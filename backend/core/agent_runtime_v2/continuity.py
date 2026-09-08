from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, ClassVar, Protocol

from core.langgraph_engine.contracts.checkpoint_contract import CHECKPOINT_TABLE_NAME
from core.services.supabase import DBConnection
from core.utils.logger import logger

from .contracts import ContinuityStateV2


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _deepcopy_state(payload: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(payload, ensure_ascii=False))


class ContinuityStoreV2(Protocol):
    async def save(self, continuity_id: str, state: ContinuityStateV2) -> str: ...

    async def load(self, continuity_id: str, resume_token: str | None = None) -> ContinuityStateV2 | None: ...


@dataclass(slots=True)
class MemoryContinuityStoreV2:
    _GLOBAL_STORE: ClassVar[dict[str, list[dict[str, Any]]]] = {}
    _GLOBAL_LOCK: ClassVar[asyncio.Lock] = asyncio.Lock()
    _store: dict[str, list[dict[str, Any]]] = None  # type: ignore[assignment]
    _lock: asyncio.Lock = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self._store is None:
            self._store = self._GLOBAL_STORE
        if self._lock is None:
            self._lock = self._GLOBAL_LOCK

    async def save(self, continuity_id: str, state: ContinuityStateV2) -> str:
        checkpoint_id = f"rtv2_{uuid.uuid4().hex}"
        payload = _deepcopy_state(state.to_dict())
        payload["updated_at"] = _now_iso()
        record = {
            "agent_run_id": continuity_id,
            "checkpoint_id": checkpoint_id,
            "state_json": payload,
            "created_at": _now_iso(),
        }
        async with self._lock:
            self._store.setdefault(continuity_id, []).append(record)
        return checkpoint_id

    async def load(self, continuity_id: str, resume_token: str | None = None) -> ContinuityStateV2 | None:
        async with self._lock:
            records = list(self._store.get(continuity_id) or [])
        if not records:
            return None
        if resume_token:
            match = next((record for record in records if record.get("checkpoint_id") == resume_token), None)
        else:
            match = max(records, key=lambda item: str(item.get("created_at") or ""))
        if not match:
            return None
        return ContinuityStateV2.from_dict(dict(match.get("state_json") or {}), continuity_id=continuity_id)


@dataclass(slots=True)
class SupabaseContinuityStoreV2:
    db_connection: Any | None = None

    def __post_init__(self) -> None:
        if self.db_connection is None:
            self.db_connection = DBConnection()

    async def _client(self) -> Any:
        if self.db_connection is None:
            raise RuntimeError("Supabase client unavailable")
        return await self.db_connection.client

    async def save(self, continuity_id: str, state: ContinuityStateV2) -> str:
        checkpoint_id = f"rtv2_{uuid.uuid4().hex}"
        payload = _deepcopy_state(state.to_dict())
        payload["updated_at"] = _now_iso()
        record = {
            "agent_run_id": continuity_id,
            "checkpoint_id": checkpoint_id,
            "state_json": payload,
            "created_at": _now_iso(),
        }
        client = await self._client()
        await client.table(CHECKPOINT_TABLE_NAME).upsert(record).execute()
        return checkpoint_id

    async def load(self, continuity_id: str, resume_token: str | None = None) -> ContinuityStateV2 | None:
        client = await self._client()
        query = client.table(CHECKPOINT_TABLE_NAME).select("*").eq("agent_run_id", continuity_id)
        if resume_token:
            query = query.eq("checkpoint_id", resume_token).limit(1)
        else:
            query = query.order("created_at", desc=True).limit(1)
        result = await query.execute()
        rows = result.data or []
        if not rows:
            return None
        return ContinuityStateV2.from_dict(dict(rows[0].get("state_json") or {}), continuity_id=continuity_id)


async def load_or_create_continuity_state(
    store: ContinuityStoreV2,
    *,
    continuity_id: str,
    resume_token: str | None = None,
) -> ContinuityStateV2:
    try:
        state = await store.load(continuity_id, resume_token=resume_token)
    except Exception as exc:
        logger.warning(
            "Failed to load runtime continuity state; starting fresh",
            continuity_id=continuity_id,
            error=str(exc),
        )
        state = None
    return state or ContinuityStateV2.empty(continuity_id)


def resume_consistency_check(
    *,
    stored: ContinuityStateV2,
    surface: str | None,
    workspace_target: dict[str, Any] | None,
    selection_context: dict[str, Any] | None,
) -> dict[str, Any]:
    snapshot = dict((stored.resume_metadata or {}).get("runtime_context_snapshot") or {})
    mismatches: list[str] = []

    if snapshot.get("surface") != surface:
        mismatches.append("surface_changed")

    stored_target = dict(snapshot.get("workspace_target") or {})
    incoming_target = dict(workspace_target or {})
    if stored_target.get("canvas_id") != incoming_target.get("canvas_id"):
        mismatches.append("canvas_target_changed")

    stored_selection = dict(snapshot.get("selection_context") or {})
    incoming_selection = dict(selection_context or {})
    if stored_selection != incoming_selection:
        mismatches.append("selection_changed")

    return {
        "ok": not mismatches,
        "mismatches": mismatches,
        "snapshot": snapshot,
    }
