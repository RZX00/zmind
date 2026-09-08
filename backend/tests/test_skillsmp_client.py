from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, call, patch

import httpx
import pytest

from core.services.skillsmp_client import (
    MarketplaceSkillDetail,
    SkillSearchResponse,
    SkillsMPAPIError,
    SkillsMPAuthError,
    SkillsMPClient,
    SkillsMPNetworkError,
    SkillsMPRateLimitError,
)


@pytest.fixture
def client() -> SkillsMPClient:
    return SkillsMPClient(
        api_key="test-api-key",
        base_url="https://skillsmp.com/api/v1",
        max_retries=3,
        timeout=30.0,
    )


@pytest.fixture
def keyword_search_response() -> dict:
    return {
        "success": True,
        "data": {
            "skills": [
                {
                    "id": "skill-1",
                    "name": "Web Scraper",
                    "description": "Scrape websites",
                    "author": "author-1",
                    "githubUrl": "https://github.com/acme/web-scraper/tree/main",
                    "skillUrl": "https://skillsmp.com/skills/skill-1",
                    "stars": 120,
                    "updatedAt": 1735689600,
                },
                {
                    "id": "skill-2",
                    "name": "API Client",
                    "description": "Call external APIs",
                    "author": "author-2",
                    "githubUrl": "https://github.com/acme/api-client/tree/main",
                    "skillUrl": "https://skillsmp.com/skills/skill-2",
                    "stars": 66,
                    "updatedAt": 1735776000,
                },
            ],
            "pagination": {
                "total": 2,
                "page": 1,
                "limit": 20,
                "hasNext": False,
            },
        },
    }


@pytest.fixture
def ai_search_response() -> dict:
    return {
        "success": True,
        "data": {
            "object": "list",
            "search_query": "build api client",
            "has_more": True,
            "data": [
                {
                    "score": 0.91,
                    "skill": {
                        "id": "skill-2",
                        "name": "API Client",
                        "description": "Call external APIs",
                        "author": "author-2",
                        "githubUrl": "https://github.com/acme/api-client/tree/main",
                        "skillUrl": "https://skillsmp.com/skills/skill-2",
                        "stars": 66,
                        "updatedAt": 1735776000,
                    },
                }
            ],
        },
    }


