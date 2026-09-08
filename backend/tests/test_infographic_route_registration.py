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


def test_infographic_http_routes_registered_once() -> None:
    expected_once = [
        ("GET", "/infographic/recipes"),
        ("GET", "/infographic/recipes/{recipe_id}"),
        ("GET", "/infographic/market/listings"),
        ("GET", "/infographic/preferences/defaults"),
        ("POST", "/infographic/preferences/defaults"),
    ]

    for method, path in expected_once:
        assert _count_http_routes(path, method) == 1, f"Expected 1 route for {method} {path}"
