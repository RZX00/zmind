from __future__ import annotations

from typing import Any, Optional, Set

from core.langgraph_engine.contracts import ToolSpec
from core.utils.logger import logger

from .adapters.native_tool_adapter import build_native_tool_specs
from .adapters.mcp_tool_adapter import build_mcp_tool_specs
from .registry import InMemoryToolRegistry


def build_static_tool_catalog() -> list[ToolSpec]:
    """All non-MCP tools (v1)."""
    return build_native_tool_specs()


def build_full_tool_catalog(
    *,
    mcp_service: Any | None = None,
    mcp_read_only_allowlist: Optional[Set[str]] = None,
    allowed_names: Optional[Set[str]] = None,
    allowed_prefixes: Optional[Set[str]] = None,
) -> list[ToolSpec]:
    """Static tools + (optional) dynamic MCP tools (v1)."""
    specs = list(build_static_tool_catalog())
    if allowed_names is not None or allowed_prefixes is not None:
        specs = _filter_specs(specs, allowed_names=allowed_names, allowed_prefixes=allowed_prefixes)
    if not mcp_service:
        return specs

    existing_names = {spec.name for spec in specs}
    mcp_specs, mcp_warnings = build_mcp_tool_specs(
        mcp_service=mcp_service,
        existing_names=existing_names,
        read_only_allowlist=set(mcp_read_only_allowlist or set()),
    )
    if mcp_warnings:
        logger.warning("MCP tool registration warnings", warnings=mcp_warnings)
    specs.extend(mcp_specs)
    if allowed_names is not None or allowed_prefixes is not None:
        specs = _filter_specs(specs, allowed_names=allowed_names, allowed_prefixes=allowed_prefixes)
    return specs


def build_registry(
    *,
    mcp_service: Any | None = None,
    mcp_read_only_allowlist: Optional[Set[str]] = None,
    allowed_names: Optional[Set[str]] = None,
    allowed_prefixes: Optional[Set[str]] = None,
) -> InMemoryToolRegistry:
    """Convenience builder used by WS-A engine nodes."""
    registry = InMemoryToolRegistry()
    for tool in build_full_tool_catalog(
        mcp_service=mcp_service,
        mcp_read_only_allowlist=mcp_read_only_allowlist,
        allowed_names=allowed_names,
        allowed_prefixes=allowed_prefixes,
    ):
        registry.register(tool)
    return registry


def _filter_specs(
    specs: list[ToolSpec],
    *,
    allowed_names: Optional[Set[str]] = None,
    allowed_prefixes: Optional[Set[str]] = None,
) -> list[ToolSpec]:
    if allowed_names is None and allowed_prefixes is None:
        return specs
    name_set = set(allowed_names or set())
    prefixes = tuple(allowed_prefixes or set())
    filtered: list[ToolSpec] = []
    for spec in specs:
        if spec.name in name_set:
            filtered.append(spec)
            continue
        if prefixes and spec.name.startswith(prefixes):
            filtered.append(spec)
            continue
    return filtered
