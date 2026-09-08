from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from core.skills.api_models import (
    MarketplaceInstallRequest,
    MarketplaceSearchResponse,
    MarketplaceSkill,
    MarketplaceSkillDetail,
)
from core.skills.marketplace_api import (
    SkillsMPAPIError,
    _marketplace_local_skill_id,
    get_marketplace_skill_detail,
    install_from_marketplace,
    search_marketplace,
)
from core.skills import marketplace_api as marketplace_api_module


def _request(path: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "headers": [],
            "query_string": b"",
        }
    )


class _FailingSearchClient:
    api_key = "test-api-key"

    async def search_skills(self, *args, **kwargs):
        raise SkillsMPAPIError("Server error: 500")

    async def ai_semantic_search(self, *args, **kwargs):
        raise SkillsMPAPIError("Server error: 500")


class _FakeImportService:
    def __init__(self, *args, **kwargs):
        pass

    async def close(self) -> None:
        return None


@pytest.fixture
def patch_marketplace_dependencies(monkeypatch):
    async def _fake_resolve_user_workspace(request: Request, token: str | None = None):
        return ("user-id", "workspace-id")

    monkeypatch.setattr(
        marketplace_api_module, "_resolve_user_workspace", _fake_resolve_user_workspace
    )
    monkeypatch.setattr(
        marketplace_api_module, "get_skillsmp_client", lambda: _FailingSearchClient()
    )
    monkeypatch.setattr(
        marketplace_api_module, "SkillsImportService", _FakeImportService
    )
    monkeypatch.setattr(
        marketplace_api_module, "get_compatibility_service", lambda: MagicMock()
    )


@pytest.mark.asyncio
async def test_search_marketplace_uses_cached_fallback_before_empty(
    monkeypatch, patch_marketplace_dependencies
) -> None:
    cached = MarketplaceSearchResponse(
        skills=[
            MarketplaceSkill(
                id="cached-skill",
                name="Cached Skill",
                description="cached fallback",
                author="Cache",
                source_url="https://example.com/cached",
                marketplace_url="https://skillsmp.com/skills/cached-skill",
                install_count=123,
                rating=None,
                tags=[],
                category="utility",
                compatibility_status="unknown",
                compatibility_reason="from cache",
                is_installed=False,
            )
        ],
        total=1,
        page=1,
        limit=9,
        has_more=False,
    )
    monkeypatch.setattr(
        marketplace_api_module,
        "_load_marketplace_fallback_snapshot",
        AsyncMock(return_value=cached),
    )

    response = await search_marketplace(
        _request("/api/skills/marketplace/search"),
        q="ai",
        page=1,
        limit=9,
        compatibility_filter=False,
        search_type="keyword",
        sort_by="stars",
    )

    assert response.total == 1
    assert len(response.skills) == 1
    assert response.skills[0].id == "cached-skill"


@pytest.mark.asyncio
async def test_search_marketplace_returns_empty_when_cache_miss(
    monkeypatch, patch_marketplace_dependencies
) -> None:
    monkeypatch.setattr(
        marketplace_api_module,
        "_load_marketplace_fallback_snapshot",
        AsyncMock(return_value=None),
    )

    response = await search_marketplace(
        _request("/api/skills/marketplace/search"),
        q="ai",
        page=1,
        limit=9,
        compatibility_filter=False,
        search_type="keyword",
        sort_by="stars",
    )

    assert response.total == 0
    assert len(response.skills) == 0


@pytest.mark.asyncio
async def test_get_marketplace_skill_detail_local_id_short_circuits_upstream(
    monkeypatch,
) -> None:
    async def _fake_resolve_user_workspace(request: Request, token: str | None = None):
        return ("user-id", "workspace-id")

    local_name = "Local Detail Skill"
    local_skill_id = _marketplace_local_skill_id(local_name)
    local_detail = MarketplaceSkillDetail(
        id=local_skill_id,
        name=local_name,
        description="local detail",
        markdown_content="# Local Skill",
        allowed_tools=[],
        author="Local",
        source_url=f"local://{local_name.replace(' ', '%20')}",
        marketplace_url=None,
        install_count=None,
        rating=None,
        tags=[],
        category="local",
        model=None,
        context=None,
        agent=None,
        user_invocable=True,
        argument_hint=None,
        license=None,
        created_at=None,
        updated_at=None,
        version=None,
        compatibility_status="compatible",
        compatibility_reason="local fallback",
        is_installed=True,
    )

    monkeypatch.setattr(
        marketplace_api_module, "_resolve_user_workspace", _fake_resolve_user_workspace
    )
    monkeypatch.setattr(
        marketplace_api_module,
        "_build_local_marketplace_skill_detail",
        AsyncMock(return_value=local_detail),
    )

    def _fail_if_called():
        raise AssertionError("get_skillsmp_client should not be called for local skill IDs")

    monkeypatch.setattr(marketplace_api_module, "get_skillsmp_client", _fail_if_called)

    response = await get_marketplace_skill_detail(
        _request(f"/api/skills/marketplace/{local_skill_id}"),
        skill_id=local_skill_id,
        source_url=None,
        name=None,
        description=None,
    )

    assert response.id == local_skill_id
    assert response.name == local_name


@pytest.mark.asyncio
async def test_install_from_marketplace_rejects_local_skill_id(monkeypatch) -> None:
    async def _fake_resolve_user_workspace(request: Request, token: str | None = None):
        return ("user-id", "workspace-id")

    monkeypatch.setattr(
        marketplace_api_module, "_resolve_user_workspace", _fake_resolve_user_workspace
    )

    with pytest.raises(HTTPException) as exc_info:
        await install_from_marketplace(
            _request("/api/skills/marketplace/local/install"),
            skill_id=_marketplace_local_skill_id("Already Local"),
            install_request=MarketplaceInstallRequest(force=False),
        )

    assert exc_info.value.status_code == 409
