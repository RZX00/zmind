from __future__ import annotations

from typing import Any, Optional

import pytest

from core.canvas.write_service import CanvasWriteService


class _DummyResponse:
    def __init__(self, status_code: int, payload: Optional[dict[str, Any]] = None):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = ""

    def json(self) -> dict[str, Any]:
        return self._payload


class _CaptureClient:
    def __init__(self, *_args: Any, **_kwargs: Any):
        self.storage = _CaptureClient.storage

    storage: dict[str, Any] = {}
    response_payload: dict[str, Any] = {"ok": True}

    async def __aenter__(self):
        return self

    async def __aexit__(self, _exc_type, _exc, _tb):
        return False

    async def post(self, url: str, json: dict[str, Any], headers: dict[str, str]):
        self.storage["url"] = url
        self.storage["json"] = json
        self.storage["headers"] = headers
        return _DummyResponse(200, dict(self.response_payload))


@pytest.mark.asyncio
async def test_apply_canvas_ops_forwards_trace_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.canvas.write_service.httpx.AsyncClient", _CaptureClient)
    _CaptureClient.response_payload = {"ok": True}

    service = CanvasWriteService(realtime_url="http://realtime")
    monkeypatch.setattr(
        service,
        "_build_service_token",
        lambda workspace_id, user_id=None: "test-token",
    )

    result = await service.apply_canvas_ops(
        canvas_id="canvas-1",
        workspace_id="ws-1",
        operations=[{"op": "update_canvas", "patch": {"title": "x"}}],
        expected_version="12",
        user_id="user-1",
        idempotency_key="idem-1",
        client_request_id="req-1",
        client_session_id="session-1",
    )

    assert result == {"ok": True}
    assert _CaptureClient.storage["headers"]["Authorization"] == "Bearer test-token"
    assert _CaptureClient.storage["headers"]["If-Match"] == "12"
    assert _CaptureClient.storage["headers"]["Idempotency-Key"] == "idem-1"
    assert _CaptureClient.storage["headers"]["X-Client-Request-Id"] == "req-1"
    assert _CaptureClient.storage["headers"]["X-Client-Session-Id"] == "session-1"


@pytest.mark.asyncio
async def test_import_canvas_snapshot_forwards_trace_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.canvas.write_service.httpx.AsyncClient", _CaptureClient)
    _CaptureClient.response_payload = {"ok": True}

    service = CanvasWriteService(realtime_url="http://realtime")
    monkeypatch.setattr(
        service,
        "_build_service_token",
        lambda workspace_id, user_id=None: "test-token",
    )

    result = await service.import_canvas_snapshot(
        canvas_id="canvas-1",
        workspace_id="ws-1",
        doc={"id": "canvas-1", "nodes": [], "connections": []},
        expected_version="23",
        user_id="user-1",
        idempotency_key="idem-2",
        client_request_id="req-2",
        client_session_id="session-2",
    )

    assert result == {"ok": True}
    assert _CaptureClient.storage["headers"]["Authorization"] == "Bearer test-token"
    assert _CaptureClient.storage["headers"]["If-Match"] == "23"
    assert _CaptureClient.storage["headers"]["Idempotency-Key"] == "idem-2"
    assert _CaptureClient.storage["headers"]["X-Client-Request-Id"] == "req-2"
    assert _CaptureClient.storage["headers"]["X-Client-Session-Id"] == "session-2"


@pytest.mark.asyncio
async def test_apply_canvas_ops_normalizes_id_map_alias(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.canvas.write_service.httpx.AsyncClient", _CaptureClient)
    _CaptureClient.response_payload = {"idMap": {"$1": "node-1"}}

    service = CanvasWriteService(realtime_url="http://realtime")
    monkeypatch.setattr(
        service,
        "_build_service_token",
        lambda workspace_id, user_id=None: "test-token",
    )

    result = await service.apply_canvas_ops(
        canvas_id="canvas-1",
        workspace_id="ws-1",
        operations=[{"op": "add_node", "node": {"type": "text", "$id": "$1"}}],
    )

    assert result["id_map"] == {"$1": "node-1"}
    assert result["idMap"] == {"$1": "node-1"}
