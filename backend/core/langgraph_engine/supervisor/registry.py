from __future__ import annotations

from typing import Any, Iterable

from core.langgraph_engine.tools.catalog import build_full_tool_catalog
from core.langgraph_engine.tools.registry import InMemoryToolRegistry

from .agent_defs import SUPERVISOR_AGENT_DEFS, AgentDef
from .handoff_tools import build_handoff_tool_specs


def _filter_agent_defs(
    agent_defs: dict[str, AgentDef],
    allowed_names: Iterable[str] | None,
) -> dict[str, AgentDef]:
    if not allowed_names:
        return agent_defs
    allowed = set(allowed_names)
    return {name: agent for name, agent in agent_defs.items() if name in allowed}


def build_supervisor_registry(
    *,
    agent_defs: dict[str, AgentDef] | None = None,
    allowed_agent_names: Iterable[str] | None = None,
    include_native_tools: bool = False,
    native_allowed_names: set[str] | None = None,
    native_allowed_prefixes: set[str] | None = None,
    mcp_service: Any | None = None,
) -> InMemoryToolRegistry:
    registry = InMemoryToolRegistry()

    if include_native_tools:
        for spec in build_full_tool_catalog(
            mcp_service=mcp_service,
            allowed_names=native_allowed_names,
            allowed_prefixes=native_allowed_prefixes,
        ):
            registry.register(spec)

    defs = agent_defs or SUPERVISOR_AGENT_DEFS
    for spec in build_handoff_tool_specs(_filter_agent_defs(defs, allowed_agent_names)):
        registry.register(spec)

    return registry
