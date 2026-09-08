from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any

import pytest
from starlette.requests import Request

from core import agent_runs


class _FakeRedis:
    def __init__(self, payloads: list[dict[str, Any]]) -> None:
        self._payloads = payloads
        self.lrange_calls: list[tuple[str, int, int]] = []

    async def lrange(self, key: str, start: int, end: int) -> list[str]:
        self.lrange_calls.append((key, start, end))
        if start < 0:
            start = 0
        return [json.dumps(item) for item in self._payloads[start:]]


def _make_request(*, headers: dict[str, str] | None = None, query_string: str = "") -> Request:
    encoded_headers = []
    for key, value in (headers or {}).items():
        encoded_headers.append((key.lower().encode("utf-8"), value.encode("utf-8")))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/agent-run/run_1/stream",
        "raw_path": b"/agent-run/run_1/stream",
        "query_string": query_string.encode("utf-8"),
        "headers": encoded_headers,
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    }
    return Request(scope)


@pytest.mark.asyncio
async def test_stream_agent_run_resumes_from_last_event_id_header(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_auth(_request: Request, _token: str | None) -> str:
        return "user_1"

    async def _fake_run_lookup(_client: Any, _agent_run_id: str, _user_id: str) -> dict[str, Any]:
        return {"status": "completed", "thread_id": "thread_1"}

    loop = asyncio.get_running_loop()
    client_future = loop.create_future()
    client_future.set_result(object())
    monkeypatch.setattr(agent_runs.utils, "db", SimpleNamespace(client=client_future), raising=False)
    monkeypatch.setattr(agent_runs, "get_user_id_from_stream_auth", _fake_auth)
    monkeypatch.setattr(agent_runs, "get_agent_run_with_access_check", _fake_run_lookup)

    fake_redis = _FakeRedis(
        payloads=[
            {"type": "message", "content": "first"},
            {"type": "message", "content": "second"},
        ]
    )
    monkeypatch.setattr(agent_runs, "redis", fake_redis)

    request = _make_request(headers={"Last-Event-ID": "0"})
    response = await agent_runs.stream_agent_run("run_1", request=request)

    chunks: list[str] = []
    async for chunk in response.body_iterator:
        chunks.append(chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk)
    body = "".join(chunks)

    assert fake_redis.lrange_calls[0][1] == 1
    assert "id: 1\n" in body
    assert "id: 0\n" not in body
    assert '"status": "completed"' in body


@pytest.mark.asyncio
async def test_stream_agent_run_resumes_from_query_param_when_header_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_auth(_request: Request, _token: str | None) -> str:
        return "user_1"

    async def _fake_run_lookup(_client: Any, _agent_run_id: str, _user_id: str) -> dict[str, Any]:
        return {"status": "completed", "thread_id": "thread_1"}

    loop = asyncio.get_running_loop()
    client_future = loop.create_future()
    client_future.set_result(object())
    monkeypatch.setattr(agent_runs.utils, "db", SimpleNamespace(client=client_future), raising=False)
    monkeypatch.setattr(agent_runs, "get_user_id_from_stream_auth", _fake_auth)
    monkeypatch.setattr(agent_runs, "get_agent_run_with_access_check", _fake_run_lookup)

    fake_redis = _FakeRedis(
        payloads=[
            {"type": "message", "content": "first"},
            {"type": "message", "content": "second"},
            {"type": "message", "content": "third"},
        ]
    )
    monkeypatch.setattr(agent_runs, "redis", fake_redis)

    request = _make_request(query_string="lastEventId=1")
    response = await agent_runs.stream_agent_run("run_1", request=request)

    chunks: list[str] = []
    async for chunk in response.body_iterator:
        chunks.append(chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk)
    body = "".join(chunks)

    assert fake_redis.lrange_calls[0][1] == 2
    assert "id: 2\n" in body
    assert "id: 0\n" not in body
    assert "id: 1\n" not in body
