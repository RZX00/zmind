from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Iterable

from core.services import redis
from core.application.use_cases.agent.update_agent_run_status import UpdateAgentRunStatusUseCase
from core.infrastructure.agent.supabase_agent_run_repository import SupabaseAgentRunRepository
from core.utils.config import config
from core.utils.logger import logger


DEFAULT_RESPONSE_TTL_SEC = 3600 * 24
STALE_RUN_ERROR = "Agent run marked failed due to stale worker heartbeat."


def _coerce_int(value: int | None, default: int) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


async def _cleanup_run_keys(agent_run_id: str) -> None:
    try:
        await redis.delete(f"agent_run_lock:{agent_run_id}")
    except Exception as exc:
        logger.debug("Reaper: failed to delete run lock", agent_run_id=agent_run_id, error=str(exc))

    try:
        active_keys = await redis.keys(f"active_run:*:{agent_run_id}")
    except Exception as exc:
        logger.debug("Reaper: failed to lookup active run keys", agent_run_id=agent_run_id, error=str(exc))
        return

    for key in active_keys:
        try:
            await redis.delete(key)
        except Exception as exc:
            logger.debug("Reaper: failed to delete active run key", key=key, error=str(exc))


async def _publish_run_termination(agent_run_id: str) -> None:
    response_list_key = f"agent_run:{agent_run_id}:responses"
    response_channel = f"agent_run:{agent_run_id}:new_response"
    control_channel = f"agent_run:{agent_run_id}:control"

    payload = {"type": "status", "status": "error", "message": STALE_RUN_ERROR}
    try:
        await redis.rpush(response_list_key, json.dumps(payload))
        await redis.publish(response_channel, "new")
        await redis.expire(response_list_key, DEFAULT_RESPONSE_TTL_SEC)
    except Exception as exc:
        logger.debug("Reaper: failed to publish response", agent_run_id=agent_run_id, error=str(exc))

    try:
        await redis.publish(control_channel, "ERROR")
    except Exception as exc:
        logger.debug("Reaper: failed to publish control signal", agent_run_id=agent_run_id, error=str(exc))


async def _fetch_stale_runs(client, stale_before_iso: str, limit: int) -> list[dict]:
    stale_runs: list[dict] = []

    try:
        heartbeat_result = (
            await client.table("agent_runs")
            .select("id, thread_id, worker_heartbeat_at, started_at")
            .eq("status", "running")
            .lt("worker_heartbeat_at", stale_before_iso)
            .limit(limit)
            .execute()
        )
        stale_runs.extend(heartbeat_result.data or [])
    except Exception as exc:
        logger.debug("Reaper: heartbeat query failed", error=str(exc))

    if len(stale_runs) >= limit:
        return stale_runs[:limit]

    try:
        no_heartbeat_result = (
            await client.table("agent_runs")
            .select("id, thread_id, worker_heartbeat_at, started_at")
            .eq("status", "running")
            .is_("worker_heartbeat_at", "null")
            .lt("started_at", stale_before_iso)
            .limit(limit - len(stale_runs))
            .execute()
        )
        stale_runs.extend(no_heartbeat_result.data or [])
    except Exception as exc:
        logger.debug("Reaper: no-heartbeat query failed", error=str(exc))

    if not stale_runs:
        return []

    seen: set[str] = set()
    unique_runs: list[dict] = []
    for run in stale_runs:
        run_id = run.get("id")
        if not run_id or run_id in seen:
            continue
        seen.add(run_id)
        unique_runs.append(run)

    return unique_runs[:limit]


async def reap_stale_agent_runs(
    db,
    *,
    stale_after_seconds: int | None = None,
    limit: int = 50,
) -> int:
    stale_after_seconds = _coerce_int(stale_after_seconds, config.AGENT_RUN_STALE_THRESHOLD_SEC)
    limit = _coerce_int(limit, 50)
    if stale_after_seconds <= 0:
        return 0

    client = await db.client
    stale_before = datetime.now(timezone.utc) - timedelta(seconds=stale_after_seconds)
    stale_before_iso = stale_before.isoformat()
    use_case = UpdateAgentRunStatusUseCase(SupabaseAgentRunRepository())

    stale_runs = await _fetch_stale_runs(client, stale_before_iso, limit)
    if not stale_runs:
        return 0

    reaped = 0
    for run in stale_runs:
        agent_run_id = run.get("id")
        if not agent_run_id:
            continue

        try:
            run = await use_case.execute(
                agent_run_id=agent_run_id,
                status="failed",
                error=STALE_RUN_ERROR,
                expected_status="running",
            )
        except Exception as exc:
            logger.debug("Reaper: failed to update stale run", agent_run_id=agent_run_id, error=str(exc))
            continue

        if not run:
            continue

        reaped += 1
        await _publish_run_termination(agent_run_id)
        await _cleanup_run_keys(agent_run_id)

    if reaped:
        logger.warning("Reaper: marked stale agent runs as failed", count=reaped, threshold_seconds=stale_after_seconds)

    return reaped


async def run_agent_reaper(db) -> None:
    if not config.AGENT_RUN_REAPER_ENABLED:
        logger.debug("Reaper disabled via config")
        return

    interval_seconds = _coerce_int(config.AGENT_RUN_REAPER_INTERVAL_SEC, 60)
    interval_seconds = max(5, interval_seconds)

    while True:
        try:
            await reap_stale_agent_runs(db)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Reaper loop failed", error=str(exc), exc_info=True)

        try:
            await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            raise
