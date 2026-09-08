from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Literal, Optional


RecipeScope = Literal["system", "workspace", "user"]
RecipeVisibility = Literal["official", "workspace_private"]
RecipeStatus = Literal["active", "disabled", "archived"]
MergeMode = Literal["append", "prepend", "replace"]
StyleLock = Literal["off", "soft", "strict"]
PreferenceScope = Literal["user", "workspace"]
ListingType = Literal["official", "workspace_private"]
GenerationStatus = Literal["succeeded", "failed"]


DEFAULT_SYSTEM_RECIPE_ID = "sys.editorial_balanced"
DEFAULT_MERGE_MODE: MergeMode = "prepend"
DEFAULT_STYLE_LOCK: StyleLock = "strict"


@dataclass(frozen=True)
class InfographicRecipeVersion:
    recipe_id: str
    version: int
    prompt_template: str
    style_manifest: Dict[str, Any]
    metadata: Dict[str, Any]
    is_published: bool
    created_at: Optional[str]


@dataclass(frozen=True)
class InfographicRecipe:
    recipe_id: str
    scope_type: RecipeScope
    visibility: RecipeVisibility
    account_id: Optional[str]
    owner_user_id: Optional[str]
    slug: str
    name: str
    description: Optional[str]
    locale: str
    tags: list[str]
    cover_url: Optional[str]
    status: RecipeStatus
    latest_version: Optional[InfographicRecipeVersion]


@dataclass(frozen=True)
class InfographicPreferences:
    account_id: str
    user_id: Optional[str]
    default_recipe_id: Optional[str]
    default_custom_prompt: Optional[str]
    default_merge_mode: MergeMode
    default_style_lock: StyleLock
    default_reference_image_file_id: Optional[str] = None


@dataclass(frozen=True)
class InfographicMarketListing:
    listing_id: str
    recipe_id: str
    listing_type: ListingType
    account_id: Optional[str]
    badge: Optional[str]
    rank: int
    featured: bool
    is_active: bool
    recipe: Optional[InfographicRecipe]


@dataclass(frozen=True)
class InfographicPreferencesBundle:
    user_preference: Optional[InfographicPreferences]
    workspace_preference: Optional[InfographicPreferences]


@dataclass(frozen=True)
class ResolvedInfographicConfig:
    recipe: Optional[InfographicRecipe]
    recipe_source: str
    custom_prompt: Optional[str]
    custom_prompt_source: str
    merge_mode: MergeMode
    merge_mode_source: str
    style_lock: StyleLock
    style_lock_source: str
    reference_image_file_id: Optional[str] = None
    reference_image_source: str = "system_default"


@dataclass(frozen=True)
class InfographicGenerationRecord:
    generation_id: str
    canvas_id: str
    account_id: str
    user_id: str
    recipe_id: Optional[str]
    recipe_version: Optional[int]
    merge_mode: MergeMode
    style_lock: StyleLock
    fingerprint: str
    selection_hash: Optional[str]
    custom_prompt: Optional[str]
    llm_model: str
    image_model: str
    aspect_ratio: str
    image_prompt: str
    reference_image_file_id: Optional[str] = None
    status: GenerationStatus = "succeeded"
    error_message: Optional[str] = None


def normalize_merge_mode(value: Optional[str]) -> MergeMode:
    candidate = (value or "").strip().lower()
    if candidate in {"append", "prepend", "replace"}:
        return candidate  # type: ignore[return-value]
    return DEFAULT_MERGE_MODE


def normalize_style_lock(value: Optional[str]) -> StyleLock:
    candidate = (value or "").strip().lower()
    if candidate in {"off", "soft", "strict"}:
        return candidate  # type: ignore[return-value]
    return DEFAULT_STYLE_LOCK
