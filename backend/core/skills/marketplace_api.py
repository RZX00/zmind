"""
Skills Marketplace API endpoints.

Phase 1: Import and manage external skills
- Import from GitHub, manual paste
- View installed skills
- Check compatibility
- Enable/disable skills
- Uninstall skills
"""

from __future__ import annotations

import json
from typing import Literal, Optional
from urllib.parse import quote, unquote

from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import JSONResponse

from core.services.skills_import import SkillsImportService, SkillImportError
from core.services.skills_compatibility import get_compatibility_service
from core.services.skillsmp_client import (
    get_skillsmp_client,
    SkillsMPAuthError,
    SkillsMPAPIError,
    SkillsMPNetworkError,
    SkillsMPRateLimitError,
)
from core.services.cache_service import cache_service
from core.services.supabase import DBConnection
from core.utils.auth_utils import resolve_user_and_workspace
from core.utils.logger import logger
from core.application.use_cases.marketplace.record_listing_event import RecordListingEventUseCase
from core.domains.marketplace import events as marketplace_events
from core import core_utils as utils
from core.skills.types import SkillDefinition
from core.skills.registry import load_all_skills

from .api_models import (
    SkillImportRequest,
    SkillImportResponse,
    InstalledSkillsResponse,
    InstalledSkill,
    CompatibilityResult,
    CompatibilityDetails,
    SkillToggleRequest,
    SkillToggleResponse,
    SkillDeleteResponse,
    SkillSourcesResponse,
    SkillSource,
    SkillsRegistryResponse,
    RegistrySkill,
    # Phase 2: Marketplace Integration
    MarketplaceSearchResponse,
    MarketplaceSkillDetail,
    MarketplaceInstallRequest,
    MarketplaceInstallResponse,
)


router = APIRouter(prefix="/skills", tags=["skills-marketplace"])
MARKETPLACE_FALLBACK_CACHE_TTL = 60 * 10
MARKETPLACE_LOCAL_SKILL_PREFIX = "local::"


async def _db():
    """Get database client."""
    return await utils.db.client


async def _resolve_user_workspace(
    request: Request, token: Optional[str] = None
) -> tuple[str, str]:
    """Resolve user and workspace from request."""
    return await resolve_user_and_workspace(request, token)


async def _safe_execute(query, *, context: str):
    """Execute a Supabase query with defensive error handling."""
    try:
        result = await query.execute()
    except Exception as exc:
        logger.warning("Skills query failed", context=context, error=str(exc))
        return None
    error = getattr(result, "error", None)
    if error:
        logger.warning("Skills query failed", context=context, error=str(error))
        return None
    return result


