from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable, List, Set


_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
_MULTI_UNDERSCORE_RE = re.compile(r"_+")


def to_snake_case(value: str) -> str:
    """Best-effort stable snake_case for tool names (ASCII a-z0-9_ only)."""
    text = (value or "").strip().lower()
    text = _NON_ALNUM_RE.sub("_", text)
    text = _MULTI_UNDERSCORE_RE.sub("_", text).strip("_")
    return text or "unknown"


def make_mcp_tool_name(server_qualified: str, tool_name: str) -> str:
    """v1 primary MCP tool name: mcp__{serverQualified}__{toolName} (snake_case)."""
    return f"mcp__{to_snake_case(server_qualified)}__{to_snake_case(tool_name)}"


def legacy_clean_alias(tool_name: str) -> str:
    """Old wrapper's 'clean name' convention (kept as alias only, when conflict-free).

    Mirrors backend/core/tools/utils/dynamic_tool_builder.py::_parse_tool_name
    but produces snake_case.
    """
    raw = (tool_name or "").strip()
    if not raw:
        return "unknown"

    if raw.startswith("custom_"):
        parts = raw.split("_")
        clean = "_".join(parts[2:]) if len(parts) >= 3 else raw
    else:
        parts = raw.split("_", 2)
        clean = parts[2] if len(parts) > 2 else raw

    return to_snake_case(clean.replace("-", "_"))


@dataclass(frozen=True)
class McpNamePlan:
    primary_name: str
    aliases: List[str] = field(default_factory=list)
    skipped_aliases: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


def plan_mcp_names(
    *,
    server_qualified: str,
    tool_name: str,
    existing_names: Set[str],
    allow_legacy_alias: bool = True,
) -> McpNamePlan:
    """Compute primary name + (optional) legacy alias plan with conflict handling."""
    primary = make_mcp_tool_name(server_qualified, tool_name)

    aliases: List[str] = []
    skipped: List[str] = []
    warnings: List[str] = []

    if allow_legacy_alias:
        alias = legacy_clean_alias(tool_name)
        if alias != primary:
            if alias in existing_names:
                skipped.append(alias)
                warnings.append(f"alias_conflict:{alias}")
            else:
                aliases.append(alias)

    return McpNamePlan(primary_name=primary, aliases=aliases, skipped_aliases=skipped, warnings=warnings)


def reserve_names(names: Iterable[str], existing_names: Set[str]) -> None:
    """Helper: add names into a shared name-set (used by adapters/registries)."""
    for name in names:
        existing_names.add(name)

