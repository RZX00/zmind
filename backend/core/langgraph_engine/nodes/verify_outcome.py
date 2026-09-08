from __future__ import annotations

from typing import Any

from core.application.services.degraded_state_service import DegradedStateService
from core.application.services.canvas_native_verifier_service import CanvasNativeVerifierService
from core.domains.agent.degraded_state import DegradedState
from core.langgraph_engine.contracts.state_schema import GraphState


class DefaultVerifyOutcomeNode:
    def __init__(
        self,
        verifier_service: CanvasNativeVerifierService | None = None,
        degraded_state_service: DegradedStateService | None = None,
    ) -> None:
        self.verifier_service = verifier_service or CanvasNativeVerifierService()
        self.degraded_state_service = degraded_state_service or DegradedStateService()

    async def __call__(self, state: GraphState, ctx: Any) -> GraphState:
        tool_context = getattr(ctx, "tool_context", {}) or {}
        state["canvas_verification"] = await self.verifier_service.verify(
            state=state,
            tool_context=tool_context,
        )
        verification = state["canvas_verification"]
        if not verification.get("passed"):
            state["degraded_state"] = self.degraded_state_service.append_flag(
                state.get("degraded_state"),
                DegradedState(
                    code="canvas_native_verification_failed",
                    component="verify_outcome",
                    severity="warning",
                    user_visible=False,
                    message=str(verification.get("summary") or "Canvas native verification failed."),
                    metadata={"retryable": bool((verification.get("metadata") or {}).get("retryable"))},
                ),
            )
        return state
