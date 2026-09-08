from __future__ import annotations

from core.api import router as core_router


def _count_http_routes(path: str, method: str) -> int:
    return len(
        [
            route
            for route in core_router.routes
            if getattr(route, "path", None) == path
            and method in (getattr(route, "methods", set()) or set())
        ]
    )


def _count_websocket_routes(path: str) -> int:
    return len(
        [
            route
            for route in core_router.routes
            if getattr(route, "path", None) == path and route.__class__.__name__ == "APIWebSocketRoute"
        ]
    )


def test_canvas_http_routes_registered_once() -> None:
    expected_once = [
        ("GET", "/canvases"),
        ("POST", "/canvases"),
        ("GET", "/canvases/meta"),
        ("GET", "/canvases/trash"),
        ("GET", "/canvases/{canvas_id}"),
        ("HEAD", "/canvases/{canvas_id}"),
        ("PUT", "/canvases/{canvas_id}"),
        ("DELETE", "/canvases/{canvas_id}"),
        ("GET", "/canvases/{canvas_id}/snapshot"),
        ("POST", "/canvases/{canvas_id}/apply"),
        ("POST", "/canvases/{canvas_id}/versions"),
        ("GET", "/canvases/{canvas_id}/versions"),
        ("POST", "/canvases/versions/{version_id}/restore"),
        ("DELETE", "/canvases/versions/{version_id}"),
        ("POST", "/canvases/{canvas_id}/restore"),
        ("POST", "/canvases/purge"),
        ("DELETE", "/canvases/{canvas_id}/purge"),
        ("POST", "/canvases/restore-batch"),
        ("POST", "/canvases/purge-by-ids"),
        ("POST", "/canvases/{canvas_id}/ensure-thread"),
        ("GET", "/canvases/{canvas_id}/thread"),
        ("POST", "/canvases/{canvas_id}/invites"),
        ("GET", "/canvases/{canvas_id}/invites"),
        ("POST", "/canvases/{canvas_id}/invites/{invite_id}/revoke"),
        ("POST", "/canvases/{canvas_id}/invite/verify"),
        ("GET", "/canvases/share/health"),
        ("GET", "/canvases/{canvas_id}/share"),
        ("POST", "/canvases/{canvas_id}/share"),
        ("GET", "/public/canvases/{canvas_id}/snapshot"),
        ("GET", "/public/canvases/{canvas_id}/versions"),
        ("GET", "/public/canvases/{canvas_id}/timeline"),
        ("POST", "/canvases/{canvas_id}/selection-chat/stream"),
        ("POST", "/canvases/{canvas_id}/selection-infographic/generate"),
        ("POST", "/canvases/{canvas_id}/generate-title"),
        ("POST", "/canvases/{canvas_id}/media/external-metadata"),
        ("POST", "/canvases/{canvas_id}/media/generate"),
    ]
    for method, path in expected_once:
        assert _count_http_routes(path, method) == 1, f"Expected 1 route for {method} {path}"


def test_canvas_websocket_route_registered_once() -> None:
    assert _count_websocket_routes("/canvas/ws/{canvas_id}") == 1
