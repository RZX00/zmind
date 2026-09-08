from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from core.domains.shared.events import DomainEvent
from core.services.supabase import DBConnection
from core.utils.logger import logger


class EventAuditProjection:
    name = "event_audit_projection"

    def __init__(self, db: Optional[DBConnection] = None) -> None:
        self._db = db or DBConnection()

    async def handle(self, event: DomainEvent) -> None:
        client = await self._db.client
        payload = event.payload or {}
        if not isinstance(payload, dict):
            payload = {"raw": payload}
        row = {
            "event_id": event.event_id,
            "event_type": event.event_type,
            "schema_version": event.schema_version,
            "occurred_at": event.occurred_at.isoformat()
            if isinstance(event.occurred_at, datetime)
            else datetime.now(timezone.utc).isoformat(),
            "aggregate_id": event.aggregate_id,
            "aggregate_type": event.aggregate_type,
            "tenant_id": event.tenant_id,
            "actor_id": event.actor_id,
            "payload": payload,
            "ingested_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            await client.table("event_audit").upsert(row, on_conflict="event_id").execute()
        except Exception as exc:
            logger.warning("projection.event_audit_failed", event_id=event.event_id, error=str(exc))
