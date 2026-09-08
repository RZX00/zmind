from __future__ import annotations

from typing import Protocol

from core.domains.shared.events import DomainEvent


class DomainEventPublisher(Protocol):
    async def publish(self, event: DomainEvent) -> None:
        ...