class TestSkillsMPClientSearch:
    @pytest.mark.asyncio
    async def test_search_skills_success(self, client: SkillsMPClient, keyword_search_response: dict) -> None:
        with (
            patch("core.services.skillsmp_client.cache_service.get", new_callable=AsyncMock, return_value=None),
            patch("core.services.skillsmp_client.cache_service.set", new_callable=AsyncMock) as mock_cache_set,
            patch.object(client, "_make_request", new_callable=AsyncMock, return_value=keyword_search_response) as mock_request,
        ):
            result = await client.search_skills("web scraper", page=1, limit=20)

            mock_request.assert_awaited_once_with(
                "GET",
                "/skills/search",
                params={"q": "web scraper", "page": 1, "limit": 20},
            )
            assert isinstance(result, SkillSearchResponse)
            assert result.total == 2
            assert result.page == 1
            assert result.limit == 20
            assert result.has_more is False
            assert [skill.name for skill in result.skills] == ["Web Scraper", "API Client"]
            mock_cache_set.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_search_skills_browse_mode_uses_docs_compliant_seed_query(
        self, client: SkillsMPClient, keyword_search_response: dict
    ) -> None:
        with (
            patch("core.services.skillsmp_client.cache_service.get", new_callable=AsyncMock, return_value=None),
            patch("core.services.skillsmp_client.cache_service.set", new_callable=AsyncMock),
            patch.object(client, "_make_request", new_callable=AsyncMock, return_value=keyword_search_response) as mock_request,
        ):
            result = await client.search_skills("*", page=1, limit=9, sort_by="stars")

            mock_request.assert_awaited_once_with(
                "GET",
                "/skills/search",
                params={"q": "ai", "page": 1, "limit": 9, "sortBy": "stars"},
            )
            assert isinstance(result, SkillSearchResponse)
            assert result.total == 2

    @pytest.mark.asyncio
    async def test_search_skills_keyword_retries_without_sort_by_on_server_error(
        self, client: SkillsMPClient, keyword_search_response: dict
    ) -> None:
        with (
            patch("core.services.skillsmp_client.cache_service.get", new_callable=AsyncMock, return_value=None),
            patch("core.services.skillsmp_client.cache_service.set", new_callable=AsyncMock),
            patch.object(
                client,
                "_make_request",
                new_callable=AsyncMock,
                side_effect=[SkillsMPAPIError("Server error: 500"), keyword_search_response],
            ) as mock_request,
        ):
            result = await client.search_skills("ai", page=1, limit=9, sort_by="stars")

            assert isinstance(result, SkillSearchResponse)
            assert result.total == 2
            assert mock_request.await_count == 2
            mock_request.assert_has_awaits(
                [
                    call(
                        "GET",
                        "/skills/search",
                        params={"q": "ai", "page": 1, "limit": 9, "sortBy": "stars"},
                    ),
                    call(
                        "GET",
                        "/skills/search",
                        params={"q": "ai", "page": 1, "limit": 9},
                    ),
                ]
            )

    @pytest.mark.asyncio
    async def test_search_skills_browse_mode_retries_without_sort_by_on_server_error(
        self, client: SkillsMPClient, keyword_search_response: dict
    ) -> None:
        with (
            patch("core.services.skillsmp_client.cache_service.get", new_callable=AsyncMock, return_value=None),
            patch("core.services.skillsmp_client.cache_service.set", new_callable=AsyncMock),
            patch.object(
                client,
                "_make_request",
                new_callable=AsyncMock,
                side_effect=[SkillsMPAPIError("Server error: 500"), keyword_search_response],
            ) as mock_request,
        ):
            result = await client.search_skills("*", page=1, limit=9, sort_by="stars")

            assert isinstance(result, SkillSearchResponse)
            assert result.total == 2
            assert mock_request.await_count == 2
            mock_request.assert_has_awaits(
                [
                    call(
                        "GET",
                        "/skills/search",
                        params={"q": "ai", "page": 1, "limit": 9, "sortBy": "stars"},
                    ),
                    call(
                        "GET",
                        "/skills/search",
                        params={"q": "ai", "page": 1, "limit": 9},
                    ),
                ]
            )

    @pytest.mark.asyncio
    async def test_search_skills_browse_mode_retries_next_seed_after_failures(
        self, client: SkillsMPClient, keyword_search_response: dict
    ) -> None:
        with (
            patch("core.services.skillsmp_client.cache_service.get", new_callable=AsyncMock, return_value=None),
            patch("core.services.skillsmp_client.cache_service.set", new_callable=AsyncMock),
            patch.object(
                client,
                "_make_request",
                new_callable=AsyncMock,
                side_effect=[
                    SkillsMPAPIError("Server error: 500"),
                    SkillsMPAPIError("Server error: 500"),
                    keyword_search_response,
                ],
            ) as mock_request,
        ):
            result = await client.search_skills("*", page=1, limit=9, sort_by="stars")

            assert isinstance(result, SkillSearchResponse)
            assert result.total == 2
            assert mock_request.await_count == 3
            mock_request.assert_has_awaits(
                [
                    call(
                        "GET",
                        "/skills/search",
                        params={"q": "ai", "page": 1, "limit": 9, "sortBy": "stars"},
                    ),
                    call(
                        "GET",
                        "/skills/search",
                        params={"q": "ai", "page": 1, "limit": 9},
                    ),
                    call(
                        "GET",
                        "/skills/search",
                        params={"q": "automation", "page": 1, "limit": 9, "sortBy": "stars"},
                    ),
                ]
            )

    @pytest.mark.asyncio
    async def test_search_skills_cache_hit(self, client: SkillsMPClient) -> None:
        cached = {
            "skills": [
                {
                    "id": "cached-skill",
                    "name": "Cached Skill",
                    "description": "cached",
                    "author": "cached-author",
                    "githubUrl": "https://github.com/acme/cached/tree/main",
                    "skillUrl": "https://skillsmp.com/skills/cached-skill",
                    "stars": 10,
                    "updatedAt": 1735689600,
                }
            ],
            "total": 1,
            "page": 2,
            "limit": 5,
            "has_more": False,
        }

        with (
            patch("core.services.skillsmp_client.cache_service.get", new_callable=AsyncMock, return_value=cached),
            patch.object(client, "_make_request", new_callable=AsyncMock) as mock_request,
        ):
            result = await client.search_skills("cached", page=2, limit=5)

            assert result.total == 1
            assert result.page == 2
            assert result.limit == 5
            assert len(result.skills) == 1
            assert result.skills[0].id == "cached-skill"
            mock_request.assert_not_called()

    @pytest.mark.asyncio
    async def test_ai_semantic_search_success(self, client: SkillsMPClient, ai_search_response: dict) -> None:
        with (
            patch("core.services.skillsmp_client.cache_service.get", new_callable=AsyncMock, return_value=None),
            patch("core.services.skillsmp_client.cache_service.set", new_callable=AsyncMock),
            patch.object(client, "_make_request", new_callable=AsyncMock, return_value=ai_search_response) as mock_request,
        ):
            result = await client.ai_semantic_search("build api client", page=1, limit=20)

            mock_request.assert_awaited_once_with(
                "GET",
                "/skills/ai-search",
                params={"q": "build api client", "page": 1, "limit": 20},
            )
            assert isinstance(result, SkillSearchResponse)
            assert result.page == 1
            assert result.limit == 20
            assert result.has_more is True
            assert len(result.skills) == 1
            assert result.skills[0].id == "skill-2"
            assert result.total == 21


