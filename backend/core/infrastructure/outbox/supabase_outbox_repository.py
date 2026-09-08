from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional, List

from core.domains.shared.events import DomainEvent
from core.domains.shared.outbox import OutboxRecord
from core.domains.shared.ports.outbox_repository import OutboxRepository
from core.services.supabase import DBConnection
from core.utils.logger import logger


def _parse_dt(value: Optional[Any]) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            return None
    return None


class SupabaseOutboxRepository(OutboxRepository):
    def __init__(self, db: Optional[DBConnection] = None):
        self._db = db or DBConnection()

    async def add(self, event: DomainEvent) -> None:
        client = await self._db.client
        data = event.to_dict()
        insert = {
            "event_id": data["event_id"],
            "event_type": data["event_type"],
            "schema_version": data["schema_version"],
            "occurred_at": data["occurred_at"],
            "aggregate_id": data["aggregate_id"],
            "aggregate_type": data["aggregate_type"],
            "tenant_id": data["tenant_id"],
            "actor_id": data["actor_id"],
            "payload": data["payload"],
        }
        await client.table("domain_outbox").insert(insert).execute()

    async def list_pending(self, limit: int) -> List[OutboxRecord]:
        client = await self._db.client
        result = (
            await client.table("domain_outbox")
            .select("*")
            .is_("published_at", "null")
            .order("occurred_at", desc=False)
            .limit(limit)
            .execute()
        )
        rows = result.data or []
        return [self._row_to_record(row) for row in rows]

    async def mark_published(self, event_id: str, published_at: datetime) -> None:
        client = await self._db.client
        await client.table("domain_outbox").update(
            {
                "published_at": published_at.isoformat(),
                "last_error": None,
            }
        ).eq("event_id", event_id).execute()

    async def mark_failed(self, event_id: str, error: str) -> None:
        client = await self._db.client
        attempts = 0
        try:
            res = (
                await client.table("domain_outbox")
                .select("publish_attempts")
                .eq("event_id", event_id)
                .limit(1)
                .execute()
            )
            if res.data:
                attempts = int(res.data[0].get("publish_attempts") or 0)
        except Exception as exc:
            logger.warning("outbox.publish_attempts_read_failed", event_id=event_id, error=str(exc))
        await client.table("domain_outbox").update(
            {
                "publish_attempts": attempts + 1,
                "last_error": error,
                "last_attempted_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("event_id", event_id).execute()

    @staticmethod
    def _row_to_record(row: Dict[str, Any]) -> OutboxRecord:
        occurred_at = _parse_dt(row.get("occurred_at")) or datetime.now(timezone.utc)
        event = DomainEvent(
            event_id=str(row.get("event_id")),
            event_type=str(row.get("event_type")),
            schema_version=int(row.get("schema_version") or 1),
            occurred_at=occurred_at,
            aggregate_id=str(row.get("aggregate_id")),
            aggregate_type=str(row.get("aggregate_type")),
            tenant_id=row.get("tenant_id"),
            actor_id=row.get("actor_id"),
            payload=row.get("payload") or {},
        )
        created_at = _parse_dt(row.get("created_at")) or occurred_at
        published_at = _parse_dt(row.get("published_at"))
        publish_attempts = int(row.get("publish_attempts") or 0)
        last_error = row.get("last_error")
        return OutboxRecord(
            event=event,
            created_at=created_at,
            published_at=published_at,
            publish_attempts=publish_attempts,
            last_error=last_error,
        )
