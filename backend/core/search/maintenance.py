from __future__ import annotations

import asyncio
import time

from core.search.indexer import rebuild_canvas_search_index
from core.services import redis as redis_service
from core.services.supabase import DBConnection
from core.utils.logger import logger


LOCK_TTL_SEC = 60 * 30
COOLDOWN_LONG_SEC = 60 * 60 * 6
COOLDOWN_SHORT_SEC = 60 * 30
MAX_CANVASES_PER_RUN = 200
TIME_BUDGET_SEC = 120
MIN_MISSING_GAP = 5


async def maybe_schedule_search_index_backfill(account_id: str) -> None:
    if not account_id:
        return
    cooldown_key = f"search:index:backfill:cooldown:{account_id}"
    lock_key = f"search:index:backfill:lock:{account_id}"
    try:
        if await redis_service.get(cooldown_key):
            return
        acquired = await redis_service.set(lock_key, "1", ex=LOCK_TTL_SEC, nx=True)
        if not acquired:
            return
        asyncio.create_task(_run_backfill(account_id, lock_key, cooldown_key))
    except Exception as e:
        logger.warning(f"[search] backfill scheduling failed workspace={account_id}: {e}")


async def _run_backfill(account_id: str, lock_key: str, cooldown_key: str) -> None:
    start = time.monotonic()
    processed = 0
    missing_count = 0
    total_count = 0
    try:
        db = DBConnection()
        client = await db.client

        res = await client.table("canvases").select(
            "id,updated_at,search_indexed_at,is_deleted"
        ).eq("account_id", account_id).eq("is_deleted", False).order("updated_at", desc=True).execute()
        rows = res.data or []
        total_count = len(rows)
        missing_rows = [row for row in rows if not row.get("search_indexed_at")]
        missing_count = len(missing_rows)

        if total_count == 0 or missing_count == 0:
            await redis_service.set(cooldown_key, "1", ex=COOLDOWN_LONG_SEC)
            return
        if total_count > MIN_MISSING_GAP and missing_count < MIN_MISSING_GAP:
            await redis_service.set(cooldown_key, "1", ex=COOLDOWN_LONG_SEC)
            return

        for row in missing_rows[:MAX_CANVASES_PER_RUN]:
            if time.monotonic() - start > TIME_BUDGET_SEC:
                break
            canvas_id = row.get("id")
            if not canvas_id:
                continue
            await rebuild_canvas_search_index(str(canvas_id), account_id, client=client)
            processed += 1

        remaining = max(0, missing_count - processed)
        cooldown = COOLDOWN_SHORT_SEC if remaining > 0 else COOLDOWN_LONG_SEC
        await redis_service.set(cooldown_key, "1", ex=cooldown)
        logger.info(
            "[search] backfill finished workspace=%s total=%s missing=%s processed=%s remaining=%s",
            account_id,
            total_count,
            missing_count,
            processed,
            remaining,
        )
    except Exception as e:
        logger.warning(f"[search] backfill failed workspace={account_id}: {e}")
        try:
            await redis_service.set(cooldown_key, "1", ex=COOLDOWN_SHORT_SEC)
        except Exception:
            pass
    finally:
        try:
            await redis_service.delete(lock_key)
        except Exception:
            pass
