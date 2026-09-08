from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Response
from fastapi.testclient import TestClient

from core.interfaces.http.canvas import ai_routes, command_routes, query_routes, share_routes


def _build_client(router) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_command_apply_route_propagates_conflict_detail(monkeypatch) -> None:
    calls: list[dict[str, Any]] = []

    class _CommandService:
        async def apply_canvas_operations(self, **kwargs: Any) -> Any:
            calls.append(kwargs)
            raise HTTPException(
                status_code=409,
                detail={"code": "version_conflict", "server_version": 12},
            )

    monkeypatch.setattr(command_routes, "command_service", _CommandService())
    client = _build_client(command_routes.router)

    response = client.post(
        "/canvases/canvas-1/apply?token=t1",
        headers={"If-Match": 'W/"sv:11"'},
        json={"operations": [{"type": "addNode", "node": {"id": "n1"}}]},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "version_conflict"
    assert calls and calls[0]["canvas_id"] == "canvas-1"
    assert calls[0]["token"] == "t1"
    assert calls[0]["expected_version"] == 'W/"sv:11"'


def test_query_head_route_returns_etag_and_304(monkeypatch) -> None:
    calls: list[dict[str, Any]] = []

    class _QueryService:
        async def head_canvas(self, **kwargs: Any) -> Any:
            calls.append(kwargs)
            return Response(status_code=304, headers={"ETag": 'W/"canvas:c1:1.0.0:1"'})

    monkeypatch.setattr(query_routes, "query_service", _QueryService())
    client = _build_client(query_routes.router)

    response = client.head(
        "/canvases/c1?token=t2",
        headers={"If-None-Match": 'W/"canvas:c1:1.0.0:1"'},
    )

    assert response.status_code == 304
    assert response.headers.get("etag") == 'W/"canvas:c1:1.0.0:1"'
    assert calls and calls[0]["canvas_id"] == "c1"
    assert calls[0]["token"] == "t2"


def test_query_trash_route_accepts_node_count_sort(monkeypatch) -> None:
    calls: list[dict[str, Any]] = []

    class _QueryService:
        async def list_deleted_canvases_with_meta(self, **kwargs: Any) -> Any:
            calls.append(kwargs)
            return {"items": [], "retention_days": 15, "total_count": 0}

    monkeypatch.setattr(query_routes, "query_service", _QueryService())
    client = _build_client(query_routes.router)

    response = client.get("/canvases/trash?sort_by=node_count&sort_dir=asc")

    assert response.status_code == 200
    assert response.json()["total_count"] == 0
    assert calls and calls[0]["sort_by"] == "node_count"
    assert calls[0]["sort_dir"] == "asc"


def test_share_health_route_forwards_token(monkeypatch) -> None:
    calls: list[dict[str, Any]] = []

    class _ShareService:
        async def get_canvas_share_health(self, **kwargs: Any) -> Any:
            calls.append(kwargs)
            return {"status": "ok"}

    monkeypatch.setattr(share_routes, "share_service", _ShareService())
    client = _build_client(share_routes.router)

    response = client.get("/canvases/share/health?token=t3")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert calls and calls[0]["token"] == "t3"


def test_ai_generate_title_route_forwards_payload(monkeypatch) -> None:
    calls: list[dict[str, Any]] = []

    class _AIService:
        async def generate_canvas_title(self, **kwargs: Any) -> Any:
            calls.append(kwargs)
            return {"title": "Auto Title"}

    monkeypatch.setattr(ai_routes, "ai_service", _AIService())
    client = _build_client(ai_routes.router)

    response = client.post(
        "/canvases/c2/generate-title?token=t4",
        json={"prompt": "name this canvas"},
    )

    assert response.status_code == 200
    assert response.json() == {"title": "Auto Title"}
    assert calls and calls[0]["canvas_id"] == "c2"
    assert calls[0]["token"] == "t4"
    assert calls[0]["payload"] == {"prompt": "name this canvas"}
