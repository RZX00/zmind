from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from pydantic import BaseModel, ConfigDict, Field, create_model

from core.langgraph_engine.contracts import SideEffectLevel, ToolExecutionResult, ToolSpec
from core.services import redis as redis_service
from core.utils.logger import logger

from ..mcp_naming import McpNamePlan, plan_mcp_names
from ..sanitizer import SANITIZER_VERSION, sanitize_json_schema


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class _McpSchemaCache:
    """Best-effort Redis cache for sanitized MCP schemas (non-fatal on failure)."""

    def __init__(self, *, ttl_seconds: int = 3600, key_prefix: str = "wsb:mcp_tool:") -> None:
        self._ttl = ttl_seconds
        self._key_prefix = key_prefix

    def make_key(self, *, config_hash: str, primary_name: str) -> str:
        return f"{self._key_prefix}{SANITIZER_VERSION}:{config_hash}:{primary_name}"

    async def _get_client(self):
        try:
            return await redis_service.get_client()
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("MCP cache: redis unavailable", error=str(exc))
            return None

    async def _get(self, key: str) -> Optional[dict[str, Any]]:
        client = await self._get_client()
        if not client:
            return None
        try:
            raw = await client.get(key)
            if not raw:
                return None
            return json.loads(raw)
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("MCP cache read failed", key=key, error=str(exc))
            return None

    async def _set(self, key: str, payload: dict[str, Any]) -> None:
        client = await self._get_client()
        if not client:
            return
        try:
            await client.setex(key, self._ttl, json.dumps(payload))
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("MCP cache write failed", key=key, error=str(exc))

    def get_sync(self, key: str) -> Optional[dict[str, Any]]:
        """Sync-friendly wrapper. Skips when already inside a running loop."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            # In running loop; avoid blocking. Caller treats as cache miss.
            return None

        try:
            return asyncio.run(self._get(key))
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("MCP cache get skipped", key=key, error=str(exc))
            return None

    def set_sync(self, key: str, payload: dict[str, Any]) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            # Fire-and-forget in running loop; ignore failures.
            loop.create_task(self._set(key, payload))
            return

        try:
            asyncio.run(self._set(key, payload))
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("MCP cache set skipped", key=key, error=str(exc))


def _connection_config_hash(connection: Any) -> str:
    payload: Dict[str, Any] = {
        "qualified_name": getattr(connection, "qualified_name", None),
        "config": getattr(connection, "config", None),
        "provider": getattr(connection, "provider", None),
        "enabled_tools": sorted(list(getattr(connection, "enabled_tools", []) or [])),
    }
    try:
        blob = json.dumps(payload, sort_keys=True, default=str)
    except Exception:
        blob = str(payload)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


class McpDynamicArgs(BaseModel):
    """Fallback args model for MCP tools when input schema is unusable."""

    model_config = ConfigDict(extra="allow")


def build_mcp_tool_specs(
    *,
    mcp_service: Any,
    existing_names: Optional[Set[str]] = None,
    read_only_allowlist: Optional[Set[str]] = None,
) -> Tuple[list[ToolSpec], list[str]]:
    """Build ToolSpec list for connected MCP servers.

    v1:
    - Primary name: mcp__{serverQualified}__{toolName}
    - side_effect_level default: EXTERNAL_WRITE
    - legacy clean alias: only if conflict-free (registered as ToolSpec.aliases)
    """
    existing = set(existing_names or set())
    allow_read_only = set(read_only_allowlist or set())
    cache = _McpSchemaCache()

    specs: list[ToolSpec] = []
    warnings: list[str] = []

    connections = list(getattr(mcp_service, "get_all_connections")() or [])
    for connection in connections:
        server_qualified = str(getattr(connection, "qualified_name", "") or "")
        config_hash = _connection_config_hash(connection)
        enabled_tools = set(getattr(connection, "enabled_tools", []) or [])
        tools = list(getattr(connection, "tools", []) or [])

        for tool in tools:
            tool_name = str(getattr(tool, "name", "") or "")
            if not tool_name or (enabled_tools and tool_name not in enabled_tools):
                continue

            name_plan: McpNamePlan = plan_mcp_names(
                server_qualified=server_qualified,
                tool_name=tool_name,
                existing_names=existing,
                allow_legacy_alias=True,
            )
            existing.add(name_plan.primary_name)
            for alias in name_plan.aliases:
                existing.add(alias)

            for warn in name_plan.warnings:
                warnings.append(f"{name_plan.primary_name}:{warn}")

            description = str(getattr(tool, "description", "") or "").strip() or f"MCP tool '{tool_name}'."
            description = f"{description} (MCP Server: {server_qualified})"

            raw_input_schema = getattr(tool, "inputSchema", None)
            cache_key = cache.make_key(config_hash=config_hash, primary_name=name_plan.primary_name)
            cached_entry = cache.get_sync(cache_key)
            cached_params = None
            if isinstance(cached_entry, dict) and cached_entry.get("sanitizer_version") == SANITIZER_VERSION:
                cached_params = cached_entry.get("parameters")

            args_model, sanitized_params = _build_args_model_for_mcp_tool(
                name_plan.primary_name, raw_input_schema, cached_sanitized_schema=cached_params
            )

            side_effect = SideEffectLevel.EXTERNAL_WRITE
            if name_plan.primary_name in allow_read_only:
                side_effect = SideEffectLevel.READ_ONLY

            specs.append(
                ToolSpec(
                    name=name_plan.primary_name,
                    description=description,
                    args_model=args_model,
                    handler=_call_mcp_tool(tool_name=tool_name),
                    side_effect_level=side_effect,
                    aliases=tuple(name_plan.aliases),
                )
            )

            if sanitized_params is not None:
                cache_payload = {
                    "sanitizer_version": SANITIZER_VERSION,
                    "parameters": sanitized_params,
                    "side_effect_level": side_effect.value,
                    "aliases": name_plan.aliases,
                    "description": description,
                    "server_qualified": server_qualified,
                    "tool_name": tool_name,
                    "cached_at": _now_iso(),
                }
                cache.set_sync(cache_key, cache_payload)

    return specs, warnings


def _build_args_model_for_mcp_tool(
    tool_schema_name: str,
    raw_input_schema: Any,
    *,
    cached_sanitized_schema: Any | None = None,
) -> Tuple[type[BaseModel], Optional[dict[str, Any]]]:
    """Create a best-effort Pydantic v2 args model from MCP inputSchema.

    We intentionally keep the Python types permissive (dict/list/str/int/bool/float)
    and rely on WS-B sanitizer to produce the strict v1 schema subset exported to
    the model.
    """
    sanitized = cached_sanitized_schema
    if sanitized is None:
        if not isinstance(raw_input_schema, dict):
            return McpDynamicArgs, None
        sanitized, _warnings = sanitize_json_schema(raw_input_schema, root=raw_input_schema, path="$")

    if not isinstance(sanitized, dict) or sanitized.get("type") != "object":
        return McpDynamicArgs, None

    properties = sanitized.get("properties")
    if not isinstance(properties, dict):
        properties = {}

    required = set(sanitized.get("required") or [])
    fields: Dict[str, Tuple[Any, Any]] = {}

    for prop_name, prop_schema in properties.items():
        annotation = _schema_to_annotation(prop_schema)
        default = ... if prop_name in required else None
        fields[str(prop_name)] = (annotation, Field(default=default))

    model_name = f"McpArgs_{tool_schema_name}"
    return create_model(model_name, __base__=McpDynamicArgs, **fields), sanitized  # type: ignore[arg-type]


def _schema_to_annotation(schema: Any) -> Any:
    if not isinstance(schema, dict):
        return Any
    schema_type = schema.get("type")
    if schema_type == "string":
        return Optional[str]
    if schema_type == "integer":
        return Optional[int]
    if schema_type == "number":
        return Optional[float]
    if schema_type == "boolean":
        return Optional[bool]
    if schema_type == "array":
        return Optional[List[Any]]
    if schema_type == "object":
        return Optional[Dict[str, Any]]
    return Any


def _call_mcp_tool(*, tool_name: str):
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            mcp_service = context.get("mcp_service")
            if not mcp_service:
                raise ValueError("context.mcp_service is required for MCP tools")

            result = await mcp_service.execute_tool(tool_name, args, external_user_id=context.get("external_user_id"))

            ended_at = _now_iso()
            success = bool(getattr(result, "success", False))
            payload: ToolExecutionResult = {
                "tool_call_id": tool_call_id,
                "name": str(context.get("tool_name") or tool_name),
                "success": success,
                "started_at": started_at,
                "ended_at": ended_at,
            }

            if success:
                payload["output"] = getattr(result, "result", None)
            else:
                payload["error"] = getattr(result, "error", None) or "mcp_tool_error"
                payload["output"] = getattr(result, "result", None)

            return payload
        except Exception as exc:
            logger.exception("MCP tool call failed", tool=tool_name)
            return {
                "tool_call_id": tool_call_id,
                "name": str(context.get("tool_name") or tool_name),
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler
