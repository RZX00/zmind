from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from core.domains.canvas.model import CanvasVersion
from core.domains.canvas.ports.canvas_version_repository import CanvasVersionRepository
from core.services.supabase import DBConnection


def _parse_dt(value: Optional[Any]) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            return None
    return None


class SupabaseCanvasVersionRepository(CanvasVersionRepository):
    def __init__(self, db: Optional[DBConnection] = None) -> None:
        self._db = db or DBConnection()

    async def save(
        self,
        *,
        canvas_id: str,
        version_doc: Dict[str, Any],
        is_auto_save: bool,
        description: Optional[str],
    ) -> CanvasVersion:
        client = await self._db.client
        created_at = datetime.now(timezone.utc)
        row = {
            "canvas_id": canvas_id,
            "version_doc": version_doc,
            "is_auto_save": bool(is_auto_save),
            "description": description,
            "created_at": created_at.isoformat(),
        }
        res = await client.table("canvas_versions").insert(row).execute()
        data = res.data[0] if res.data else None
        if not data:
            data = await self._fetch_latest_row(canvas_id)
        if not data:
            raise RuntimeError("canvas_versions insert failed")
        return self._row_to_version(data, fallback_doc=version_doc, fallback_created_at=created_at)

    async def latest_for_canvas(self, canvas_id: str) -> Optional[CanvasVersion]:
        data = await self._fetch_latest_row(canvas_id)
        if not data:
            return None
        return self._row_to_version(data)

    async def _fetch_latest_row(self, canvas_id: str) -> Optional[Dict[str, Any]]:
        client = await self._db.client
        res = (
            await client.table("canvas_versions")
            .select("*")
            .eq("canvas_id", canvas_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if not res.data:
            return None
        return res.data[0]

    @staticmethod
    def _row_to_version(
        row: Dict[str, Any],
        *,
        fallback_doc: Optional[Dict[str, Any]] = None,
        fallback_created_at: Optional[datetime] = None,
    ) -> CanvasVersion:
        created_at = _parse_dt(row.get("created_at")) or fallback_created_at or datetime.now(
            timezone.utc
        )
        return CanvasVersion(
            id=str(row.get("id")),
            canvas_id=str(row.get("canvas_id")),
            version_doc=row.get("version_doc") or fallback_doc or {},
            is_auto_save=bool(row.get("is_auto_save", False)),
            description=row.get("description"),
            created_at=created_at,
        )
