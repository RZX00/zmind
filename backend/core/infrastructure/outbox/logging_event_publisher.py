from __future__ import annotations

from core.domains.shared.events import DomainEvent
from core.domains.shared.ports.event_publisher import DomainEventPublisher
from core.utils.logger import logger


class LoggingEventPublisher(DomainEventPublisher):
    async def publish(self, event: DomainEvent) -> None:
        logger.info(
            "domain_event_published",
            event_id=event.event_id,
            event_type=event.event_type,
            aggregate_type=event.aggregate_type,
            aggregate_id=event.aggregate_id,
        )
