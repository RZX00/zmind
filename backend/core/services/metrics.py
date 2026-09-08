from __future__ import annotations

from typing import Any

from core.utils.logger import logger


def incr(name: str, value: int = 1, **tags: Any) -> None:
    """Lightweight metrics shim; replace with real metrics sink when available."""
    try:
        logger.debug("[metrics] incr", metric=name, value=value, tags=tags)
    except Exception:
        pass


def gauge(name: str, value: float, **tags: Any) -> None:
    try:
        logger.debug("[metrics] gauge", metric=name, value=value, tags=tags)
    except Exception:
        pass


def timing(name: str, ms: float, **tags: Any) -> None:
    try:
        logger.debug("[metrics] timing", metric=name, value=ms, tags=tags)
    except Exception:
        pass
