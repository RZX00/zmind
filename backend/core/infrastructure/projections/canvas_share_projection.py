from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from core.domains.shared.events import DomainEvent
from core.services.supabase import DBConnection
from core.utils.logger import logger


class CanvasShareProjection:
    name = "canvas_share_projection"

    def __init__(self, db: Optional[DBConnection] = None) -> None:
        self._db = db or DBConnection()

    async def handle(self, event: DomainEvent) -> None:
        if event.event_type not in {
            "CanvasShareUpdated",
            "TemplatePublished",
            "TemplateUnpublished",
        }:
            return
        if event.event_type == "CanvasShareUpdated":
            payload = event.payload or {}
            row = {
                "canvas_id": event.aggregate_id,
                "workspace_id": event.tenant_id,
                "is_public": bool(payload.get("is_public", False)),
                "is_listed": bool(payload.get("is_listed", False)),
                "timeline_enabled": bool(payload.get("timeline_enabled", False)),
                "public_shows_timeline": bool(payload.get("public_shows_timeline", False)),
                "listed_at": payload.get("listed_at"),
                "author_display_name": payload.get("author_display_name"),
                "author_avatar_url": payload.get("author_avatar_url"),
                "updated_at": event.occurred_at.isoformat()
                if isinstance(event.occurred_at, datetime)
                else datetime.now(timezone.utc).isoformat(),
            }
            client = await self._db.client
            await client.table("public_canvas_shares").upsert(
                row, on_conflict="canvas_id"
            ).execute()
            return
        logger.info(
            "projection.canvas_share_skip",
            event_type=event.event_type,
            aggregate_id=event.aggregate_id,
        )
