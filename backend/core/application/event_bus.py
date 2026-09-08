from __future__ import annotations

from typing import Optional

from core.domains.shared.events import DomainEvent
from core.domains.shared.event_registry import validate_event_type
from core.domains.shared.ports.outbox_repository import OutboxRepository
from core.infrastructure.outbox.supabase_outbox_repository import SupabaseOutboxRepository
from core.services import metrics
from core.utils.config import config
from core.utils.logger import logger


class EventRecorder:
    def __init__(self, repository: Optional[OutboxRepository] = None) -> None:
        self._repository = repository or SupabaseOutboxRepository()

    async def record(self, event: DomainEvent) -> None:
        await self._repository.add(event)


def _default_recorder() -> EventRecorder:
    return EventRecorder()


class OutboxRecordError(RuntimeError):
    pass


async def record_event(event: DomainEvent, *, strict: Optional[bool] = None) -> None:
    strict_mode = config.OUTBOX_RECORD_STRICT if strict is None else bool(strict)
    try:
        try:
            validate_event_type(event.event_type, event.schema_version)
        except Exception as exc:
            metrics.incr(
                "outbox.record.validation_failed",
                1,
                event_type=event.event_type,
                schema_version=event.schema_version,
            )
            logger.warning(
                "domain_event_validation_failed",
                event_type=event.event_type,
                schema_version=event.schema_version,
                error=str(exc),
            )
            if strict_mode:
                raise OutboxRecordError(
                    f"Domain event validation failed: {event.event_type}@{event.schema_version}"
                ) from exc
            return
        await _default_recorder().record(event)
        metrics.incr(
            "outbox.record.success",
            1,
            event_type=event.event_type,
            schema_version=event.schema_version,
        )
    except Exception as exc:
        metrics.incr(
            "outbox.record.failed",
            1,
            event_type=event.event_type,
            schema_version=event.schema_version,
        )
        logger.warning("outbox.record_failed", event_id=event.event_id, error=str(exc))
        if strict_mode:
            raise OutboxRecordError(f"Outbox record failed for event {event.event_id}") from exc
