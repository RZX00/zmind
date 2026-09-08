from __future__ import annotations

from datetime import datetime
from typing import Protocol, List

from core.domains.shared.events import DomainEvent
from core.domains.shared.outbox import OutboxRecord


class OutboxRepository(Protocol):
    async def add(self, event: DomainEvent) -> None:
        ...

    async def list_pending(self, limit: int) -> List[OutboxRecord]:
        ...

    async def mark_published(self, event_id: str, published_at: datetime) -> None:
        ...

    async def mark_failed(self, event_id: str, error: str) -> None:
        ...
