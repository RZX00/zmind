"""
Unit tests for SkillsImportService.

Tests skill import functionality for Skills Marketplace Phase 1.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from core.services.skills_import import SkillsImportService, SkillImportError
from core.skills.types import SkillDefinition


# Sample SKILL.md content for testing
VALID_SKILL_MD = """---
name: test-skill
description: A test skill for unit tests
allowed-tools:
  - web_search_tool
  - canvas_read
model: claude-3-5-sonnet-20241022
user-invocable: true
---

You are a helpful test assistant. Use web search to find information.
"""

MINIMAL_SKILL_MD = """---
name: minimal-skill
description: Minimal skill with only required fields
---

Just a simple prompt.
"""

INVALID_SKILL_MD_NO_NAME = """---
description: Missing name field
---

This skill is invalid.
"""

INVALID_SKILL_MD_NO_DESCRIPTION = """---
name: no-description
---

This skill is also invalid.
"""


class TestSkillsImportService:
    """Test suite for SkillsImportService."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database connection."""
        db = MagicMock()
        client = MagicMock()

        class _AwaitableClient:
            def __init__(self, value):
                self._value = value

            def __await__(self):
                async def _resolve():
                    return self._value

                return _resolve().__await__()

        db.client = _AwaitableClient(client)

        # Mock table operations
        table = MagicMock()
        client.table.return_value = table

        # Mock select chain
        select = MagicMock()
        table.select.return_value = select
        eq1 = MagicMock()
        select.eq.return_value = eq1
        eq2 = MagicMock()
        eq1.eq.return_value = eq2
        eq2.execute = AsyncMock(return_value=MagicMock(data=[]))

        # Mock insert
        insert = MagicMock()
        table.insert.return_value = insert
        insert.execute = AsyncMock(return_value=MagicMock(data=[]))

        return db

    @pytest.fixture
    def service(self, mock_db):
        """Create service instance with mock database."""
        return SkillsImportService(db=mock_db)

    def test_parse_github_url_valid(self, service):
        """Test parsing valid GitHub blob URLs."""
        url = "https://github.com/user/repo/blob/main/skills/test-skill/SKILL.md"

        result = service._parse_github_url(url)

        assert result is not None
        assert result["owner"] == "user"
        assert result["repo"] == "repo"
        assert result["branch"] == "main"
        assert result["path"] == "skills/test-skill/SKILL.md"

    def test_parse_github_url_different_branch(self, service):
        """Test parsing GitHub URL with different branch."""
        url = "https://github.com/user/repo/blob/develop/SKILL.md"

        result = service._parse_github_url(url)

        assert result is not None
        assert result["branch"] == "develop"

    def test_parse_github_url_invalid(self, service):
        """Test parsing invalid URLs."""
        invalid_urls = [
            "https://github.com/user/repo",  # No blob
            "https://gitlab.com/user/repo/blob/main/SKILL.md",  # Not GitHub
            "https://github.com/user",  # Incomplete
            "not-a-url",  # Not a URL at all
        ]

        for url in invalid_urls:
            result = service._parse_github_url(url)
            assert result is None, f"Should reject invalid URL: {url}"

    def test_parse_markdown_frontmatter_valid(self, service):
        """Test parsing valid markdown with frontmatter."""
        frontmatter, body = service._parse_markdown_frontmatter(VALID_SKILL_MD)

        assert frontmatter["name"] == "test-skill"
        assert frontmatter["description"] == "A test skill for unit tests"
        assert frontmatter["allowed-tools"] == ["web_search_tool", "canvas_read"]
        assert "helpful test assistant" in body

    def test_parse_markdown_frontmatter_no_frontmatter(self, service):
        """Test parsing markdown without frontmatter."""
        md = "Just plain markdown content"

        frontmatter, body = service._parse_markdown_frontmatter(md)

        assert frontmatter == {}
        assert body == md

    def test_parse_markdown_frontmatter_invalid_yaml(self, service):
        """Test parsing markdown with invalid YAML frontmatter."""
        md = """---
invalid: yaml: content:
---
Body content"""

        frontmatter, body = service._parse_markdown_frontmatter(md)

        # Should return empty dict for invalid YAML
        assert frontmatter == {}

    def test_normalize_list_from_list(self, service):
        """Test normalizing list values."""
        assert service._normalize_list(["a", "b", "c"]) == ["a", "b", "c"]
        assert service._normalize_list([1, 2, 3]) == ["1", "2", "3"]
        assert service._normalize_list([]) == []

    def test_normalize_list_from_string(self, service):
        """Test normalizing string values to list."""
        assert service._normalize_list("a, b, c") == ["a", "b", "c"]
        assert service._normalize_list("single") == ["single"]
        assert service._normalize_list("") == []

    def test_normalize_list_from_none(self, service):
        """Test normalizing None to empty list."""
        assert service._normalize_list(None) == []

    def test_build_skill_definition_valid(self, service):
        """Test building skill definition from valid data."""
        frontmatter = {
            "name": "test-skill",
            "description": "Test description",
            "allowed-tools": ["web_search_tool"],
            "model": "claude-3-5-sonnet-20241022",
        }
        body = "Test prompt"

        skill = service._build_skill_definition(frontmatter, body)

        assert skill.name == "test-skill"
        assert skill.description == "Test description"
        assert skill.prompt == "Test prompt"
        assert skill.allowed_tools == ["web_search_tool"]
        assert skill.model == "claude-3-5-sonnet-20241022"

    def test_build_skill_definition_minimal(self, service):
        """Test building skill with only required fields."""
        frontmatter = {
            "name": "minimal",
            "description": "Minimal skill",
        }
        body = "Prompt"

        skill = service._build_skill_definition(frontmatter, body)

        assert skill.name == "minimal"
        assert skill.description == "Minimal skill"
        assert skill.prompt == "Prompt"
        assert skill.allowed_tools == []

    def test_build_skill_definition_missing_name(self, service):
        """Test building skill without name raises error."""
        frontmatter = {"description": "No name"}
        body = "Prompt"

        with pytest.raises(SkillImportError, match="missing required field: 'name'"):
            service._build_skill_definition(frontmatter, body)

    def test_build_skill_definition_missing_description(self, service):
        """Test building skill without description raises error."""
        frontmatter = {"name": "no-desc"}
        body = "Prompt"

        with pytest.raises(
            SkillImportError, match="missing required field: 'description'"
        ):
            service._build_skill_definition(frontmatter, body)

    def test_build_skill_definition_handles_underscored_fields(self, service):
        """Test that both hyphenated and underscored field names work."""
        frontmatter1 = {
            "name": "test1",
            "description": "Test",
            "allowed-tools": ["tool1"],
            "user-invocable": True,
        }

        frontmatter2 = {
            "name": "test2",
            "description": "Test",
            "allowed_tools": ["tool1"],
            "user_invocable": True,
        }

        skill1 = service._build_skill_definition(frontmatter1, "Prompt")
        skill2 = service._build_skill_definition(frontmatter2, "Prompt")

        assert skill1.allowed_tools == skill2.allowed_tools
        assert skill1.user_invocable == skill2.user_invocable

    @pytest.mark.asyncio
    async def test_download_file_success(self, service):
        """Test successful file download."""
        mock_response = AsyncMock()
        mock_response.text = "File content"
        mock_response.raise_for_status = MagicMock()

        with patch.object(service, "_get_http_client") as mock_client_getter:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_getter.return_value = mock_client

            content = await service._download_file("https://example.com/file.md")

            assert content == "File content"
            mock_client.get.assert_called_once_with("https://example.com/file.md")

    @pytest.mark.asyncio
    async def test_download_file_http_error(self, service):
        """Test file download with HTTP error."""
        import httpx

        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Not Found", request=MagicMock(), response=mock_response
        )

        with patch.object(service, "_get_http_client") as mock_client_getter:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_getter.return_value = mock_client

            with pytest.raises(SkillImportError, match="HTTP 404"):
                await service._download_file("https://example.com/notfound.md")

    @pytest.mark.asyncio
    async def test_download_file_empty_content(self, service):
        """Test file download with empty content."""
        mock_response = AsyncMock()
        mock_response.text = ""
        mock_response.raise_for_status = MagicMock()

        with patch.object(service, "_get_http_client") as mock_client_getter:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_getter.return_value = mock_client

            with pytest.raises(SkillImportError, match="empty"):
                await service._download_file("https://example.com/empty.md")

    @pytest.mark.asyncio
    async def test_import_from_markdown_success(self, service, mock_db):
        """Test successful import from markdown content."""
        result = await service.import_from_markdown(
            markdown_content=VALID_SKILL_MD,
            account_id="user123",
        )

        assert result["skill"].name == "test-skill"
        assert result["compatibility"]["status"] in ["compatible", "partial"]
        assert result["created"] is True

    @pytest.mark.asyncio
    async def test_import_from_markdown_invalid(self, service):
        """Test import from invalid markdown raises error."""
        with pytest.raises(SkillImportError, match="missing required field"):
            await service.import_from_markdown(
                markdown_content=INVALID_SKILL_MD_NO_NAME,
                account_id="user123",
            )

    @pytest.mark.asyncio
    async def test_import_from_github_invalid_url(self, service):
        """Test import from invalid GitHub URL raises error."""
        with pytest.raises(SkillImportError, match="Invalid GitHub URL"):
            await service.import_from_github(
                github_url="https://example.com/notgithub",
                account_id="user123",
            )

    @pytest.mark.asyncio
    async def test_save_skill_duplicate_without_force(self, service, mock_db):
        """Test saving duplicate skill without force raises error."""
        # Mock existing skill
        client = await mock_db.client
        table = client.table.return_value
        select = table.select.return_value
        eq1 = select.eq.return_value
        eq2 = eq1.eq.return_value
        eq2.execute.return_value = MagicMock(
            data=[{"id": "existing-id", "skill_id": "test-skill"}]
        )

        skill = SkillDefinition(
            name="test-skill",
            description="Test",
            prompt="Test prompt",
        )

        compatibility = {
            "status": "compatible",
            "reason": "OK",
            "details": {},
        }

        with pytest.raises(SkillImportError, match="already exists"):
            await service._save_skill(
                skill=skill,
                account_id="user123",
                source_url=None,
                source_type="manual",
                compatibility=compatibility,
                force=False,
            )

    @pytest.mark.asyncio
    async def test_save_skill_duplicate_with_force(self, service, mock_db):
        """Test saving duplicate skill with force updates existing."""
        # Mock existing skill
        client = await mock_db.client
        table = client.table.return_value
        select = table.select.return_value
        eq1 = select.eq.return_value
        eq2 = eq1.eq.return_value
        eq2.execute.return_value = MagicMock(
            data=[{"id": "existing-id", "skill_id": "test-skill"}]
        )

        # Mock update
        update = MagicMock()
        table.update.return_value = update
        eq = MagicMock()
        update.eq.return_value = eq
        eq.execute = AsyncMock()

        skill = SkillDefinition(
            name="test-skill",
            description="Test",
            prompt="Test prompt",
        )

        compatibility = {
            "status": "compatible",
            "reason": "OK",
            "details": {},
        }

        created = await service._save_skill(
            skill=skill,
            account_id="user123",
            source_url=None,
            source_type="manual",
            compatibility=compatibility,
            force=True,
        )

        assert created is False  # Updated, not created
        table.update.assert_called_once()

    @pytest.mark.asyncio
    async def test_close_http_client(self, service):
        """Test closing HTTP client."""
        # Create a mock client
        mock_client = AsyncMock()
        service._http_client = mock_client

        await service.close()

        mock_client.aclose.assert_called_once()
        assert service._http_client is None
