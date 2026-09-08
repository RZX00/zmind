from __future__ import annotations

from typing import Any

from core.application.services.canvas_native_runtime_policy_service import (
    CanvasNativeRuntimePolicyService,
)
from core.application.services.degraded_state_service import DegradedStateService
from core.application.services.intent_resolution_service import IntentResolutionService
from core.domains.agent.degraded_state import DegradedState
from core.langgraph_engine.contracts.state_schema import GraphState
from core.utils.config import config


def _latest_user_text(messages: list[dict[str, Any]]) -> str:
    for message in reversed(messages):
        if str(message.get("role") or "").strip().lower() != "user":
            continue

        content = message.get("content")
        if isinstance(content, str):
            return content.strip()

        if isinstance(content, list):
            parts: list[str] = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                text = part.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
            if parts:
                return "\n".join(parts)

    return ""


class DefaultResolveIntentNode:
    def __init__(
        self,
        intent_resolution_service: IntentResolutionService | None = None,
        degraded_state_service: DegradedStateService | None = None,
        runtime_policy_service: CanvasNativeRuntimePolicyService | None = None,
    ) -> None:
        self.intent_resolution_service = intent_resolution_service or IntentResolutionService()
        self.degraded_state_service = degraded_state_service or DegradedStateService()
        self.runtime_policy_service = runtime_policy_service or CanvasNativeRuntimePolicyService(config)

    async def __call__(self, state: GraphState, ctx: Any) -> GraphState:
        tool_context = getattr(ctx, "tool_context", {}) or {}
        latest_user_text = _latest_user_text(state.get("messages_context") or [])

        resolution = self.intent_resolution_service.resolve(
            latest_user_text,
            interaction_surface=tool_context.get("interaction_surface"),
            agent_config=state.get("agent_config"),
        )

        state["intent"] = resolution.to_dict()
        state["domain"] = resolution.domain
        state["repair_count"] = int(state.get("repair_count") or 0)
        state["canvas_runtime"] = self.runtime_policy_service.evaluate(
            intent=state["intent"],
            tool_context=tool_context,
        )

        if resolution.confidence < 0.45:
            state["degraded_state"] = self.degraded_state_service.append_flag(
                state.get("degraded_state"),
                DegradedState(
                    code="intent_low_confidence",
                    component="resolve_intent",
                    severity="warning",
                    user_visible=False,
                    message="Intent resolution confidence is below the native-routing threshold.",
                    metadata={
                        "confidence": resolution.confidence,
                        "domain": resolution.domain,
                    },
                ),
            )

        canvas_runtime = state.get("canvas_runtime") or {}
        if resolution.domain == "canvas" and canvas_runtime.get("route") != "native":
            state["degraded_state"] = self.degraded_state_service.append_flag(
                state.get("degraded_state"),
                DegradedState(
                    code="canvas_native_not_selected",
                    component="resolve_intent",
                    severity="info",
                    user_visible=False,
                    message="Canvas intent fell back to classic path.",
                    metadata={
                        "reason": canvas_runtime.get("reason"),
                        "canvas_id": canvas_runtime.get("canvas_id"),
                    },
                ),
            )

        return state
