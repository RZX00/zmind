from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from .api_models import Item, ItemType


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _to_ms(value) -> int:
    if value is None:
        return _now_ms()
    if isinstance(value, (int, float)):
        return int(value)
    try:
        text = str(value)
        if text.endswith("Z"):
            text = text.replace("Z", "+00:00")
        return int(datetime.fromisoformat(text).timestamp() * 1000)
    except Exception:
        return _now_ms()


def _to_item(row: dict) -> Item:
    return Item(
        id=row.get("id"),
        type=row.get("type"),
        title=row.get("title") or "Untitled",
        folderId=row.get("folder_id"),
        parentItemId=row.get("parent_item_id"),
        sourceId=row.get("source_id"),
        isDeleted=bool(row.get("is_deleted", False)),
        createdAt=_to_ms(row.get("created_at")),
        updatedAt=_to_ms(row.get("updated_at")),
    )


class ItemsRepository:
    async def list_items(
        self,
        client,
        workspace_id: str,
        item_type: Optional[ItemType] = None,
        folder_id: Optional[str] = None,
        parent_item_id: Optional[str] = None,
        include_deleted: bool = False,
    ) -> list[Item]:
        query = client.table("items").select("*").eq("account_id", workspace_id)
        if not include_deleted:
            query = query.eq("is_deleted", False)
        if item_type:
            query = query.eq("type", item_type)
        if folder_id is not None:
            if folder_id == "__null__":
                query = query.is_("folder_id", "null")
            else:
                query = query.eq("folder_id", folder_id)
        if parent_item_id is not None:
            if parent_item_id == "__null__":
                query = query.is_("parent_item_id", "null")
            else:
                query = query.eq("parent_item_id", parent_item_id)

        result = await query.execute()
        return [_to_item(row) for row in (result.data or [])]

    async def get_item(self, client, workspace_id: str, item_id: str) -> Optional[Item]:
        result = (
            await client.table("items")
            .select("*")
            .eq("account_id", workspace_id)
            .eq("id", item_id)
            .limit(1)
            .execute()
        )
        if not result.data:
            return None
        return _to_item(result.data[0])

    async def get_item_row(self, client, workspace_id: str, item_id: str) -> Optional[dict]:
        result = (
            await client.table("items")
            .select("*")
            .eq("account_id", workspace_id)
            .eq("id", item_id)
            .limit(1)
            .execute()
        )
        if not result.data:
            return None
        return result.data[0]

    async def get_item_by_source(
        self,
        client,
        workspace_id: str,
        source_id: str,
        item_type: ItemType,
    ) -> Optional[Item]:
        result = (
            await client.table("items")
            .select("*")
            .eq("account_id", workspace_id)
            .eq("source_id", source_id)
            .eq("type", item_type)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )
        if not result.data:
            return None
        return _to_item(result.data[0])

    async def create_item(self, client, payload: dict) -> Item:
        result = await client.table("items").insert(payload).execute()
        row = result.data[0] if result.data else payload
        return _to_item(row)

    async def update_item(self, client, workspace_id: str, item_id: str, changes: dict) -> Optional[Item]:
        result = (
            await client.table("items")
            .update(changes)
            .eq("account_id", workspace_id)
            .eq("id", item_id)
            .execute()
        )
        if not result.data:
            return None
        return _to_item(result.data[0])

    async def soft_delete_item(self, client, workspace_id: str, item_id: str, updated_at_iso: str) -> bool:
        result = (
            await client.table("items")
            .update({"is_deleted": True, "updated_at": updated_at_iso})
            .eq("account_id", workspace_id)
            .eq("id", item_id)
            .eq("is_deleted", False)
            .execute()
        )
        return bool(result.data)

    async def list_canvas_rows(self, client, workspace_id: str) -> list[dict]:
        result = (
            await client.table("canvases")
            .select("id,title,doc,created_at,updated_at,is_deleted")
            .eq("account_id", workspace_id)
            .eq("is_deleted", False)
            .execute()
        )
        return result.data or []

    async def list_item_rows(self, client, workspace_id: str) -> list[dict]:
        result = (
            await client.table("items")
            .select("id,type,source_id,title,folder_id,parent_item_id,is_deleted")
            .eq("account_id", workspace_id)
            .eq("is_deleted", False)
            .execute()
        )
        return result.data or []

    async def upsert_canvas_item(
        self,
        client,
        *,
        workspace_id: str,
        source_canvas_id: str,
        title: str,
        folder_id: Optional[str],
        now_iso: str,
        item_id: Optional[str] = None,
    ) -> tuple[Item, bool]:
        existing = await self.get_item_by_source(client, workspace_id, source_canvas_id, "canvas")
        if existing:
            updated = await self.update_item(
                client,
                workspace_id,
                existing.id,
                {
                    "title": title,
                    "folder_id": folder_id,
                    "updated_at": now_iso,
                    "is_deleted": False,
                },
            )
            return (updated or existing, False)

        payload = {
            "id": item_id,
            "account_id": workspace_id,
            "type": "canvas",
            "title": title,
            "folder_id": folder_id,
            "parent_item_id": None,
            "source_id": source_canvas_id,
            "is_deleted": False,
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        if not item_id:
            payload.pop("id")
        created = await self.create_item(client, payload)
        return (created, True)
