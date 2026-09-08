"""
SkillsMP.com API Client

Provides integration with SkillsMP marketplace API for browsing and installing skills.
Supports keyword search, AI semantic search, and skill details retrieval.
"""

from __future__ import annotations

import os
import json
import asyncio
from typing import Optional, Dict, Any, List
from enum import Enum

import httpx
from pydantic import BaseModel, Field

from core.utils.logger import logger
from core.services.cache_service import cache_service


class SkillsMPError(Exception):
    """Base exception for SkillsMP API errors."""
    pass


class SkillsMPAuthError(SkillsMPError):
    """Authentication error."""
    pass


class SkillsMPAPIError(SkillsMPError):
    """API error."""
    pass


class SkillsMPNetworkError(SkillsMPError):
    """Network error."""
    pass


class SkillsMPRateLimitError(SkillsMPError):
    """Rate limit exceeded."""
    pass


# ============================================================================
# Response Models
# ============================================================================

class MarketplaceSkill(BaseModel):
    """Skill from SkillsMP marketplace (search result)."""

    id: str = Field(..., description="Unique skill ID from SkillsMP")
    name: str = Field(..., description="Skill name")
    description: str = Field(..., description="Skill description")
    author: Optional[str] = None

    # SkillsMP API actual fields
    githubUrl: Optional[str] = Field(None, alias="githubUrl")
    skillUrl: Optional[str] = Field(None, alias="skillUrl")
    stars: Optional[int] = None
    updatedAt: Optional[int] = None  # Unix timestamp

    # Will be populated by compatibility check
    compatibility_status: Optional[str] = None
    compatibility_reason: Optional[str] = None

    class Config:
        populate_by_name = True


class MarketplaceSkillDetail(MarketplaceSkill):
    """Full skill details from SkillsMP (includes SKILL.md content)."""

    markdown_content: str = Field(..., description="Full SKILL.md content")
    allowed_tools: List[str] = Field(default_factory=list)
    model: Optional[str] = None
    context: Optional[str] = None
    agent: Optional[str] = None
    user_invocable: Optional[bool] = None
    license: Optional[str] = None

    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    version: Optional[str] = None


class SkillSearchResponse(BaseModel):
    """Response from skill search."""

    skills: List[MarketplaceSkill]
    total: int = Field(..., description="Total number of results")
    page: int = Field(..., description="Current page number")
    limit: int = Field(..., description="Results per page")
    has_more: bool = Field(..., description="Whether there are more results")


# ============================================================================
# SkillsMP API Client
# ============================================================================

