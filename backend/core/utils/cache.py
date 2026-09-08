import json
from typing import Any, Optional
from core.services.redis import get_client
from core.utils.logger import logger


class _cache:
    async def get(self, key: str) -> Optional[Any]:
        """Get a cached item or None if missing or Redis unavailable.

        This wrapper is intentionally resilient: if Redis is down or slow,
        it will log and return None instead of raising, so API routes degrade
        gracefully rather than 500.
        """
        try:
            redis = await get_client()
            key = f"cache:{key}"
            result = await redis.get(key)
            if result:
                return json.loads(result)
            return None
        except Exception as e:
            logger.warning(f"Cache.get fallback (no Redis): {e}")
            return None

    async def set(self, key: str, value: Any, ttl: int = 15 * 60) -> None:
        """Set a cached item; noop if Redis unavailable."""
        try:
            redis = await get_client()
            key = f"cache:{key}"
            await redis.set(key, json.dumps(value), ex=ttl)
        except Exception as e:
            logger.warning(f"Cache.set fallback (no Redis): {e}")

    async def invalidate(self, key: str) -> None:
        """Invalidate a cached item; noop if Redis unavailable."""
        try:
            redis = await get_client()
            key = f"cache:{key}"
            await redis.delete(key)
        except Exception as e:
            logger.warning(f"Cache.invalidate fallback (no Redis): {e}")


Cache = _cache()
