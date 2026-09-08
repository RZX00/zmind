"""
API models for Skills Marketplace endpoints.

Pydantic models for request/response validation.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, HttpUrl, field_validator


class SkillImportRequest(BaseModel):
    """Request model for importing a skill."""

    source_type: Literal["github", "manual"] = Field(
        ..., description="Type of import source"
    )
    github_url: Optional[HttpUrl] = Field(
        default=None, description="GitHub URL (for source_type=github)"
    )
    markdown_content: Optional[str] = Field(
        default=None, description="SKILL.md content (for source_type=manual)"
    )
    force: bool = Field(
        default=False, description="Overwrite existing skill if it exists"
    )

    @field_validator("github_url")
    @classmethod
    def validate_github_url(cls, v, info):
        """Validate github_url is provided when source_type is github."""
        if info.data.get("source_type") == "github" and not v:
            raise ValueError("github_url is required when source_type is 'github'")
        return v

    @field_validator("markdown_content")
    @classmethod
    def validate_markdown_content(cls, v, info):
        """Validate markdown_content is provided when source_type is manual."""
        if info.data.get("source_type") == "manual" and not v:
            raise ValueError(
                "markdown_content is required when source_type is 'manual'"
            )
        return v


class CompatibilityDetails(BaseModel):
    """Compatibility check details."""

    incompatible_tools: List[str] = Field(
        default_factory=list, description="List of tools that won't work in Zmind"
    )
    alternatives: Dict[str, List[str]] = Field(
        default_factory=dict, description="Suggested Zmind alternatives for each tool"
    )
    warnings: List[str] = Field(
        default_factory=list, description="Compatibility warnings"
    )
    compatible_ratio: float = Field(
        default=1.0, description="Ratio of compatible tools (0.0 to 1.0)"
    )


class CompatibilityResult(BaseModel):
    """Compatibility check result."""

    status: Literal["compatible", "partial", "incompatible", "unknown"] = Field(
        ..., description="Compatibility status"
    )
    reason: str = Field(..., description="Human-readable explanation")
    details: CompatibilityDetails = Field(..., description="Detailed compatibility info")
    suggestions: List[str] = Field(
        default_factory=list, description="Human-readable suggestions"
    )


class InstalledSkill(BaseModel):
    """Installed skill information."""

    id: str = Field(..., description="Unique skill ID (database ID)")
    skill_id: str = Field(..., description="Skill identifier (name)")
    name: str = Field(..., description="Skill name")
    description: str = Field(..., description="Skill description")
    prompt: str = Field(..., description="Skill prompt")
    allowed_tools: List[str] = Field(
        default_factory=list, description="List of allowed tools"
    )
    enabled: bool = Field(default=True, description="Whether skill is enabled")

    # Marketplace-specific fields
    source_url: Optional[str] = Field(
        default=None, description="Original source URL"
    )
    source_type: Optional[Literal["github", "manual", "marketplace", "builtin", "user"]] = Field(
        default="user", description="Type of source"
    )
    compatibility_status: Optional[
        Literal["compatible", "partial", "incompatible", "unknown"]
    ] = Field(default="unknown", description="Compatibility status")
    compatibility_reason: Optional[str] = Field(
        default=None, description="Compatibility explanation"
    )

    # Timestamps
    installed_at: Optional[str] = Field(
        default=None, description="Installation timestamp (ISO 8601)"
    )
    created_at: Optional[str] = Field(
        default=None, description="Creation timestamp (ISO 8601)"
    )
    updated_at: Optional[str] = Field(
        default=None, description="Last update timestamp (ISO 8601)"
    )

    # Optional official fields
    model: Optional[str] = Field(default=None, description="Preferred model")
    context: Optional[Literal["fork"]] = Field(
        default=None, description="Context mode"
    )
    agent: Optional[str] = Field(default=None, description="Agent configuration")
    user_invocable: bool = Field(
        default=True, description="Whether users can invoke directly"
    )
    argument_hint: Optional[str] = Field(default=None, description="Argument hint")
    license: Optional[str] = Field(default=None, description="License identifier")


class InstalledSkillsResponse(BaseModel):
    """Response for installed skills list."""

    skills: List[InstalledSkill] = Field(
        default_factory=list, description="List of installed skills"
    )
    total: int = Field(..., description="Total number of skills")
    by_source: Dict[str, int] = Field(
        default_factory=dict, description="Count by source type"
    )
    by_compatibility: Dict[str, int] = Field(
        default_factory=dict, description="Count by compatibility status"
    )


class RegistrySkill(BaseModel):
    """Unified skill entry across builtin, file, and user sources."""

    id: str = Field(..., description="Unique skill identifier for registry list")
    skill_id: str = Field(..., description="Skill identifier (name)")
    name: str = Field(..., description="Skill name")
    description: str = Field(..., description="Skill description")
    allowed_tools: List[str] = Field(
        default_factory=list, description="List of allowed tools"
    )
    enabled: bool = Field(default=True, description="Whether skill is enabled")

    source_type: Literal[
        "github", "manual", "marketplace", "builtin", "user", "file"
    ] = Field(..., description="Type of source")
    source_url: Optional[str] = Field(
        default=None, description="Original source URL"
    )
    compatibility_status: Optional[
        Literal["compatible", "partial", "incompatible", "unknown"]
    ] = Field(default="unknown", description="Compatibility status")
    compatibility_reason: Optional[str] = Field(
        default=None, description="Compatibility explanation"
    )

    # Timestamps (only for DB-backed skills)
    installed_at: Optional[str] = Field(
        default=None, description="Installation timestamp (ISO 8601)"
    )
    created_at: Optional[str] = Field(
        default=None, description="Creation timestamp (ISO 8601)"
    )
    updated_at: Optional[str] = Field(
        default=None, description="Last update timestamp (ISO 8601)"
    )

    # Optional official fields
    model: Optional[str] = Field(default=None, description="Preferred model")
    context: Optional[Literal["fork"]] = Field(
        default=None, description="Context mode"
    )
    agent: Optional[str] = Field(default=None, description="Agent configuration")
    user_invocable: bool = Field(
        default=True, description="Whether users can invoke directly"
    )
    argument_hint: Optional[str] = Field(default=None, description="Argument hint")
    license: Optional[str] = Field(default=None, description="License identifier")

    # Registry metadata
    location: Optional[str] = Field(default=None, description="Skill file location")
    editable: bool = Field(default=False, description="Whether skill can be edited")


class SkillsRegistryResponse(BaseModel):
    """Response for unified skills registry list."""

    skills: List[RegistrySkill] = Field(
        default_factory=list, description="All available skills"
    )
    total: int = Field(..., description="Total number of skills")
    by_source: Dict[str, int] = Field(
        default_factory=dict, description="Count by source type"
    )
    by_compatibility: Dict[str, int] = Field(
        default_factory=dict, description="Count by compatibility status"
    )


class SkillImportResponse(BaseModel):
    """Response for skill import operation."""

    success: bool = Field(..., description="Whether import succeeded")
    skill: Optional[InstalledSkill] = Field(
        default=None, description="Imported skill (if successful)"
    )
    compatibility: Optional[CompatibilityResult] = Field(
        default=None, description="Compatibility check result"
    )
    created: bool = Field(
        default=False, description="Whether skill was newly created (vs updated)"
    )
    message: str = Field(..., description="Result message")


class SkillToggleRequest(BaseModel):
    """Request model for toggling skill enabled state."""

    enabled: bool = Field(..., description="New enabled state")


class SkillToggleResponse(BaseModel):
    """Response for skill toggle operation."""

    success: bool = Field(..., description="Whether toggle succeeded")
    skill_id: str = Field(..., description="Skill identifier")
    enabled: bool = Field(..., description="New enabled state")
    message: str = Field(..., description="Result message")


class SkillDeleteResponse(BaseModel):
    """Response for skill deletion operation."""

    success: bool = Field(..., description="Whether deletion succeeded")
    skill_id: str = Field(..., description="Deleted skill identifier")
    message: str = Field(..., description="Result message")


class SkillSource(BaseModel):
    """Information about a skill source."""

    type: Literal["github", "marketplace", "builtin"] = Field(
        ..., description="Source type"
    )
    name: str = Field(..., description="Source name")
    description: str = Field(..., description="Source description")
    url: Optional[str] = Field(default=None, description="Source URL")
    skill_count: Optional[int] = Field(
        default=None, description="Estimated number of skills"
    )
    compatibility_rate: Optional[float] = Field(
        default=None, description="Estimated compatibility rate (0.0 to 1.0)"
    )


class SkillSourcesResponse(BaseModel):
    """Response for skill sources list."""

    sources: List[SkillSource] = Field(
        default_factory=list, description="List of available sources"
    )
    total: int = Field(..., description="Total number of sources")


# ============================================================================
# Phase 2: Marketplace Integration Models
# ============================================================================


class MarketplaceSearchRequest(BaseModel):
    """Request model for marketplace search."""

    query: str = Field(..., description="Search query", min_length=1)
    page: int = Field(default=1, description="Page number (1-based)", ge=1)
    limit: int = Field(default=20, description="Results per page", ge=1, le=100)
    compatibility_filter: bool = Field(
        default=True, description="Only show compatible skills"
    )
    search_type: Literal["keyword", "ai_semantic"] = Field(
        default="keyword", description="Search type"
    )
    sort_by: Optional[Literal["stars", "recent"]] = Field(
        default=None, description="Sort order (stars or recent)"
    )


class MarketplaceSkill(BaseModel):
    """Skill from marketplace (search result or detail)."""

    id: str = Field(..., description="Marketplace skill ID")
    name: str = Field(..., description="Skill name")
    description: str = Field(..., description="Skill description")

    # Optional metadata
    author: Optional[str] = Field(default=None, description="Skill author")
    source_url: Optional[str] = Field(default=None, description="Source URL")
    marketplace_url: Optional[str] = Field(default=None, description="Marketplace URL")
    install_count: Optional[int] = Field(default=None, description="Install count")
    rating: Optional[float] = Field(default=None, description="User rating")
    tags: List[str] = Field(default_factory=list, description="Tags")
    category: Optional[str] = Field(default=None, description="Category")

    # Compatibility (populated after check)
    compatibility_status: Optional[str] = Field(
        default=None, description="Compatibility status"
    )
    compatibility_reason: Optional[str] = Field(
        default=None, description="Compatibility reason"
    )
    is_installed: bool = Field(default=False, description="Whether already installed")


class MarketplaceSearchResponse(BaseModel):
    """Response model for marketplace search."""

    skills: List[MarketplaceSkill] = Field(
        default_factory=list, description="Search results"
    )
    total: int = Field(..., description="Total number of results")
    page: int = Field(..., description="Current page")
    limit: int = Field(..., description="Results per page")
    has_more: bool = Field(..., description="Whether there are more pages")


class MarketplaceSkillDetail(MarketplaceSkill):
    """Detailed skill information from marketplace."""

    markdown_content: str = Field(..., description="Full SKILL.md content")
    allowed_tools: List[str] = Field(default_factory=list, description="Allowed tools")

    # Optional fields from frontmatter
    model: Optional[str] = Field(default=None, description="Preferred model")
    context: Optional[str] = Field(default=None, description="Context type")
    agent: Optional[str] = Field(default=None, description="Agent type")
    user_invocable: Optional[bool] = Field(
        default=None, description="User invocable"
    )
    argument_hint: Optional[str] = Field(default=None, description="Argument hint")
    license: Optional[str] = Field(default=None, description="License")

    # Timestamps
    created_at: Optional[str] = Field(default=None, description="Creation date")
    updated_at: Optional[str] = Field(default=None, description="Last update date")
    version: Optional[str] = Field(default=None, description="Version")


class MarketplaceInstallRequest(BaseModel):
    """Request to install skill from marketplace."""

    force: bool = Field(
        default=False, description="Overwrite if skill already exists"
    )
    source_url: Optional[str] = Field(
        default=None, description="GitHub URL for the skill"
    )
    name: Optional[str] = Field(default=None, description="Skill name")
    description: Optional[str] = Field(default=None, description="Skill description")


class MarketplaceInstallResponse(BaseModel):
    """Response after installing from marketplace."""

    success: bool = Field(..., description="Whether installation succeeded")
    skill: Optional[InstalledSkill] = Field(
        default=None, description="Installed skill details"
    )
    compatibility: Optional[CompatibilityResult] = Field(
        default=None, description="Compatibility check result"
    )
    created: bool = Field(..., description="Whether skill was newly created")
    message: str = Field(..., description="Result message")


class SkillUpdateInfo(BaseModel):
    """Information about available skill update."""

    skill_id: str = Field(..., description="Skill ID")
    skill_name: str = Field(..., description="Skill name")
    current_version: Optional[str] = Field(
        default=None, description="Current installed version"
    )
    latest_version: Optional[str] = Field(
        default=None, description="Latest available version"
    )
    marketplace_id: Optional[str] = Field(
        default=None, description="Marketplace skill ID"
    )
    update_available: bool = Field(
        default=False, description="Whether update is available"
    )
    last_check: Optional[str] = Field(
        default=None, description="Last update check timestamp"
    )


class SkillUpdatesResponse(BaseModel):
    """Response with list of skills that have updates available."""

    updates: List[SkillUpdateInfo] = Field(
        default_factory=list, description="Skills with updates"
    )
    total_updates: int = Field(..., description="Total number of updates available")
    last_check_at: Optional[str] = Field(
        default=None, description="Last global check timestamp"
    )


class BatchImportRequest(BaseModel):
    """Request to batch import skills."""

    source_type: Literal["github_repo", "marketplace_ids"] = Field(
        ..., description="Type of batch import"
    )
    github_repo_url: Optional[HttpUrl] = Field(
        default=None, description="GitHub repository URL (for github_repo)"
    )
    marketplace_ids: Optional[List[str]] = Field(
        default=None, description="List of marketplace skill IDs"
    )
    force: bool = Field(default=False, description="Overwrite existing skills")

    @field_validator("github_repo_url")
    @classmethod
    def validate_github_repo(cls, v, info):
        """Validate github_repo_url when source_type is github_repo."""
        if info.data.get("source_type") == "github_repo" and not v:
            raise ValueError(
                "github_repo_url is required when source_type is 'github_repo'"
            )
        return v

    @field_validator("marketplace_ids")
    @classmethod
    def validate_marketplace_ids(cls, v, info):
        """Validate marketplace_ids when source_type is marketplace_ids."""
        if info.data.get("source_type") == "marketplace_ids" and not v:
            raise ValueError(
                "marketplace_ids is required when source_type is 'marketplace_ids'"
            )
        return v


class BatchImportStatus(BaseModel):
    """Status of batch import operation."""

    task_id: str = Field(..., description="Background task ID")
    status: Literal["pending", "processing", "completed", "failed"] = Field(
        ..., description="Task status"
    )
    total_skills: int = Field(..., description="Total skills to import")
    imported: int = Field(default=0, description="Number of skills imported")
    failed: int = Field(default=0, description="Number of failures")
    progress_percent: float = Field(default=0.0, description="Progress percentage")
    message: str = Field(..., description="Status message")


class BatchImportResponse(BaseModel):
    """Response after initiating batch import."""

    success: bool = Field(..., description="Whether batch import was initiated")
    task_id: str = Field(..., description="Background task ID for tracking")
    status: BatchImportStatus = Field(..., description="Initial status")
    message: str = Field(..., description="Result message")