def _db_row_to_skill_model(row: dict) -> InstalledSkill:
    """Convert database row to InstalledSkill model.

    Note: The API model uses 'skill_id' but the database schema uses 'name'
    as the unique identifier per Claude Code Skills official standard.
    """
    enabled = row.get("user_invocable")
    if enabled is None:
        enabled = row.get("enabled", True)
    return InstalledSkill(
        id=row["id"],
        skill_id=row["name"],  # Use 'name' from DB for 'skill_id' in API model
        name=row["name"],
        description=row.get("description") or "",
        prompt=row.get("prompt") or "",
        allowed_tools=row.get("allowed_tools") or [],
        enabled=bool(enabled),
        source_url=row.get("source_url"),
        source_type=row.get("source_type"),
        compatibility_status=row.get("compatibility_status"),
        compatibility_reason=row.get("compatibility_reason"),
        installed_at=row.get("installed_at"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        model=row.get("model"),
        context=row.get("context"),
        agent=row.get("agent"),
        user_invocable=row.get("user_invocable", True),
        argument_hint=row.get("argument_hint"),
        license=row.get("license"),
    )

async def _get_installed_skill_row(
    db_client,
    *,
    account_id: str,
    skill_name: str,
    marketplace_id: Optional[str] = None,
) -> Optional[dict]:
    """Lookup installed skill by marketplace ID or skill name."""
    if marketplace_id:
        try:
            result = await (
                db_client.table("user_skills")
                .select("id, compatibility_status, compatibility_reason")
                .eq("account_id", account_id)
                .contains("marketplace_metadata", {"marketplace_id": marketplace_id})
                .execute()
            )
            if result.data:
                return result.data[0]
        except Exception as exc:
            logger.warning(
                "Marketplace metadata lookup failed",
                marketplace_id=marketplace_id,
                error=str(exc),
            )

    result = await (
        db_client.table("user_skills")
        .select("id, compatibility_status, compatibility_reason")
        .eq("account_id", account_id)
        .eq("name", skill_name)
        .execute()
    )
    if result.data:
        return result.data[0]
    return None


def _build_skill_definition_from_markdown(
    import_service: SkillsImportService,
    markdown_content: str,
    *,
    fallback_name: str,
    fallback_description: str,
    source_url: Optional[str],
    source_type: str,
) -> Optional[SkillDefinition]:
    """Build a SkillDefinition from markdown, with a safe fallback."""
    try:
        return import_service.parse_markdown_content(
            markdown_content,
            source_url=source_url,
            source_type=source_type,
        )
    except SkillImportError as exc:
        logger.warning(
            "Failed to parse skill markdown",
            skill_name=fallback_name,
            error=str(exc),
        )
    except Exception as exc:
        logger.warning(
            "Unexpected error parsing skill markdown",
            skill_name=fallback_name,
            error=str(exc),
        )

    try:
        return SkillDefinition.model_validate(
            {
                "name": fallback_name,
                "description": fallback_description or "Imported skill",
                "prompt": (markdown_content or "").strip(),
            }
        )
    except Exception as exc:
        logger.warning(
            "Failed to build fallback skill definition",
            skill_name=fallback_name,
            error=str(exc),
        )
        return None


def _is_upstream_server_error(exc: Exception) -> bool:
    message = str(exc)
    lowered = message.lower()
    if lowered.startswith("server error:") or "api error (5" in lowered:
        return True
    try:
        payload = json.loads(message)
    except Exception:
        return False
    status_code = payload.get("status_code")
    if isinstance(status_code, int) and status_code >= 500:
        return True
    return payload.get("kind") == "server_error"


def _marketplace_local_skill_id(skill_name: str) -> str:
    return f"{MARKETPLACE_LOCAL_SKILL_PREFIX}{quote((skill_name or '').strip(), safe='')}"


def _parse_local_skill_name(skill_id: str) -> Optional[str]:
    if not skill_id.startswith(MARKETPLACE_LOCAL_SKILL_PREFIX):
        return None
    encoded = skill_id[len(MARKETPLACE_LOCAL_SKILL_PREFIX) :].strip()
    if not encoded:
        return None
    return unquote(encoded)


def _normalize_marketplace_query(query: str) -> str:
    normalized = (query or "").strip().lower()
    return normalized or "__browse__"


def _marketplace_fallback_cache_keys(*, search_type: str, query: str) -> list[str]:
    normalized_query = _normalize_marketplace_query(query)
    keys = [
        f"skillsmp:fallback:search:{search_type}:{normalized_query}",
        f"skillsmp:fallback:search:{search_type}:__latest__",
    ]
    if search_type != "keyword":
        keys.append("skillsmp:fallback:search:keyword:__latest__")
    return keys


async def _cache_marketplace_fallback_snapshot(
    *,
    search_type: str,
    query: str,
    response: MarketplaceSearchResponse,
) -> None:
    payload = response.model_dump()
    keys = _marketplace_fallback_cache_keys(search_type=search_type, query=query)[:2]
    for cache_key in keys:
        await cache_service.set(cache_key, payload, ttl=MARKETPLACE_FALLBACK_CACHE_TTL)


async def _load_marketplace_fallback_snapshot(
    *,
    search_type: str,
    query: str,
    page: int,
    limit: int,
) -> Optional[MarketplaceSearchResponse]:
    keys = _marketplace_fallback_cache_keys(search_type=search_type, query=query)
    for cache_key in keys:
        cached = await cache_service.get(cache_key)
        if not cached:
            continue
        try:
            parsed = MarketplaceSearchResponse.model_validate(cached)
        except Exception as exc:
            logger.warning(
                "Invalid cached marketplace fallback payload",
                cache_key=cache_key,
                error=str(exc),
            )
            continue

        sliced_skills = parsed.skills[:limit]
        return MarketplaceSearchResponse(
            skills=sliced_skills,
            total=max(parsed.total, len(sliced_skills)),
            page=page,
            limit=limit,
            has_more=False,
        )

    return None


def _skill_matches_query(skill: SkillDefinition, query: str) -> bool:
    text = (query or "").strip().lower()
    if not text:
        return True
    return text in skill.name.lower() or text in (skill.description or "").lower()


def _local_skill_source_url(skill: SkillDefinition) -> str:
    metadata = dict(skill.metadata or {})
    source_url = (metadata.get("zmind_source_url") or "").strip()
    if source_url:
        return source_url
    return f"local://{quote(skill.name, safe='')}"


async def _build_local_catalog_marketplace_response(
    *,
    account_id: str,
    query: str,
    page: int,
    limit: int,
) -> MarketplaceSearchResponse:
    from .api_models import MarketplaceSkill as APIMarketplaceSkill

    all_skills = await load_all_skills(
        db=DBConnection(),
        account_id=account_id,
        include_disabled=False,
    )
    filtered = [skill for skill in all_skills if _skill_matches_query(skill, query)]
    if not filtered and (query or "").strip():
        filtered = all_skills

    source_rank = {"user": 0, "file": 1, "builtin": 2}
    filtered.sort(
        key=lambda skill: (
            source_rank.get((skill.source or "builtin"), 9),
            skill.name.lower(),
        )
    )

    start = (page - 1) * limit
    end = start + limit
    page_skills = filtered[start:end]

    mapped = [
        APIMarketplaceSkill(
            id=_marketplace_local_skill_id(skill.name),
            name=skill.name,
            description=skill.description or "Local skill",
            author="Local",
            source_url=_local_skill_source_url(skill),
            marketplace_url=None,
            install_count=None,
            rating=None,
            tags=[],
            category=skill.source or "local",
            compatibility_status="compatible",
            compatibility_reason="Served from local skills catalog fallback",
            is_installed=True,
        )
        for skill in page_skills
    ]

    return MarketplaceSearchResponse(
        skills=mapped,
        total=len(filtered),
        page=page,
        limit=limit,
        has_more=end < len(filtered),
    )


async def _build_local_marketplace_skill_detail(
    *,
    account_id: str,
    skill_name: str,
) -> Optional[MarketplaceSkillDetail]:
    from .api_models import MarketplaceSkillDetail as APIMarketplaceSkillDetail

    all_skills = await load_all_skills(
        db=DBConnection(),
        account_id=account_id,
        include_disabled=False,
    )

    selected = None
    skill_name_lower = (skill_name or "").strip().lower()
    for skill in all_skills:
        if skill.name == skill_name or skill.name.lower() == skill_name_lower:
            selected = skill
            break

    if not selected:
        return None

    return APIMarketplaceSkillDetail(
        id=_marketplace_local_skill_id(selected.name),
        name=selected.name,
        description=selected.description or "Local skill",
        markdown_content=(selected.prompt or "").strip(),
        allowed_tools=selected.allowed_tools,
        author="Local",
        source_url=_local_skill_source_url(selected),
        marketplace_url=None,
        install_count=None,
        rating=None,
        tags=[],
        category=selected.source or "local",
        model=selected.model,
        context=selected.context,
        agent=selected.agent,
        user_invocable=selected.user_invocable,
        argument_hint=selected.argument_hint,
        license=selected.license,
        created_at=None,
        updated_at=None,
        version=None,
        compatibility_status="compatible",
        compatibility_reason="Served from local skills catalog fallback",
        is_installed=True,
    )


def _resolve_local_detail_skill_name(
    *,
    skill_id: str,
    source_url: Optional[str],
    name: Optional[str],
) -> Optional[str]:
    local_from_id = _parse_local_skill_name(skill_id)
    if local_from_id:
        return local_from_id

    local_source = (source_url or "").strip()
    if local_source.startswith("local://"):
        return unquote(local_source[len("local://") :])

    return None

@router.post("/import", status_code=201, response_model=SkillImportResponse)
async def import_skill(
    request: Request,
    import_request: SkillImportRequest,
) -> SkillImportResponse:
    """
    Import a skill from GitHub or manual markdown paste.

    **GitHub Import:**
    - Provide GitHub blob URL (e.g., https://github.com/user/repo/blob/main/SKILL.md)
    - Downloads and parses SKILL.md automatically
    - Checks compatibility with Zmind platform

    **Manual Import:**
    - Paste full SKILL.md content
    - Parses frontmatter and validates
    - Checks compatibility

    **Returns:**
    - Imported skill details
    - Compatibility status and suggestions
    - Whether skill was created or updated
    """
    user_id, workspace_id = await _resolve_user_workspace(request)

    logger.info(
        "Importing skill",
        source_type=import_request.source_type,
        account_id=workspace_id,
    )

    try:
        # Create import service
        db = DBConnection()
        import_service = SkillsImportService(db)

        try:
            # Import based on source type
            if import_request.source_type == "github":
                result = await import_service.import_from_github(
                    github_url=str(import_request.github_url),
                    account_id=workspace_id,
                    force=import_request.force,
                )
            elif import_request.source_type == "manual":
                result = await import_service.import_from_markdown(
                    markdown_content=import_request.markdown_content,
                    account_id=workspace_id,
                    force=import_request.force,
                )
            else:
                raise HTTPException(
                    status_code=400, detail=f"Invalid source_type: {import_request.source_type}"
                )

            # Convert skill to response model
            skill = result["skill"]
            compatibility = result["compatibility"]
            created = result["created"]

            # Get compatibility suggestions
            compat_service = get_compatibility_service()
            suggestions = compat_service.get_compatibility_suggestions(skill)

            # Build response
            return SkillImportResponse(
                success=True,
                skill=InstalledSkill(
                    id="pending",  # Will be set by database
                    skill_id=skill.name,
                    name=skill.name,
                    description=skill.description,
                    prompt=skill.prompt,
                    allowed_tools=skill.allowed_tools,
                    enabled=True,
                    source_url=str(import_request.github_url)
                    if import_request.github_url
                    else None,
                    source_type=import_request.source_type,
                    compatibility_status=compatibility["status"],
                    compatibility_reason=compatibility["reason"],
                    model=skill.model,
                    context=skill.context,
                    agent=skill.agent,
                    user_invocable=skill.user_invocable,
                    argument_hint=skill.argument_hint,
                    license=skill.license,
                ),
                compatibility=CompatibilityResult(
                    status=compatibility["status"],
                    reason=compatibility["reason"],
                    details=CompatibilityDetails(**compatibility["details"]),
                    suggestions=suggestions,
                ),
                created=created,
                message=f"Skill '{skill.name}' imported successfully"
                + (
                    f" with {compatibility['status']} compatibility"
                    if compatibility["status"] != "compatible"
                    else ""
                ),
            )

        finally:
            await import_service.close()

    except SkillImportError as exc:
        logger.warning("Skill import failed", error=str(exc))
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error("Unexpected error during skill import", error=str(exc))
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/installed", response_model=InstalledSkillsResponse)
async def get_installed_skills(
    request: Request,
    source_type: Optional[Literal["github", "manual", "marketplace", "builtin", "user"]] = Query(
        default=None, description="Filter by source type"
    ),
    compatibility_status: Optional[
        Literal["compatible", "partial", "incompatible", "unknown"]
    ] = Query(default=None, description="Filter by compatibility status"),
    enabled_only: bool = Query(default=False, description="Only return enabled skills"),
) -> InstalledSkillsResponse:
    """
    Get list of installed skills for current user.

    **Filters:**
    - source_type: Filter by import source (github, manual, etc.)
    - compatibility_status: Filter by compatibility (compatible, partial, incompatible)
    - enabled_only: Only show enabled skills

    **Returns:**
    - List of installed skills with metadata
    - Statistics by source and compatibility
    """
    user_id, workspace_id = await _resolve_user_workspace(request)

    client = await _db()

    def build_query():
        query = (
            client.table("user_skills")
            .select("*")
            .eq("account_id", workspace_id)
        )
        if source_type:
            query = query.eq("source_type", source_type)
        if compatibility_status:
            query = query.eq("compatibility_status", compatibility_status)
        return query.order("installed_at", desc=True)

    result = None
    if enabled_only:
        result = await _safe_execute(
            build_query().eq("user_invocable", True),
            context="installed_skills:user_invocable",
        )
        if result is None:
            result = await _safe_execute(
                build_query().eq("enabled", True),
                context="installed_skills:enabled_fallback",
            )
        if result is None:
            result = await _safe_execute(
                build_query(),
                context="installed_skills:unfiltered_fallback",
            )
    else:
        result = await _safe_execute(build_query(), context="installed_skills:all")

    rows = (result.data if result else []) or []

    # Convert to models
    skills = [_db_row_to_skill_model(row) for row in rows]

    # Calculate statistics
    total = len(skills)

    by_source = {}
    by_compatibility = {}

    for skill in skills:
        # Count by source type
        src = skill.source_type or "user"
        by_source[src] = by_source.get(src, 0) + 1

        # Count by compatibility
        compat = skill.compatibility_status or "unknown"
        by_compatibility[compat] = by_compatibility.get(compat, 0) + 1

    logger.info(
        "Retrieved installed skills",
        account_id=workspace_id,
        total=total,
        filters={
            "source_type": source_type,
            "compatibility_status": compatibility_status,
            "enabled_only": enabled_only,
        },
    )

    return InstalledSkillsResponse(
        skills=skills,
        total=total,
        by_source=by_source,
        by_compatibility=by_compatibility,
    )


@router.get("/registry", response_model=SkillsRegistryResponse)
async def get_skill_registry(
    request: Request,
    source_type: Optional[Literal["github", "manual", "marketplace", "builtin", "user", "file"]] = Query(
        default=None, description="Filter by source type"
    ),
    compatibility_status: Optional[
        Literal["compatible", "partial", "incompatible", "unknown"]
    ] = Query(default=None, description="Filter by compatibility status"),
    enabled_only: bool = Query(default=False, description="Only return enabled skills"),
) -> SkillsRegistryResponse:
    """
    Get unified list of skills across builtin, file, and user sources.
    """
    user_id, workspace_id = await _resolve_user_workspace(request)

    db_client = await _db()

    def build_query():
        query = (
            db_client.table("user_skills")
            .select("*")
            .eq("account_id", workspace_id)
        )
        if source_type in {"github", "manual", "marketplace", "user"}:
            query = query.eq("source_type", source_type)
        if compatibility_status:
            query = query.eq("compatibility_status", compatibility_status)
        return query

    result = None
    if enabled_only:
        result = await _safe_execute(
            build_query().eq("user_invocable", True),
            context="skill_registry:user_invocable",
        )
        if result is None:
            result = await _safe_execute(
                build_query().eq("enabled", True),
                context="skill_registry:enabled_fallback",
            )
        if result is None:
            result = await _safe_execute(
                build_query(),
                context="skill_registry:unfiltered_fallback",
            )
    else:
        result = await _safe_execute(build_query(), context="skill_registry:all")

    rows = (result.data if result else []) or []
    user_by_name = {row.get("name"): row for row in rows if row.get("name")}

    skills = await load_all_skills(
        db=DBConnection(),
        account_id=workspace_id,
        include_disabled=not enabled_only,
    )

    items: list[RegistrySkill] = []
    for skill in skills:
        if skill.source == "user":
            row = user_by_name.get(skill.name)
            if row is None:
                # If filters were applied, skip rows not in the filtered set
                if source_type or compatibility_status or enabled_only:
                    continue
            source = (row or {}).get("source_type") or "user"
            if source_type and source != source_type:
                continue
            compat_status = (row or {}).get("compatibility_status") or "unknown"
            if compatibility_status and compat_status != compatibility_status:
                continue
            items.append(
                RegistrySkill(
                    id=str((row or {}).get("id") or f"user:{skill.name}"),
                    skill_id=skill.name,
                    name=skill.name,
                    description=skill.description,
                    allowed_tools=skill.allowed_tools or [],
                    enabled=bool((row or {}).get("user_invocable", (row or {}).get("enabled", True))),
                    source_type=source,
                    source_url=(row or {}).get("source_url"),
                    compatibility_status=compat_status,
                    compatibility_reason=(row or {}).get("compatibility_reason"),
                    installed_at=(row or {}).get("installed_at"),
                    created_at=(row or {}).get("created_at"),
                    updated_at=(row or {}).get("updated_at"),
                    model=skill.model,
                    context=skill.context,
                    agent=skill.agent,
                    user_invocable=skill.user_invocable,
                    argument_hint=skill.argument_hint,
                    license=skill.license,
                    location=skill.location,
                    editable=True,
                )
            )
            continue

        source = "builtin" if skill.source == "builtin" else "file"
        if source_type and source != source_type:
            continue
        default_compat = "compatible" if source == "builtin" else "unknown"
        if compatibility_status and compatibility_status != default_compat:
            continue

        items.append(
            RegistrySkill(
                id=f"{source}:{skill.name}",
                skill_id=skill.name,
                name=skill.name,
                description=skill.description,
                allowed_tools=skill.allowed_tools or [],
                enabled=True,
                source_type=source,
                source_url=None,
                compatibility_status=default_compat,
                compatibility_reason=None,
                installed_at=None,
                created_at=None,
                updated_at=None,
                model=skill.model,
                context=skill.context,
                agent=skill.agent,
                user_invocable=skill.user_invocable,
                argument_hint=skill.argument_hint,
                license=skill.license,
                location=skill.location,
                editable=False,
            )
        )

    by_source: dict[str, int] = {}
    by_compatibility: dict[str, int] = {}
    for item in items:
        by_source[item.source_type] = by_source.get(item.source_type, 0) + 1
        compat = item.compatibility_status or "unknown"
        by_compatibility[compat] = by_compatibility.get(compat, 0) + 1

    return SkillsRegistryResponse(
        skills=items,
        total=len(items),
        by_source=by_source,
        by_compatibility=by_compatibility,
    )


@router.get("/compatibility/{skill_name}", response_model=CompatibilityResult)
async def check_skill_compatibility(
    request: Request,
    skill_name: str,
) -> CompatibilityResult:
    """
    Check compatibility of an installed skill.

    **Parameters:**
    - skill_name: Skill identifier to check

    **Returns:**
    - Compatibility status (compatible, partial, incompatible)
    - Detailed explanation and suggestions
    - Alternative Zmind tools for incompatible tools
    """
    user_id, workspace_id = await _resolve_user_workspace(request)

    client = await _db()

    # Get skill from database
    result = await (
        client.table("user_skills")
        .select("*")
        .eq("account_id", workspace_id)
        .eq("name", skill_name)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")

    row = result.data[0]

    # Build minimal skill definition for compatibility check
    from core.skills.types import SkillDefinition

    skill = SkillDefinition(
        name=row["name"],
        description=row.get("description") or "",
        prompt=row.get("prompt") or "",
        allowed_tools=row.get("allowed_tools") or [],
    )

    # Check compatibility
    compat_service = get_compatibility_service()
    compatibility = compat_service.check_compatibility(skill)
    suggestions = compat_service.get_compatibility_suggestions(skill)

    logger.info(
        "Compatibility check completed",
        skill_name=skill_name,
        status=compatibility["status"],
    )

    return CompatibilityResult(
        status=compatibility["status"],
        reason=compatibility["reason"],
        details=CompatibilityDetails(**compatibility["details"]),
        suggestions=suggestions,
    )


@router.patch("/{skill_name}/toggle", response_model=SkillToggleResponse)
async def toggle_skill(
    request: Request,
    skill_name: str,
    toggle_request: SkillToggleRequest,
) -> SkillToggleResponse:
    """
    Enable or disable an installed skill.

    **Parameters:**
    - skill_name: Skill identifier to toggle
    - enabled: New enabled state (true/false)

    **Returns:**
    - Success status
    - New enabled state
    """
    user_id, workspace_id = await _resolve_user_workspace(request)

    client = await _db()

    # Update enabled state (user_invocable preferred, enabled fallback)
    result = await _safe_execute(
        client.table("user_skills")
        .update({"user_invocable": toggle_request.enabled})
        .eq("account_id", workspace_id)
        .eq("name", skill_name),
        context="toggle_skill:user_invocable",
    )
    if result is None:
        result = await _safe_execute(
            client.table("user_skills")
            .update({"enabled": toggle_request.enabled})
            .eq("account_id", workspace_id)
            .eq("name", skill_name),
            context="toggle_skill:enabled_fallback",
        )

    if not result or not result.data:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")

    # Best-effort sync for legacy 'enabled' column
    await _safe_execute(
        client.table("user_skills")
        .update({"enabled": toggle_request.enabled})
        .eq("account_id", workspace_id)
        .eq("name", skill_name),
        context="toggle_skill:enabled_sync",
    )

    logger.info(
        "Skill toggled",
        skill_name=skill_name,
        enabled=toggle_request.enabled,
        account_id=workspace_id,
    )

    return SkillToggleResponse(
        success=True,
        skill_id=skill_name,
        enabled=toggle_request.enabled,
        message=f"Skill '{skill_name}' {'enabled' if toggle_request.enabled else 'disabled'}",
    )


@router.delete("/{skill_name}", response_model=SkillDeleteResponse)
async def delete_skill(
    request: Request,
    skill_name: str,
) -> SkillDeleteResponse:
    """
    Delete (uninstall) a skill.

    **Parameters:**
    - skill_name: Skill identifier to delete

    **Returns:**
    - Success status
    - Deleted skill identifier

    **Note:** This permanently removes the skill. Use toggle to temporarily disable instead.
    """
    user_id, workspace_id = await _resolve_user_workspace(request)

    client = await _db()

    skill_row = (
        await client.table("user_skills")
        .select("name, source_type, source_url, marketplace_metadata")
        .eq("account_id", workspace_id)
        .eq("name", skill_name)
        .limit(1)
        .execute()
    )
    skill_record = skill_row.data[0] if skill_row.data else None

    # Delete skill
    result = await (
        client.table("user_skills")
        .delete()
        .eq("account_id", workspace_id)
        .eq("name", skill_name)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")

    if skill_record and skill_record.get("source_type") == "marketplace":
        metadata = skill_record.get("marketplace_metadata") or {}
        if not isinstance(metadata, dict):
            metadata = {}
        marketplace_id = metadata.get("marketplace_id") or skill_name
        use_case = RecordListingEventUseCase()
        await use_case.execute(
            listing_id=str(marketplace_id),
            event_type=marketplace_events.LISTING_DEPRECATED,
            tenant_id=workspace_id,
            actor_id=user_id,
            payload={
                "skill_name": skill_name,
                "source_url": skill_record.get("source_url"),
                "marketplace_id": marketplace_id,
            },
        )

    logger.info(
        "Skill deleted",
        skill_name=skill_name,
        account_id=workspace_id,
    )

    return SkillDeleteResponse(
        success=True,
        skill_id=skill_name,
        message=f"Skill '{skill_name}' deleted successfully",
    )


@router.get("/sources", response_model=SkillSourcesResponse)
async def get_skill_sources(
    request: Request,
) -> SkillSourcesResponse:
    """
    Get list of available skill sources.

    **Returns:**
    - List of skill sources (GitHub repositories, SkillsMP, etc.)
    - Estimated skill counts and compatibility rates
    """
    # Hardcoded list of curated sources for Phase 1
    # Phase 2 will add dynamic discovery
    sources = [
        SkillSource(
            type="marketplace",
            name="SkillsMP.com",
            description="Community Skills Marketplace with 63,000+ Claude Code skills",
            url="https://skillsmp.com",
            skill_count=63000,
            compatibility_rate=0.65,  # ~65% compatible based on analysis
        ),
        SkillSource(
            type="github",
            name="Anthropic Official Skills",
            description="Official Claude Code skills from Anthropic",
            url="https://github.com/anthropics/skills",
            skill_count=50,
            compatibility_rate=0.60,  # Many use CLI tools
        ),
        SkillSource(
            type="github",
            name="Community Skills Collections",
            description="Curated collections from the Claude Code community",
            url="https://github.com/topics/claude-code-skills",
            skill_count=500,
            compatibility_rate=0.70,  # Varies by repository
        ),
        SkillSource(
            type="builtin",
            name="Zmind Built-in Skills",
            description="Pre-installed skills optimized for Zmind",
            url=None,
            skill_count=10,
            compatibility_rate=1.0,  # All compatible
        ),
    ]

    logger.info("Retrieved skill sources", total=len(sources))

    return SkillSourcesResponse(
        sources=sources,
        total=len(sources),
    )


# ============================================================================
# Phase 2: Marketplace Integration Endpoints
# ============================================================================


@router.get("/marketplace/search", response_model=MarketplaceSearchResponse)
async def search_marketplace(
    request: Request,
    q: str = Query("*", description='Search query (use "*" to browse all skills)'),
    page: int = Query(1, description="Page number", ge=1),
    limit: int = Query(20, description="Results per page", ge=1, le=100),
    compatibility_filter: bool = Query(
        True, description="Filter by compatibility"
    ),
    search_type: str = Query("keyword", description="Search type: keyword or ai_semantic"),
    sort_by: Optional[str] = Query(None, description="Sort order: 'stars' or 'recent'"),
) -> MarketplaceSearchResponse:
    """
    Search SkillsMP marketplace for skills.

    **Features:**
    - Keyword search or AI semantic search
    - Browse all/popular skills with empty query
    - Compatibility filtering (Zmind-compatible only)
    - Pagination support
    - Caching for performance

    **Parameters:**
    - **q**: Search query (use "*" to browse all skills, default: "*")
    - **page**: Page number (default: 1)
    - **limit**: Results per page (default: 20, max: 100)
    - **compatibility_filter**: Only show compatible skills (default: true)
    - **search_type**: 'keyword' or 'ai_semantic' (default: keyword)
    - **sort_by**: Sort order - 'stars' or 'recent' (optional, only for keyword search)

    **Returns:**
    - List of marketplace skills with compatibility status
    - Pagination metadata
    """
    user, workspace = await _resolve_user_workspace(request)
    normalized_query = (q or "").strip()
    is_browse_query = normalized_query in {"", "*"}
    effective_query = "" if is_browse_query else normalized_query

    logger.info(
        "Marketplace search requested",
        query=q,
        normalized_query=effective_query or "<browse>",
        page=page,
        limit=limit,
        compatibility_filter=compatibility_filter,
        search_type=search_type,
        sort_by=sort_by,
        account_id=workspace
    )

    client = get_skillsmp_client()

    # Check if API is configured
    if not client.api_key:
        raise HTTPException(
            status_code=503,
            detail="SkillsMP integration not configured. Please set SKILLSMP_API_KEY."
        )

    import_service = SkillsImportService(DBConnection())
    compat_service = get_compatibility_service()

    try:
        # Perform search based on type
        if search_type == "ai_semantic":
            search_result = await client.ai_semantic_search(
                query=effective_query,
                page=page,
                limit=limit
            )
        else:
            search_result = await client.search_skills(
                query=effective_query,
                page=page,
                limit=limit,
                sort_by=sort_by
            )

        # Convert to our API models
        from .api_models import MarketplaceSkill as APIMarketplaceSkill

        db_client = None
        account_id = workspace
        try:
            db_client = await _db()
        except Exception as exc:
            logger.warning(
                "Marketplace search: database unavailable",
                error=str(exc),
            )

        skills = []
        for skill in search_result.skills:
            compatibility_status = None
            compatibility_reason = None

            installed_row = None
            is_installed = False
            if db_client:
                installed_row = await _get_installed_skill_row(
                    db_client,
                    account_id=account_id,
                    skill_name=skill.name,
                    marketplace_id=skill.id,
                )
                is_installed = bool(installed_row)
                if installed_row:
                    compatibility_status = installed_row.get("compatibility_status")
                    compatibility_reason = installed_row.get("compatibility_reason")

            if compatibility_filter and compatibility_status in (None, "unknown"):
                try:
                    if skill.githubUrl:
                        skill_detail = await client.get_skill_detail_from_github(
                            skill_id=skill.id,
                            github_url=skill.githubUrl,
                            name=skill.name,
                            description=skill.description,
                        )
                    else:
                        skill_detail = await client.get_skill_detail_from_search(skill.id)
                    skill_def = _build_skill_definition_from_markdown(
                        import_service,
                        skill_detail.markdown_content,
                        fallback_name=skill_detail.name or skill.name,
                        fallback_description=skill_detail.description or skill.description,
                        source_url=skill_detail.githubUrl,
                        source_type="marketplace",
                    )
                    if skill_def:
                        compatibility = compat_service.check_compatibility(skill_def)
                        compatibility_status = compatibility["status"]
                        compatibility_reason = compatibility["reason"]
                except Exception as exc:
                    logger.warning(
                        "Marketplace compatibility check failed",
                        skill_id=skill.id,
                        error=str(exc),
                    )

            if compatibility_filter and compatibility_status != "compatible":
                continue

            if not compatibility_status:
                compatibility_status = "unknown"
                compatibility_reason = (
                    compatibility_reason or "Compatibility will be checked on install"
                )

            # Convert to API model
            api_skill = APIMarketplaceSkill(
                id=skill.id,
                name=skill.name,
                description=skill.description,
                author=skill.author,
                source_url=skill.githubUrl,
                marketplace_url=skill.skillUrl or f"https://skillsmp.com/skills/{skill.id}",
                install_count=skill.stars,
                rating=None,
                tags=[],
                category=None,
                compatibility_status=compatibility_status,
                compatibility_reason=compatibility_reason,
                is_installed=is_installed
            )

            skills.append(api_skill)

        response = MarketplaceSearchResponse(
            skills=skills,
            total=search_result.total,
            page=page,
            limit=limit,
            has_more=search_result.has_more
        )
        try:
            await _cache_marketplace_fallback_snapshot(
                search_type=search_type,
                query=effective_query,
                response=response,
            )
        except Exception as exc:
            logger.warning(
                "Failed to cache marketplace fallback snapshot",
                error=str(exc),
                search_type=search_type,
                query=effective_query or "<browse>",
            )

        logger.info(
            "Marketplace search completed",
            query=q,
            results=len(skills),
            total=search_result.total
        )

        return response

    except SkillsMPAuthError as exc:
        logger.error("Marketplace auth failed", error=str(exc))
        raise HTTPException(
            status_code=503,
            detail="SkillsMP authentication failed. Please verify SKILLSMP_API_KEY."
        )
    except SkillsMPRateLimitError as exc:
        logger.error("Marketplace rate limit", error=str(exc))
        raise HTTPException(status_code=429, detail=str(exc))
    except SkillsMPNetworkError as exc:
        logger.error("Marketplace network error", error=str(exc))
        raise HTTPException(status_code=503, detail=str(exc))
    except SkillsMPAPIError as exc:
        # Degrade search to cached marketplace results first, then empty results.
        # Do not mix local installed skills into marketplace search results.
        logger.warning(
            "Marketplace search degraded due upstream API error",
            error=str(exc),
            is_upstream_server_error=_is_upstream_server_error(exc),
            query=q,
            normalized_query=effective_query or "<browse>",
            is_browse_query=is_browse_query,
            search_type=search_type,
            page=page,
            limit=limit,
        )
        cached_fallback = None
        try:
            cached_fallback = await _load_marketplace_fallback_snapshot(
                search_type=search_type,
                query=effective_query,
                page=page,
                limit=limit,
            )
        except Exception as cache_exc:
            logger.warning(
                "Marketplace cached fallback lookup failed",
                search_type=search_type,
                query=effective_query or "<browse>",
                error=str(cache_exc),
            )
        if cached_fallback:
            logger.warning(
                "Marketplace search serving cached fallback results",
                search_type=search_type,
                query=effective_query or "<browse>",
                results=len(cached_fallback.skills),
            )
            return cached_fallback

        logger.warning(
            "Marketplace search returning empty fallback results",
            search_type=search_type,
            query=effective_query or "<browse>",
        )
        return MarketplaceSearchResponse(
            skills=[],
            total=0,
            page=page,
            limit=limit,
            has_more=False,
        )
    except Exception as e:
        logger.error(
            "Marketplace search failed",
            query=q,
            error=str(e),
            error_type=type(e).__name__
        )
        raise HTTPException(
            status_code=500,
            detail=f"Marketplace search failed: {str(e)}"
        )
    finally:
        await import_service.close()


@router.get("/marketplace/{skill_id}", response_model=MarketplaceSkillDetail)
async def get_marketplace_skill_detail(
    request: Request,
    skill_id: str,
    source_url: Optional[str] = Query(
        default=None, description="GitHub URL for the skill"
    ),
    name: Optional[str] = Query(default=None, description="Skill name"),
    description: Optional[str] = Query(default=None, description="Skill description"),
) -> MarketplaceSkillDetail:
    """
    Get detailed information about a marketplace skill.

    **Parameters:**
    - **skill_id**: SkillsMP skill ID

    **Returns:**
    - Full skill details including SKILL.md content
    - Compatibility information
    - Install status
    """
    user, workspace = await _resolve_user_workspace(request)

    logger.info(
        "Marketplace skill detail requested",
        skill_id=skill_id,
        account_id=workspace
    )

    local_skill_name = _resolve_local_detail_skill_name(
        skill_id=skill_id,
        source_url=source_url,
        name=name,
    )
    if local_skill_name:
        local_detail = await _build_local_marketplace_skill_detail(
            account_id=workspace,
            skill_name=local_skill_name,
        )
        if local_detail:
            logger.info(
                "Marketplace detail served from local catalog fallback",
                skill_id=skill_id,
                local_skill_name=local_skill_name,
            )
            return local_detail

    client = get_skillsmp_client()

    if not client.api_key:
        raise HTTPException(
            status_code=503,
            detail="SkillsMP integration not configured."
        )

    import_service = SkillsImportService(DBConnection())
    compat_service = get_compatibility_service()

    try:
        # Fetch skill details from SkillsMP + GitHub
        if source_url:
            skill_detail = await client.get_skill_detail_from_github(
                skill_id=skill_id,
                github_url=source_url,
                name=name,
                description=description,
            )
        else:
            skill_detail = await client.get_skill_detail_from_search(skill_id)

        # Check if already installed
        db_client = None
        account_id = workspace
        installed_row = None
        is_installed = False
        try:
            db_client = await _db()
            installed_row = await _get_installed_skill_row(
                db_client,
                account_id=account_id,
                skill_name=skill_detail.name,
                marketplace_id=skill_id,
            )
            is_installed = bool(installed_row)
        except Exception as exc:
            logger.warning(
                "Marketplace detail: database unavailable",
                error=str(exc),
            )

        skill_def = _build_skill_definition_from_markdown(
            import_service,
            skill_detail.markdown_content,
            fallback_name=skill_detail.name,
            fallback_description=skill_detail.description,
            source_url=skill_detail.githubUrl,
            source_type="marketplace",
        )

        compatibility_status = None
        compatibility_reason = None
        if skill_def:
            compatibility_check = compat_service.check_compatibility(skill_def)
            compatibility_status = compatibility_check["status"]
            compatibility_reason = compatibility_check["reason"]
        elif installed_row:
            compatibility_status = installed_row.get("compatibility_status")
            compatibility_reason = installed_row.get("compatibility_reason")
        else:
            compatibility_check = None
            compatibility_status = "unknown"
            compatibility_reason = "Compatibility will be checked on install"

        # Convert to API model
        from .api_models import MarketplaceSkillDetail as APIMarketplaceSkillDetail

        response = APIMarketplaceSkillDetail(
            id=skill_detail.id,
            name=skill_detail.name,
            description=skill_def.description if skill_def else skill_detail.description,
            markdown_content=skill_detail.markdown_content,
            allowed_tools=skill_def.allowed_tools if skill_def else [],
            author=skill_detail.author,
            source_url=skill_detail.githubUrl,
            marketplace_url=skill_detail.skillUrl or f"https://skillsmp.com/skills/{skill_id}",
            install_count=skill_detail.stars,
            rating=None,
            tags=[],
            category=None,
            model=skill_def.model if skill_def else None,
            context=skill_def.context if skill_def else None,
            agent=skill_def.agent if skill_def else None,
            user_invocable=skill_def.user_invocable if skill_def else None,
            argument_hint=skill_def.argument_hint if skill_def else None,
            license=skill_def.license if skill_def else None,
            created_at=skill_detail.created_at,
            updated_at=skill_detail.updated_at,
            version=skill_detail.version,
            compatibility_status=compatibility_status,
            compatibility_reason=compatibility_reason,
            is_installed=is_installed
        )

        logger.info(
            "Marketplace skill detail retrieved",
            skill_id=skill_id,
            name=skill_detail.name,
            compatibility=compatibility_status
        )

        return response

    except SkillsMPAuthError as exc:
        logger.error("Marketplace auth failed", error=str(exc))
        raise HTTPException(
            status_code=503,
            detail="SkillsMP authentication failed. Please verify SKILLSMP_API_KEY."
        )
    except SkillsMPRateLimitError as exc:
        logger.error("Marketplace rate limit", error=str(exc))
        raise HTTPException(status_code=429, detail=str(exc))
    except SkillsMPNetworkError as exc:
        logger.error("Marketplace network error", error=str(exc))
        raise HTTPException(status_code=503, detail=str(exc))
    except SkillsMPAPIError as exc:
        logger.error("Marketplace API error", error=str(exc))
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as e:
        logger.error(
            "Failed to get marketplace skill detail",
            skill_id=skill_id,
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get skill details: {str(e)}"
        )
    finally:
        await import_service.close()


@router.post("/marketplace/{skill_id}/install", response_model=MarketplaceInstallResponse, status_code=201)
async def install_from_marketplace(
    request: Request,
    skill_id: str,
    install_request: MarketplaceInstallRequest,
) -> MarketplaceInstallResponse:
    """
    Install a skill from SkillsMP marketplace.

    **Parameters:**
    - **skill_id**: SkillsMP skill ID
    - **force**: Overwrite if skill already exists (default: false)

    **Returns:**
    - Installed skill details
    - Compatibility check result
    - Success/failure message
    """
    user, workspace = await _resolve_user_workspace(request)
    account_id = workspace  # workspace is the account_id string

    logger.info(
        "Marketplace skill install requested",
        skill_id=skill_id,
        force=install_request.force,
        account_id=account_id
    )

    local_skill_name = _parse_local_skill_name(skill_id)
    if local_skill_name:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Skill '{local_skill_name}' is already available locally and does not "
                "need marketplace installation."
            ),
        )

    client = get_skillsmp_client()

    if not client.api_key:
        raise HTTPException(
            status_code=503,
            detail="SkillsMP integration not configured."
        )

    import_service = SkillsImportService(DBConnection())
    try:
        # Fetch skill details from marketplace + GitHub
        if install_request.source_url:
            skill_detail = await client.get_skill_detail_from_github(
                skill_id=skill_id,
                github_url=install_request.source_url,
                name=install_request.name,
                description=install_request.description,
            )
        else:
            skill_detail = await client.get_skill_detail_from_search(skill_id)

        marketplace_metadata = {
            "marketplace_id": skill_id,
            "author": skill_detail.author,
            "install_count": skill_detail.stars,
            "rating": None,
            "tags": [],
            "category": None,
            "version": skill_detail.version,
        }

        result = await import_service.import_from_raw_markdown(
            markdown_content=skill_detail.markdown_content,
            account_id=account_id,
            force=install_request.force,
            source_type="marketplace",
            source_url=f"https://skillsmp.com/skills/{skill_id}",
            marketplace_metadata=marketplace_metadata,
        )

        skill = result["skill"]
        compatibility = result["compatibility"]

        installed_skill = InstalledSkill(
            id="pending",
            skill_id=skill.name,  # skill_id in response model maps to name in database
            name=skill.name,
            description=skill.description,
            prompt=skill.prompt,
            allowed_tools=skill.allowed_tools,
            source_url=f"https://skillsmp.com/skills/{skill_id}",
            source_type="marketplace",
            compatibility_status=compatibility["status"],
            compatibility_reason=compatibility["reason"],
            model=skill.model,
            context=skill.context,
            agent=skill.agent,
            user_invocable=skill.user_invocable,
            argument_hint=skill.argument_hint,
            license=skill.license,
        )

        compatibility_result = CompatibilityResult(
            status=compatibility["status"],
            reason=compatibility["reason"],
            details=CompatibilityDetails(**compatibility["details"]),
            suggestions=[],
        )

        message = f"Skill '{skill.name}' installed successfully"
        if compatibility["status"] != "compatible":
            message += f" with {compatibility['status']} compatibility"

        logger.info(
            "Marketplace skill installed",
            skill_id=skill_id,
            skill_name=skill.name,
            created=result["created"],
            compatibility=compatibility["status"],
        )

        return MarketplaceInstallResponse(
            success=True,
            skill=installed_skill,
            compatibility=compatibility_result,
            created=result["created"],
            message=message,
        )

    except SkillsMPAuthError as exc:
        logger.error("Marketplace auth failed", error=str(exc))
        raise HTTPException(
            status_code=503,
            detail="SkillsMP authentication failed. Please verify SKILLSMP_API_KEY."
        )
    except SkillsMPRateLimitError as exc:
        logger.error("Marketplace rate limit", error=str(exc))
        raise HTTPException(status_code=429, detail=str(exc))
    except SkillsMPNetworkError as exc:
        logger.error("Marketplace network error", error=str(exc))
        raise HTTPException(status_code=503, detail=str(exc))
    except SkillsMPAPIError as exc:
        logger.error("Marketplace API error", error=str(exc))
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as e:
        logger.error(
            "Marketplace skill install failed",
            skill_id=skill_id,
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail=f"Installation failed: {str(e)}"
        )
    finally:
        await import_service.close()
