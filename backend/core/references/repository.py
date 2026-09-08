from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from .api_models import ReferenceEdge, RefsSummary


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


def _to_reference(row: dict) -> ReferenceEdge:
    return ReferenceEdge(
        id=row.get("id"),
        sourceType=row.get("source_type"),
        sourceItemId=row.get("source_item_id"),
        sourceAnchor=row.get("source_anchor"),
        targetType=row.get("target_type"),
        targetItemId=row.get("target_item_id"),
        targetAnchor=row.get("target_anchor"),
        mode=row.get("mode"),
        snapshotPayload=row.get("snapshot_payload"),
        isDeleted=bool(row.get("is_deleted", False)),
        createdAt=_to_ms(row.get("created_at")),
        updatedAt=_to_ms(row.get("updated_at")),
    )


class ReferencesRepository:
    async def get_item_row(self, client, workspace_id: str, item_id: str) -> Optional[dict]:
        result = (
            await client.table("items")
            .select("id,type,is_deleted")
            .eq("account_id", workspace_id)
            .eq("id", item_id)
            .limit(1)
            .execute()
        )
        if not result.data:
            return None
        return result.data[0]

    async def create_reference(self, client, payload: dict) -> ReferenceEdge:
        result = await client.table("references").insert(payload).execute()
        row = result.data[0] if result.data else payload
        return _to_reference(row)

    async def get_reference(self, client, workspace_id: str, reference_id: str) -> Optional[ReferenceEdge]:
        result = (
            await client.table("references")
            .select("*")
            .eq("account_id", workspace_id)
            .eq("id", reference_id)
            .limit(1)
            .execute()
        )
        if not result.data:
            return None
        return _to_reference(result.data[0])

    async def soft_delete_reference(self, client, workspace_id: str, reference_id: str, updated_at_iso: str) -> bool:
        result = (
            await client.table("references")
            .update({"is_deleted": True, "updated_at": updated_at_iso})
            .eq("account_id", workspace_id)
            .eq("id", reference_id)
            .eq("is_deleted", False)
            .execute()
        )
        return bool(result.data)

    async def list_backlinks(
        self,
        client,
        workspace_id: str,
        target_item_id: str,
        target_anchor: Optional[str] = None,
    ) -> list[ReferenceEdge]:
        query = (
            client.table("references")
            .select("*")
            .eq("account_id", workspace_id)
            .eq("target_item_id", target_item_id)
            .eq("is_deleted", False)
            .order("updated_at", desc=True)
        )
        if target_anchor is not None:
            query = query.eq("target_anchor", target_anchor)
        result = await query.execute()
        return [_to_reference(row) for row in (result.data or [])]

    async def list_references_by_ids(
        self,
        client,
        workspace_id: str,
        reference_ids: list[str],
    ) -> list[ReferenceEdge]:
        if not reference_ids:
            return []
        result = (
            await client.table("references")
            .select("*")
            .eq("account_id", workspace_id)
            .in_("id", reference_ids)
            .eq("is_deleted", False)
            .execute()
        )
        return [_to_reference(row) for row in (result.data or [])]

    async def summarize_refs(self, client, workspace_id: str) -> RefsSummary:
        result = (
            await client.table("references")
            .select("source_item_id,target_item_id")
            .eq("account_id", workspace_id)
            .eq("is_deleted", False)
            .execute()
        )
        rows = result.data or []

        inbound: dict[str, int] = {}
        outbound: dict[str, int] = {}

        for row in rows:
            source_item_id = row.get("source_item_id")
            target_item_id = row.get("target_item_id")
            if source_item_id:
                outbound[source_item_id] = outbound.get(source_item_id, 0) + 1
            if target_item_id:
                inbound[target_item_id] = inbound.get(target_item_id, 0) + 1

        return RefsSummary(
            inboundCountByItem=inbound,
            outboundCountByItem=outbound,
        )
