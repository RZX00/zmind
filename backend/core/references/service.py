from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
import uuid

from fastapi import HTTPException

from core.services.supabase import DBConnection
from core.workspace.service import bump_workspace_version_and_broadcast

from .api_models import CreateReferenceRequest, ReferenceEdge, ResolveReferenceItem, ResolveReferencesResponse, RefsSummary
from .repository import ReferencesRepository


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ReferencesService:
    def __init__(self, repo: Optional[ReferencesRepository] = None):
        self.repo = repo or ReferencesRepository()

    async def _get_client(self):
        db = DBConnection()
        return await db.client

    async def _ensure_item_for_role(
        self,
        client,
        *,
        workspace_id: str,
        item_id: str,
        role: str,
        expected_item_type: Optional[str],
    ) -> dict:
        row = await self.repo.get_item_row(client, workspace_id, item_id)
        if not row or row.get("is_deleted"):
            raise HTTPException(status_code=400, detail=f"{role} item does not exist")

        if expected_item_type and row.get("type") != expected_item_type:
            raise HTTPException(
                status_code=400,
                detail=f"{role} item type mismatch: expected {expected_item_type}",
            )
        return row

    async def create_reference(
        self,
        *,
        workspace_id: str,
        user_id: str,
        payload: CreateReferenceRequest,
        client_request_id: Optional[str] = None,
    ) -> ReferenceEdge:
        client = await self._get_client()

        source_expected_type = "doc" if payload.sourceType == "doc_block" else "canvas"
        target_expected_type = "canvas" if payload.targetType == "canvas" else "doc"

        await self._ensure_item_for_role(
            client,
            workspace_id=workspace_id,
            item_id=payload.sourceItemId,
            role="source",
            expected_item_type=source_expected_type,
        )
        await self._ensure_item_for_role(
            client,
            workspace_id=workspace_id,
            item_id=payload.targetItemId,
            role="target",
            expected_item_type=target_expected_type,
        )

        now_iso = _now_iso()
        reference = await self.repo.create_reference(
            client,
            {
                "id": f"ref_{uuid.uuid4().hex}",
                "account_id": workspace_id,
                "source_type": payload.sourceType,
                "source_item_id": payload.sourceItemId,
                "source_anchor": payload.sourceAnchor,
                "target_type": payload.targetType,
                "target_item_id": payload.targetItemId,
                "target_anchor": payload.targetAnchor,
                "mode": payload.mode,
                "snapshot_payload": payload.snapshotPayload,
                "is_deleted": False,
                "created_at": now_iso,
                "updated_at": now_iso,
            },
        )

        await bump_workspace_version_and_broadcast(
            workspace_id,
            changes=[
                {
                    "entity": "reference",
                    "action": "create",
                    "data": {
                        **reference.model_dump(),
                        **({"clientRequestId": client_request_id} if client_request_id else {}),
                    },
                }
            ],
            actor_id=user_id,
            request_id=client_request_id,
        )
        return reference

    async def delete_reference(
        self,
        *,
        workspace_id: str,
        user_id: str,
        reference_id: str,
        client_request_id: Optional[str] = None,
    ) -> None:
        client = await self._get_client()
        exists = await self.repo.get_reference(client, workspace_id, reference_id)
        if not exists or exists.isDeleted:
            raise HTTPException(status_code=404, detail="Reference not found")

        deleted = await self.repo.soft_delete_reference(client, workspace_id, reference_id, _now_iso())
        if not deleted:
            raise HTTPException(status_code=404, detail="Reference not found")

        await bump_workspace_version_and_broadcast(
            workspace_id,
            changes=[
                {
                    "entity": "reference",
                    "action": "delete",
                    "data": {
                        "id": reference_id,
                        **({"clientRequestId": client_request_id} if client_request_id else {}),
                    },
                }
            ],
            actor_id=user_id,
            request_id=client_request_id,
        )

    async def list_backlinks(
        self,
        *,
        workspace_id: str,
        target_item_id: str,
        target_anchor: Optional[str] = None,
    ) -> list[ReferenceEdge]:
        client = await self._get_client()
        await self._ensure_item_for_role(
            client,
            workspace_id=workspace_id,
            item_id=target_item_id,
            role="target",
            expected_item_type=None,
        )
        return await self.repo.list_backlinks(
            client,
            workspace_id,
            target_item_id,
            target_anchor,
        )

    async def resolve_references(
        self,
        *,
        workspace_id: str,
        reference_ids: list[str],
    ) -> ResolveReferencesResponse:
        client = await self._get_client()
        refs = await self.repo.list_references_by_ids(client, workspace_id, reference_ids)
        ref_by_id = {ref.id: ref for ref in refs}

        items: list[ResolveReferenceItem] = []
        for ref_id in reference_ids:
            ref = ref_by_id.get(ref_id)
            if not ref:
                items.append(ResolveReferenceItem(referenceId=ref_id, resolved=False, reason="not_found"))
                continue

            source_row = await self.repo.get_item_row(client, workspace_id, ref.sourceItemId)
            target_row = await self.repo.get_item_row(client, workspace_id, ref.targetItemId)
            if not source_row or source_row.get("is_deleted"):
                items.append(ResolveReferenceItem(referenceId=ref_id, resolved=False, reason="source_missing"))
                continue
            if not target_row or target_row.get("is_deleted"):
                items.append(ResolveReferenceItem(referenceId=ref_id, resolved=False, reason="target_missing"))
                continue

            items.append(ResolveReferenceItem(referenceId=ref_id, resolved=True, reference=ref))

        return ResolveReferencesResponse(items=items)

    async def summarize_refs(self, *, workspace_id: str) -> RefsSummary:
        client = await self._get_client()
        return await self.repo.summarize_refs(client, workspace_id)
