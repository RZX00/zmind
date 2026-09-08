from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
import uuid

from fastapi import HTTPException

from core.services.supabase import DBConnection
from core.workspace.service import bump_workspace_version_and_broadcast

from .api_models import BackfillResult, CreateItemRequest, Item, ItemType, MoveItemRequest, UpdateItemRequest
from .repository import ItemsRepository


MAX_ITEM_PARENT_DEPTH = 32


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_folder_id_from_canvas_doc(doc: dict | None) -> Optional[str]:
    if not isinstance(doc, dict):
        return None
    folder_id = doc.get("folderId")
    return str(folder_id) if folder_id else None


class ItemsService:
    def __init__(self, repo: Optional[ItemsRepository] = None):
        self.repo = repo or ItemsRepository()

    async def _get_client(self):
        db = DBConnection()
        return await db.client

    async def _ensure_parent_safe(
        self,
        client,
        *,
        workspace_id: str,
        item_id: Optional[str],
        parent_item_id: Optional[str],
    ) -> None:
        if parent_item_id is None:
            return
        if item_id and parent_item_id == item_id:
            raise HTTPException(status_code=400, detail="parentItemId cannot reference self")

        parent_row = await self.repo.get_item_row(client, workspace_id, parent_item_id)
        if not parent_row or parent_row.get("is_deleted"):
            raise HTTPException(status_code=400, detail="Parent item does not exist")

        if not item_id:
            return

        # Check cycle by climbing parent chain from the candidate parent.
        current = parent_item_id
        seen: set[str] = set()
        depth = 0
        while current:
            if current in seen:
                break
            seen.add(current)
            if current == item_id:
                raise HTTPException(status_code=400, detail="Move would create a parent cycle")
            row = await self.repo.get_item_row(client, workspace_id, current)
            if not row:
                break
            current = row.get("parent_item_id")
            depth += 1
            if depth >= MAX_ITEM_PARENT_DEPTH:
                break

    async def _ensure_folder_exists(self, client, workspace_id: str, folder_id: Optional[str]) -> None:
        if folder_id is None:
            return
        result = (
            await client.table("folders")
            .select("id")
            .eq("account_id", workspace_id)
            .eq("id", folder_id)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=400, detail="Folder does not exist")

    async def list_items(
        self,
        *,
        workspace_id: str,
        item_type: Optional[ItemType] = None,
        folder_id: Optional[str] = None,
        parent_item_id: Optional[str] = None,
        include_deleted: bool = False,
    ) -> list[Item]:
        client = await self._get_client()
        return await self.repo.list_items(
            client,
            workspace_id,
            item_type=item_type,
            folder_id=folder_id,
            parent_item_id=parent_item_id,
            include_deleted=include_deleted,
        )

    async def get_item(self, *, workspace_id: str, item_id: str) -> Optional[Item]:
        client = await self._get_client()
        return await self.repo.get_item(client, workspace_id, item_id)

    async def create_item(
        self,
        *,
        workspace_id: str,
        user_id: str,
        payload: CreateItemRequest,
        client_request_id: Optional[str] = None,
    ) -> Item:
        title = (payload.title or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="Item title is required")

        client = await self._get_client()
        await self._ensure_folder_exists(client, workspace_id, payload.folderId)
        await self._ensure_parent_safe(
            client,
            workspace_id=workspace_id,
            item_id=None,
            parent_item_id=payload.parentItemId,
        )

        item_id = f"item_{uuid.uuid4().hex}"
        now_iso = _now_iso()

        if payload.sourceId:
            existing = await self.repo.get_item_by_source(client, workspace_id, payload.sourceId, payload.type)
            if existing:
                return existing

        created = await self.repo.create_item(
            client,
            {
                "id": item_id,
                "account_id": workspace_id,
                "type": payload.type,
                "title": title,
                "folder_id": payload.folderId,
                "parent_item_id": payload.parentItemId,
                "source_id": payload.sourceId,
                "is_deleted": False,
                "created_at": now_iso,
                "updated_at": now_iso,
            },
        )

        await bump_workspace_version_and_broadcast(
            workspace_id,
            changes=[
                {
                    "entity": "item",
                    "action": "create",
                    "data": {
                        **created.model_dump(),
                        **({"clientRequestId": client_request_id} if client_request_id else {}),
                    },
                }
            ],
            actor_id=user_id,
            request_id=client_request_id,
        )
        return created

    async def update_item(
        self,
        *,
        workspace_id: str,
        user_id: str,
        item_id: str,
        payload: UpdateItemRequest,
        client_request_id: Optional[str] = None,
    ) -> Item:
        client = await self._get_client()
        existing = await self.repo.get_item_row(client, workspace_id, item_id)
        if not existing or existing.get("is_deleted"):
            raise HTTPException(status_code=404, detail="Item not found")

        changes: dict = {"updated_at": _now_iso()}

        field_set = getattr(payload, "model_fields_set", set())

        if "title" in field_set:
            if payload.title is None:
                raise HTTPException(status_code=400, detail="Item title is required")
            title = payload.title.strip()
            if not title:
                raise HTTPException(status_code=400, detail="Item title is required")
            changes["title"] = title
        if "folderId" in field_set:
            await self._ensure_folder_exists(client, workspace_id, payload.folderId)
            changes["folder_id"] = payload.folderId
        if "parentItemId" in field_set:
            await self._ensure_parent_safe(
                client,
                workspace_id=workspace_id,
                item_id=item_id,
                parent_item_id=payload.parentItemId,
            )
            changes["parent_item_id"] = payload.parentItemId

        updated = await self.repo.update_item(client, workspace_id, item_id, changes)
        if not updated:
            raise HTTPException(status_code=404, detail="Item not found")

        await bump_workspace_version_and_broadcast(
            workspace_id,
            changes=[
                {
                    "entity": "item",
                    "action": "update",
                    "data": {
                        **updated.model_dump(),
                        **({"clientRequestId": client_request_id} if client_request_id else {}),
                    },
                }
            ],
            actor_id=user_id,
            request_id=client_request_id,
        )
        return updated

    async def move_item(
        self,
        *,
        workspace_id: str,
        user_id: str,
        item_id: str,
        payload: MoveItemRequest,
        client_request_id: Optional[str] = None,
    ) -> Item:
        update_data: dict = {}
        field_set = getattr(payload, "model_fields_set", set())
        if "folderId" in field_set:
            update_data["folderId"] = payload.folderId
        if "parentItemId" in field_set:
            update_data["parentItemId"] = payload.parentItemId
        updated = await self.update_item(
            workspace_id=workspace_id,
            user_id=user_id,
            item_id=item_id,
            payload=UpdateItemRequest(**update_data),
            client_request_id=client_request_id,
        )
        return updated

    async def delete_item(
        self,
        *,
        workspace_id: str,
        user_id: str,
        item_id: str,
        client_request_id: Optional[str] = None,
    ) -> None:
        client = await self._get_client()
        existing = await self.repo.get_item_row(client, workspace_id, item_id)
        if not existing or existing.get("is_deleted"):
            raise HTTPException(status_code=404, detail="Item not found")

        success = await self.repo.soft_delete_item(client, workspace_id, item_id, _now_iso())
        if not success:
            raise HTTPException(status_code=404, detail="Item not found")

        # Keep references as soft-deleted evidence when item is removed.
        try:
            await client.table("references").update(
                {
                    "is_deleted": True,
                    "updated_at": _now_iso(),
                }
            ).eq("account_id", workspace_id).or_(
                f"source_item_id.eq.{item_id},target_item_id.eq.{item_id}"
            ).execute()
        except Exception:
            # Allow item deletion to complete even if references table is unavailable.
            pass

        await bump_workspace_version_and_broadcast(
            workspace_id,
            changes=[
                {
                    "entity": "item",
                    "action": "delete",
                    "data": {
                        "id": item_id,
                        **({"clientRequestId": client_request_id} if client_request_id else {}),
                    },
                }
            ],
            actor_id=user_id,
            request_id=client_request_id,
        )

    async def backfill_canvas_items(
        self,
        *,
        workspace_id: str,
        user_id: str,
        client_request_id: Optional[str] = None,
    ) -> BackfillResult:
        client = await self._get_client()
        rows = await self.repo.list_canvas_rows(client, workspace_id)

        created = 0
        updated = 0
        skipped = 0
        now_iso = _now_iso()

        for row in rows:
            canvas_id = row.get("id")
            if not canvas_id:
                skipped += 1
                continue
            title = (row.get("title") or "Untitled").strip() or "Untitled"
            folder_id = _extract_folder_id_from_canvas_doc(row.get("doc") or {})
            _, was_created = await self.repo.upsert_canvas_item(
                client,
                workspace_id=workspace_id,
                source_canvas_id=canvas_id,
                title=title,
                folder_id=folder_id,
                now_iso=now_iso,
            )
            if was_created:
                created += 1
            else:
                updated += 1

        await bump_workspace_version_and_broadcast(
            workspace_id,
            changes=[
                {
                    "entity": "item",
                    "action": "update",
                    "data": {
                        "backfill": True,
                        "scanned": len(rows),
                        "created": created,
                        "updated": updated,
                        "skipped": skipped,
                        **({"clientRequestId": client_request_id} if client_request_id else {}),
                    },
                }
            ],
            actor_id=user_id,
            request_id=client_request_id,
        )

        return BackfillResult(
            scanned=len(rows),
            created=created,
            updated=updated,
            skipped=skipped,
        )
