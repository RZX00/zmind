from __future__ import annotations

from typing import Optional, Protocol

from core.domains.infographic.model import (
    InfographicGenerationRecord,
    InfographicMarketListing,
    InfographicPreferences,
    InfographicPreferencesBundle,
    InfographicRecipe,
    PreferenceScope,
)


class InfographicRepository(Protocol):
    async def list_accessible_recipes(
        self,
        *,
        workspace_id: str,
        user_id: str,
        query: Optional[str] = None,
        include_disabled: bool = False,
    ) -> list[InfographicRecipe]:
        ...

    async def get_accessible_recipe(
        self,
        *,
        recipe_id: str,
        workspace_id: str,
        user_id: str,
    ) -> Optional[InfographicRecipe]:
        ...

    async def list_market_listings(
        self,
        *,
        workspace_id: str,
        user_id: str,
        query: Optional[str] = None,
        limit: int = 30,
        offset: int = 0,
    ) -> list[InfographicMarketListing]:
        ...

    async def get_preferences(
        self,
        *,
        workspace_id: str,
        user_id: str,
    ) -> InfographicPreferencesBundle:
        ...

    async def save_preferences(
        self,
        *,
        workspace_id: str,
        user_id: str,
        scope: PreferenceScope,
        preference: InfographicPreferences,
    ) -> InfographicPreferences:
        ...

    async def create_generation_record(self, *, record: InfographicGenerationRecord) -> None:
        ...
