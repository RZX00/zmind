from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from core.domains.shared.events import DomainEvent


@dataclass(frozen=True)
class OutboxRecord:
    event: DomainEvent
    created_at: datetime
    published_at: Optional[datetime]
    publish_attempts: int
    last_error: Optional[str]
