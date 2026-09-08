from __future__ import annotations

from typing import Any

from core.application.services.canvas_native_narration_service import (
    CanvasNativeNarrationService,
)
from core.application.services.degraded_state_service import DegradedStateService
from core.domains.agent.degraded_state import DegradedState
from core.langgraph_engine.contracts.state_schema import GraphState


class DefaultNarrateResultNode:
    def __init__(
        self,
        narration_service: CanvasNativeNarrationService | None = None,
        degraded_state_service: DegradedStateService | None = None,
    ) -> None:
        self.narration_service = narration_service or CanvasNativeNarrationService()
        self.degraded_state_service = degraded_state_service or DegradedStateService()

    async def __call__(self, state: GraphState, ctx: Any) -> GraphState:
        execution = state.get("canvas_execution") or {}
        verification = state.get("canvas_verification") or {}
        if execution.get("status") == "failed" or not verification.get("passed", True):
            state["degraded_state"] = self.degraded_state_service.append_flag(
                state.get("degraded_state"),
                DegradedState(
                    code="canvas_native_user_visible_failure",
                    component="narrate_result",
                    severity="error",
                    user_visible=True,
                    message="Canvas native runtime finished with verification failure.",
                    metadata={
                        "execution_status": execution.get("status"),
                        "verification_summary": verification.get("summary"),
                    },
                ),
            )

        payload = self.narration_service.build(state=state)
        deferred_events = list(state.get("deferred_events") or [])
        deferred_events.append(payload["event"])
        state["deferred_events"] = deferred_events
        state["termination"] = payload["termination"]
        return state
