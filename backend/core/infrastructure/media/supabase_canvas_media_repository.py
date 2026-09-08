from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import List, Optional

from core.domains.media.ports.canvas_media_repository import CanvasMediaNode, CanvasMediaRepository
from core.services.supabase import DBConnection


class SupabaseCanvasMediaRepository(CanvasMediaRepository):
    def __init__(self, db: Optional[DBConnection] = None) -> None:
        self._db = db or DBConnection()

    async def list_media_nodes(
        self, canvas_id: str, account_id: Optional[str]
    ) -> List[CanvasMediaNode]:
        if not canvas_id:
            return []
        client = await self._db.client
        query = (
            client.table("canvases")
            .select("id, account_id, doc")
            .eq("id", canvas_id)
        )
        if account_id:
            query = query.eq("account_id", account_id)
        resp = await query.limit(1).execute()
        if not resp.data:
            return []
        doc = resp.data[0].get("doc") or {}
        if isinstance(doc, str):
            try:
                doc = json.loads(doc)
            except Exception:
                doc = {}
        nodes = doc.get("nodes") or []
        results: List[CanvasMediaNode] = []
        for node in nodes:
            if not isinstance(node, dict):
                continue
            if node.get("type") != "media":
                continue
            if node.get("mediaType") != "image":
                continue
            node_id = node.get("id")
            if not node_id:
                continue
            file_id = node.get("fileId") or node.get("file_id")
            storage_path = node.get("storagePath") or node.get("storage_path")
            label = node.get("fileName") or node.get("content") or node_id
            width = _safe_int(node.get("width"))
            height = _safe_int(node.get("height"))
            updated_at = _safe_int(node.get("updatedAt") or node.get("createdAt"))
            results.append(
                CanvasMediaNode(
                    node_id=str(node_id),
                    file_id=str(file_id) if file_id else None,
                    storage_path=str(storage_path) if storage_path else None,
                    label=str(label) if label else None,
                    width=width,
                    height=height,
                    updated_at=updated_at,
                )
            )
        return results

    async def update_node_file_id(
        self, canvas_id: str, account_id: Optional[str], node_id: str, file_id: str
    ) -> bool:
        if not canvas_id or not node_id or not file_id:
            return False
        client = await self._db.client
        query = (
            client.table("canvases")
            .select("id, account_id, doc")
            .eq("id", canvas_id)
        )
        if account_id:
            query = query.eq("account_id", account_id)
        resp = await query.limit(1).execute()
        if not resp.data:
            return False
        row = resp.data[0]
        doc = row.get("doc") or {}
        if isinstance(doc, str):
            try:
                doc = json.loads(doc)
            except Exception:
                doc = {}
        nodes = doc.get("nodes") or []
        updated = False
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        for node in nodes:
            if not isinstance(node, dict):
                continue
            if str(node.get("id")) != str(node_id):
                continue
            if node.get("fileId") == file_id:
                return True
            node["fileId"] = file_id
            node["updatedAt"] = now_ms
            updated = True
            break
        if not updated:
            return False
        await client.table("canvases").update(
            {
                "doc": doc,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", canvas_id).execute()
        return True


def _safe_int(value: object) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except Exception:
        return None
