import os
from typing import Optional

from core.utils.logger import logger

_warned = set()


def optional_env(key: str) -> Optional[str]:
    value = os.getenv(key)
    if (not value or not value.strip()) and key not in _warned:
        _warned.add(key)
        logger.warning("Optional environment variable missing", env_var=key)
    return value.strip() if value else None


def required_env(key: str) -> str:
    value = os.getenv(key)
    if not value or not value.strip():
        raise RuntimeError(f"Missing required environment variable: {key}")
    return value.strip()
