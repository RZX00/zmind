from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional, List

from core.domains.collaboration.model import (
    CollaborationSession,
    CollaborationOperationBatch,
)
from core.domains.collaboration.ports.collaboration_repository import (
    CollaborationRepository,
)
from core.services.supabase import DBConnection
from core.utils.errors import is_unique_violation
from core.utils.logger import logger


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


class SupabaseCollaborationRepository(CollaborationRepository):
    def __init__(self, db: Optional[DBConnection] = None) -> None:
        self._db = db or DBConnection()

    async def start_session(
        self,
        *,
        session_id: str,
        canvas_id: str,
        workspace_id: str,
        user_id: Optional[str],
    ) -> CollaborationSession:
        client = await self._db.client
        row = {
            "session_id": session_id,
            "canvas_id": canvas_id,
            "workspace_id": workspace_id,
            "user_id": user_id,
            "status": "active",
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        await client.table("collaboration_sessions").upsert(
            row, on_conflict="session_id"
        ).execute()
        return CollaborationSession(
            id=session_id,
            canvas_id=canvas_id,
            workspace_id=workspace_id,
            user_id=user_id,
            status="active",
            started_at=_parse_dt(row["started_at"]) or datetime.now(timezone.utc),
            ended_at=None,
        )

    async def close_session(
        self,
        *,
        session_id: str,
        ended_at: datetime,
    ) -> None:
        client = await self._db.client
        await client.table("collaboration_sessions").update(
            {"status": "closed", "ended_at": ended_at.isoformat()}
        ).eq("session_id", session_id).execute()

    async def append_operations(
        self,
        *,
        session_id: str,
        canvas_id: str,
        workspace_id: str,
        user_id: Optional[str],
        operations: List[Dict[str, Any]],
        idempotency_key: Optional[str],
    ) -> CollaborationOperationBatch:
        client = await self._db.client
        created_at = datetime.now(timezone.utc)
        row = {
            "session_id": session_id,
            "canvas_id": canvas_id,
            "workspace_id": workspace_id,
            "user_id": user_id,
            "operations": operations,
            "op_count": len(operations or []),
            "idempotency_key": idempotency_key,
            "created_at": created_at.isoformat(),
        }
        try:
            res = await client.table("collaboration_ops").insert(row).execute()
            data = res.data[0] if res.data else None
            if data:
                return self._row_to_batch(data)
        except Exception as exc:
            if idempotency_key and is_unique_violation(exc):
                try:
                    res = (
                        await client.table("collaboration_ops")
                        .select("*")
                        .eq("session_id", session_id)
                        .eq("idempotency_key", idempotency_key)
                        .limit(1)
                        .execute()
                    )
                    if res.data:
                        return self._row_to_batch(res.data[0])
                except Exception as inner:
                    logger.warning(
                        "collaboration_ops.idempotency_lookup_failed",
                        session_id=session_id,
                        error=str(inner),
                    )
            raise
        return CollaborationOperationBatch(
            id="",
            session_id=session_id,
            canvas_id=canvas_id,
            workspace_id=workspace_id,
            user_id=user_id,
            operations=operations,
            op_count=len(operations or []),
            idempotency_key=idempotency_key,
            created_at=created_at,
        )

    async def list_operations_since(
        self,
        *,
        canvas_id: str,
        workspace_id: str,
        since: datetime,
        limit: int = 500,
    ) -> List[CollaborationOperationBatch]:
        client = await self._db.client
        res = (
            await client.table("collaboration_ops")
            .select("*")
            .eq("canvas_id", canvas_id)
            .eq("workspace_id", workspace_id)
            .gt("created_at", since.isoformat())
            .order("created_at", desc=False)
            .limit(limit)
            .execute()
        )
        rows = res.data or []
        return [self._row_to_batch(row) for row in rows]

    @staticmethod
    def _row_to_batch(row: Dict[str, Any]) -> CollaborationOperationBatch:
        created_at = _parse_dt(row.get("created_at")) or datetime.now(timezone.utc)
        return CollaborationOperationBatch(
            id=str(row.get("id")),
            session_id=str(row.get("session_id")),
            canvas_id=str(row.get("canvas_id")),
            workspace_id=str(row.get("workspace_id")),
            user_id=row.get("user_id"),
            operations=row.get("operations") or [],
            op_count=int(row.get("op_count") or 0),
            idempotency_key=row.get("idempotency_key"),
            created_at=created_at,
        )
