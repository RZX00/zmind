from __future__ import annotations

from typing import Any, Mapping, Optional

from core.domains.shared.events import DomainEvent, new_event
from core.domains.shared.event_registry import register_event_type

SOURCE_REGISTERED = "KnowledgeSourceRegistered"
INGESTION_QUEUED = "KnowledgeIngestionQueued"
INGESTION_SUCCEEDED = "KnowledgeIngestionSucceeded"
INGESTION_FAILED = "KnowledgeIngestionFailed"

register_event_type(SOURCE_REGISTERED, 1)
register_event_type(INGESTION_QUEUED, 1)
register_event_type(INGESTION_SUCCEEDED, 1)
register_event_type(INGESTION_FAILED, 1)


def knowledge_event(
    *,
    event_type: str,
    source_id: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> DomainEvent:
    return new_event(
        event_type=event_type,
        aggregate_id=source_id,
        aggregate_type="KnowledgeSource",
        payload=payload,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
