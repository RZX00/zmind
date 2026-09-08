#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from core.services import redis
from core.services.supabase import DBConnection
from core.utils.logger import logger


def _json_dump(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


async def _load_agent_run(client, agent_run_id: str) -> dict[str, Any]:
    res = await client.table("agent_runs").select("*").eq("id", agent_run_id).limit(1).execute()
    if not res.data:
        raise SystemExit(f"agent_run not found: {agent_run_id}")
    return res.data[0]


async def _load_thread(client, thread_id: str) -> dict[str, Any]:
    res = await client.table("threads").select("*").eq("thread_id", thread_id).limit(1).execute()
    if not res.data:
        raise SystemExit(f"thread not found: {thread_id}")
    return res.data[0]


async def _load_messages(client, thread_id: str) -> list[dict[str, Any]]:
    # Best-effort full snapshot (caller can post-filter by session_index).
    res = await client.table("messages").select("*").eq("thread_id", thread_id).order("created_at", desc=False).execute()
    return res.data or []


async def _load_legacy_stream(agent_run_id: str) -> list[dict[str, Any]]:
    key = f"agent_run:{agent_run_id}:responses"
    raw_items = await redis.lrange(key, 0, -1)
    payloads: list[dict[str, Any]] = []
    for item in raw_items or []:
        if isinstance(item, bytes):
            item = item.decode("utf-8", errors="replace")
        payloads.append(json.loads(item))
    return payloads


async def main() -> int:
    parser = argparse.ArgumentParser(description="WS-E: Record a primary run into a replayable JSON fixture.")
    parser.add_argument("--agent-run-id", required=True, help="Primary agent_run.id to record")
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output JSON path (default: backend/tests/golden/records/{agent_run_id}.json)",
    )
    parser.add_argument("--include-messages", action="store_true", help="Include full thread messages snapshot")
    args = parser.parse_args()

    agent_run_id: str = args.agent_run_id
    out: Path = args.out or Path("backend/tests/golden/records") / f"{agent_run_id}.json"

    await redis.initialize_async()
    db = DBConnection()
    await db.initialize()
    client = await db.client

    agent_run = await _load_agent_run(client, agent_run_id)
    thread_id = agent_run.get("thread_id")
    if not isinstance(thread_id, str) or not thread_id:
        raise SystemExit(f"agent_run missing thread_id: {agent_run_id}")

    thread = await _load_thread(client, thread_id)
    legacy_stream_payloads = await _load_legacy_stream(agent_run_id)

    record: dict[str, Any] = {
        "schema_version": "ws-e-recording-v1",
        "recorded_at": agent_run.get("completed_at") or agent_run.get("updated_at") or agent_run.get("created_at"),
        "primary_agent_run_id": agent_run_id,
        "agent_run": agent_run,
        "thread": thread,
        "legacy_stream": {
            "redis_list_key": f"agent_run:{agent_run_id}:responses",
            "payloads": legacy_stream_payloads,
            "count": len(legacy_stream_payloads),
        },
    }

    if args.include_messages:
        record["messages"] = await _load_messages(client, thread_id)

    _json_dump(out, record)
    logger.info(f"[WS-E] Recorded agent_run {agent_run_id} -> {out} (payloads={len(legacy_stream_payloads)})")
    return 0


if __name__ == "__main__":
    import asyncio

    raise SystemExit(asyncio.run(main()))

