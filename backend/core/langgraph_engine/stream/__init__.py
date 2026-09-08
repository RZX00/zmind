"""
WS-C (Stream Adapter) — EngineEvents -> legacy Redis/SSE protocol.

This package is intentionally small:
- `legacy_adapter.py`: pure translation from `EngineEvent` to legacy chunk dicts.
- `redis_writer.py`: async writer that appends to Redis list + notifies via pubsub.
"""

from .legacy_adapter import LegacyStreamAdapter
from .redis_writer import RedisStreamWriter
from .terminal import normalize_terminal_status

__all__ = ["LegacyStreamAdapter", "RedisStreamWriter", "normalize_terminal_status"]
