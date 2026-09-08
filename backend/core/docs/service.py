from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional
import re
import uuid

from fastapi import HTTPException

from core.services.supabase import DBConnection
from core.workspace.service import bump_workspace_version_and_broadcast

from core.items.api_models import CreateItemRequest, UpdateItemRequest
from core.items.service import ItemsService
from core.utils.logger import logger

from .api_models import (
    ApplyDocOpsRequest,
    ApplyDocOpsResponse,
    CreateDocRequest,
    DocBlock,
    DocContent,
    DocRevision,
    DocRevisionListResponse,
    DocsMetaItem,
    UndoDocRevisionRequest,
    UpdateDocRequest,
    UpdateDocResponse,
)
from .block_extractor import extract_doc_blocks
from .ops_engine import DocOpsError, apply_doc_ops
from .repository import DocsRepository


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


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


def _parse_if_match_version(raw: Optional[str]) -> Optional[int]:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    # Accept formats like W/"v12", "12", 12, v12
    text = text.replace('W/"', '').replace('"', '').strip()
    text = text.lstrip("v")
    if not re.fullmatch(r"\d+", text):
        raise HTTPException(status_code=400, detail="Invalid If-Match version format")
    return int(text)


def _coerce_metadata_dict(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return dict(parsed)
        except Exception:
            return {}
    return {}


class DocsService:
    def __init__(
        self,
        repo: Optional[DocsRepository] = None,
        items_service: Optional[ItemsService] = None,
    ):
        self.repo = repo or DocsRepository()
        self.items_service = items_service or ItemsService()

    async def _get_client(self):
        db = DBConnection()
        return await db.client

    async def create_doc(
        self,
        *,
        workspace_id: str,
        user_id: str,
        payload: CreateDocRequest,
        client_request_id: Optional[str] = None,
    ) -> DocContent:
        item = await self.items_service.create_item(
            workspace_id=workspace_id,
            user_id=user_id,
            payload=CreateItemRequest(
                type="doc",
                title=payload.title,
                folderId=payload.folderId,
                parentItemId=payload.parentItemId,
            ),
            client_request_id=client_request_id,
        )

        now_iso = _now_iso()
        client = await self._get_client()
        try:
            await self.repo.create_doc_row(
                client,
                {
                    "item_id": item.id,
                    "content_md": payload.contentMd,
                    "frontmatter": payload.frontmatter or {},
                    "version": 1,
                    "created_at": now_iso,
                    "updated_at": now_iso,
                },
            )

            blocks = extract_doc_blocks(item.id, payload.contentMd)
            await self.repo.replace_doc_blocks(
                client,
                item_id=item.id,
                blocks=[
                    {
                        "block_id": block.block_id,
                        "block_type": block.block_type,
                        "anchor": block.anchor,
                        "text_preview": block.text_preview,
                        "hash": block.hash,
                        "order_index": block.order_index,
                    }
                    for block in blocks
                ],
                updated_at_iso=now_iso,
            )
        except Exception as exc:
            # Best-effort compensation to avoid orphan item rows.
            await client.table("items").update(
                {
                    "is_deleted": True,
                    "updated_at": _now_iso(),
                }
            ).eq("account_id", workspace_id).eq("id", item.id).execute()
            raise HTTPException(status_code=500, detail=f"Failed to create doc: {exc}")

        doc = await self.repo.get_doc_content(client, workspace_id, item.id)
        if not doc:
            raise HTTPException(status_code=500, detail="Doc created but cannot be loaded")

        await bump_workspace_version_and_broadcast(
            workspace_id,
            changes=[
                {
                    "entity": "doc",
                    "action": "create",
                    "data": {
                        "itemId": item.id,
                        "version": doc.version,
                        "title": doc.title,
                        **({"clientRequestId": client_request_id} if client_request_id else {}),
                    },
                }
            ],
            actor_id=user_id,
            request_id=client_request_id,
        )
        return doc

    async def get_doc(self, *, workspace_id: str, item_id: str) -> DocContent:
        client = await self._get_client()
        doc = await self.repo.get_doc_content(client, workspace_id, item_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Doc not found")
        return doc

    async def update_doc(
        self,
        *,
        workspace_id: str,
        user_id: str,
        item_id: str,
        payload: UpdateDocRequest,
        if_match: Optional[str] = None,
        client_request_id: Optional[str] = None,
    ) -> UpdateDocResponse:
        expected_version = _parse_if_match_version(if_match)
        client = await self._get_client()

        item = await self.repo.get_item_row(client, workspace_id, item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Doc item not found")
        if item.get("type") != "doc":
            raise HTTPException(status_code=400, detail="Item is not a doc")

        row, conflicted = await self.repo.update_doc_row(
            client,
            item_id=item_id,
            content_md=payload.contentMd,
            frontmatter=payload.frontmatter,
            expected_version=expected_version,
            updated_at_iso=_now_iso(),
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Doc not found")
        if conflicted:
            current_version = int(row.get("version") or 1)
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Doc version conflict",
                    "currentVersion": current_version,
                    "expectedVersion": expected_version,
                },
            )

        blocks = extract_doc_blocks(item_id, payload.contentMd)
        await self.repo.replace_doc_blocks(
            client,
            item_id=item_id,
            blocks=[
                {
                    "block_id": block.block_id,
                    "block_type": block.block_type,
                    "anchor": block.anchor,
                    "text_preview": block.text_preview,
                    "hash": block.hash,
                    "order_index": block.order_index,
                }
                for block in blocks
            ],
            updated_at_iso=_now_iso(),
        )

        version = int(row.get("version") or 1)
        updated_at = _now_ms()

        await bump_workspace_version_and_broadcast(
            workspace_id,
            changes=[
                {
                    "entity": "doc",
                    "action": "update",
                    "data": {
                        "itemId": item_id,
                        "version": version,
                        "blockCount": len(blocks),
                        **({"clientRequestId": client_request_id} if client_request_id else {}),
                    },
                }
            ],
            actor_id=user_id,
            request_id=client_request_id,
        )

        return UpdateDocResponse(itemId=item_id, version=version, updatedAt=updated_at)

    async def list_doc_blocks(self, *, workspace_id: str, item_id: str) -> list[DocBlock]:
        client = await self._get_client()
        item = await self.repo.get_item_row(client, workspace_id, item_id)
        if not item or item.get("type") != "doc":
            raise HTTPException(status_code=404, detail="Doc not found")
        return await self.repo.list_doc_blocks(client, item_id)

    async def list_docs_meta(self, *, workspace_id: str) -> list[DocsMetaItem]:
        client = await self._get_client()
        return await self.repo.list_docs_meta(client, workspace_id)

    async def _list_doc_threads(
        self,
        *,
        client,
        workspace_id: str,
        item_id: str,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        try:
            result = (
                await client.table("threads")
                .select("thread_id, metadata")
                .eq("account_id", workspace_id)
                .contains("metadata", {"doc_item_id": item_id})
                .execute()
            )
            rows = list(result.data or [])
        except Exception:
            rows = []

        if not rows:
            fallback = (
                await client.table("threads")
                .select("thread_id, metadata")
                .eq("account_id", workspace_id)
                .order("created_at", desc=True)
                .execute()
            )
            rows = list(fallback.data or [])

        filtered: list[dict[str, Any]] = []
        seen_thread_ids: set[str] = set()
        for row in rows:
            thread_id = str(row.get("thread_id") or "").strip()
            if not thread_id or thread_id in seen_thread_ids:
                continue
            metadata = _coerce_metadata_dict(row.get("metadata"))
            if str(metadata.get("doc_item_id") or "").strip() != item_id:
                continue
            filtered.append({"thread_id": thread_id, "metadata": metadata})
            seen_thread_ids.add(thread_id)
        return filtered

    async def _sync_doc_title_in_thread_metadata(
        self,
        *,
        client,
        workspace_id: str,
        item_id: str,
        title: str,
    ) -> int:
        threads = await self._list_doc_threads(
            client=client,
            workspace_id=workspace_id,
            item_id=item_id,
        )
        updated_count = 0
        for thread in threads:
            thread_id = thread["thread_id"]
            metadata = dict(thread["metadata"])
            changed = False

            if metadata.get("doc_title") != title:
                metadata["doc_title"] = title
                changed = True

            doc_context = metadata.get("doc_context")
            if isinstance(doc_context, dict):
                doc_context_item_id = str(doc_context.get("doc_item_id") or "").strip()
                if doc_context_item_id == item_id and doc_context.get("doc_title") != title:
                    metadata["doc_context"] = {
                        **doc_context,
                        "doc_title": title,
                    }
                    changed = True

            if not changed:
                continue

            try:
                await (
                    client.table("threads")
                    .update({"metadata": metadata})
                    .eq("account_id", workspace_id)
                    .eq("thread_id", thread_id)
                    .execute()
                )
                updated_count += 1
            except Exception as exc:
                logger.warning(
                    "DocsService: failed to sync thread doc title metadata",
                    workspace_id=workspace_id,
                    item_id=item_id,
                    thread_id=thread_id,
                    error=str(exc),
                )
        return updated_count

    async def update_doc_title(
        self,
        *,
        workspace_id: str,
        user_id: str,
        item_id: str,
        title: str,
        client_request_id: Optional[str] = None,
    ) -> dict[str, Any]:
        normalized_title = str(title or "").strip()
        if not normalized_title:
            raise HTTPException(status_code=400, detail="Item title is required")

        client = await self._get_client()
        item = await self.repo.get_item_row(client, workspace_id, item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Doc item not found")
        if item.get("type") != "doc":
            raise HTTPException(status_code=400, detail="Item is not a doc")

        updated_item = await self.items_service.update_item(
            workspace_id=workspace_id,
            user_id=user_id,
            item_id=item_id,
            payload=UpdateItemRequest(title=normalized_title),
            client_request_id=client_request_id,
        )

        doc_row = await self.repo.get_doc_row(client, item_id)
        version = int(doc_row.get("version") or 1) if doc_row else 1
        thread_updates = await self._sync_doc_title_in_thread_metadata(
            client=client,
            workspace_id=workspace_id,
            item_id=item_id,
            title=updated_item.title,
        )

        return {
            "docItemId": item_id,
            "title": updated_item.title,
            "version": version,
            "updatedAt": updated_item.updatedAt,
            "threadMetadataUpdates": thread_updates,
        }

    async def _find_doc_thread_id(
        self,
        *,
        client,
        workspace_id: str,
        item_id: str,
    ) -> Optional[str]:
        try:
            result = (
                await client.table("threads")
                .select("thread_id, metadata")
                .eq("account_id", workspace_id)
                .contains("metadata", {"doc_item_id": item_id})
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if result.data:
                thread_id = result.data[0].get("thread_id")
                if thread_id:
                    return str(thread_id)
        except Exception:
            # Some environments may not support json contains filter reliably.
            pass

        fallback = (
            await client.table("threads")
            .select("thread_id, metadata")
            .eq("account_id", workspace_id)
            .order("created_at", desc=True)
            .execute()
        )
        for row in fallback.data or []:
            metadata = row.get("metadata") or {}
            if isinstance(metadata, str):
                try:
                    import json as _json

                    metadata = _json.loads(metadata)
                except Exception:
                    metadata = {}
            if not isinstance(metadata, dict):
                continue
            if str(metadata.get("doc_item_id") or "").strip() != item_id:
                continue
            thread_id = row.get("thread_id")
            if thread_id:
                return str(thread_id)
        return None

    async def ensure_doc_thread(
        self,
        *,
        workspace_id: str,
        item_id: str,
    ) -> str:
        doc = await self.get_doc(workspace_id=workspace_id, item_id=item_id)
        client = await self._get_client()

        existing_thread_id = await self._find_doc_thread_id(
            client=client,
            workspace_id=workspace_id,
            item_id=item_id,
        )
        if existing_thread_id:
            return existing_thread_id

        thread_metadata = {
            "source": "doc_auto",
            "surface": "doc",
            "doc_item_id": item_id,
            "doc_title": doc.title,
            "current_session_index": 0,
        }
        payload = {
            "account_id": workspace_id,
            "metadata": thread_metadata,
        }

        new_thread_id: Optional[str] = None
        try:
            result = await client.table("threads").insert(payload).execute()
            if result.data:
                new_thread_id = result.data[0].get("thread_id")
        except Exception:
            # Fall through to race-safe lookup path.
            new_thread_id = None

        if not new_thread_id:
            existing_thread_id = await self._find_doc_thread_id(
                client=client,
                workspace_id=workspace_id,
                item_id=item_id,
            )
            if existing_thread_id:
                return existing_thread_id
            raise HTTPException(status_code=500, detail="Failed to ensure doc thread")

        return str(new_thread_id)

    async def peek_doc_thread(
        self,
        *,
        workspace_id: str,
        item_id: str,
    ) -> Optional[str]:
        # Validate ownership/type first.
        await self.get_doc(workspace_id=workspace_id, item_id=item_id)
        client = await self._get_client()
        return await self._find_doc_thread_id(
            client=client,
            workspace_id=workspace_id,
            item_id=item_id,
        )

    async def apply_doc_ops(
        self,
        *,
        workspace_id: str,
        user_id: str,
        item_id: str,
        payload: ApplyDocOpsRequest,
        client_request_id: Optional[str] = None,
    ) -> ApplyDocOpsResponse:
        client = await self._get_client()

        item = await self.repo.get_item_row(client, workspace_id, item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Doc item not found")
        if item.get("type") != "doc":
            raise HTTPException(status_code=400, detail="Item is not a doc")

        current_doc = await self.repo.get_doc_row(client, item_id)
        if not current_doc:
            raise HTTPException(status_code=404, detail="Doc not found")

        current_version = int(current_doc.get("version") or 1)
        if payload.baseVersion != current_version:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Doc version conflict",
                    "currentVersion": current_version,
                    "expectedVersion": payload.baseVersion,
                },
            )

        idempotency_key = (payload.idempotencyKey or "").strip()
        if idempotency_key:
            existing = await self.repo.get_doc_idempotency(client, item_id, idempotency_key)
            if existing:
                existing_response = existing.get("response_json")
                if isinstance(existing_response, dict) and existing_response.get("revisionId"):
                    return ApplyDocOpsResponse(
                        itemId=item_id,
                        revisionId=str(existing_response.get("revisionId")),
                        previousVersion=int(existing_response.get("previousVersion") or current_version),
                        version=int(existing_response.get("version") or current_version),
                        updatedAt=int(existing_response.get("updatedAt") or _now_ms()),
                        appliedOps=int(existing_response.get("appliedOps") or 0),
                        summary=str(existing_response.get("summary") or "Idempotent replay"),
                        idempotentReplay=True,
                    )

        raw_ops = [op.model_dump(by_alias=True) for op in payload.ops]
        current_content = str(current_doc.get("content_md") or "")
        try:
            next_content, applied = apply_doc_ops(item_id, current_content, raw_ops)
        except DocOpsError as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": str(exc),
                    "opIndex": exc.op_index,
                    "opType": exc.op_type,
                },
            ) from exc

        if next_content == current_content:
            revision_id = _new_id("docrev")
            created_at_iso = _now_iso()
            await self.repo.create_doc_revision(
                client,
                {
                    "id": revision_id,
                    "item_id": item_id,
                    "account_id": workspace_id,
                    "base_version": current_version,
                    "new_version": current_version,
                    "actor_type": payload.actorType or "agent",
                    "actor_id": payload.actorId or user_id,
                    "agent_run_id": payload.agentRunId,
                    "thread_id": payload.threadId,
                    "summary": (payload.summary or "No-op edit").strip(),
                    "ops_json": raw_ops,
                    "content_before": current_content,
                    "content_after": current_content,
                    "metadata": payload.metadata or {"noop": True},
                    "created_at": created_at_iso,
                },
            )
            response_payload = ApplyDocOpsResponse(
                itemId=item_id,
                revisionId=revision_id,
                previousVersion=current_version,
                version=current_version,
                updatedAt=_now_ms(),
                appliedOps=len(applied),
                summary=payload.summary or "No-op edit",
                idempotentReplay=False,
            )
            if idempotency_key:
                await self.repo.upsert_doc_idempotency(
                    client,
                    item_id=item_id,
                    idempotency_key=idempotency_key,
                    account_id=workspace_id,
                    revision_id=revision_id,
                    response_json=response_payload.model_dump(),
                )
            return response_payload

        updated_at_iso = _now_iso()
        row, conflicted = await self.repo.update_doc_row(
            client,
            item_id=item_id,
            content_md=next_content,
            frontmatter=current_doc.get("frontmatter") or {},
            expected_version=current_version,
            updated_at_iso=updated_at_iso,
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Doc not found")
        if conflicted:
            latest_version = int(row.get("version") or current_version)
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Doc version conflict",
                    "currentVersion": latest_version,
                    "expectedVersion": current_version,
                },
            )

        blocks = extract_doc_blocks(item_id, next_content)
        await self.repo.replace_doc_blocks(
            client,
            item_id=item_id,
            blocks=[
                {
                    "block_id": block.block_id,
                    "block_type": block.block_type,
                    "anchor": block.anchor,
                    "text_preview": block.text_preview,
                    "hash": block.hash,
                    "order_index": block.order_index,
                }
                for block in blocks
            ],
            updated_at_iso=updated_at_iso,
        )

        next_version = int(row.get("version") or current_version + 1)
        revision_id = _new_id("docrev")
        revision_row = await self.repo.create_doc_revision(
            client,
            {
                "id": revision_id,
                "item_id": item_id,
                "account_id": workspace_id,
                "base_version": current_version,
                "new_version": next_version,
                "actor_type": payload.actorType or "agent",
                "actor_id": payload.actorId or user_id,
                "agent_run_id": payload.agentRunId,
                "thread_id": payload.threadId,
                "summary": (payload.summary or "Applied doc operations").strip(),
                "ops_json": raw_ops,
                "content_before": current_content,
                "content_after": next_content,
                "metadata": payload.metadata or {},
                "created_at": updated_at_iso,
            },
        )
        _ = revision_row

        await self.repo.insert_doc_operation_journal_rows(
            client,
            [
                {
                    "id": _new_id("docop"),
                    "revision_id": revision_id,
                    "item_id": item_id,
                    "account_id": workspace_id,
                    "op_index": int(result.index),
                    "op_type": result.op_type,
                    "payload_json": raw_ops[result.index] if result.index < len(raw_ops) else {},
                    "status": result.status,
                    "error_code": None,
                    "latency_ms": 0,
                    "created_at": updated_at_iso,
                }
                for result in applied
            ],
        )

        response_payload = ApplyDocOpsResponse(
            itemId=item_id,
            revisionId=revision_id,
            previousVersion=current_version,
            version=next_version,
            updatedAt=_now_ms(),
            appliedOps=len(applied),
            summary=(payload.summary or "Applied doc operations").strip(),
            idempotentReplay=False,
        )

        if idempotency_key:
            await self.repo.upsert_doc_idempotency(
                client,
                item_id=item_id,
                idempotency_key=idempotency_key,
                account_id=workspace_id,
                revision_id=revision_id,
                response_json=response_payload.model_dump(),
            )

        await bump_workspace_version_and_broadcast(
            workspace_id,
            changes=[
                {
                    "entity": "doc",
                    "action": "update",
                    "data": {
                        "itemId": item_id,
                        "version": next_version,
                        "revisionId": revision_id,
                        "appliedOps": len(applied),
                        **({"clientRequestId": client_request_id} if client_request_id else {}),
                    },
                }
            ],
            actor_id=user_id,
            request_id=client_request_id,
        )

        return response_payload

    async def list_doc_revisions(
        self,
        *,
        workspace_id: str,
        item_id: str,
        limit: int = 50,
    ) -> DocRevisionListResponse:
        client = await self._get_client()
        item = await self.repo.get_item_row(client, workspace_id, item_id)
        if not item or item.get("type") != "doc":
            raise HTTPException(status_code=404, detail="Doc not found")
        bounded_limit = max(1, min(100, int(limit or 50)))
        revisions = await self.repo.list_doc_revisions(client, item_id, limit=bounded_limit)
        return DocRevisionListResponse(itemId=item_id, revisions=revisions)

    async def get_doc_revision(
        self,
        *,
        workspace_id: str,
        item_id: str,
        revision_id: str,
    ) -> DocRevision:
        client = await self._get_client()
        item = await self.repo.get_item_row(client, workspace_id, item_id)
        if not item or item.get("type") != "doc":
            raise HTTPException(status_code=404, detail="Doc not found")
        row = await self.repo.get_doc_revision(client, item_id, revision_id)
        if not row:
            raise HTTPException(status_code=404, detail="Doc revision not found")
        return DocRevision(
            revisionId=str(row.get("id") or ""),
            itemId=str(row.get("item_id") or ""),
            baseVersion=int(row.get("base_version") or 0),
            version=int(row.get("new_version") or 0),
            actorType=str(row.get("actor_type") or "agent"),
            actorId=row.get("actor_id"),
            agentRunId=row.get("agent_run_id"),
            threadId=row.get("thread_id"),
            summary=str(row.get("summary") or ""),
            ops=list(row.get("ops_json") or []),
            metadata=dict(row.get("metadata") or {}),
            createdAt=_to_ms(row.get("created_at")),
        )

    async def undo_doc_revision(
        self,
        *,
        workspace_id: str,
        user_id: str,
        item_id: str,
        revision_id: str,
        payload: UndoDocRevisionRequest,
        client_request_id: Optional[str] = None,
    ) -> ApplyDocOpsResponse:
        client = await self._get_client()
        item = await self.repo.get_item_row(client, workspace_id, item_id)
        if not item or item.get("type") != "doc":
            raise HTTPException(status_code=404, detail="Doc not found")

        revision_row = await self.repo.get_doc_revision(client, item_id, revision_id)
        if not revision_row:
            raise HTTPException(status_code=404, detail="Doc revision not found")

        current_doc = await self.repo.get_doc_row(client, item_id)
        if not current_doc:
            raise HTTPException(status_code=404, detail="Doc not found")

        current_version = int(current_doc.get("version") or 1)
        expected_current_version = payload.expectedCurrentVersion
        if expected_current_version is not None and expected_current_version != current_version:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Doc version conflict",
                    "currentVersion": current_version,
                    "expectedVersion": expected_current_version,
                },
            )

        target_new_version = int(revision_row.get("new_version") or 0)
        if target_new_version != current_version:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Revision is not the latest state and cannot be undone directly",
                    "currentVersion": current_version,
                    "targetRevisionVersion": target_new_version,
                },
            )

        revert_content = str(revision_row.get("content_before") or "")
        updated_at_iso = _now_iso()
        row, conflicted = await self.repo.update_doc_row(
            client,
            item_id=item_id,
            content_md=revert_content,
            frontmatter=current_doc.get("frontmatter") or {},
            expected_version=current_version,
            updated_at_iso=updated_at_iso,
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Doc not found")
        if conflicted:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Doc version conflict",
                    "currentVersion": int(row.get("version") or current_version),
                    "expectedVersion": current_version,
                },
            )

        blocks = extract_doc_blocks(item_id, revert_content)
        await self.repo.replace_doc_blocks(
            client,
            item_id=item_id,
            blocks=[
                {
                    "block_id": block.block_id,
                    "block_type": block.block_type,
                    "anchor": block.anchor,
                    "text_preview": block.text_preview,
                    "hash": block.hash,
                    "order_index": block.order_index,
                }
                for block in blocks
            ],
            updated_at_iso=updated_at_iso,
        )

        next_version = int(row.get("version") or current_version + 1)
        undo_revision_id = _new_id("docrev")
        undo_ops = [
            {
                "op": "undo_revision",
                "targetRevisionId": revision_id,
                "targetVersion": target_new_version,
            }
        ]
        await self.repo.create_doc_revision(
            client,
            {
                "id": undo_revision_id,
                "item_id": item_id,
                "account_id": workspace_id,
                "base_version": current_version,
                "new_version": next_version,
                "actor_type": payload.actorType or "agent",
                "actor_id": payload.actorId or user_id,
                "agent_run_id": payload.agentRunId,
                "thread_id": payload.threadId,
                "summary": (payload.summary or f"Undo revision {revision_id}").strip(),
                "ops_json": undo_ops,
                "content_before": str(current_doc.get("content_md") or ""),
                "content_after": revert_content,
                "metadata": payload.metadata or {"undoTargetRevisionId": revision_id},
                "created_at": updated_at_iso,
            },
        )

        await self.repo.insert_doc_operation_journal_rows(
            client,
            [
                {
                    "id": _new_id("docop"),
                    "revision_id": undo_revision_id,
                    "item_id": item_id,
                    "account_id": workspace_id,
                    "op_index": 0,
                    "op_type": "undo_revision",
                    "payload_json": {"targetRevisionId": revision_id},
                    "status": "applied",
                    "error_code": None,
                    "latency_ms": 0,
                    "created_at": updated_at_iso,
                }
            ],
        )

        await bump_workspace_version_and_broadcast(
            workspace_id,
            changes=[
                {
                    "entity": "doc",
                    "action": "update",
                    "data": {
                        "itemId": item_id,
                        "version": next_version,
                        "revisionId": undo_revision_id,
                        "undoRevisionId": revision_id,
                        **({"clientRequestId": client_request_id} if client_request_id else {}),
                    },
                }
            ],
            actor_id=user_id,
            request_id=client_request_id,
        )

        return ApplyDocOpsResponse(
            itemId=item_id,
            revisionId=undo_revision_id,
            previousVersion=current_version,
            version=next_version,
            updatedAt=_now_ms(),
            appliedOps=1,
            summary=(payload.summary or f"Undo revision {revision_id}").strip(),
            idempotentReplay=False,
        )
