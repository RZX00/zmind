from __future__ import annotations

from typing import Any

from core.application.services.canvas_native_repair_service import CanvasNativeRepairService
from core.langgraph_engine.contracts.state_schema import GraphState


class DefaultRepairPlanNode:
    def __init__(self, repair_service: CanvasNativeRepairService | None = None) -> None:
        self.repair_service = repair_service or CanvasNativeRepairService()

    async def __call__(self, state: GraphState, ctx: Any) -> GraphState:
        tool_context = getattr(ctx, "tool_context", {}) or {}
        repaired = await self.repair_service.repair(state=state, tool_context=tool_context)
        state["repair_count"] = repaired["repair_count"]
        state["canvas_task"] = repaired["canvas_task"]
        state["canvas_context"] = repaired["canvas_context"]
        state["canvas_runtime"] = repaired["canvas_runtime"]
        return state
