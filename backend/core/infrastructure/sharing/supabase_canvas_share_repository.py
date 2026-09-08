from __future__ import annotations

from typing import Optional, Dict, Any, List

from core.domains.sharing.model import CanvasShare
from core.domains.sharing.ports.canvas_share_repository import CanvasShareRepository
from core.services.supabase import DBConnection


class SupabaseCanvasShareRepository(CanvasShareRepository):
    def __init__(self, db: Optional[DBConnection] = None) -> None:
        self._db = db or DBConnection()

    async def update_share(
        self,
        *,
        canvas_id: str,
        workspace_id: str,
        update_payload: Dict[str, Any],
        select_fields: List[str],
    ) -> CanvasShare:
        client = await self._db.client
        select_clause = ",".join(select_fields) if select_fields else "*"
        await (
            client.table("canvases")
            .update(update_payload)
            .eq("id", canvas_id)
            .eq("account_id", workspace_id)
            .execute()
        )
        res = (
            await client.table("canvases")
            .select(select_clause)
            .eq("id", canvas_id)
            .eq("account_id", workspace_id)
            .limit(1)
            .execute()
        )
        if not res.data:
            raise RuntimeError("canvas share update failed")
        row = res.data[0]
        return CanvasShare(
            canvas_id=str(row.get("id") or canvas_id),
            workspace_id=str(workspace_id),
            is_public=bool(row.get("is_public", False)),
            is_listed=bool(row.get("is_listed", False)),
            timeline_enabled=bool(row.get("timeline_enabled", False)),
            public_shows_timeline=bool(row.get("public_shows_timeline", False)),
            listed_at=row.get("listed_at"),
            author_display_name=row.get("author_display_name"),
            author_avatar_url=row.get("author_avatar_url"),
        )
