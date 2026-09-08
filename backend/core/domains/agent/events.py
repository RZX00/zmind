from __future__ import annotations

from typing import Any, Mapping, Optional

from core.domains.shared.events import DomainEvent, new_event
from core.domains.shared.event_registry import register_event_type

AGENT_CREATED = "AgentCreated"
AGENT_UPDATED = "AgentUpdated"
AGENT_RUN_STARTED = "AgentRunStarted"
AGENT_RUN_COMPLETED = "AgentRunCompleted"
AGENT_RUN_FAILED = "AgentRunFailed"
AGENT_RUN_STOPPED = "AgentRunStopped"

register_event_type(AGENT_CREATED, 1)
register_event_type(AGENT_UPDATED, 1)
register_event_type(AGENT_RUN_STARTED, 1)
register_event_type(AGENT_RUN_COMPLETED, 1)
register_event_type(AGENT_RUN_FAILED, 1)
register_event_type(AGENT_RUN_STOPPED, 1)


def agent_event(
    *,
    event_type: str,
    agent_id: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> DomainEvent:
    return new_event(
        event_type=event_type,
        aggregate_id=agent_id,
        aggregate_type="Agent",
        payload=payload,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
