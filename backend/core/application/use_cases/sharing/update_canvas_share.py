from __future__ import annotations

from typing import Dict, Any, List, Optional

from core.application.event_bus import record_event
from core.domains.sharing import events as sharing_events
from core.domains.sharing.model import CanvasShare
from core.domains.sharing.ports.canvas_share_repository import CanvasShareRepository


class UpdateCanvasShareUseCase:
    def __init__(self, repository: CanvasShareRepository) -> None:
        self._repository = repository

    async def execute(
        self,
        *,
        canvas_id: str,
        workspace_id: str,
        actor_id: Optional[str],
        update_payload: Dict[str, Any],
        select_fields: List[str],
    ) -> CanvasShare:
        share = await self._repository.update_share(
            canvas_id=canvas_id,
            workspace_id=workspace_id,
            update_payload=update_payload,
            select_fields=select_fields,
        )
        payload: Dict[str, Any] = {
            "canvas_id": canvas_id,
            "is_public": share.is_public,
            "is_listed": share.is_listed,
            "timeline_enabled": share.timeline_enabled,
            "public_shows_timeline": share.public_shows_timeline,
            "listed_at": share.listed_at,
            "author_display_name": share.author_display_name,
            "author_avatar_url": share.author_avatar_url,
        }
        payload = {k: v for k, v in payload.items() if v is not None}
        event = sharing_events.canvas_share_updated(
            canvas_id=canvas_id,
            tenant_id=workspace_id,
            actor_id=actor_id,
            payload=payload,
        )
        await record_event(event)
        return share
