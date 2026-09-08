from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.interfaces.http.infographic import routes as infographic_routes


def _build_client() -> TestClient:
    app = FastAPI()
    app.include_router(infographic_routes.router)
    return TestClient(app)


async def _resolve_user_workspace(_request: Any, _token: Any) -> tuple[str, str]:
    return "u_test", "w_test"


def test_list_infographic_recipes_route_forwards_query(monkeypatch) -> None:
    calls: list[dict[str, Any]] = []

    class _Service:
        async def list_recipes(self, **kwargs: Any) -> Any:
            calls.append(kwargs)
            return [{"recipe_id": "r1", "name": "Recipe 1"}]

    monkeypatch.setattr(infographic_routes, "resolve_user_and_workspace", _resolve_user_workspace)
    monkeypatch.setattr(infographic_routes, "recipe_to_dict", lambda item: item)
    monkeypatch.setattr(infographic_routes, "infographic_service", _Service())

    client = _build_client()
    response = client.get("/infographic/recipes?token=t1&query=editorial")

    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["recipes"][0]["recipe_id"] == "r1"
    assert calls and calls[0]["workspace_id"] == "w_test"
    assert calls[0]["user_id"] == "u_test"
    assert calls[0]["query"] == "editorial"


def test_update_infographic_preferences_route_forwards_patch(monkeypatch) -> None:
    calls: list[dict[str, Any]] = []

    class _Service:
        async def update_preferences(self, **kwargs: Any) -> Any:
            calls.append(kwargs)
            return {"default_recipe_id": kwargs["patch"].get("default_recipe_id")}

        async def get_preferences_bundle(self, **_kwargs: Any) -> Any:
            return type("Bundle", (), {"user_preference": {"scope": "user"}, "workspace_preference": None})()

        async def resolve_generation_config(self, **_kwargs: Any) -> Any:
            return {"recipe_id": "sys.editorial_balanced"}

    monkeypatch.setattr(infographic_routes, "resolve_user_and_workspace", _resolve_user_workspace)
    monkeypatch.setattr(infographic_routes, "preference_to_dict", lambda item: item)
    monkeypatch.setattr(infographic_routes, "resolved_config_to_dict", lambda item: item)
    monkeypatch.setattr(infographic_routes, "infographic_service", _Service())

    client = _build_client()
    response = client.post(
        "/infographic/preferences/defaults?token=t2",
        json={
            "scope": "user",
            "default_recipe_id": "sys.editorial_balanced",
            "default_merge_mode": "append",
        },
    )

    assert response.status_code == 200
    assert calls and calls[0]["scope"] == "user"
    assert calls[0]["patch"]["default_recipe_id"] == "sys.editorial_balanced"


def test_update_workspace_preferences_requires_owner_check(monkeypatch) -> None:
    owner_calls: list[dict[str, Any]] = []
    update_calls: list[dict[str, Any]] = []

    async def _ensure_workspace_owner(*, workspace_id: str, user_id: str) -> None:
        owner_calls.append({"workspace_id": workspace_id, "user_id": user_id})

    class _Service:
        async def update_preferences(self, **kwargs: Any) -> Any:
            update_calls.append(kwargs)
            return {"default_style_lock": "soft"}

        async def get_preferences_bundle(self, **_kwargs: Any) -> Any:
            return type("Bundle", (), {"user_preference": None, "workspace_preference": {"scope": "workspace"}})()

        async def resolve_generation_config(self, **_kwargs: Any) -> Any:
            return {"recipe_id": "sys.editorial_balanced"}

    monkeypatch.setattr(infographic_routes, "resolve_user_and_workspace", _resolve_user_workspace)
    monkeypatch.setattr(infographic_routes, "_ensure_workspace_owner", _ensure_workspace_owner)
    monkeypatch.setattr(infographic_routes, "preference_to_dict", lambda item: item)
    monkeypatch.setattr(infographic_routes, "resolved_config_to_dict", lambda item: item)
    monkeypatch.setattr(infographic_routes, "infographic_service", _Service())

    client = _build_client()
    response = client.post(
        "/infographic/preferences/defaults",
        json={
            "scope": "workspace",
            "default_style_lock": "soft",
        },
    )

    assert response.status_code == 200
    assert owner_calls == [{"workspace_id": "w_test", "user_id": "u_test"}]
    assert update_calls and update_calls[0]["scope"] == "workspace"
