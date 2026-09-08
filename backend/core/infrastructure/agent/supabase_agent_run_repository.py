from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Dict, Any, Tuple

from core.domains.agent.model import AgentRun
from core.domains.agent.ports.agent_run_repository import AgentRunRepository
from core.services.supabase import DBConnection
from core.utils.errors import is_unique_violation


class SupabaseAgentRunRepository(AgentRunRepository):
    def __init__(self, db: Optional[DBConnection] = None) -> None:
        self._db = db or DBConnection()

    @staticmethod
    def _row_to_run(row: Dict[str, Any], workspace_id: Optional[str] = None) -> AgentRun:
        metadata = row.get("metadata") or {}
        if isinstance(metadata, str):
            try:
                import json as _json

                metadata = _json.loads(metadata)
            except Exception:
                metadata = {}
        if not isinstance(metadata, dict):
            metadata = {}
        run_id = row.get("id")
        thread_id = row.get("thread_id")
        return AgentRun(
            id=str(run_id) if run_id is not None else "",
            thread_id=str(thread_id) if thread_id is not None else "",
            status=row.get("status") or "running",
            started_at=row.get("started_at"),
            completed_at=row.get("completed_at"),
            error=row.get("error"),
            agent_id=row.get("agent_id"),
            agent_version_id=row.get("agent_version_id"),
            metadata=metadata,
            workspace_id=workspace_id,
        )

    async def create_run(
        self,
        *,
        thread_id: str,
        status: str,
        started_at: Optional[str],
        agent_id: Optional[str],
        agent_version_id: Optional[str],
        metadata: Dict[str, Any],
        idempotency_key: Optional[str],
        skip_idempotency_lookup: bool = False,
    ) -> Tuple[AgentRun, bool]:
        client = await self._db.client
        if idempotency_key and not skip_idempotency_lookup:
            existing = (
                await client.table("agent_runs")
                .select("id, thread_id, status, started_at, completed_at, error, agent_id, agent_version_id, metadata")
                .eq("thread_id", thread_id)
                .eq("idempotency_key", idempotency_key)
                .limit(1)
                .execute()
            )
            if existing.data:
                return self._row_to_run(existing.data[0]), True

        payload: Dict[str, Any] = {
            "thread_id": thread_id,
            "status": status,
            "started_at": started_at or datetime.now(timezone.utc).isoformat(),
            "agent_id": agent_id,
            "agent_version_id": agent_version_id,
            "metadata": metadata or {},
        }
        if idempotency_key:
            payload["idempotency_key"] = idempotency_key

        try:
            res = await client.table("agent_runs").insert(payload).execute()
        except Exception as exc:
            if idempotency_key and is_unique_violation(exc):
                existing = (
                    await client.table("agent_runs")
                    .select("id, thread_id, status, started_at, completed_at, error, agent_id, agent_version_id, metadata")
                    .eq("thread_id", thread_id)
                    .eq("idempotency_key", idempotency_key)
                    .limit(1)
                    .execute()
                )
                if existing.data:
                    return self._row_to_run(existing.data[0]), True
            raise

        if res.data:
            return self._row_to_run(res.data[0]), False

        if idempotency_key:
            existing = (
                await client.table("agent_runs")
                .select("id, thread_id, status, started_at, completed_at, error, agent_id, agent_version_id, metadata")
                .eq("thread_id", thread_id)
                .eq("idempotency_key", idempotency_key)
                .limit(1)
                .execute()
            )
            if existing.data:
                return self._row_to_run(existing.data[0]), True

        raise RuntimeError("agent_runs insert failed")

    async def update_status(
        self,
        *,
        agent_run_id: str,
        status: str,
        error: Optional[str] = None,
        completed_at: Optional[str] = None,
        expected_status: Optional[str] = None,
    ) -> Optional[AgentRun]:
        client = await self._db.client
        update_data: Dict[str, Any] = {
            "status": status,
            "completed_at": completed_at or datetime.now(timezone.utc).isoformat(),
        }
        if error is not None:
            update_data["error"] = error

        query = client.table("agent_runs").update(update_data).eq("id", agent_run_id)
        if expected_status:
            query = query.eq("status", expected_status)
        res = await query.execute()
        if not getattr(res, "data", None):
            return None

        run = await self.get_with_workspace(agent_run_id)
        if run:
            return run

        return self._row_to_run(res.data[0])

    async def get_by_id(self, agent_run_id: str) -> Optional[AgentRun]:
        client = await self._db.client
        res = (
            await client.table("agent_runs")
            .select("id, thread_id, status, started_at, completed_at, error, agent_id, agent_version_id, metadata")
            .eq("id", agent_run_id)
            .limit(1)
            .execute()
        )
        if not res.data:
            return None
        return self._row_to_run(res.data[0])

    async def get_with_workspace(self, agent_run_id: str) -> Optional[AgentRun]:
        client = await self._db.client
        res = (
            await client.table("agent_runs")
            .select("id, thread_id, status, started_at, completed_at, error, agent_id, agent_version_id, metadata, threads(account_id)")
            .eq("id", agent_run_id)
            .limit(1)
            .execute()
        )
        if not res.data:
            return None
        row = res.data[0]
        workspace_id = None
        threads = row.get("threads") or {}
        if isinstance(threads, dict):
            workspace_id = threads.get("account_id")
        return self._row_to_run(row, workspace_id=str(workspace_id) if workspace_id else None)
