from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from .contracts import AgentEventV2, RuntimeContextV2


@dataclass(slots=True)
class CanonicalEventBusV2:
    runtime_context: RuntimeContextV2
    sequence: int = 0

    def build(
        self,
        event_type: str,
        *,
        payload: dict[str, Any] | None = None,
        user_visible: bool = False,
        persistence_hint: dict[str, Any] | None = None,
        analytics_hint: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AgentEventV2:
        self.sequence += 1
        event = AgentEventV2(
            event_id=f"evt_{uuid.uuid4().hex}",
            event_type=event_type,
            run_id=self.runtime_context.identity.run_id,
            thread_id=self.runtime_context.identity.thread_id,
            lane=self.runtime_context.lane,
            sequence=self.sequence,
            timestamp=self._timestamp(),
            payload=dict(payload or {}),
            user_visible=user_visible,
            persistence_hint=dict(persistence_hint or {}),
            analytics_hint=dict(analytics_hint or {}),
            metadata=dict(metadata or {}),
        )
        if self.runtime_context.continuity_state is not None:
            self.runtime_context.continuity_state.event_history.append(event.to_dict())
            self.runtime_context.continuity_state.updated_at = event.timestamp
        return event

    def message(
        self,
        content: str,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> AgentEventV2:
        return self.build(
            "run.message",
            payload={
                "message": {
                    "role": "assistant",
                    "content": content,
                    "tool_calls": None,
                }
            },
            user_visible=True,
            metadata=metadata,
        )

    @staticmethod
    def _timestamp() -> str:
        from .contracts import _now_iso

        return _now_iso()
