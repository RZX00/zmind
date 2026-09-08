from __future__ import annotations

import asyncio
import json
from collections.abc import Iterable

from core.langgraph_engine.contracts.legacy_stream_contract import (
    LEGACY_REDIS_RESPONSE_CHANNEL_TEMPLATE,
    LEGACY_REDIS_RESPONSE_LIST_KEY_TEMPLATE,
    LegacyStreamChunk,
)
from core.services import redis


class RedisStreamWriter:
    """
    Append legacy chunks into Redis list + notify subscribers via pubsub.

    Keys/channels MUST remain compatible with:
    - writer: `backend/run_agent_background.py`
    - reader: `backend/core/agent_runs.py`
    """

    def __init__(self, agent_run_id: str):
        self.agent_run_id = agent_run_id
        self.response_list_key = LEGACY_REDIS_RESPONSE_LIST_KEY_TEMPLATE.format(agent_run_id=agent_run_id)
        self.response_channel = LEGACY_REDIS_RESPONSE_CHANNEL_TEMPLATE.format(agent_run_id=agent_run_id)
        self._lock = asyncio.Lock()

    async def write_chunk(self, chunk: LegacyStreamChunk) -> None:
        payload = json.dumps(chunk)
        async with self._lock:
            client = await redis.get_client()
            pipe = client.pipeline(transaction=False)
            pipe.rpush(self.response_list_key, payload)
            pipe.publish(self.response_channel, "new")
            await pipe.execute()

    async def write_chunks(self, chunks: Iterable[LegacyStreamChunk]) -> int:
        payloads = [json.dumps(c) for c in chunks]
        if not payloads:
            return 0
        async with self._lock:
            client = await redis.get_client()
            pipe = client.pipeline(transaction=False)
            pipe.rpush(self.response_list_key, *payloads)
            pipe.publish(self.response_channel, "new")
            await pipe.execute()
        return len(payloads)

