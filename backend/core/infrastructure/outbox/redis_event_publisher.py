from __future__ import annotations

import os
from typing import Optional

import orjson

from core.domains.shared.events import DomainEvent
from core.domains.shared.ports.event_publisher import DomainEventPublisher
from core.services import redis


class RedisEventPublisher(DomainEventPublisher):
    def __init__(self, channel: Optional[str] = None) -> None:
        self._channel = channel or os.getenv("OUTBOX_REDIS_CHANNEL", "domain_events")

    async def publish(self, event: DomainEvent) -> None:
        payload = orjson.dumps(event.to_dict()).decode("utf-8")
        await redis.publish(self._channel, payload)
