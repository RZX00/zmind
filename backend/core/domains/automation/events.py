from __future__ import annotations

from typing import Any, Mapping, Optional

from core.domains.shared.events import DomainEvent, new_event
from core.domains.shared.event_registry import register_event_type


AUTOMATION_CREATED = "AutomationCreated"
AUTOMATION_UPDATED = "AutomationUpdated"
AUTOMATION_DELETED = "AutomationDeleted"
AUTOMATION_TOGGLED = "AutomationToggled"
PROVIDER_EVENT_INGESTED = "ProviderEventIngested"
AUTOMATION_RUN_QUEUED = "AutomationRunQueued"
AUTOMATION_RUN_STARTED = "AutomationRunStarted"
AUTOMATION_RUN_COMPLETED = "AutomationRunCompleted"
AUTOMATION_RUN_FAILED = "AutomationRunFailed"
AUTOMATION_RUN_DEAD_LETTERED = "AutomationRunDeadLettered"

register_event_type(AUTOMATION_CREATED, 1)
register_event_type(AUTOMATION_UPDATED, 1)
register_event_type(AUTOMATION_DELETED, 1)
register_event_type(AUTOMATION_TOGGLED, 1)
register_event_type(PROVIDER_EVENT_INGESTED, 1)
register_event_type(AUTOMATION_RUN_QUEUED, 1)
register_event_type(AUTOMATION_RUN_STARTED, 1)
register_event_type(AUTOMATION_RUN_COMPLETED, 1)
register_event_type(AUTOMATION_RUN_FAILED, 1)
register_event_type(AUTOMATION_RUN_DEAD_LETTERED, 1)


def automation_event(
    *,
    event_type: str,
    automation_id: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> DomainEvent:
    return new_event(
        event_type=event_type,
        aggregate_id=automation_id,
        aggregate_type="Automation",
        payload=payload,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
