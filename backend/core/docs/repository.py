from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from .api_models import DocBlock, DocContent, DocsMetaItem, DocRevision


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


def _to_doc_block(row: dict) -> DocBlock:
    return DocBlock(
        blockId=row.get("block_id"),
        itemId=row.get("item_id"),
        blockType=row.get("block_type") or "paragraph",
        anchor=row.get("anchor") or "block",
        textPreview=row.get("text_preview") or "",
        hash=row.get("hash") or "",
        orderIndex=int(row.get("order_index") or 0),
    )


def _to_doc_revision(row: dict) -> DocRevision:
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


class DocsRepository:
    async def get_item_row(self, client, workspace_id: str, item_id: str) -> Optional[dict]:
        result = (
            await client.table("items")
            .select("*")
            .eq("account_id", workspace_id)
            .eq("id", item_id)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )
        if not result.data:
            return None
        return result.data[0]

    async def create_item_row(self, client, payload: dict) -> dict:
        result = await client.table("items").insert(payload).execute()
        return result.data[0] if result.data else payload

    async def create_doc_row(self, client, payload: dict) -> dict:
        result = await client.table("docs").insert(payload).execute()
        return result.data[0] if result.data else payload

    async def get_doc_row(self, client, item_id: str) -> Optional[dict]:
        result = (
            await client.table("docs")
            .select("*")
            .eq("item_id", item_id)
            .limit(1)
            .execute()
        )
        if not result.data:
            return None
        return result.data[0]

    async def get_doc_content(self, client, workspace_id: str, item_id: str) -> Optional[DocContent]:
        item_row = await self.get_item_row(client, workspace_id, item_id)
        if not item_row:
            return None
        doc_row = await self.get_doc_row(client, item_id)
        if not doc_row:
            return None
        return DocContent(
            itemId=item_id,
            title=item_row.get("title") or "Untitled",
            contentMd=doc_row.get("content_md") or "",
            frontmatter=doc_row.get("frontmatter") or {},
            version=int(doc_row.get("version") or 1),
            createdAt=_to_ms(doc_row.get("created_at") or item_row.get("created_at")),
            updatedAt=_to_ms(doc_row.get("updated_at") or item_row.get("updated_at")),
        )

    async def update_doc_row(
        self,
        client,
        *,
        item_id: str,
        content_md: str,
        frontmatter: Optional[dict],
        expected_version: Optional[int],
        updated_at_iso: str,
    ) -> tuple[Optional[dict], bool]:
        current = await self.get_doc_row(client, item_id)
        if not current:
            return (None, False)

        current_version = int(current.get("version") or 1)
        if expected_version is not None and expected_version != current_version:
            return (current, True)

        next_version = current_version + 1
        payload = {
            "content_md": content_md,
            "frontmatter": frontmatter if frontmatter is not None else (current.get("frontmatter") or {}),
            "version": next_version,
            "updated_at": updated_at_iso,
        }
        result = await client.table("docs").update(payload).eq("item_id", item_id).execute()
        row = result.data[0] if result.data else {**current, **payload}
        return (row, False)

    async def replace_doc_blocks(self, client, *, item_id: str, blocks: list[dict], updated_at_iso: str) -> None:
        await client.table("doc_blocks").delete().eq("item_id", item_id).execute()
        if not blocks:
            return
        rows = [
            {
                "block_id": block["block_id"],
                "item_id": item_id,
                "block_type": block["block_type"],
                "anchor": block["anchor"],
                "text_preview": block["text_preview"],
                "hash": block["hash"],
                "order_index": block["order_index"],
                "created_at": updated_at_iso,
                "updated_at": updated_at_iso,
            }
            for block in blocks
        ]
        await client.table("doc_blocks").insert(rows).execute()

    async def list_doc_blocks(self, client, item_id: str) -> list[DocBlock]:
        result = (
            await client.table("doc_blocks")
            .select("*")
            .eq("item_id", item_id)
            .order("order_index")
            .execute()
        )
        return [_to_doc_block(row) for row in (result.data or [])]

    async def list_docs_meta(self, client, workspace_id: str) -> list[DocsMetaItem]:
        items_res = (
            await client.table("items")
            .select("id,title,updated_at")
            .eq("account_id", workspace_id)
            .eq("type", "doc")
            .eq("is_deleted", False)
            .execute()
        )
        item_rows = items_res.data or []
        if not item_rows:
            return []

        ids = [row.get("id") for row in item_rows if row.get("id")]
        docs_res = await client.table("docs").select("item_id,version,updated_at").in_("item_id", ids).execute()
        version_by_item: dict[str, dict] = {row.get("item_id"): row for row in (docs_res.data or [])}

        out: list[DocsMetaItem] = []
        for item in item_rows:
            item_id = item.get("id")
            if not item_id:
                continue
            doc_row = version_by_item.get(item_id) or {}
            out.append(
                DocsMetaItem(
                    itemId=item_id,
                    title=item.get("title") or "Untitled",
                    version=int(doc_row.get("version") or 1),
                    updatedAt=_to_ms(doc_row.get("updated_at") or item.get("updated_at")),
                )
            )
        return out

    async def create_doc_revision(self, client, payload: dict[str, Any]) -> dict[str, Any]:
        result = await client.table("doc_revisions").insert(payload).execute()
        return result.data[0] if result.data else payload

    async def get_doc_revision(self, client, item_id: str, revision_id: str) -> Optional[dict[str, Any]]:
        result = (
            await client.table("doc_revisions")
            .select("*")
            .eq("item_id", item_id)
            .eq("id", revision_id)
            .limit(1)
            .execute()
        )
        if not result.data:
            return None
        return result.data[0]

    async def list_doc_revisions(self, client, item_id: str, limit: int = 50) -> list[DocRevision]:
        result = (
            await client.table("doc_revisions")
            .select("*")
            .eq("item_id", item_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return [_to_doc_revision(row) for row in (result.data or [])]

    async def insert_doc_operation_journal_rows(self, client, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        await client.table("doc_operation_journal").insert(rows).execute()

    async def get_doc_idempotency(self, client, item_id: str, idempotency_key: str) -> Optional[dict[str, Any]]:
        result = (
            await client.table("doc_idempotency_keys")
            .select("*")
            .eq("item_id", item_id)
            .eq("idempotency_key", idempotency_key)
            .limit(1)
            .execute()
        )
        if not result.data:
            return None
        return result.data[0]

    async def upsert_doc_idempotency(
        self,
        client,
        *,
        item_id: str,
        idempotency_key: str,
        account_id: str,
        revision_id: Optional[str],
        response_json: dict[str, Any],
        expires_at_iso: Optional[str] = None,
    ) -> None:
        await client.table("doc_idempotency_keys").upsert(
            {
                "item_id": item_id,
                "idempotency_key": idempotency_key,
                "account_id": account_id,
                "revision_id": revision_id,
                "response_json": response_json,
                "expires_at": expires_at_iso,
            }
        ).execute()
