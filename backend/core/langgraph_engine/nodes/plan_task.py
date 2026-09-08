from __future__ import annotations

from typing import Any

from core.application.services.canvas_native_context_resolver_service import (
    CanvasNativeContextResolverService,
)
from core.application.services.canvas_native_planner_service import CanvasNativePlannerService
from core.application.services.degraded_state_service import DegradedStateService
from core.domains.agent.degraded_state import DegradedState
from core.langgraph_engine.contracts.state_schema import GraphState


class DefaultPlanTaskNode:
    def __init__(
        self,
        context_resolver: CanvasNativeContextResolverService | None = None,
        planner_service: CanvasNativePlannerService | None = None,
        degraded_state_service: DegradedStateService | None = None,
    ) -> None:
        self.context_resolver = context_resolver or CanvasNativeContextResolverService()
        self.planner_service = planner_service or CanvasNativePlannerService()
        self.degraded_state_service = degraded_state_service or DegradedStateService()

    async def __call__(self, state: GraphState, ctx: Any) -> GraphState:
        tool_context = getattr(ctx, "tool_context", {}) or {}
        runtime = state.get("canvas_runtime") or {}

        canvas_context = await self.context_resolver.resolve(state, tool_context)
        state["canvas_context"] = canvas_context
        for warning in list(canvas_context.get("selection_warnings") or []) + list(canvas_context.get("snapshot_warnings") or []):
            state["degraded_state"] = self.degraded_state_service.append_flag(
                state.get("degraded_state"),
                DegradedState(
                    code=str(warning),
                    component="plan_task",
                    severity="warning",
                    user_visible=False,
                    message=f"Canvas native context warning: {warning}",
                ),
            )

        task_ir = self.planner_service.plan(state=state, context=canvas_context)
        task_payload = task_ir.to_dict()
        task_payload["status"] = "planned"
        task_payload["mode"] = runtime.get("mode") or "apply"
        state["canvas_task"] = task_payload
        best_path = (task_payload.get("metadata") or {}).get("best_path") or {}
        if best_path.get("budget_exceeded"):
            state["degraded_state"] = self.degraded_state_service.append_flag(
                state.get("degraded_state"),
                DegradedState(
                    code="canvas_best_path_budget_exceeded",
                    component="plan_task",
                    severity="warning",
                    user_visible=False,
                    message="Canvas best-path planning exceeded the configured budget and fell back to the baseline plan.",
                ),
            )

        return state
