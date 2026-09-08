from __future__ import annotations

from typing import Protocol

from core.domains.shared.events import DomainEvent


class ProcessManager(Protocol):
    async def handle(self, event: DomainEvent) -> None:
        ...
