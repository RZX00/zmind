from __future__ import annotations

from dataclasses import dataclass

from core.application.services.intent_resolution_service import IntentResolutionService
from core.utils.config import config

from .contracts import ContinuityStateV2, LaneNameV2
from .semantics import is_confirmation_message


@dataclass(slots=True)
class ExecutionLaneDecisionV2:
    lane: LaneNameV2
    reason: str
    intent_payload: dict


class ExecutionLaneSelectorV2:
    def __init__(self, intent_service: IntentResolutionService | None = None) -> None:
        self._intent_service = intent_service or IntentResolutionService()

    def resolve_intent(
        self,
        *,
        latest_user_text: str,
        interaction_surface: str | None,
        agent_config: dict | None,
    ) -> dict:
        return self._intent_service.resolve(
            latest_user_text,
            interaction_surface=interaction_surface,
            agent_config=agent_config,
        ).to_dict()

    def select_lane(
        self,
        *,
        latest_user_text: str,
        interaction_surface: str | None,
        intent_payload: dict,
        continuity_state: ContinuityStateV2 | None,
    ) -> ExecutionLaneDecisionV2:
        pending_plan = continuity_state.pending_canvas_plan if continuity_state else None
        if pending_plan and is_confirmation_message(latest_user_text):
            return ExecutionLaneDecisionV2(
                lane="canvas",
                reason="resume_pending_canvas_preview",
                intent_payload=intent_payload,
            )

        domain = str(intent_payload.get("domain") or "generic")
        surface = str(interaction_surface or intent_payload.get("target_surface") or "").strip().lower()

        if domain == "canvas" or surface == "canvas":
            # AI-first (flagged): a fresh canvas intent goes to the general AGENTIC lane (the
            # LangGraph loop already has canvas_read/canvas_edit + canvas binding), replacing
            # the zero-LLM regex canvas core. Pending-plan preview resume (handled above) still
            # uses the canvas lane, so that flow is preserved.
            if getattr(config, "CANVAS_AGENTIC_LANE_ENABLED", False):
                return ExecutionLaneDecisionV2(lane="general", reason="canvas_agentic_lane", intent_payload=intent_payload)
            return ExecutionLaneDecisionV2(lane="canvas", reason="canvas_intent", intent_payload=intent_payload)
        if domain == "doc" or surface == "doc":
            return ExecutionLaneDecisionV2(lane="doc", reason="doc_intent", intent_payload=intent_payload)
        return ExecutionLaneDecisionV2(lane="general", reason=f"default:{domain}", intent_payload=intent_payload)
