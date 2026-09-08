from __future__ import annotations

import asyncio
import ast
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Dict, Iterable, Mapping, MutableMapping, Sequence

from core.langgraph_engine.contracts import (
    DISABLED_IN_SHADOW_ERROR,
    SideEffectLevel,
    ToolCall,
    ToolExecutionResult,
    ToolRegistry as ToolRegistryProtocol,
    ToolSchemaSanitizer as ToolSchemaSanitizerProtocol,
    ToolSpec,
)
from core.utils.logger import logger

from .sanitizer import SchemaIssue, lint_openai_tool_schema, sanitize_openai_tool_schema


_SCHEMA_SANITIZE_CACHE_LOCK = Lock()
_SCHEMA_SANITIZE_CACHE: dict[tuple[str, int, bool], tuple[dict[str, Any], tuple[str, ...]]] = {}
_SCHEMA_SANITIZE_WARNINGS_LOGGED: set[tuple[str, tuple[str, ...]]] = set()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _single_field_name(tool: ToolSpec) -> str | None:
    fields = getattr(tool.args_model, "model_fields", None)
    if not isinstance(fields, dict) or not fields:
        return None
    required = [name for name, info in fields.items() if getattr(info, "is_required", lambda: False)()]
    if len(required) == 1:
        return required[0]
    if len(fields) == 1:
        return next(iter(fields))
    return None


def _parse_raw_arguments(raw: Any) -> Any:
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            try:
                return ast.literal_eval(raw)
            except Exception:
                return raw
    return raw


def _coerce_tool_arguments(tool: ToolSpec, tool_call: ToolCall) -> dict[str, Any]:
    args = tool_call.get("arguments")
    if isinstance(args, dict) and args:
        return args

    raw: Any = None
    raw_payload = tool_call.get("raw")
    if isinstance(raw_payload, dict):
        raw = raw_payload.get("arguments_str") or raw_payload.get("arguments")

    if raw is None:
        return args if isinstance(args, dict) else {}

    parsed = _parse_raw_arguments(raw)
    if isinstance(parsed, dict):
        return parsed

    fields = getattr(tool.args_model, "model_fields", {}) if tool.args_model else {}
    if isinstance(parsed, list) and isinstance(fields, dict):
        if parsed and all(isinstance(item, dict) for item in parsed):
            if "sections" in fields:
                return {"sections": parsed}
            if "operations" in fields:
                return {"operations": parsed}
        if parsed and all(isinstance(item, str) for item in parsed):
            if "task_contents" in fields:
                return {"task_contents": parsed}
            if "urls" in fields:
                return {"urls": parsed}

    field_name = _single_field_name(tool)
    if field_name:
        return {field_name: parsed}

    return args if isinstance(args, dict) else {}


def _extract_text_from_message_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        chunks: list[str] = []
        for item in content:
            if isinstance(item, str):
                text = item.strip()
                if text:
                    chunks.append(text)
                continue
            if not isinstance(item, Mapping):
                continue
            text_candidate = item.get("text")
            if isinstance(text_candidate, str) and text_candidate.strip():
                chunks.append(text_candidate.strip())
                continue
            nested = item.get("content")
            if isinstance(nested, str) and nested.strip():
                chunks.append(nested.strip())
        return "\n".join(chunks).strip()
    return ""


