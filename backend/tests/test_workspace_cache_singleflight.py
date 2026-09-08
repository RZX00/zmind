from __future__ import annotations

import asyncio

import pytest

from core.workspace import service


@pytest.mark.asyncio
async def test_workspace_meta_cache_singleflight_dedupes_concurrent_builds(monkeypatch) -> None:
    build_calls = 0

    async def fake_cache_get(_key: str):
        return None

    async def fake_cache_set(_key: str, _value, ttl: int = 0):
        assert ttl == 600
        return True

    async def fake_build(_workspace_id: str):
        nonlocal build_calls
        build_calls += 1
        await asyncio.sleep(0.03)
        return {"version": 1, "generatedAt": 1}

    monkeypatch.setattr(service.cache_service, "get", fake_cache_get)
    monkeypatch.setattr(service.cache_service, "set", fake_cache_set)
    monkeypatch.setattr(service, "build_workspace_payload_meta", fake_build)

    service._CACHE_SINGLEFLIGHT.clear()
    try:
        result_a, result_b, result_c = await asyncio.gather(
            service.get_workspace_meta_cached("ws-1"),
            service.get_workspace_meta_cached("ws-1"),
            service.get_workspace_meta_cached("ws-1"),
        )
    finally:
        service._CACHE_SINGLEFLIGHT.clear()

    assert build_calls == 1
    assert result_a == {"version": 1, "generatedAt": 1}
    assert result_b == {"version": 1, "generatedAt": 1}
    assert result_c == {"version": 1, "generatedAt": 1}


@pytest.mark.asyncio
async def test_workspace_meta_cache_singleflight_propagates_errors(monkeypatch) -> None:
    async def fake_cache_get(_key: str):
        return None

    async def fake_cache_set(_key: str, _value, ttl: int = 0):
        return True

    async def fake_build(_workspace_id: str):
        await asyncio.sleep(0.01)
        raise RuntimeError("boom")

    monkeypatch.setattr(service.cache_service, "get", fake_cache_get)
    monkeypatch.setattr(service.cache_service, "set", fake_cache_set)
    monkeypatch.setattr(service, "build_workspace_payload_meta", fake_build)

    service._CACHE_SINGLEFLIGHT.clear()
    try:
        results = await asyncio.gather(
            service.get_workspace_meta_cached("ws-2"),
            service.get_workspace_meta_cached("ws-2"),
            return_exceptions=True,
        )
    finally:
        service._CACHE_SINGLEFLIGHT.clear()

    assert len(results) == 2
    assert all(isinstance(item, RuntimeError) for item in results)
