from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from core.domains.canvas.model import Canvas
from core.domains.canvas.ports.canvas_repository import CanvasRepository
from core.services.supabase import DBConnection


class SupabaseCanvasRepository(CanvasRepository):
    def __init__(self, db: Optional[DBConnection] = None) -> None:
        self._db = db or DBConnection()

    async def get_by_id(self, canvas_id: str, workspace_id: str) -> Optional[Canvas]:
        client = await self._db.client
        res = (
            await client.table("canvases")
            .select("id, account_id, title, doc, version")
            .eq("id", canvas_id)
            .eq("account_id", workspace_id)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )
        if not res.data:
            return None
        row = res.data[0]
        return Canvas(
            id=row.get("id"),
            workspace_id=row.get("account_id"),
            title=row.get("title"),
            version=row.get("version") or "1.0.0",
            doc=row.get("doc") or {},
        )

    async def save(self, canvas: Canvas) -> Canvas:
        client = await self._db.client
        await client.table("canvases").insert(
            {
                "id": canvas.id,
                "account_id": canvas.workspace_id,
                "title": canvas.title,
                "doc": canvas.doc,
                "version": canvas.version,
            }
        ).execute()
        return canvas

    async def update(self, canvas: Canvas) -> Canvas:
        client = await self._db.client
        await client.table("canvases").update(
            {
                "title": canvas.title,
                "doc": canvas.doc,
                "version": canvas.version,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", canvas.id).eq("account_id", canvas.workspace_id).execute()
        return canvas

    async def soft_delete(self, canvas_id: str, workspace_id: str) -> None:
        client = await self._db.client
        await client.table("canvases").update(
            {
                "is_deleted": True,
                "deleted_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", canvas_id).eq("account_id", workspace_id).execute()

    async def restore(self, canvas_id: str, workspace_id: str) -> Canvas:
        client = await self._db.client
        await client.table("canvases").update(
            {
                "is_deleted": False,
                "deleted_at": None,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", canvas_id).eq("account_id", workspace_id).execute()
        res = (
            await client.table("canvases")
            .select("id, account_id, title, doc, version")
            .eq("id", canvas_id)
            .eq("account_id", workspace_id)
            .limit(1)
            .execute()
        )
        if not res.data:
            raise RuntimeError("canvas restore failed")
        row = res.data[0]
        return Canvas(
            id=row.get("id"),
            workspace_id=row.get("account_id"),
            title=row.get("title"),
            version=row.get("version") or "1.0.0",
            doc=row.get("doc") or {},
        )

    async def hard_delete(self, canvas_id: str, workspace_id: str) -> None:
        client = await self._db.client
        await client.table("canvases").delete().eq("id", canvas_id).eq(
            "account_id", workspace_id
        ).execute()