def _latest_user_text_from_context(context: Mapping[str, Any]) -> str:
    direct = context.get("latest_user_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()

    state = context.get("state")
    if not isinstance(state, Mapping):
        return ""
    messages = state.get("messages_context") or state.get("messages")
    if not isinstance(messages, list):
        return ""
    for message in reversed(messages):
        if not isinstance(message, Mapping):
            continue
        if str(message.get("role") or "").strip().lower() != "user":
            continue
        text = _extract_text_from_message_content(message.get("content"))
        if text:
            return text
    return ""


def _extract_title_candidate_from_text(text: str) -> str:
    content = str(text or "").strip()
    if not content:
        return ""

    quote_patterns = [
        r"[“\"]([^“”\"\n]{1,180})[”\"]",
        r"[‘']([^‘’'\n]{1,180})[’']",
        r"《([^《》\n]{1,180})》",
    ]
    for pattern in quote_patterns:
        match = re.search(pattern, content)
        if match:
            candidate = str(match.group(1) or "").strip()
            if candidate:
                return candidate

    keyword_patterns = [
        r"(?:标题|题目)\s*(?:改成|改为|设为|设置为|设置成|叫做|命名为|命名成|为|是|:|：)\s*(.+)$",
        r"(?:rename(?:\s+it)?\s+to|set(?:\s+the)?\s+title\s+to|title\s*(?:to|is|=|:))\s*(.+)$",
    ]
    for pattern in keyword_patterns:
        match = re.search(pattern, content, flags=re.IGNORECASE)
        if not match:
            continue
        candidate = str(match.group(1) or "").strip()
        candidate = candidate.strip(" \t\r\n\"'“”‘’《》。,.!?;:：")
        if candidate:
            return candidate

    return ""


def _is_missing_required_field_validation_error(exc: Exception, field_name: str) -> bool:
    target = str(field_name or "").strip()
    if not target:
        return False
    errors_fn = getattr(exc, "errors", None)
    if callable(errors_fn):
        try:
            errors = errors_fn()
        except Exception:
            errors = None
        if isinstance(errors, list):
            for err in errors:
                if not isinstance(err, Mapping):
                    continue
                loc = err.get("loc")
                err_type = str(err.get("type") or "")
                if isinstance(loc, (list, tuple)) and loc and str(loc[-1]) == target:
                    if "missing" in err_type:
                        return True
                    if err_type in {"string_too_short", "too_short"}:
                        return True
                if isinstance(loc, str) and loc == target and ("missing" in err_type):
                    return True
    message = str(exc).lower()
    if f"{target}" in message and "field required" in message:
        return True
    if f"{target}" in message and "string_too_short" in message:
        return True
    return False


def _is_missing_title_validation_error(exc: Exception) -> bool:
    return _is_missing_required_field_validation_error(exc, "title")


def _is_missing_prompt_validation_error(exc: Exception) -> bool:
    return _is_missing_required_field_validation_error(exc, "prompt")


def _repair_doc_update_title_args(
    args_for_validation: Mapping[str, Any],
    context: Mapping[str, Any],
) -> dict[str, Any] | None:
    repaired = dict(args_for_validation or {})
    existing_title = repaired.get("title")
    if isinstance(existing_title, str) and existing_title.strip():
        return repaired
    latest_user_text = _latest_user_text_from_context(context)
    inferred_title = _extract_title_candidate_from_text(latest_user_text)
    if not inferred_title:
        return None
    repaired["title"] = inferred_title
    return repaired


def _repair_doc_generate_image_args(
    args_for_validation: Mapping[str, Any],
    context: Mapping[str, Any],
) -> dict[str, Any] | None:
    repaired = dict(args_for_validation or {})
    existing_prompt = repaired.get("prompt")
    if isinstance(existing_prompt, str) and existing_prompt.strip():
        return repaired
    latest_user_text = _latest_user_text_from_context(context)
    inferred_prompt = str(latest_user_text or "").strip()
    if not inferred_prompt:
        return None
    repaired["prompt"] = inferred_prompt
    return repaired


class DefaultToolSchemaSanitizer(ToolSchemaSanitizerProtocol):
    """Generate tool schema from Pydantic v2, then sanitize into the v1 safe subset."""

    def sanitize_openai_tool_schema(self, tool: ToolSpec) -> dict[str, Any]:
        # Some OpenAI-compatible gateways reject top-level parameter names starting with '$'.
        # For canvas_edit we expose non-$ field names in the schema while still accepting both
        # via validation aliases.
        use_alias = tool.name != "canvas_edit"
        cache_key = (tool.name, id(tool.args_model), use_alias)

        with _SCHEMA_SANITIZE_CACHE_LOCK:
            cached = _SCHEMA_SANITIZE_CACHE.get(cache_key)
        if cached is not None:
            return cached[0]

        raw_params = tool.args_model.model_json_schema(by_alias=use_alias)
        raw_tool_schema: Dict[str, Any] = {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": raw_params,
            },
        }

        sanitized, warnings = sanitize_openai_tool_schema(raw_tool_schema)
        issues = lint_openai_tool_schema(sanitized)
        if issues:
            summary = ", ".join(sorted({i.rule for i in issues}))
            raise ValueError(f"Tool schema for '{tool.name}' is not v1-compatible after sanitization: {summary}")

        warning_rules = tuple(w.rule for w in warnings)
        should_log_warnings = False
        with _SCHEMA_SANITIZE_CACHE_LOCK:
            _SCHEMA_SANITIZE_CACHE[cache_key] = (sanitized, warning_rules)
            if warning_rules and (tool.name, warning_rules) not in _SCHEMA_SANITIZE_WARNINGS_LOGGED:
                _SCHEMA_SANITIZE_WARNINGS_LOGGED.add((tool.name, warning_rules))
                should_log_warnings = True

        if warning_rules and should_log_warnings:
            logger.debug(
                "Tool schema sanitized with downgrades",
                tool=tool.name,
                warnings=list(warning_rules),
            )

        return sanitized


@dataclass(slots=True)
class ToolRegistrationReport:
    registered: int = 0
    skipped: int = 0
    alias_conflicts: list[str] = field(default_factory=list)
    schema_warnings: dict[str, list[str]] = field(default_factory=dict)


