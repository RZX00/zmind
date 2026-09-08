"""
Skills Import Service for Skills Marketplace.

This service handles importing skills from external sources:
- GitHub repositories (SKILL.md files)
- Manual paste (markdown content)
- Future: SkillsMP.com API integration

Workflow:
1. Parse source URL or content
2. Download/extract SKILL.md markdown
3. Parse frontmatter and validate
4. Check compatibility with Zmind
5. Save to database (user_skills table)
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import httpx
import yaml
from pydantic import ValidationError

from core.services.supabase import DBConnection
from core.skills.types import SkillDefinition
from core.utils.logger import logger
from core.application.use_cases.marketplace.record_listing_event import RecordListingEventUseCase
from core.domains.marketplace import events as marketplace_events

from .skills_compatibility import get_compatibility_service


class SkillImportError(Exception):
    """Base exception for skill import errors."""

    pass


class SkillsImportService:
    """Service for importing skills from external sources."""

    # GitHub URL patterns
    GITHUB_BLOB_PATTERN = re.compile(
        r"^https?://github\.com/"
        r"(?P<owner>[^/]+)/"
        r"(?P<repo>[^/]+)/"
        r"blob/"
        r"(?P<branch>[^/]+)/"
        r"(?P<path>.+\.md)$"
    )

    GITHUB_RAW_URL = "https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"

    def __init__(self, db: DBConnection):
        """Initialize the import service.

        Args:
            db: Database connection
        """
        self.db = db
        self.compatibility_service = get_compatibility_service()
        self._http_client: Optional[httpx.AsyncClient] = None

    async def _get_http_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(
                timeout=30.0,
                follow_redirects=True,
                headers={"User-Agent": "Zmind-Skills-Importer/1.0"},
            )
        return self._http_client

    async def close(self):
        """Close HTTP client."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

    def _parse_github_url(self, url: str) -> Optional[Dict[str, str]]:
        """Parse GitHub blob URL into components.

        Args:
            url: GitHub URL (e.g., https://github.com/user/repo/blob/main/skill.md)

        Returns:
            Dict with owner, repo, branch, path, or None if invalid
        """
        match = self.GITHUB_BLOB_PATTERN.match(url)
        if not match:
            return None

        return match.groupdict()

    async def _download_file(self, url: str) -> str:
        """Download file content from URL.

        Args:
            url: File URL to download

        Returns:
            File content as string

        Raises:
            SkillImportError: If download fails
        """
        client = await self._get_http_client()

        try:
            response = await client.get(url)
            response.raise_for_status()

            content = response.text

            if not content or len(content.strip()) == 0:
                raise SkillImportError("Downloaded file is empty")

            return content

        except httpx.HTTPStatusError as exc:
            logger.error(
                "Failed to download file",
                url=url,
                status_code=exc.response.status_code,
            )
            raise SkillImportError(
                f"Failed to download file: HTTP {exc.response.status_code}"
            )
        except httpx.RequestError as exc:
            logger.error("Network error downloading file", url=url, error=str(exc))
            raise SkillImportError(f"Network error: {exc}")

    def _parse_markdown_frontmatter(
        self, markdown: str
    ) -> tuple[Dict[str, Any], str]:
        """Parse SKILL.md frontmatter and body.

        Args:
            markdown: Full markdown content

        Returns:
            Tuple of (frontmatter_dict, body_text)
        """
        if not markdown.startswith("---"):
            return {}, markdown

        lines = markdown.splitlines()
        if not lines or lines[0].strip() != "---":
            return {}, markdown

        # Find closing ---
        for idx in range(1, len(lines)):
            if lines[idx].strip() == "---":
                frontmatter_raw = "\n".join(lines[1:idx]).strip()
                body = "\n".join(lines[idx + 1 :]).lstrip("\n")

                try:
                    parsed = yaml.safe_load(frontmatter_raw) if frontmatter_raw else {}
                except yaml.YAMLError as exc:
                    logger.warning("Failed to parse frontmatter YAML", error=str(exc))
                    parsed = {}

                return (parsed if isinstance(parsed, dict) else {}), body

        # No closing ---, treat entire content as body
        return {}, markdown

    def _normalize_list(self, value: Any) -> list[str]:
        """Normalize list values from frontmatter."""
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if "," in text:
                return [part.strip() for part in text.split(",") if part.strip()]
            return [text]
        return []

    def _build_skill_definition(
        self,
        frontmatter: Dict[str, Any],
        body: str,
        source_url: Optional[str] = None,
        source_type: str = "manual",
    ) -> SkillDefinition:
        """Build SkillDefinition from parsed frontmatter and body.

        Args:
            frontmatter: Parsed frontmatter dictionary
            body: Markdown body (prompt content)
            source_url: Original source URL
            source_type: Type of source (github, manual, etc.)

        Returns:
            Valid SkillDefinition

        Raises:
            SkillImportError: If skill definition is invalid
        """
        payload: Dict[str, Any] = {
            "prompt": (body or "").strip(),
        }

        # Required fields
        if "name" not in frontmatter:
            raise SkillImportError("Skill missing required field: 'name'")
        if "description" not in frontmatter:
            raise SkillImportError("Skill missing required field: 'description'")

        payload["name"] = frontmatter["name"]
        payload["description"] = frontmatter["description"]

        # Optional fields - handle both hyphenated and underscored versions
        if "allowed-tools" in frontmatter:
            payload["allowed-tools"] = self._normalize_list(frontmatter["allowed-tools"])
        elif "allowed_tools" in frontmatter:
            payload["allowed-tools"] = self._normalize_list(frontmatter["allowed_tools"])

        for field in ["model", "context", "agent", "license"]:
            if field in frontmatter:
                payload[field] = frontmatter[field]

        if "user-invocable" in frontmatter:
            payload["user-invocable"] = bool(frontmatter["user-invocable"])
        elif "user_invocable" in frontmatter:
            payload["user-invocable"] = bool(frontmatter["user_invocable"])

        if "disable-model-invocation" in frontmatter:
            payload["disable-model-invocation"] = bool(
                frontmatter["disable-model-invocation"]
            )
        elif "disable_model_invocation" in frontmatter:
            payload["disable-model-invocation"] = bool(
                frontmatter["disable_model_invocation"]
            )

        if "argument-hint" in frontmatter:
            payload["argument-hint"] = frontmatter["argument-hint"]
        elif "argument_hint" in frontmatter:
            payload["argument-hint"] = frontmatter["argument_hint"]

        if "metadata" in frontmatter and isinstance(frontmatter["metadata"], dict):
            payload["metadata"] = frontmatter["metadata"]

        if "hooks" in frontmatter:
            payload["hooks"] = frontmatter["hooks"]

        # Validate with Pydantic
        try:
            skill = SkillDefinition.model_validate(payload)
            skill.source = "user"  # type: ignore
            if source_url:
                skill.location = source_url  # type: ignore
            return skill

        except ValidationError as exc:
            logger.error("Invalid skill definition", errors=exc.errors())
            raise SkillImportError(f"Invalid skill definition: {exc}")

    def parse_markdown_content(
        self,
        markdown_content: str,
        *,
        source_url: Optional[str] = None,
        source_type: str = "manual",
    ) -> SkillDefinition:
        """Parse raw markdown content into a SkillDefinition."""
        frontmatter, body = self._parse_markdown_frontmatter(markdown_content)
        return self._build_skill_definition(
            frontmatter=frontmatter,
            body=body,
            source_url=source_url,
            source_type=source_type,
        )

    async def import_from_github(
        self,
        github_url: str,
        account_id: str,
        *,
        force: bool = False,
    ) -> Dict[str, Any]:
        """Import skill from GitHub repository.

        Args:
            github_url: GitHub blob URL (e.g., https://github.com/.../blob/main/SKILL.md)
            account_id: User account ID
            force: If True, overwrite existing skill with same name

        Returns:
            Dictionary with:
            - skill: Imported skill definition
            - compatibility: Compatibility check result
            - created: Whether skill was newly created (vs updated)

        Raises:
            SkillImportError: If import fails
        """
        logger.info("Importing skill from GitHub", url=github_url, account_id=account_id)

        # Parse GitHub URL
        parsed = self._parse_github_url(github_url)
        if not parsed:
            raise SkillImportError(
                "Invalid GitHub URL. Expected format: "
                "https://github.com/owner/repo/blob/branch/path/SKILL.md"
            )

        # Convert to raw URL
        raw_url = self.GITHUB_RAW_URL.format(**parsed)
        logger.debug("Downloading from raw URL", raw_url=raw_url)

        # Download SKILL.md content
        markdown_content = await self._download_file(raw_url)

        # Parse frontmatter and body
        frontmatter, body = self._parse_markdown_frontmatter(markdown_content)

        # Build skill definition
        skill = self._build_skill_definition(
            frontmatter=frontmatter,
            body=body,
            source_url=github_url,
            source_type="github",
        )

        # Check compatibility
        compatibility = self.compatibility_service.check_compatibility(skill)

        # Save to database
        created = await self._save_skill(
            skill=skill,
            account_id=account_id,
            source_url=github_url,
            source_type="github",
            compatibility=compatibility,
            force=force,
        )

        logger.info(
            "Skill imported successfully",
            skill_name=skill.name,
            compatibility_status=compatibility["status"],
            created=created,
        )

        return {
            "skill": skill,
            "compatibility": compatibility,
            "created": created,
        }

    async def import_from_markdown(
        self,
        markdown_content: str,
        account_id: str,
        *,
        force: bool = False,
    ) -> Dict[str, Any]:
        """Import skill from manual markdown paste.

        Args:
            markdown_content: Full SKILL.md content
            account_id: User account ID
            force: If True, overwrite existing skill with same name

        Returns:
            Dictionary with skill, compatibility, created

        Raises:
            SkillImportError: If import fails
        """
        logger.info("Importing skill from manual markdown", account_id=account_id)

        # Parse frontmatter and body
        frontmatter, body = self._parse_markdown_frontmatter(markdown_content)

        # Build skill definition
        skill = self._build_skill_definition(
            frontmatter=frontmatter,
            body=body,
            source_url=None,
            source_type="manual",
        )

        # Check compatibility
        compatibility = self.compatibility_service.check_compatibility(skill)

        # Save to database
        created = await self._save_skill(
            skill=skill,
            account_id=account_id,
            source_url=None,
            source_type="manual",
            compatibility=compatibility,
            force=force,
        )

        logger.info(
            "Skill imported successfully",
            skill_name=skill.name,
            compatibility_status=compatibility["status"],
            created=created,
        )

        return {
            "skill": skill,
            "compatibility": compatibility,
            "created": created,
        }

    async def import_from_raw_markdown(
        self,
        markdown_content: str,
        account_id: str,
        *,
        force: bool = False,
        source_type: str = "manual",
        source_url: Optional[str] = None,
        marketplace_metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Import skill from raw markdown with explicit source metadata."""
        logger.info(
            "Importing skill from raw markdown",
            account_id=account_id,
            source_type=source_type,
        )

        skill = self.parse_markdown_content(
            markdown_content,
            source_url=source_url,
            source_type=source_type,
        )

        compatibility = self.compatibility_service.check_compatibility(skill)

        created = await self._save_skill(
            skill=skill,
            account_id=account_id,
            source_url=source_url,
            source_type=source_type,
            compatibility=compatibility,
            force=force,
            marketplace_metadata=marketplace_metadata,
        )

        logger.info(
            "Skill imported successfully",
            skill_name=skill.name,
            compatibility_status=compatibility["status"],
            created=created,
        )

        return {
            "skill": skill,
            "compatibility": compatibility,
            "created": created,
        }

    async def _save_skill(
        self,
        skill: SkillDefinition,
        account_id: str,
        source_url: Optional[str],
        source_type: str,
        compatibility: Dict[str, Any],
        force: bool = False,
        marketplace_metadata: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Save skill to database.

        Args:
            skill: Skill definition
            account_id: User account ID
            source_url: Original source URL
            source_type: Type of source
            compatibility: Compatibility check result
            force: If True, overwrite existing skill

        Returns:
            True if created, False if updated

        Raises:
            SkillImportError: If save fails
        """
        client = await self.db.client

        # Check if skill already exists
        existing = await client.table("user_skills").select("id, name").eq(
            "account_id", account_id
        ).eq("name", skill.name).execute()

        if existing.data and not force:
            raise SkillImportError(
                f"Skill '{skill.name}' already exists. Use force=True to overwrite."
            )

        # Prepare data for insertion
        data = {
            "account_id": account_id,
            "name": skill.name,
            "description": skill.description,
            "prompt": skill.prompt,
            "allowed_tools": skill.allowed_tools,
            "model": skill.model,
            "context": skill.context,
            "agent": skill.agent,
            "hooks": skill.hooks.model_dump(by_alias=False, exclude_none=True)
            if skill.hooks
            else None,
            "user_invocable": skill.user_invocable,
            "disable_model_invocation": skill.disable_model_invocation,
            "argument_hint": skill.argument_hint,
            "license": skill.license,
            "metadata": skill.metadata or {},
            "source_url": source_url,
            "source_type": source_type,
            "source": "user",
            "compatibility_status": compatibility["status"],
            "compatibility_reason": compatibility["reason"],
            "compatibility_details": compatibility["details"],
        }
        data["marketplace_metadata"] = marketplace_metadata or {}

        async def _write_payload(payload: dict[str, Any]) -> bool:
            if existing.data:
                await client.table("user_skills").update(payload).eq(
                    "id", existing.data[0]["id"]
                ).execute()
                return False
            await client.table("user_skills").insert(payload).execute()
            return True

        try:
            created = await _write_payload(data)
        except Exception as exc:
            message = str(exc)
            fallback_data = dict(data)
            retried = False
            if "argument_hint" in message or "argument-hint" in message:
                logger.warning("Retrying skill save without argument_hint", error=message)
                fallback_data.pop("argument_hint", None)
                retried = True
            if "user_invocable" in message or "user-invocable" in message:
                logger.warning("Retrying skill save with enabled fallback", error=message)
                value = fallback_data.pop("user_invocable", None)
                if value is not None:
                    fallback_data["enabled"] = value
                retried = True
            if retried:
                try:
                    created = await _write_payload(fallback_data)
                except Exception as retry_exc:
                    logger.error("Failed to save skill to database", error=str(retry_exc))
                    raise SkillImportError(f"Database error: {retry_exc}")
            else:
                logger.error("Failed to save skill to database", error=message)
                raise SkillImportError(f"Database error: {exc}")

        if source_type == "marketplace":
            marketplace_id = (marketplace_metadata or {}).get("marketplace_id") or skill.name
            use_case = RecordListingEventUseCase()
            await use_case.execute(
                listing_id=str(marketplace_id),
                event_type=marketplace_events.LISTING_INSTALLED,
                tenant_id=account_id,
                actor_id=account_id,
                payload={
                    "skill_name": skill.name,
                    "source_url": source_url,
                    "marketplace_id": marketplace_id,
                    "created": created,
                },
            )

        return created
