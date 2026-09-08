from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Mapping, Optional, Dict
import uuid

from core.domains.shared.event_registry import get_schema_version

@dataclass(frozen=True)
class DomainEvent:
    event_id: str
    event_type: str
    schema_version: int
    occurred_at: datetime
    aggregate_id: str
    aggregate_type: str
    tenant_id: Optional[str] = None
    actor_id: Optional[str] = None
    payload: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_id": self.event_id,
            "event_type": self.event_type,
            "schema_version": self.schema_version,
            "occurred_at": self.occurred_at.isoformat(),
            "aggregate_id": self.aggregate_id,
            "aggregate_type": self.aggregate_type,
            "tenant_id": self.tenant_id,
            "actor_id": self.actor_id,
            "payload": dict(self.payload or {}),
        }


def new_event(
    *,
    event_type: str,
    aggregate_id: str,
    aggregate_type: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
    schema_version: Optional[int] = None,
    occurred_at: Optional[datetime] = None,
    event_id: Optional[str] = None,
) -> DomainEvent:
    resolved_version = schema_version
    if resolved_version is None:
        resolved_version = get_schema_version(event_type) or 1
    return DomainEvent(
        event_id=event_id or str(uuid.uuid4()),
        event_type=event_type,
        schema_version=resolved_version,
        occurred_at=occurred_at or datetime.now(timezone.utc),
        aggregate_id=aggregate_id,
        aggregate_type=aggregate_type,
        tenant_id=tenant_id,
        actor_id=actor_id,
        payload=payload,
    )
