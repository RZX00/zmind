from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Optional

from core.domains.shared.ports.event_publisher import DomainEventPublisher
from core.domains.shared.ports.outbox_repository import OutboxRepository
from core.infrastructure.outbox.logging_event_publisher import LoggingEventPublisher
from core.infrastructure.outbox.redis_event_publisher import RedisEventPublisher
from core.infrastructure.outbox.supabase_outbox_repository import SupabaseOutboxRepository
from core.utils.logger import logger


class OutboxRelay:
    def __init__(
        self,
        repository: OutboxRepository,
        publisher: DomainEventPublisher,
        batch_size: int = 100,
        max_attempts: Optional[int] = None,
    ) -> None:
        self._repository = repository
        self._publisher = publisher
        self._batch_size = batch_size
        self._max_attempts = max_attempts

    async def run_once(self) -> int:
        records = await self._repository.list_pending(self._batch_size)
        if not records:
            return 0
        processed = 0
        for record in records:
            if (
                self._max_attempts is not None
                and record.publish_attempts >= self._max_attempts
            ):
                logger.warning(
                    "outbox.publish_attempts_exceeded",
                    event_id=record.event.event_id,
                    attempts=record.publish_attempts,
                )
                continue
            try:
                await self._publisher.publish(record.event)
                await self._repository.mark_published(
                    record.event.event_id, datetime.now(timezone.utc)
                )
                processed += 1
            except Exception as exc:
                await self._repository.mark_failed(record.event.event_id, str(exc))
                logger.warning(
                    "outbox.publish_failed",
                    event_id=record.event.event_id,
                    error=str(exc),
                )
        return processed

    async def run_forever(self, interval_sec: float = 2.0) -> None:
        while True:
            processed = await self.run_once()
            if processed == 0:
                await asyncio.sleep(interval_sec)


async def run_default_outbox_relay(
    interval_sec: float = 2.0,
    batch_size: int = 100,
    repository: Optional[OutboxRepository] = None,
    publisher: Optional[DomainEventPublisher] = None,
) -> None:
    max_attempts = _parse_int(os.getenv("OUTBOX_MAX_ATTEMPTS"), None)
    publisher = publisher or _build_publisher()
    relay = OutboxRelay(
        repository=repository or SupabaseOutboxRepository(),
        publisher=publisher,
        batch_size=batch_size,
        max_attempts=max_attempts,
    )
    await relay.run_forever(interval_sec=interval_sec)


def _build_publisher() -> DomainEventPublisher:
    mode = (os.getenv("OUTBOX_PUBLISHER") or "logging").lower().strip()
    if mode == "redis":
        return RedisEventPublisher()
    return LoggingEventPublisher()


def _parse_int(value: Optional[str], default: Optional[int]) -> Optional[int]:
    if value is None or value == "":
        return default
    try:
        return int(value)
    except ValueError:
        return default
