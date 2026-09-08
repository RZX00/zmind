from __future__ import annotations

from typing import Optional, Dict, Any

from core.application.event_bus import record_event
from core.domains.marketplace import events as marketplace_events


class RecordListingEventUseCase:
    async def execute(
        self,
        *,
        listing_id: str,
        event_type: str,
        tenant_id: Optional[str],
        actor_id: Optional[str],
        payload: Dict[str, Any],
    ) -> None:
        event = marketplace_events.marketplace_event(
            event_type=event_type,
            listing_id=listing_id,
            tenant_id=tenant_id,
            actor_id=actor_id,
            payload=payload,
        )
        await record_event(event)
