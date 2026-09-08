from __future__ import annotations

from typing import Any

from core.langgraph_engine.contracts.event_schema import EngineEvent
from core.langgraph_engine.stream.legacy_adapter import LegacyStreamAdapter

from ..contracts import AgentEventV2, RuntimeContextV2


class AgentEventLegacyProjectionV2:
    @staticmethod
    def to_engine_event(event: AgentEventV2) -> EngineEvent:
        raw_engine_event = event.payload.get("engine_event")
        if isinstance(raw_engine_event, dict) and raw_engine_event.get("type"):
            return raw_engine_event  # type: ignore[return-value]

        if event.event_type == "run.message":
            return {
                "type": "assistant_final",
                "timestamp": event.timestamp,
                "agent_run_id": event.run_id,
                "thread_id": event.thread_id,
                "message_id": f"v2-msg-{event.event_id}",
                "content": dict(event.payload.get("message") or {}),
                "metadata": dict(event.metadata),
            }

        if event.event_type == "run.failed":
            return {
                "type": "status",
                "timestamp": event.timestamp,
                "agent_run_id": event.run_id,
                "thread_id": event.thread_id,
                "status_type": "run_failed",
                "message": str((event.payload or {}).get("error") or (event.payload or {}).get("status") or "run_failed"),
                "data": dict(event.payload),
                "metadata": dict(event.metadata),
                "terminal_status": str(event.metadata.get("terminal_status") or "failed"),
            }

        if event.event_type == "run.completed":
            return {
                "type": "status",
                "timestamp": event.timestamp,
                "agent_run_id": event.run_id,
                "thread_id": event.thread_id,
                "status_type": "run_completed",
                "message": str((event.payload or {}).get("status") or "completed"),
                "data": dict(event.payload),
                "metadata": dict(event.metadata),
                "terminal_status": str(event.metadata.get("terminal_status") or "completed"),
            }

        return {
            "type": "status",
            "timestamp": event.timestamp,
            "agent_run_id": event.run_id,
            "thread_id": event.thread_id,
            "status_type": event.event_type.replace(".", "_"),
            "data": dict(event.payload),
            "metadata": dict(event.metadata),
        }

    @classmethod
    def to_legacy_chunk(cls, event: AgentEventV2) -> dict[str, Any]:
        return LegacyStreamAdapter.to_legacy_chunk(cls.to_engine_event(event))

    @classmethod
    def build_persistence_state_snapshot(cls, context: RuntimeContextV2, event: AgentEventV2) -> dict[str, Any]:
        checkpoint_id = context.checkpoint_id
        raw_engine_event = event.payload.get("engine_event")
        if isinstance(raw_engine_event, dict):
            checkpoint_id = raw_engine_event.get("checkpoint_id", checkpoint_id)
        return {
            "agent_run_id": context.identity.run_id,
            "thread_id": context.identity.thread_id,
            "project_id": context.identity.project_id,
            "account_id": context.identity.account_id,
            "session_index": 0,
            "engine": "runtime_v2",
            "engine_version": "v2",
            "checkpoint_id": checkpoint_id,
            "is_shadow": False,
            "model_name": context.model_name,
        }