class InMemoryToolRegistry(ToolRegistryProtocol):
    """Simple ToolRegistry implementation (v1).

    Notes:
    - Canonical names are exported to the model.
    - Aliases are accepted for execution, but are *not* exported by default.
    """

    def __init__(self, sanitizer: ToolSchemaSanitizerProtocol | None = None):
        self._sanitizer = sanitizer or DefaultToolSchemaSanitizer()
        self._tools_by_name: dict[str, ToolSpec] = {}
        self._alias_to_name: dict[str, str] = {}
        self._schema_cache: dict[str, dict[str, Any]] = {}
        self._schema_warnings: dict[str, list[str]] = {}

    def register(self, tool: ToolSpec) -> None:
        if tool.name in self._tools_by_name or tool.name in self._alias_to_name:
            raise ValueError(f"Tool name collision: {tool.name}")

        # Validate schema at registration time so failures are visible early.
        # Sanitizer already validates and caches schema.
        sanitized_schema = self._sanitizer.sanitize_openai_tool_schema(tool)

        self._tools_by_name[tool.name] = tool
        self._schema_cache[tool.name] = sanitized_schema
        # Default sanitizer logs its own warnings; cache remains optional.

        for alias in tool.aliases:
            alias_name = str(alias).strip()
            if not alias_name or alias_name == tool.name:
                continue
            if alias_name in self._tools_by_name or alias_name in self._alias_to_name:
                logger.warning("Skipping tool alias due to conflict", alias=alias_name, tool=tool.name)
                continue
            self._alias_to_name[alias_name] = tool.name

    def get(self, name: str) -> ToolSpec | None:
        tool = self._tools_by_name.get(name)
        if tool:
            return tool
        resolved = self._alias_to_name.get(name)
        if not resolved:
            return None
        return self._tools_by_name.get(resolved)

    def list_tools(self) -> Sequence[ToolSpec]:
        return list(self._tools_by_name.values())

    def openai_tools_schema(self) -> list[dict[str, Any]]:
        # Canonical-only export (aliases are accepted but not advertised).
        return [self._schema_cache[name] for name in sorted(self._schema_cache.keys())]

    def schema_warnings(self) -> Mapping[str, list[str]]:
        return dict(self._schema_warnings)

    async def execute_tool_call(
        self,
        tool_call: ToolCall,
        context: MutableMapping[str, Any],
    ) -> ToolExecutionResult:
        """Validate + gate + execute, returning a canonical ToolExecutionResult."""
        started_at = _now_iso()

        tool = self.get(tool_call["name"])
        if not tool:
            ended_at = _now_iso()
            return {
                "tool_call_id": tool_call["id"],
                "name": tool_call["name"],
                "success": False,
                "started_at": started_at,
                "ended_at": ended_at,
                "error": "tool_not_found",
            }

        if _is_disabled_by_policy(tool, context):
            ended_at = _now_iso()
            return {
                "tool_call_id": tool_call["id"],
                "name": tool.name,
                "success": False,
                "started_at": started_at,
                "ended_at": ended_at,
                "error": DISABLED_IN_SHADOW_ERROR,
                "metadata": {
                    "side_effect_level": tool.side_effect_level,
                    "side_effect_policy": context.get("side_effect_policy"),
                    "is_shadow": bool(context.get("is_shadow")),
                },
            }

        args: dict[str, Any]
        args_for_validation: dict[str, Any] = {}
        try:
            args_for_validation = _coerce_tool_arguments(tool, tool_call)
            validated = tool.args_model.model_validate(args_for_validation)
            # Prefer aliases so handlers receive canonical user-facing keys
            # (e.g. CaC "$delete", "$id", and connection endpoints "from"/"to").
            args = validated.model_dump(by_alias=True)
        except Exception as exc:
            if tool.name == "doc_update_title" and _is_missing_title_validation_error(exc):
                repaired_args = _repair_doc_update_title_args(args_for_validation, context)
                if repaired_args is None:
                    ended_at = _now_iso()
                    return {
                        "tool_call_id": tool_call["id"],
                        "name": tool.name,
                        "success": True,
                        "started_at": started_at,
                        "ended_at": ended_at,
                        "output": {
                            "skipped": True,
                            "reason": "missing_required_title",
                        },
                        "metadata": {
                            "message": "doc_update_title skipped because required title argument was missing",
                        },
                    }
                try:
                    validated = tool.args_model.model_validate(repaired_args)
                    args = validated.model_dump(by_alias=True)
                except Exception as repair_exc:
                    ended_at = _now_iso()
                    return {
                        "tool_call_id": tool_call["id"],
                        "name": tool.name,
                        "success": False,
                        "started_at": started_at,
                        "ended_at": ended_at,
                        "error": f"args_validation_error:{type(repair_exc).__name__}",
                        "metadata": {
                            "message": str(repair_exc)[:500],
                            "raw_arguments": repaired_args,
                        },
                    }
            elif tool.name == "doc_generate_image_and_insert" and _is_missing_prompt_validation_error(exc):
                repaired_args = _repair_doc_generate_image_args(args_for_validation, context)
                if repaired_args is None:
                    ended_at = _now_iso()
                    return {
                        "tool_call_id": tool_call["id"],
                        "name": tool.name,
                        "success": True,
                        "started_at": started_at,
                        "ended_at": ended_at,
                        "output": {
                            "skipped": True,
                            "reason": "missing_required_prompt",
                        },
                        "metadata": {
                            "message": (
                                "doc_generate_image_and_insert skipped because required prompt argument was missing"
                            ),
                        },
                    }
                try:
                    validated = tool.args_model.model_validate(repaired_args)
                    args = validated.model_dump(by_alias=True)
                except Exception as repair_exc:
                    ended_at = _now_iso()
                    return {
                        "tool_call_id": tool_call["id"],
                        "name": tool.name,
                        "success": False,
                        "started_at": started_at,
                        "ended_at": ended_at,
                        "error": f"args_validation_error:{type(repair_exc).__name__}",
                        "metadata": {
                            "message": str(repair_exc)[:500],
                            "raw_arguments": repaired_args,
                        },
                    }
            else:
                ended_at = _now_iso()
                raw_payload = tool_call.get("raw") if isinstance(tool_call, dict) else None
                raw_args = None
                raw_summary = None
                raw_schema = None
                if isinstance(raw_payload, dict):
                    raw_args = raw_payload.get("arguments_str") or raw_payload.get("arguments")
                    raw_summary = raw_payload.get("call_summary")
                    raw_schema = raw_payload.get("schema_summary")
                if raw_args is None:
                    raw_args = tool_call.get("arguments") if isinstance(tool_call, dict) else None
                return {
                    "tool_call_id": tool_call["id"],
                    "name": tool.name,
                    "success": False,
                    "started_at": started_at,
                    "ended_at": ended_at,
                    "error": f"args_validation_error:{type(exc).__name__}",
                    "metadata": {
                        "message": str(exc)[:500],
                        "raw_arguments": raw_args,
                        "tool_call_summary": raw_summary,
                        "tool_schema_summary": raw_schema,
                    },
                }

        # Provide standard call context keys for handlers.
        call_context: Dict[str, Any] = dict(context)
        call_context.setdefault("tool_call_id", tool_call["id"])
        call_context.setdefault("tool_name", tool.name)

        try:
            if tool.timeout_s:
                result = await asyncio.wait_for(tool.handler(args, call_context), timeout=tool.timeout_s)
            else:
                result = await tool.handler(args, call_context)
        except asyncio.TimeoutError:
            ended_at = _now_iso()
            return {
                "tool_call_id": tool_call["id"],
                "name": tool.name,
                "success": False,
                "started_at": started_at,
                "ended_at": ended_at,
                "error": "tool_timeout",
            }
        except Exception as exc:
            ended_at = _now_iso()
            return {
                "tool_call_id": tool_call["id"],
                "name": tool.name,
                "success": False,
                "started_at": started_at,
                "ended_at": ended_at,
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

        # Ensure required fields are always present/stable.
        result.setdefault("tool_call_id", tool_call["id"])
        result.setdefault("name", tool.name)
        result.setdefault("started_at", started_at)
        result.setdefault("ended_at", _now_iso())
        result.setdefault("success", bool(result.get("success")))
        return result


def _is_disabled_by_policy(tool: ToolSpec, context: Mapping[str, Any]) -> bool:
    is_shadow = bool(context.get("is_shadow"))
    policy = context.get("side_effect_policy") or "allow_all"

    if is_shadow and tool.side_effect_level != SideEffectLevel.READ_ONLY:
        return True

    if policy in ("dry_run", "deny_write") and tool.side_effect_level != SideEffectLevel.READ_ONLY:
        return True

    return False


def lint_registry_openai_schemas(registry: InMemoryToolRegistry) -> dict[str, list[SchemaIssue]]:
    """Utility for CI/scripts: run linter over exported schemas."""
    out: dict[str, list[SchemaIssue]] = {}
    for idx, schema in enumerate(registry.openai_tools_schema()):
        name = str(schema.get("function", {}).get("name") or f"tool_{idx}")
        issues = lint_openai_tool_schema(schema, path=f"$[{idx}]")
        if issues:
            out[name] = issues
    return out
