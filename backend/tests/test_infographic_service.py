from __future__ import annotations

from typing import Optional

import pytest

from core.application.services.infographic_service import InfographicService, InfographicServiceDependencies
from core.domains.infographic.model import (
    InfographicPreferences,
    InfographicPreferencesBundle,
    InfographicRecipe,
    InfographicRecipeVersion,
)


class _Repo:
    def __init__(self) -> None:
        self.recipes: dict[str, InfographicRecipe] = {}
        self.bundle = InfographicPreferencesBundle(user_preference=None, workspace_preference=None)

    async def list_accessible_recipes(self, **_kwargs):
        return list(self.recipes.values())

    async def get_accessible_recipe(self, *, recipe_id: str, **_kwargs):
        return self.recipes.get(recipe_id)

    async def list_market_listings(self, **_kwargs):
        return []

    async def get_preferences(self, **_kwargs):
        return self.bundle

    async def save_preferences(self, **_kwargs):
        raise NotImplementedError

    async def create_generation_record(self, **_kwargs):
        return None


def _recipe(recipe_id: str, version: int = 1) -> InfographicRecipe:
    return InfographicRecipe(
        recipe_id=recipe_id,
        scope_type="system",
        visibility="official",
        account_id=None,
        owner_user_id=None,
        slug=recipe_id,
        name=recipe_id,
        description=None,
        locale="multi",
        tags=[],
        cover_url=None,
        status="active",
        latest_version=InfographicRecipeVersion(
            recipe_id=recipe_id,
            version=version,
            prompt_template="prompt",
            style_manifest={},
            metadata={},
            is_published=True,
            created_at=None,
        ),
    )


@pytest.mark.asyncio
async def test_resolve_generation_config_prefers_temporary_recipe() -> None:
    repo = _Repo()
    repo.recipes["tmp.recipe"] = _recipe("tmp.recipe")
    repo.bundle = InfographicPreferencesBundle(
        user_preference=InfographicPreferences(
            account_id="w1",
            user_id="u1",
            default_recipe_id="user.recipe",
            default_custom_prompt="user prompt",
            default_merge_mode="prepend",
            default_style_lock="strict",
        ),
        workspace_preference=None,
    )
    repo.recipes["user.recipe"] = _recipe("user.recipe")

    service = InfographicService(InfographicServiceDependencies(repository=repo))
    resolved = await service.resolve_generation_config(
        workspace_id="w1",
        user_id="u1",
        requested_recipe_id="tmp.recipe",
        requested_custom_prompt="temporary",
        requested_merge_mode="append",
        requested_style_lock="soft",
    )

    assert resolved.recipe and resolved.recipe.recipe_id == "tmp.recipe"
    assert resolved.recipe_source == "temporary"
    assert resolved.custom_prompt == "temporary"
    assert resolved.custom_prompt_source == "temporary"
    assert resolved.merge_mode == "append"
    assert resolved.style_lock == "soft"


@pytest.mark.asyncio
async def test_resolve_generation_config_falls_back_user_workspace_system() -> None:
    repo = _Repo()
    repo.recipes["sys.editorial_balanced"] = _recipe("sys.editorial_balanced")

    service = InfographicService(InfographicServiceDependencies(repository=repo))

    # 1) user default
    repo.recipes["user.recipe"] = _recipe("user.recipe")
    repo.bundle = InfographicPreferencesBundle(
        user_preference=InfographicPreferences(
            account_id="w1",
            user_id="u1",
            default_recipe_id="user.recipe",
            default_custom_prompt=None,
            default_merge_mode="prepend",
            default_style_lock="strict",
        ),
        workspace_preference=InfographicPreferences(
            account_id="w1",
            user_id=None,
            default_recipe_id="workspace.recipe",
            default_custom_prompt="workspace prompt",
            default_merge_mode="append",
            default_style_lock="soft",
        ),
    )
    resolved_user = await service.resolve_generation_config(
        workspace_id="w1",
        user_id="u1",
        requested_recipe_id=None,
        requested_custom_prompt=None,
        requested_merge_mode=None,
        requested_style_lock=None,
    )
    assert resolved_user.recipe and resolved_user.recipe.recipe_id == "user.recipe"
    assert resolved_user.recipe_source == "user_default"

    # 2) workspace default (user missing)
    repo.recipes.pop("user.recipe")
    repo.recipes["workspace.recipe"] = _recipe("workspace.recipe")
    resolved_workspace = await service.resolve_generation_config(
        workspace_id="w1",
        user_id="u1",
        requested_recipe_id=None,
        requested_custom_prompt=None,
        requested_merge_mode=None,
        requested_style_lock=None,
    )
    assert resolved_workspace.recipe and resolved_workspace.recipe.recipe_id == "workspace.recipe"
    assert resolved_workspace.recipe_source == "workspace_default"

    # 3) system default (user/workspace missing)
    repo.recipes.pop("workspace.recipe")
    resolved_system = await service.resolve_generation_config(
        workspace_id="w1",
        user_id="u1",
        requested_recipe_id=None,
        requested_custom_prompt=None,
        requested_merge_mode=None,
        requested_style_lock=None,
    )
    assert resolved_system.recipe and resolved_system.recipe.recipe_id == "sys.editorial_balanced"
    assert resolved_system.recipe_source == "system_default"


@pytest.mark.asyncio
async def test_resolve_generation_config_rejects_invalid_temporary_recipe() -> None:
    repo = _Repo()
    repo.recipes["sys.editorial_balanced"] = _recipe("sys.editorial_balanced")
    service = InfographicService(InfographicServiceDependencies(repository=repo))

    with pytest.raises(ValueError):
        await service.resolve_generation_config(
            workspace_id="w1",
            user_id="u1",
            requested_recipe_id="missing.recipe",
            requested_custom_prompt=None,
            requested_merge_mode=None,
            requested_style_lock=None,
        )


@pytest.mark.asyncio
async def test_empty_custom_prompt_is_temporary_override() -> None:
    repo = _Repo()
    repo.recipes["sys.editorial_balanced"] = _recipe("sys.editorial_balanced")
    repo.bundle = InfographicPreferencesBundle(
        user_preference=InfographicPreferences(
            account_id="w1",
            user_id="u1",
            default_recipe_id=None,
            default_custom_prompt="default prompt",
            default_merge_mode="append",
            default_style_lock="soft",
        ),
        workspace_preference=None,
    )
    service = InfographicService(InfographicServiceDependencies(repository=repo))

    resolved = await service.resolve_generation_config(
        workspace_id="w1",
        user_id="u1",
        requested_recipe_id=None,
        requested_custom_prompt="",
        requested_merge_mode=None,
        requested_style_lock=None,
    )

    assert resolved.custom_prompt is None
    assert resolved.custom_prompt_source == "temporary"
