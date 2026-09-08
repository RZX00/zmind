from __future__ import annotations

from typing import Any

from core.application.services.degraded_state_service import DegradedStateService
from core.application.services.canvas_native_executor_service import CanvasNativeExecutorService
from core.domains.agent.degraded_state import DegradedState
from core.langgraph_engine.contracts.state_schema import GraphState


class DefaultExecutePlanNode:
    def __init__(
        self,
        executor_service: CanvasNativeExecutorService | None = None,
        degraded_state_service: DegradedStateService | None = None,
    ) -> None:
        self.executor_service = executor_service or CanvasNativeExecutorService()
        self.degraded_state_service = degraded_state_service or DegradedStateService()

    async def __call__(self, state: GraphState, ctx: Any) -> GraphState:
        tool_context = getattr(ctx, "tool_context", {}) or {}
        execution = await self.executor_service.execute(state=state, tool_context=tool_context)
        state["canvas_execution"] = execution
        if execution.get("mode") == "shadow":
            state["degraded_state"] = self.degraded_state_service.append_flag(
                state.get("degraded_state"),
                DegradedState(
                    code="canvas_native_shadow_mode",
                    component="execute_plan",
                    severity="info",
                    user_visible=False,
                    message="Canvas native runtime is running in shadow mode.",
                ),
            )
        if execution.get("status") == "failed":
            error = execution.get("error") or {}
            state["degraded_state"] = self.degraded_state_service.append_flag(
                state.get("degraded_state"),
                DegradedState(
                    code=str(error.get("code") or "canvas_native_execute_failed"),
                    component="execute_plan",
                    severity="error",
                    user_visible=False,
                    message=str(error.get("message") or "Canvas native execution failed."),
                    metadata={"retryable": bool(execution.get("retryable"))},
                ),
            )
        return state
