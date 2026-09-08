from __future__ import annotations

from typing import Optional

from core.domains.canvas import events as canvas_events
from core.domains.shared.events import DomainEvent
from core.search.indexer import rebuild_canvas_search_index, delete_canvas_search_index
from core.services.supabase import DBConnection
from core.utils.logger import logger


class CanvasSearchProjection:
    name = "canvas_search_projection"

    def __init__(self, db: Optional[DBConnection] = None) -> None:
        self._db = db or DBConnection()

    async def _resolve_account_id(self, canvas_id: str, fallback: Optional[str]) -> Optional[str]:
        if fallback:
            return fallback
        client = await self._db.client
        try:
            res = (
                await client.table("canvases")
                .select("account_id")
                .eq("id", canvas_id)
                .limit(1)
                .execute()
            )
            if res.data:
                return res.data[0].get("account_id")
        except Exception as exc:
            logger.warning("projection.canvas_search_account_lookup_failed", canvas_id=canvas_id, error=str(exc))
        return None

    async def handle(self, event: DomainEvent) -> None:
        if event.event_type not in {
            canvas_events.CANVAS_CREATED,
            canvas_events.CANVAS_UPDATED,
            canvas_events.CANVAS_VERSION_SAVED,
            canvas_events.CANVAS_RESTORED,
            canvas_events.CANVAS_DELETED,
            canvas_events.CANVAS_PURGED,
        }:
            return

        canvas_id = event.aggregate_id
        account_id = await self._resolve_account_id(canvas_id, event.tenant_id)
        client = await self._db.client

        if event.event_type in {canvas_events.CANVAS_DELETED, canvas_events.CANVAS_PURGED}:
            if not account_id:
                logger.warning(
                    "projection.canvas_search_missing_account",
                    canvas_id=canvas_id,
                    event_type=event.event_type,
                )
                return
            await delete_canvas_search_index(canvas_id, account_id, client=client)
            return

        if not account_id:
            logger.warning("projection.canvas_search_missing_account", canvas_id=canvas_id, event_type=event.event_type)
            return

        await rebuild_canvas_search_index(canvas_id, account_id, client=client)
