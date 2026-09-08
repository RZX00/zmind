"""
Unit tests for SkillsCompatibilityService.

Tests compatibility detection logic for Skills Marketplace Phase 1.
"""

import pytest

from core.services.skills_compatibility import (
    SkillsCompatibilityService,
    get_compatibility_service,
)
from core.skills.types import SkillDefinition


class TestSkillsCompatibilityService:
    """Test suite for SkillsCompatibilityService."""

    @pytest.fixture
    def service(self):
        """Create service instance for testing."""
        return SkillsCompatibilityService()

    @pytest.fixture
    def compatible_skill(self):
        """Create a fully compatible skill (web-based tools only)."""
        return SkillDefinition(
            name="web-researcher",
            description="Research topics using web search",
            prompt="You are a web researcher",
            allowed_tools=["web_search_tool", "canvas_read"],
        )

    @pytest.fixture
    def partial_skill(self):
        """Create a partially compatible skill (mix of tools)."""
        return SkillDefinition(
            name="code-analyzer",
            description="Analyze code files",
            prompt="You analyze code",
            allowed_tools=[
                "web_search_tool",  # Compatible
                "canvas_read",  # Compatible
                "Bash",  # Incompatible
                "Edit",  # Incompatible
            ],
        )

    @pytest.fixture
    def incompatible_skill(self):
        """Create an incompatible skill (mostly CLI tools)."""
        return SkillDefinition(
            name="git-manager",
            description="Manage git repositories",
            prompt="You manage git",
            allowed_tools=[
                "GitCommit",
                "GitPush",
                "GitPull",
                "Bash",
                "Shell",
            ],
        )

    @pytest.fixture
    def no_tools_skill(self):
        """Create a skill with no tools (prompt-only)."""
        return SkillDefinition(
            name="writer",
            description="Creative writing assistant",
            prompt="You are a creative writer",
            allowed_tools=[],
        )

    def test_compatible_skill_detection(self, service, compatible_skill):
        """Test detection of fully compatible skills."""
        result = service.check_compatibility(compatible_skill)

        assert result["status"] == "compatible"
        assert result["details"]["incompatible_tools"] == []
        assert result["details"]["compatible_ratio"] == 1.0
        assert "available in Zmind" in result["reason"]

    def test_partial_skill_detection(self, service, partial_skill):
        """Test detection of partially compatible skills."""
        result = service.check_compatibility(partial_skill)

        assert result["status"] == "partial"
        assert set(result["details"]["incompatible_tools"]) == {"Bash", "Edit"}
        assert result["details"]["compatible_ratio"] == 0.5
        assert "2 of 4 tools unavailable" in result["reason"]

    def test_incompatible_skill_detection(self, service, incompatible_skill):
        """Test detection of incompatible skills."""
        result = service.check_compatibility(incompatible_skill)

        assert result["status"] == "incompatible"
        assert len(result["details"]["incompatible_tools"]) == 5
        assert result["details"]["compatible_ratio"] == 0.0
        assert "won't work properly" in result["reason"]

    def test_no_tools_skill_is_compatible(self, service, no_tools_skill):
        """Test that prompt-only skills are considered compatible."""
        result = service.check_compatibility(no_tools_skill)

        assert result["status"] == "compatible"
        assert result["details"]["incompatible_tools"] == []
        assert "doesn't require specific tools" in result["reason"]

    def test_alternatives_suggested(self, service):
        """Test that alternatives are suggested for incompatible tools."""
        skill = SkillDefinition(
            name="editor",
            description="Edit files",
            prompt="You edit files",
            allowed_tools=["Edit", "Write", "Read"],
        )

        result = service.check_compatibility(skill)

        # Should suggest canvas tools as alternatives
        alternatives = result["details"]["alternatives"]
        assert "Edit" in alternatives
        assert "canvas_edit" in alternatives["Edit"]

    def test_warnings_for_tools_without_alternatives(self, service):
        """Test that warnings are generated for tools without alternatives."""
        skill = SkillDefinition(
            name="git-tool",
            description="Git operations",
            prompt="You use git",
            allowed_tools=["GitCommit"],
        )

        result = service.check_compatibility(skill)

        # GitCommit has no alternatives
        warnings = result["details"]["warnings"]
        assert any("no Zmind alternative" in w for w in warnings)

    def test_compatibility_suggestions_for_compatible(self, service, compatible_skill):
        """Test suggestions for compatible skills."""
        suggestions = service.get_compatibility_suggestions(compatible_skill)

        assert len(suggestions) == 1
        assert "✅" in suggestions[0]
        assert "fully compatible" in suggestions[0]

    def test_compatibility_suggestions_for_partial(self, service, partial_skill):
        """Test suggestions for partially compatible skills."""
        suggestions = service.get_compatibility_suggestions(partial_skill)

        # Should have warning and alternatives
        assert any("⚠️" in s for s in suggestions)
        assert any("Instead of" in s for s in suggestions)

    def test_compatibility_suggestions_for_incompatible(
        self, service, incompatible_skill
    ):
        """Test suggestions for incompatible skills."""
        suggestions = service.get_compatibility_suggestions(incompatible_skill)

        # Should have error and recommendation
        assert any("❌" in s for s in suggestions)
        assert any("not available" in s for s in suggestions)

    def test_catalog_analysis(self, service, compatible_skill, partial_skill, incompatible_skill):
        """Test analysis of skill catalog."""
        skills = [compatible_skill, partial_skill, incompatible_skill]

        stats = service.analyze_skill_catalog(skills)

        assert stats["total"] == 3
        assert stats["compatible"] == 1
        assert stats["partial"] == 1
        assert stats["incompatible"] == 1
        assert stats["compatibility_rate"] == 66.7  # 2/3 usable

    def test_empty_catalog_analysis(self, service):
        """Test analysis of empty catalog."""
        stats = service.analyze_skill_catalog([])

        assert stats["total"] == 0
        assert stats["compatibility_rate"] == 0.0

    def test_singleton_instance(self):
        """Test that get_compatibility_service returns singleton."""
        service1 = get_compatibility_service()
        service2 = get_compatibility_service()

        assert service1 is service2

    def test_incompatible_tools_set_completeness(self, service):
        """Test that INCOMPATIBLE_TOOLS set includes expected tools."""
        expected_tools = {
            "Bash",
            "Shell",
            "Edit",
            "GitCommit",
            "LSP",
            "AskUserQuestion",
        }

        assert expected_tools.issubset(service.INCOMPATIBLE_TOOLS)

    def test_alternatives_mapping_exists(self, service):
        """Test that ZMIND_ALTERNATIVES mapping is defined."""
        assert isinstance(service.ZMIND_ALTERNATIVES, dict)
        assert "Edit" in service.ZMIND_ALTERNATIVES
        assert "canvas_edit" in service.ZMIND_ALTERNATIVES["Edit"]

    def test_compatibility_ratio_calculation(self, service):
        """Test that compatibility ratio is correctly calculated."""
        skill = SkillDefinition(
            name="test-skill",
            description="Test",
            prompt="Test",
            allowed_tools=["A", "B", "Bash", "C"],  # 1/4 incompatible
        )

        result = service.check_compatibility(skill)

        assert result["details"]["compatible_ratio"] == 0.75

    def test_skill_with_none_allowed_tools(self, service):
        """Test handling of skill with None allowed_tools."""
        skill = SkillDefinition(
            name="test-skill",
            description="Test",
            prompt="Test",
        )
        # allowed_tools defaults to []

        result = service.check_compatibility(skill)

        assert result["status"] == "compatible"
        assert result["details"]["incompatible_tools"] == []