class TestSkillsMPClientDetails:
    @pytest.mark.asyncio
    async def test_get_skill_detail_from_search_success(self, client: SkillsMPClient) -> None:
        search_result = SkillSearchResponse(
            skills=[
                {
                    "id": "skill-xyz",
                    "name": "Skill XYZ",
                    "description": "desc",
                    "author": "author-xyz",
                    "githubUrl": "https://github.com/acme/xyz/tree/main/skills/xyz",
                    "skillUrl": "https://skillsmp.com/skills/skill-xyz",
                    "stars": 77,
                    "updatedAt": 1735689600,
                }
            ],
            total=1,
            page=1,
            limit=20,
            has_more=False,
        )

        mock_http_response = MagicMock()
        mock_http_response.raise_for_status = MagicMock()
        mock_http_response.text = "# SKILL XYZ\n\nDo XYZ."

        with (
            patch("core.services.skillsmp_client.cache_service.get", new_callable=AsyncMock, return_value=None),
            patch("core.services.skillsmp_client.cache_service.set", new_callable=AsyncMock) as mock_cache_set,
            patch.object(client, "search_skills", new_callable=AsyncMock, return_value=search_result),
            patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_http_response) as mock_get,
        ):
            detail = await client.get_skill_detail_from_search("skill-xyz")

            assert isinstance(detail, MarketplaceSkillDetail)
            assert detail.id == "skill-xyz"
            assert detail.name == "Skill XYZ"
            assert "Do XYZ" in detail.markdown_content
            mock_get.assert_awaited_once_with(
                "https://raw.githubusercontent.com/acme/xyz/main/skills/xyz/SKILL.md",
                timeout=30.0,
            )
            mock_cache_set.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_get_skill_detail_from_search_not_found(self, client: SkillsMPClient) -> None:
        search_result = SkillSearchResponse(
            skills=[],
            total=0,
            page=1,
            limit=20,
            has_more=False,
        )

        with patch.object(client, "search_skills", new_callable=AsyncMock, return_value=search_result):
            with pytest.raises(SkillsMPAPIError, match="Skill not found"):
                await client.get_skill_detail_from_search("missing-skill")

    @pytest.mark.asyncio
    async def test_get_skill_detail_from_search_missing_github_url(self, client: SkillsMPClient) -> None:
        search_result = SkillSearchResponse(
            skills=[
                {
                    "id": "skill-no-github",
                    "name": "No GitHub",
                    "description": "desc",
                    "author": "author",
                    "githubUrl": None,
                    "skillUrl": "https://skillsmp.com/skills/skill-no-github",
                    "stars": 1,
                    "updatedAt": 1735689600,
                }
            ],
            total=1,
            page=1,
            limit=20,
            has_more=False,
        )

        with patch.object(client, "search_skills", new_callable=AsyncMock, return_value=search_result):
            with pytest.raises(SkillsMPAPIError, match="has no GitHub URL"):
                await client.get_skill_detail_from_search("skill-no-github")

    @pytest.mark.asyncio
    async def test_get_skill_detail_from_github_cache_hit(self, client: SkillsMPClient) -> None:
        cached = {
            "id": "skill-cached",
            "name": "Cached",
            "description": "cached desc",
            "author": "cached-author",
            "githubUrl": "https://github.com/acme/cached/tree/main",
            "skillUrl": None,
            "stars": 9,
            "updatedAt": None,
            "markdown_content": "# Cached",
            "allowed_tools": [],
            "model": None,
            "context": None,
            "agent": None,
            "user_invocable": None,
            "license": None,
            "created_at": None,
            "updated_at": None,
            "version": None,
            "compatibility_status": None,
            "compatibility_reason": None,
        }
        with (
            patch("core.services.skillsmp_client.cache_service.get", new_callable=AsyncMock, return_value=cached),
            patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get,
        ):
            detail = await client.get_skill_detail_from_github(
                skill_id="skill-cached",
                github_url="https://github.com/acme/cached/tree/main",
            )

            assert detail.id == "skill-cached"
            assert detail.markdown_content == "# Cached"
            mock_get.assert_not_called()


