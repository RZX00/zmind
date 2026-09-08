from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from core.billing import api as billing_api


async def _allow_owner_account() -> str:
    return "team-account"


async def _allow_member_account() -> str:
    return "team-account"


async def _reject_member_owner_gate() -> None:
    raise HTTPException(status_code=403, detail="Only workspace owners can manage team billing")


def _build_client(*, owner_dependency=None, member_dependency=None) -> TestClient:
    app = FastAPI()
    app.include_router(billing_api.router)
    if owner_dependency is not None:
        app.dependency_overrides[billing_api._get_workspace_owner_account_id] = owner_dependency
    if member_dependency is not None:
        app.dependency_overrides[billing_api._get_workspace_account_id] = member_dependency
    return TestClient(app)


@pytest.mark.parametrize(
    ("method", "path", "kwargs"),
    [
        (
            "PUT",
            "/billing/provider-policy",
            {"json": {"enabled_providers": ["openai"], "default_provider": "openai"}},
        ),
    ],
)
def test_billing_mutations_require_workspace_owner(method: str, path: str, kwargs: dict) -> None:
    client = _build_client(owner_dependency=_reject_member_owner_gate)

    response = client.request(method, path, **kwargs)

    assert response.status_code == 403
    assert response.json() == {"detail": "Only workspace owners can manage team billing"}


def test_workspace_owner_can_update_provider_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    deleted_keys: list[str] = []

    async def _resolve_user_and_workspace(_request) -> tuple[str, str]:
        return "owner-user", "team-account"

    async def _update_policy(*, account_id: str, patch: dict, updated_by: str) -> dict:
        assert account_id == "team-account"
        assert updated_by == "owner-user"
        return {"updated": True, "patch": patch}

    class _CacheService:
        async def delete(self, key: str) -> None:
            deleted_keys.append(key)

    monkeypatch.setattr(billing_api, "resolve_user_and_workspace", _resolve_user_and_workspace)
    monkeypatch.setattr(billing_api.provider_policy_service, "update_policy", _update_policy)
    monkeypatch.setattr(billing_api, "CacheService", _CacheService)

    client = _build_client(owner_dependency=_allow_owner_account)
    response = client.put(
        "/billing/provider-policy",
        json={"enabled_providers": ["openai"], "default_provider": "openai"},
    )

    assert response.status_code == 200
    assert response.json()["updated"] is True
    assert response.json()["account_id"] == "team-account"
    assert deleted_keys == [f"available_models:team-account:{getattr(billing_api.config.ENV_MODE, 'value', str(billing_api.config.ENV_MODE))}"]
