from __future__ import annotations

from typing import Any

from core.langgraph_engine.contracts.engine_interface import RunConfig
from core.langgraph_engine.graph import LangGraphBuilder
from core.langgraph_engine.tools.catalog import build_registry


async def _noop_emit(event: dict[str, Any]) -> None:
    # LangGraph dev server will handle visualization; no-op here.
    return None


def create_graph():
    """
    LangGraph dev entrypoint.

    Uses in-memory checkpointing and a minimal RunConfig for visualization.
    """
    registry = build_registry()
    builder = LangGraphBuilder(
        emit=_noop_emit,
        stop_event=None,
        tool_registry=registry,
        run_config=RunConfig(
            agent_run_id="dev",
            thread_id="dev",
            project_id=None,
            account_id="dev",
            model_name="openai/gpt-4o-mini",
        ),
        tool_context={},
    )
    return builder.build()

# Export a singleton graph for langgraph CLI to pick up via langgraph.json
graph = create_graph()