class SkillsMPClient:
    """
    Client for SkillsMP.com API.

    Features:
    - Keyword search
    - AI semantic search
    - Skill details retrieval
    - Error handling and retries
    - Rate limiting protection
    - Redis caching for performance optimization

    Environment Variables:
    - SKILLSMP_API_KEY: API key for authentication
    - SKILLSMP_BASE_URL: Base URL (default: https://skillsmp.com/api/v1)
    - SKILLSMP_MAX_RETRIES: Max retry attempts (default: 3)
    - SKILLSMP_TIMEOUT: Request timeout in seconds (default: 30)
    """

    # Cache TTL configuration (in seconds)
    CACHE_TTL_SEARCH = 3600          # 1 hour for search results
    CACHE_TTL_SKILL_DETAIL = 86400   # 24 hours for skill details
    CACHE_TTL_COMPATIBILITY = 21600  # 6 hours for compatibility checks
    BROWSE_FALLBACK_QUERIES = ("ai", "automation", "productivity", "developer")

    @staticmethod
    def _is_server_error_exc(exc: Exception) -> bool:
        message = str(exc)
        if message.startswith("Server error:"):
            return True
        try:
            payload = json.loads(message)
        except Exception:
            return False
        status_code = payload.get("status_code")
        if isinstance(status_code, int) and status_code >= 500:
            return True
        return payload.get("kind") == "server_error"

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        max_retries: int = 3,
        timeout: float = 30.0
    ):
        """
        Initialize SkillsMP API client.

        Args:
            api_key: API key (defaults to SKILLSMP_API_KEY env var)
            base_url: Base URL (defaults to SKILLSMP_BASE_URL or default)
            max_retries: Maximum retry attempts
            timeout: Request timeout in seconds
        """
        self.api_key = api_key or os.getenv("SKILLSMP_API_KEY")
        self.base_url = base_url or os.getenv(
            "SKILLSMP_BASE_URL",
            "https://skillsmp.com/api/v1"
        )
        self.max_retries = max_retries
        self.timeout = timeout

        if not self.api_key:
            logger.warning(
                "SkillsMP API key not configured. "
                "Set SKILLSMP_API_KEY environment variable."
            )

        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "Zmind/1.0"
        }

    async def _make_request(
        self,
        method: str,
        endpoint: str,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Make HTTP request with retry logic and error handling.

        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint (e.g., "/skills/search")
            **kwargs: Additional arguments for httpx request

        Returns:
            Response JSON data

        Raises:
            SkillsMPAuthError: Authentication failed
            SkillsMPRateLimitError: Rate limit exceeded
            SkillsMPAPIError: API error
            SkillsMPNetworkError: Network error
        """
        url = f"{self.base_url}{endpoint}"

        for attempt in range(self.max_retries):
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.request(
                        method,
                        url,
                        headers=self.headers,
                        timeout=self.timeout,
                        **kwargs
                    )

                    # Handle different status codes
                    if response.status_code == 200 or response.status_code == 201:
                        logger.debug(
                            "SkillsMP API request successful",
                            method=method,
                            endpoint=endpoint,
                            status_code=response.status_code,
                            upstream_url=url,
                            upstream_params=kwargs.get("params"),
                        )
                        return response.json()

                    elif response.status_code == 401:
                        raise SkillsMPAuthError(
                            "Invalid API key. Please check SKILLSMP_API_KEY."
                        )

                    elif response.status_code == 429:
                        # Rate limit - exponential backoff
                        if attempt < self.max_retries - 1:
                            wait_time = 2 ** attempt
                            logger.warning(
                                "SkillsMP rate limit hit, retrying",
                                attempt=attempt + 1,
                                wait_time=wait_time,
                                endpoint=endpoint,
                                upstream_url=url,
                                upstream_params=kwargs.get("params"),
                            )
                            await asyncio.sleep(wait_time)
                            continue
                        raise SkillsMPRateLimitError(
                            "Rate limit exceeded. Please try again later."
                        )

                    elif response.status_code >= 500:
                        # Server error - retry
                        if attempt < self.max_retries - 1:
                            logger.warning(
                                "SkillsMP server error, retrying",
                                status_code=response.status_code,
                                attempt=attempt + 1,
                                endpoint=endpoint,
                                upstream_url=url,
                                upstream_params=kwargs.get("params"),
                            )
                            await asyncio.sleep(1)
                            continue
                        error_payload = None
                        error_preview = response.text[:400]
                        try:
                            error_payload = response.json()
                        except Exception:
                            pass
                        raise SkillsMPAPIError(
                            json.dumps(
                                {
                                    "kind": "server_error",
                                    "status_code": response.status_code,
                                    "endpoint": endpoint,
                                    "params": kwargs.get("params"),
                                    "error": error_payload or error_preview,
                                },
                                ensure_ascii=False,
                            )
                        )

                    else:
                        # Other errors
                        error_detail = response.text
                        raise SkillsMPAPIError(
                            f"API error ({response.status_code}): {error_detail}"
                        )

            except httpx.RequestError as e:
                if attempt < self.max_retries - 1:
                    logger.warning(
                        "SkillsMP network error, retrying",
                        error=str(e),
                        attempt=attempt + 1,
                        endpoint=endpoint,
                        upstream_url=url,
                        upstream_params=kwargs.get("params"),
                    )
                    await asyncio.sleep(1)
                    continue
                raise SkillsMPNetworkError(f"Network error: {e}")

        raise SkillsMPAPIError("Max retries exceeded")

    async def search_skills(
        self,
        query: str,
        page: int = 1,
        limit: int = 20,
        sort_by: Optional[str] = None,
    ) -> SkillSearchResponse:
        """
        Search skills using keyword search.

        Args:
            query: Search query (keywords)
            page: Page number (1-based)
            limit: Results per page (max 100)
            sort_by: Sort order - "stars" or "recent" (optional)

        Returns:
            SkillSearchResponse with skills list and pagination

        Example:
            >>> client = SkillsMPClient()
            >>> results = await client.search_skills("web scraper", page=1, sort_by="stars")
            >>> print(f"Found {results.total} skills")
        """
        normalized_query = self._normalize_search_query(query)

        # Generate cache key (include sort_by if present)
        cache_query = normalized_query or "__browse__"
        cache_key = f"skillsmp:search:{cache_query}:p{page}:l{limit}"
        if sort_by:
            cache_key += f":sort{sort_by}"

        # Try to get from cache
        cached_result = await cache_service.get(cache_key)
        if cached_result:
            logger.info(
                "SkillsMP search cache hit",
                query=query,
                page=page,
                limit=limit,
                sort_by=sort_by
            )
            return SkillSearchResponse(**cached_result)

        logger.info(
            "Searching SkillsMP",
            query=query,
            normalized_query=normalized_query or "<browse>",
            page=page,
            limit=limit,
            sort_by=sort_by
        )

        base_params = {
            "page": page,
            "limit": min(limit, 100),  # Max 100 per page
        }
        if normalized_query:
            primary_params = dict(base_params)
            primary_params["q"] = normalized_query
            if sort_by:
                primary_params["sortBy"] = sort_by

            request_plan = [primary_params]
            if sort_by:
                # Some SkillsMP deployments return 5xx when sortBy is present.
                # Retry the same query without sortBy before failing.
                request_plan.append(
                    {
                        **base_params,
                        "q": normalized_query,
                    }
                )
        else:
            # SkillsMP official docs require `q` and do not support wildcard `*`.
            # For browse mode, probe a small set of broad queries.
            request_plan = []
            for fallback_query in self.BROWSE_FALLBACK_QUERIES:
                params_with_q = {**base_params, "q": fallback_query}
                if sort_by:
                    params_with_q["sortBy"] = sort_by
                request_plan.append(params_with_q)

                if sort_by:
                    # Retry same browse query without sortBy.
                    request_plan.append({**base_params, "q": fallback_query})

        response = None
        last_error: Optional[Exception] = None
        for attempt_index, attempt_params in enumerate(request_plan, start=1):
            try:
                response = await self._make_request(
                    "GET",
                    "/skills/search",
                    params=attempt_params,
                )
                if attempt_index > 1:
                    logger.warning(
                        "SkillsMP search recovered via fallback params",
                        original_query=query,
                        normalized_query=normalized_query or "<browse>",
                        attempt_index=attempt_index,
                        fallback_q=attempt_params.get("q", "<omitted>"),
                    )
                break
            except SkillsMPAPIError as exc:
                last_error = exc
                is_server_error = self._is_server_error_exc(exc)
                should_try_fallback = (
                    attempt_index < len(request_plan)
                    and (
                        is_server_error
                        or not normalized_query
                        or "sortBy" in attempt_params
                    )
                )
                if should_try_fallback:
                    logger.warning(
                        "SkillsMP search attempt failed; trying fallback params",
                        attempt_index=attempt_index,
                        total_attempts=len(request_plan),
                        normalized_query=normalized_query or "<browse>",
                        fallback_q=attempt_params.get("q", "<omitted>"),
                        had_sort_by="sortBy" in attempt_params,
                        error=str(exc),
                    )
                    continue
                raise

        if response is None:
            if last_error:
                raise last_error
            raise SkillsMPAPIError("Marketplace search failed with empty response")

        # Parse response - SkillsMP returns {success, data: {skills, pagination}}
        if not response.get("success"):
            raise SkillsMPAPIError(f"API returned success=false: {response}")

        data = response.get("data", {})
        skills = [MarketplaceSkill(**skill) for skill in data.get("skills", [])]
        pagination = data.get("pagination", {})

        total = pagination.get("total", 0)
        result = SkillSearchResponse(
            skills=skills,
            total=total,
            page=pagination.get("page", page),
            limit=pagination.get("limit", limit),
            has_more=pagination.get("hasNext", False)
        )

        # Cache the result (use model_dump for Pydantic v2)
        await cache_service.set(cache_key, result.model_dump(), ttl=self.CACHE_TTL_SEARCH)

        logger.info(
            "SkillsMP search completed",
            query=query,
            normalized_query=normalized_query or "<browse>",
            results=len(skills),
            total=total
        )

        return result

    @staticmethod
    def _normalize_search_query(query: str) -> str:
        normalized = (query or "").strip()
        if normalized == "*":
            return ""
        return normalized

    async def ai_semantic_search(
        self,
        query: str,
        page: int = 1,
        limit: int = 20,
    ) -> SkillSearchResponse:
        """
        Search skills using AI semantic search.

        This uses AI to understand the intent of natural language queries.
        Note: AI semantic search does not support sortBy parameter.

        Args:
            query: Natural language query (e.g., "How to create a web scraper")
            page: Page number (1-based)
            limit: Results per page (max 100)

        Returns:
            SkillSearchResponse with skills list and pagination

        Example:
            >>> results = await client.ai_semantic_search(
            ...     "I need to scrape data from websites"
            ... )
        """
        # Generate cache key
        cache_key = f"skillsmp:ai-search:{query}:p{page}:l{limit}"

        # Try to get from cache
        cached_result = await cache_service.get(cache_key)
        if cached_result:
            logger.info(
                "SkillsMP AI semantic search cache hit",
                query=query,
                page=page,
                limit=limit
            )
            return SkillSearchResponse(**cached_result)

        logger.info(
            "AI semantic search on SkillsMP",
            query=query,
            page=page,
            limit=limit
        )

        params = {
            "q": query,
            "page": page,
            "limit": min(limit, 100)
        }

        response = await self._make_request(
            "GET",
            "/skills/ai-search",
            params=params
        )

        # Parse response - AI search returns different format:
        # {success, data: {object, search_query, data: [{skill, score, ...}], has_more}}
        if not response.get("success"):
            raise SkillsMPAPIError(f"API returned success=false: {response}")

        data = response.get("data", {})
        # AI search nests skills in data.data[].skill
        skill_results = data.get("data", [])
        skills = [MarketplaceSkill(**item["skill"]) for item in skill_results if "skill" in item]

        # AI search doesn't provide total count, estimate from results
        has_more = data.get("has_more", False)
        total = len(skills) if not has_more else (page * limit) + 1  # Estimate

        result = SkillSearchResponse(
            skills=skills,
            total=total,
            page=page,
            limit=limit,
            has_more=has_more
        )

        # Cache the result (use model_dump for Pydantic v2)
        await cache_service.set(cache_key, result.model_dump(), ttl=self.CACHE_TTL_SEARCH)

        return result

    def _resolve_github_raw_url(self, github_url: str) -> str:
        """
        Resolve a GitHub URL (tree/blob/raw) to a raw.githubusercontent URL.

        Supports:
        - https://github.com/{owner}/{repo}/blob/{branch}/{path}.md
        - https://github.com/{owner}/{repo}/tree/{branch}/{path}
        - https://github.com/{owner}/{repo}/raw/{branch}/{path}.md
        - https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}.md
        """
        url = (github_url or "").strip()
        if not url:
            raise ValueError("GitHub URL is empty")

        url = url.replace("http://", "https://", 1)
        if url.startswith("https://raw.githubusercontent.com/"):
            return url

        if not url.startswith("https://github.com/"):
            raise ValueError(f"Invalid GitHub URL format: {github_url}")

        path = url.replace("https://github.com/", "")

        if "/blob/" in path:
            owner_repo, rest = path.split("/blob/", 1)
            if "/" not in rest:
                raise ValueError(f"Invalid GitHub blob URL: {github_url}")
            branch, file_path = rest.split("/", 1)
            return f"https://raw.githubusercontent.com/{owner_repo}/{branch}/{file_path}"

        if "/raw/" in path:
            owner_repo, rest = path.split("/raw/", 1)
            if "/" not in rest:
                raise ValueError(f"Invalid GitHub raw URL: {github_url}")
            branch, file_path = rest.split("/", 1)
            return f"https://raw.githubusercontent.com/{owner_repo}/{branch}/{file_path}"

        if "/tree/" in path:
            owner_repo, rest = path.split("/tree/", 1)
            if "/" in rest:
                branch, subpath = rest.split("/", 1)
            else:
                branch, subpath = rest, ""

            if subpath:
                if subpath.endswith(".md"):
                    return f"https://raw.githubusercontent.com/{owner_repo}/{branch}/{subpath}"
                return f"https://raw.githubusercontent.com/{owner_repo}/{branch}/{subpath}/SKILL.md"

            return f"https://raw.githubusercontent.com/{owner_repo}/{branch}/SKILL.md"

        raise ValueError(f"Unsupported GitHub URL format: {github_url}")

    def _github_tree_to_raw(self, github_url: str) -> str:
        """Backward-compatible wrapper for resolving GitHub raw URLs."""
        return self._resolve_github_raw_url(github_url)

    async def get_skill_detail_from_search(self, skill_id: str) -> MarketplaceSkillDetail:
        """
        Get full skill details by searching and fetching from GitHub.

        Since SkillsMP API doesn't have a dedicated skill detail endpoint,
        we search for the skill and fetch its markdown from GitHub.

        Args:
            skill_id: Unique skill ID from SkillsMP

        Returns:
            MarketplaceSkillDetail with full skill information

        Raises:
            SkillsMPAPIError: If skill not found or GitHub fetch fails

        Example:
            >>> skill = await client.get_skill_detail_from_search("abc123")
            >>> print(skill.markdown_content)
        """
        # Generate cache key
        cache_key = f"skillsmp:skill:{skill_id}"

        # Try to get from cache
        cached_result = await cache_service.get(cache_key)
        if cached_result:
            logger.info(
                "SkillsMP skill details cache hit",
                skill_id=skill_id
            )
            return MarketplaceSkillDetail(**cached_result)

        logger.info("Fetching skill details from SkillsMP + GitHub", skill_id=skill_id)

        # Search for the specific skill (use ID as search term)
        search_result = await self.search_skills(query=skill_id, limit=50)

        # Find exact match by ID
        skill_data = None
        for skill in search_result.skills:
            if skill.id == skill_id:
                skill_data = skill
                break

        if not skill_data:
            raise SkillsMPAPIError(f"Skill not found: {skill_id}")

        # Fetch markdown from GitHub
        if not skill_data.githubUrl:
            raise SkillsMPAPIError(f"Skill {skill_id} has no GitHub URL")

        try:
            raw_url = self._resolve_github_raw_url(skill_data.githubUrl)
            async with httpx.AsyncClient() as client:
                response = await client.get(raw_url, timeout=self.timeout)
                response.raise_for_status()
                markdown_content = response.text

        except Exception as e:
            raise SkillsMPAPIError(f"Failed to fetch SKILL.md from GitHub: {e}")

        # Create detailed skill object
        skill_detail = MarketplaceSkillDetail(
            id=skill_data.id,
            name=skill_data.name,
            description=skill_data.description,
            author=skill_data.author,
            githubUrl=skill_data.githubUrl,
            skillUrl=skill_data.skillUrl,
            stars=skill_data.stars,
            updatedAt=skill_data.updatedAt,
            markdown_content=markdown_content,
            allowed_tools=[],  # Will be parsed from markdown
        )

        # Cache the result
        await cache_service.set(cache_key, skill_detail.model_dump(), ttl=self.CACHE_TTL_SKILL_DETAIL)

        logger.info(
            "Skill details retrieved",
            skill_id=skill_id,
            name=skill_detail.name
        )

        return skill_detail

    async def get_skill_detail_from_github(
        self,
        *,
        skill_id: str,
        github_url: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> MarketplaceSkillDetail:
        """
        Fetch skill details directly from a GitHub URL without SkillsMP search.
        """
        cache_key = f"skillsmp:skill:{skill_id}"
        cached_result = await cache_service.get(cache_key)
        if cached_result:
            logger.info("SkillsMP skill details cache hit", skill_id=skill_id)
            return MarketplaceSkillDetail(**cached_result)

        raw_url = self._resolve_github_raw_url(github_url)
        async with httpx.AsyncClient() as client:
            response = await client.get(raw_url, timeout=self.timeout)
            response.raise_for_status()
            markdown_content = response.text

        skill_detail = MarketplaceSkillDetail(
            id=skill_id,
            name=name or skill_id,
            description=description or "",
            author=None,
            githubUrl=github_url,
            skillUrl=None,
            stars=None,
            updatedAt=None,
            markdown_content=markdown_content,
            allowed_tools=[],
        )

        await cache_service.set(
            cache_key,
            skill_detail.model_dump(),
            ttl=self.CACHE_TTL_SKILL_DETAIL,
        )

        logger.info(
            "Skill details retrieved from GitHub",
            skill_id=skill_id,
            name=skill_detail.name,
        )

        return skill_detail

    async def check_health(self) -> bool:
        """
        Check if SkillsMP API is accessible.

        Returns:
            True if API is healthy, False otherwise
        """
        try:
            await self._make_request("GET", "/health")
            logger.info("SkillsMP API health check passed")
            return True
        except Exception as e:
            logger.warning("SkillsMP API health check failed", error=str(e))
            return False

    # ========================================================================
    # Cache Management Methods
    # ========================================================================

    async def invalidate_skill_cache(self, skill_id: str) -> bool:
        """
        Invalidate cached skill details for a specific skill.

        Args:
            skill_id: Skill ID to invalidate

        Returns:
            True if cache was invalidated, False otherwise
        """
        cache_key = f"skillsmp:skill:{skill_id}"
        try:
            await cache_service.delete(cache_key)
            logger.info(f"Invalidated cache for skill {skill_id}")
            return True
        except Exception as e:
            logger.warning(f"Failed to invalidate cache for skill {skill_id}: {e}")
            return False

    async def invalidate_search_cache(self, query: str) -> int:
        """
        Invalidate all cached search results for a query.

        This clears both keyword and AI semantic search caches for all pages.

        Args:
            query: Search query to invalidate

        Returns:
            Number of cache entries deleted
        """
        try:
            # Invalidate both keyword and AI semantic search caches
            keyword_pattern = f"skillsmp:search:{query}:*"
            ai_pattern = f"skillsmp:ai-search:{query}:*"

            deleted = 0
            deleted += await cache_service.delete_pattern(keyword_pattern)
            deleted += await cache_service.delete_pattern(ai_pattern)

            logger.info(f"Invalidated {deleted} search cache entries for query: {query}")
            return deleted
        except Exception as e:
            logger.warning(f"Failed to invalidate search cache for query {query}: {e}")
            return 0

    async def invalidate_all_cache(self) -> int:
        """
        Clear all SkillsMP-related caches.

        Use with caution - this will force fresh API calls for all subsequent requests.

        Returns:
            Number of cache entries deleted
        """
        try:
            deleted = await cache_service.delete_pattern("skillsmp:*")
            logger.info(f"Invalidated all SkillsMP cache ({deleted} entries)")
            return deleted
        except Exception as e:
            logger.warning(f"Failed to invalidate all SkillsMP cache: {e}")
            return 0


# ============================================================================
# Singleton Instance
# ============================================================================

_skillsmp_client: Optional[SkillsMPClient] = None


def get_skillsmp_client() -> SkillsMPClient:
    """
    Get singleton SkillsMP client instance.

    Returns:
        SkillsMPClient instance
    """
    global _skillsmp_client

    if _skillsmp_client is None:
        _skillsmp_client = SkillsMPClient()

    return _skillsmp_client
