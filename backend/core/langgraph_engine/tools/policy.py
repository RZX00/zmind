from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Set

from core.utils.logger import logger


@dataclass(frozen=True, slots=True)
class ToolPolicy:
    allowed_names: Optional[Set[str]] = None
    allowed_prefixes: Optional[Set[str]] = None
    source: str = "none"  # none | explicit | native_tools


def resolve_tool_policy(
    agent_config: dict[str, Any] | None,
    *,
    mcp_enabled: bool,
) -> ToolPolicy:
    """Resolve which tools are visible to the model.

    Precedence:
    1) Explicit allow/deny lists in agent_config (recommended).
    2) Legacy agent_config.native_tools toggles (best-effort mapping).
    3) No policy (return ToolPolicy(source="none")).
    """
    if not isinstance(agent_config, dict) or not agent_config:
        return ToolPolicy()

    allowlist = _normalize_str_set(agent_config.get("tool_allowlist") or agent_config.get("tool_allow_list"))
    allow_prefixes = _normalize_str_set(
        agent_config.get("tool_allow_prefixes")
        or agent_config.get("tool_allow_prefix")
        or agent_config.get("tool_allow_prefix_list")
    )
    denylist = _normalize_str_set(agent_config.get("tool_denylist") or agent_config.get("tool_deny_list"))

    if allowlist or allow_prefixes or denylist:
        allowed_names = set(allowlist) if allowlist else None
        allowed_prefixes = set(allow_prefixes) if allow_prefixes else None
        if denylist:
            if allowed_names is None:
                # If denylist exists without allowlist, start from all static tool names.
                allowed_names = _all_static_tool_names()
            allowed_names -= set(denylist)
        return ToolPolicy(
            allowed_names=allowed_names,
            allowed_prefixes=allowed_prefixes,
            source="explicit",
        )

    native_tools = agent_config.get("native_tools")
    if not isinstance(native_tools, dict) or not native_tools:
        return ToolPolicy()

    # Default to permissive when a toggle is missing: we only *disable* when explicitly disabled.
    def enabled(key: str, *, default: bool = True) -> bool:
        value = native_tools.get(key, None)
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, dict):
            return bool(value.get("enabled", default))
        return bool(value)

    disabled_names: set[str] = set()

    if not enabled("web_search_tool"):
        disabled_names.update(
            {
                "web_search",
                "scrape_webpage",
                "image_search",
                "intelligent_web_search",
                "extract_web_content",
            }
        )

    if not enabled("upload_file_tool"):
        disabled_names.add("upload_file")

    if not enabled("data_providers_tool"):
        disabled_names.update(
            {
                "people_search",
                "company_search",
                "get_data_provider_endpoints",
                "execute_data_provider_call",
            }
        )

    if not enabled("trigger_tool"):
        disabled_names.update(
            {
                "create_scheduled_trigger",
                "get_scheduled_triggers",
                "delete_scheduled_trigger",
                "toggle_scheduled_trigger",
                "list_event_trigger_apps",
                "list_app_event_triggers",
                "create_event_trigger",
            }
        )

    # Optional finer toggle: keep backwards compatibility if it exists in configs.
    if "people_search_tool" in native_tools and not enabled("people_search_tool"):
        disabled_names.update({"people_search", "company_search"})

    allowed_names = _all_static_tool_names() - disabled_names

    allowed_prefixes: set[str] = set()
    if mcp_enabled and enabled("mcp_search_tool"):
        allowed_prefixes.add("mcp__")

    return ToolPolicy(
        allowed_names=allowed_names,
        # Preserve empty set to represent "filtering on, but no prefixes allowed".
        allowed_prefixes=allowed_prefixes,
        source="native_tools",
    )


def _normalize_str_set(value: Any) -> set[str]:
    if value is None:
        return set()
    if isinstance(value, str):
        cleaned = value.strip()
        return {cleaned} if cleaned else set()
    if isinstance(value, (list, tuple, set)):
        out: set[str] = set()
        for item in value:
            if isinstance(item, str):
                cleaned = item.strip()
                if cleaned:
                    out.add(cleaned)
        return out
    return set()


def _all_static_tool_names() -> set[str]:
    try:
        from core.langgraph_engine.tools.catalog import build_static_tool_catalog

        return {spec.name for spec in build_static_tool_catalog()}
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to build static tool set for policy; falling back to empty", error=str(exc))
        return set()
