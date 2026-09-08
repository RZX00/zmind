from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from core.services import redis as redis_service
from core.utils.logger import logger

CANVAS_VERSION_KEY = "canvas:server-version:{canvas_id}"


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


async def ensure_canvas_server_version(canvas_id: str, version: Optional[int] = None) -> Optional[int]:
    if not canvas_id:
        return None
    base: Optional[int]
    if isinstance(version, (int, float)):
        base = int(version)
    else:
        base = None
    if base is None:
        base = _now_ms()
    try:
        client = await redis_service.get_client()
        await client.setnx(CANVAS_VERSION_KEY.format(canvas_id=canvas_id), str(base))
        return base
    except Exception as exc:
        logger.warning(f"Failed to ensure canvas serverVersion for {canvas_id}: {exc}")
        return base


async def bump_canvas_server_version(canvas_id: str, fallback: Optional[int] = None) -> int:
    if not canvas_id:
        return _now_ms()
    try:
        client = await redis_service.get_client()
        value = await client.incr(CANVAS_VERSION_KEY.format(canvas_id=canvas_id))
        return int(value)
    except Exception as exc:
        logger.warning(f"Failed to bump canvas serverVersion for {canvas_id}: {exc}")
        base = int(fallback) if isinstance(fallback, (int, float)) else _now_ms()
        try:
            client = await redis_service.get_client()
            await client.set(CANVAS_VERSION_KEY.format(canvas_id=canvas_id), str(base))
        except Exception as inner:
            logger.debug(f"Failed to set fallback serverVersion for {canvas_id}: {inner}")
        return base
