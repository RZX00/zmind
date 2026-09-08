from __future__ import annotations

from typing import Any, Mapping, Optional

from core.domains.shared.events import DomainEvent, new_event
from core.domains.shared.event_registry import register_event_type

SESSION_OPENED = "CollaborationSessionOpened"
OPERATION_APPENDED = "CollaborationOperationAppended"
SESSION_CLOSED = "CollaborationSessionClosed"

register_event_type(SESSION_OPENED, 1)
register_event_type(OPERATION_APPENDED, 1)
register_event_type(SESSION_CLOSED, 1)


def collaboration_event(
    *,
    event_type: str,
    session_id: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> DomainEvent:
    return new_event(
        event_type=event_type,
        aggregate_id=session_id,
        aggregate_type="CollaborationSession",
        payload=payload,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
