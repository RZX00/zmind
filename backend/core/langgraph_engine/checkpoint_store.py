from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from core.langgraph_engine.contracts.checkpoint_contract import (
    CHECKPOINT_TABLE_NAME,
    CheckpointRecord,
    CheckpointStore,
)
from core.langgraph_engine.contracts.state_schema import GraphState
from core.utils.logger import logger

try:
    from core.services.supabase import DBConnection
except Exception:  # pragma: no cover - supabase client may be unavailable in tests
    DBConnection = None  # type: ignore


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _deepcopy_state(state: GraphState) -> GraphState:
    # Persist as plain JSON to avoid accidental mutation across async tasks.
    return json.loads(json.dumps(state))


class MemoryCheckpointStore(CheckpointStore):
    """
    In-memory checkpoint store for testing and local runs.
    Not process-safe; intended for unit tests only.
    """

    def __init__(self) -> None:
        self._store: dict[str, list[CheckpointRecord]] = {}
        self._lock = asyncio.Lock()

    async def save(self, state: GraphState) -> str:
        checkpoint_id = f"cp_{uuid.uuid4().hex}"
        state_json = _deepcopy_state(state)
        state_json["checkpoint_id"] = checkpoint_id
        record: CheckpointRecord = {
            "agent_run_id": state["agent_run_id"],
            "checkpoint_id": checkpoint_id,
            "state_json": state_json,
            "created_at": _now_iso(),
        }
        async with self._lock:
            self._store.setdefault(state["agent_run_id"], []).append(record)
        return checkpoint_id

    async def load(self, agent_run_id: str, checkpoint_id: str | None = None) -> GraphState | None:
        async with self._lock:
            records = self._store.get(agent_run_id) or []
            if not records:
                return None
            if checkpoint_id is None:
                record = max(records, key=lambda r: r["created_at"])
            else:
                record = next((r for r in records if r["checkpoint_id"] == checkpoint_id), None)
                if record is None:
                    return None
        return _deepcopy_state(record["state_json"])  # type: ignore[return-value]


class SupabaseCheckpointStore(CheckpointStore):
    """
    Supabase-backed checkpoint saver.

    Schema (decision 3):
      agent_run_id text
      checkpoint_id text
      state_json jsonb
      created_at timestamp
      unique (agent_run_id, checkpoint_id)
    """

    def __init__(self, db_connection: Optional[Any] = None) -> None:
        if db_connection is None and DBConnection:
            db_connection = DBConnection()
        self._db_connection = db_connection

    async def _client(self):
        if not self._db_connection:
            raise RuntimeError("Supabase client not available")
        return await self._db_connection.client

    async def save(self, state: GraphState) -> str:
        checkpoint_id = f"cp_{uuid.uuid4().hex}"
        state_json = _deepcopy_state(state)
        state_json["checkpoint_id"] = checkpoint_id
        record: Dict[str, Any] = {
            "agent_run_id": state["agent_run_id"],
            "checkpoint_id": checkpoint_id,
            "state_json": state_json,
            "created_at": _now_iso(),
        }
        try:
            client = await self._client()
            await client.table(CHECKPOINT_TABLE_NAME).upsert(record).execute()
        except Exception:
            logger.exception("Failed to save checkpoint to Supabase", agent_run_id=state["agent_run_id"])
            raise
        return checkpoint_id

    async def load(self, agent_run_id: str, checkpoint_id: str | None = None) -> GraphState | None:
        try:
            client = await self._client()
            query = client.table(CHECKPOINT_TABLE_NAME).select("*").eq("agent_run_id", agent_run_id)
            if checkpoint_id:
                query = query.eq("checkpoint_id", checkpoint_id).limit(1)
            else:
                query = query.order("created_at", desc=True).limit(1)
            res = await query.execute()
            rows = res.data or []
            if not rows:
                return None
            row = rows[0]
            return _deepcopy_state(row.get("state_json") or {})  # type: ignore[return-value]
        except Exception:
            logger.exception("Failed to load checkpoint from Supabase", agent_run_id=agent_run_id, checkpoint_id=checkpoint_id)
            raise