class TestSkillsMPClientGithubUrl:
    @pytest.mark.parametrize(
        ("source", "expected"),
        [
            (
                "https://raw.githubusercontent.com/acme/repo/main/SKILL.md",
                "https://raw.githubusercontent.com/acme/repo/main/SKILL.md",
            ),
            (
                "https://github.com/acme/repo/blob/main/skills/demo/SKILL.md",
                "https://raw.githubusercontent.com/acme/repo/main/skills/demo/SKILL.md",
            ),
            (
                "https://github.com/acme/repo/raw/main/skills/demo/SKILL.md",
                "https://raw.githubusercontent.com/acme/repo/main/skills/demo/SKILL.md",
            ),
            (
                "https://github.com/acme/repo/tree/main/skills/demo",
                "https://raw.githubusercontent.com/acme/repo/main/skills/demo/SKILL.md",
            ),
            (
                "https://github.com/acme/repo/tree/main/skills/demo/SKILL.md",
                "https://raw.githubusercontent.com/acme/repo/main/skills/demo/SKILL.md",
            ),
            (
                "https://github.com/acme/repo/tree/main",
                "https://raw.githubusercontent.com/acme/repo/main/SKILL.md",
            ),
        ],
    )
    def test_resolve_github_raw_url(self, client: SkillsMPClient, source: str, expected: str) -> None:
        assert client._resolve_github_raw_url(source) == expected

    def test_resolve_github_raw_url_invalid(self, client: SkillsMPClient) -> None:
        with pytest.raises(ValueError, match="Invalid GitHub URL format"):
            client._resolve_github_raw_url("https://example.com/skill")


class TestSkillsMPClientRequestErrors:
    @pytest.mark.asyncio
    async def test_make_request_auth_error_401(self, client: SkillsMPClient) -> None:
        response = MagicMock(status_code=401, text="unauthorized")

        with patch("httpx.AsyncClient.request", new_callable=AsyncMock, return_value=response):
            with pytest.raises(SkillsMPAuthError, match="Invalid API key"):
                await client._make_request("GET", "/test")

    @pytest.mark.asyncio
    async def test_make_request_rate_limit_429_retries(self, client: SkillsMPClient) -> None:
        response = MagicMock(status_code=429, text="rate_limited")

        with (
            patch("httpx.AsyncClient.request", new_callable=AsyncMock, return_value=response) as mock_request,
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            with pytest.raises(SkillsMPRateLimitError, match="Rate limit exceeded"):
                await client._make_request("GET", "/test")

            assert mock_request.await_count == client.max_retries

    @pytest.mark.asyncio
    async def test_make_request_server_error_500_retries(self, client: SkillsMPClient) -> None:
        response = MagicMock(status_code=500, text="server_error")

        with (
            patch("httpx.AsyncClient.request", new_callable=AsyncMock, return_value=response) as mock_request,
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            with pytest.raises(SkillsMPAPIError, match="Server error: 500"):
                await client._make_request("GET", "/test")

            assert mock_request.await_count == client.max_retries

    @pytest.mark.asyncio
    async def test_make_request_network_error_retries(self, client: SkillsMPClient) -> None:
        with (
            patch("httpx.AsyncClient.request", new_callable=AsyncMock) as mock_request,
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            mock_request.side_effect = httpx.RequestError("Connection failed")
            with pytest.raises(SkillsMPNetworkError, match="Network error"):
                await client._make_request("GET", "/test")

            assert mock_request.await_count == client.max_retries

    @pytest.mark.asyncio
    async def test_make_request_succeeds_after_retries(self, client: SkillsMPClient) -> None:
        error_response = MagicMock(status_code=500, text="server_error")
        success_response = MagicMock(status_code=200)
        success_response.json.return_value = {"success": True}

        with (
            patch("httpx.AsyncClient.request", new_callable=AsyncMock) as mock_request,
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            mock_request.side_effect = [error_response, error_response, success_response]
            result = await client._make_request("GET", "/health")

            assert result == {"success": True}
            assert mock_request.await_count == 3
