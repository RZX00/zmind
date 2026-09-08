from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from core.domains.infographic.model import (
    DEFAULT_MERGE_MODE,
    DEFAULT_STYLE_LOCK,
    InfographicGenerationRecord,
    InfographicMarketListing,
    InfographicPreferences,
    InfographicPreferencesBundle,
    InfographicRecipe,
    InfographicRecipeVersion,
    PreferenceScope,
    normalize_merge_mode,
    normalize_style_lock,
)
from core.domains.infographic.ports.infographic_repository import InfographicRepository
from core.services.supabase import DBConnection
from core.utils.logger import logger


class SupabaseInfographicRepository(InfographicRepository):
    def __init__(self, db: Optional[DBConnection] = None) -> None:
        self._db = db or DBConnection()

    async def list_accessible_recipes(
        self,
        *,
        workspace_id: str,
        user_id: str,
        query: Optional[str] = None,
        include_disabled: bool = False,
    ) -> list[InfographicRecipe]:
        client = await self._db.client
        rows: list[dict[str, Any]] = []
        rows.extend(await self._load_recipe_rows_for_scope(client, scope_type="system", include_disabled=include_disabled))
        rows.extend(
            await self._load_recipe_rows_for_scope(
                client,
                scope_type="workspace",
                workspace_id=workspace_id,
                include_disabled=include_disabled,
            )
        )
        rows.extend(
            await self._load_recipe_rows_for_scope(
                client,
                scope_type="user",
                workspace_id=workspace_id,
                user_id=user_id,
                include_disabled=include_disabled,
            )
        )

        if not rows:
            return []

        latest_versions = await self._load_latest_versions(client, [str(row.get("recipe_id")) for row in rows if row.get("recipe_id")])

        recipes = [self._to_recipe(row, latest_versions.get(str(row.get("recipe_id")))) for row in rows if row.get("recipe_id")]
        if query:
            recipes = [recipe for recipe in recipes if _recipe_matches_query(recipe, query)]

        # Sort by featured scope intent: system first, then workspace, then user; stable alpha within scope.
        scope_rank = {"system": 0, "workspace": 1, "user": 2}
        recipes.sort(key=lambda item: (scope_rank.get(item.scope_type, 9), item.name.lower(), item.recipe_id))
        return recipes

    async def get_accessible_recipe(
        self,
        *,
        recipe_id: str,
        workspace_id: str,
        user_id: str,
    ) -> Optional[InfographicRecipe]:
        if not recipe_id:
            return None

        client = await self._db.client
        result = (
            await client.table("infographic_recipes")
            .select("*")
            .eq("recipe_id", recipe_id)
            .limit(1)
            .execute()
        )
        if not result.data:
            return None

        row = result.data[0]
        if not _is_recipe_accessible(row=row, workspace_id=workspace_id, user_id=user_id):
            return None

        latest_versions = await self._load_latest_versions(client, [recipe_id])
        return self._to_recipe(row, latest_versions.get(recipe_id))

    async def list_market_listings(
        self,
        *,
        workspace_id: str,
        user_id: str,
        query: Optional[str] = None,
        limit: int = 30,
        offset: int = 0,
    ) -> list[InfographicMarketListing]:
        client = await self._db.client

        official = (
            await client.table("infographic_market_listings")
            .select("*")
            .eq("listing_type", "official")
            .eq("is_active", True)
            .is_("account_id", "null")
            .execute()
        )
        workspace = (
            await client.table("infographic_market_listings")
            .select("*")
            .eq("listing_type", "workspace_private")
            .eq("account_id", workspace_id)
            .eq("is_active", True)
            .execute()
        )

        listing_rows = list(official.data or []) + list(workspace.data or [])
        if not listing_rows:
            return []

        recipes = await self.list_accessible_recipes(
            workspace_id=workspace_id,
            user_id=user_id,
            query=query,
            include_disabled=False,
        )
        recipes_by_id = {recipe.recipe_id: recipe for recipe in recipes}

        listings: list[InfographicMarketListing] = []
        for row in listing_rows:
            recipe_id = str(row.get("recipe_id") or "")
            recipe = recipes_by_id.get(recipe_id)
            if not recipe:
                continue
            listings.append(
                InfographicMarketListing(
                    listing_id=str(row.get("listing_id") or ""),
                    recipe_id=recipe_id,
                    listing_type=_normalize_listing_type(row.get("listing_type")),
                    account_id=_clean_optional_str(row.get("account_id")),
                    badge=_clean_optional_str(row.get("badge")),
                    rank=_safe_int(row.get("rank"), default=1000),
                    featured=bool(row.get("featured", False)),
                    is_active=bool(row.get("is_active", True)),
                    recipe=recipe,
                )
            )

        listings.sort(key=lambda item: (0 if item.featured else 1, item.rank, item.recipe.name.lower()))
        if offset < 0:
            offset = 0
        if limit <= 0:
            return listings[offset:]
        return listings[offset : offset + limit]

    async def get_preferences(
        self,
        *,
        workspace_id: str,
        user_id: str,
    ) -> InfographicPreferencesBundle:
        client = await self._db.client

        user_result = (
            await client.table("infographic_preferences")
            .select("*")
            .eq("account_id", workspace_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )

        workspace_result = (
            await client.table("infographic_preferences")
            .select("*")
            .eq("account_id", workspace_id)
            .is_("user_id", "null")
            .limit(1)
            .execute()
        )

        return InfographicPreferencesBundle(
            user_preference=self._to_preferences(user_result.data[0]) if user_result.data else None,
            workspace_preference=self._to_preferences(workspace_result.data[0]) if workspace_result.data else None,
        )

    async def save_preferences(
        self,
        *,
        workspace_id: str,
        user_id: str,
        scope: PreferenceScope,
        preference: InfographicPreferences,
    ) -> InfographicPreferences:
        client = await self._db.client

        payload = {
            "account_id": workspace_id,
            "user_id": user_id if scope == "user" else None,
            "default_recipe_id": preference.default_recipe_id,
            "default_custom_prompt": preference.default_custom_prompt,
            "default_merge_mode": preference.default_merge_mode,
            "default_style_lock": preference.default_style_lock,
            "default_reference_image_file_id": preference.default_reference_image_file_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        if scope == "user":
            # Keep updates idempotent at the user scope key.
            await client.table("infographic_preferences").upsert(
                payload,
                on_conflict="account_id,user_id",
            ).execute()
            return preference

        existing = (
            await client.table("infographic_preferences")
            .select("preference_id")
            .eq("account_id", workspace_id)
            .is_("user_id", "null")
            .limit(1)
            .execute()
        )
        if existing.data:
            pref_id = existing.data[0].get("preference_id")
            if pref_id:
                await client.table("infographic_preferences").update(payload).eq("preference_id", pref_id).execute()
            else:
                await client.table("infographic_preferences").insert(payload).execute()
        else:
            await client.table("infographic_preferences").insert(payload).execute()

        return preference

    async def create_generation_record(self, *, record: InfographicGenerationRecord) -> None:
        client = await self._db.client
        payload = {
            "generation_id": record.generation_id,
            "canvas_id": record.canvas_id,
            "account_id": record.account_id,
            "user_id": record.user_id,
            "recipe_id": record.recipe_id,
            "recipe_version": record.recipe_version,
            "merge_mode": record.merge_mode,
            "style_lock": record.style_lock,
            "fingerprint": record.fingerprint,
            "selection_hash": record.selection_hash,
            "custom_prompt": record.custom_prompt,
            "llm_model": record.llm_model,
            "image_model": record.image_model,
            "aspect_ratio": record.aspect_ratio,
            "image_prompt": record.image_prompt,
            "reference_image_file_id": record.reference_image_file_id,
            "status": record.status,
            "error_message": record.error_message,
        }
        try:
            await client.table("infographic_generations").insert(payload).execute()
        except Exception as exc:
            logger.warning("Failed to persist infographic generation record", error=str(exc), generation_id=record.generation_id)

    async def _load_recipe_rows_for_scope(
        self,
        client,
        *,
        scope_type: str,
        workspace_id: Optional[str] = None,
        user_id: Optional[str] = None,
        include_disabled: bool = False,
    ) -> list[dict[str, Any]]:
        query = (
            client.table("infographic_recipes")
            .select("*")
            .eq("scope_type", scope_type)
        )
        if not include_disabled:
            query = query.eq("status", "active")
        if scope_type == "workspace":
            query = query.eq("account_id", workspace_id)
        elif scope_type == "user":
            query = query.eq("account_id", workspace_id).eq("owner_user_id", user_id)

        try:
            result = await query.execute()
        except Exception as exc:
            logger.warning("Failed to query infographic recipes", scope_type=scope_type, error=str(exc))
            return []
        return list(result.data or [])

    async def _load_latest_versions(self, client, recipe_ids: list[str]) -> dict[str, InfographicRecipeVersion]:
        unique_ids = sorted({rid for rid in recipe_ids if rid})
        if not unique_ids:
            return {}

        try:
            result = (
                await client.table("infographic_recipe_versions")
                .select("recipe_id, version, prompt_template, style_manifest, metadata, is_published, created_at")
                .in_("recipe_id", unique_ids)
                .eq("is_published", True)
                .order("version", desc=True)
                .execute()
            )
        except Exception as exc:
            logger.warning("Failed to query infographic recipe versions", error=str(exc))
            return {}

        out: dict[str, InfographicRecipeVersion] = {}
        for row in result.data or []:
            recipe_id = str(row.get("recipe_id") or "")
            if not recipe_id or recipe_id in out:
                continue
            out[recipe_id] = self._to_version(row)
        return out

    def _to_version(self, row: dict[str, Any]) -> InfographicRecipeVersion:
        return InfographicRecipeVersion(
            recipe_id=str(row.get("recipe_id") or ""),
            version=_safe_int(row.get("version"), default=1),
            prompt_template=str(row.get("prompt_template") or "").strip(),
            style_manifest=row.get("style_manifest") or {},
            metadata=row.get("metadata") or {},
            is_published=bool(row.get("is_published", True)),
            created_at=_clean_optional_str(row.get("created_at")),
        )

    def _to_recipe(self, row: dict[str, Any], version: Optional[InfographicRecipeVersion]) -> InfographicRecipe:
        raw_tags = row.get("tags")
        tags: list[str] = []
        if isinstance(raw_tags, list):
            tags = [str(item) for item in raw_tags if str(item).strip()]

        return InfographicRecipe(
            recipe_id=str(row.get("recipe_id") or ""),
            scope_type=_normalize_scope_type(row.get("scope_type")),
            visibility=_normalize_visibility(row.get("visibility")),
            account_id=_clean_optional_str(row.get("account_id")),
            owner_user_id=_clean_optional_str(row.get("owner_user_id")),
            slug=str(row.get("slug") or "").strip(),
            name=str(row.get("name") or "").strip() or str(row.get("slug") or "").strip(),
            description=_clean_optional_str(row.get("description")),
            locale=str(row.get("locale") or "multi").strip() or "multi",
            tags=tags,
            cover_url=_clean_optional_str(row.get("cover_url")),
            status=_normalize_status(row.get("status")),
            latest_version=version,
        )

    def _to_preferences(self, row: dict[str, Any]) -> InfographicPreferences:
        return InfographicPreferences(
            account_id=str(row.get("account_id") or ""),
            user_id=_clean_optional_str(row.get("user_id")),
            default_recipe_id=_clean_optional_str(row.get("default_recipe_id")),
            default_custom_prompt=_clean_optional_str(row.get("default_custom_prompt")),
            default_merge_mode=normalize_merge_mode(_clean_optional_str(row.get("default_merge_mode"))),
            default_style_lock=normalize_style_lock(_clean_optional_str(row.get("default_style_lock"))),
            default_reference_image_file_id=_clean_optional_str(row.get("default_reference_image_file_id")),
        )


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _clean_optional_str(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _normalize_scope_type(value: Any) -> str:
    candidate = _clean_optional_str(value) or "system"
    if candidate in {"system", "workspace", "user"}:
        return candidate
    return "system"


def _normalize_visibility(value: Any) -> str:
    candidate = _clean_optional_str(value) or "official"
    if candidate in {"official", "workspace_private"}:
        return candidate
    return "official"


def _normalize_status(value: Any) -> str:
    candidate = _clean_optional_str(value) or "active"
    if candidate in {"active", "disabled", "archived"}:
        return candidate
    return "active"


def _normalize_listing_type(value: Any) -> str:
    candidate = _clean_optional_str(value) or "official"
    if candidate in {"official", "workspace_private"}:
        return candidate
    return "official"


def _is_recipe_accessible(*, row: dict[str, Any], workspace_id: str, user_id: str) -> bool:
    scope_type = _normalize_scope_type(row.get("scope_type"))
    status = _normalize_status(row.get("status"))
    if status != "active":
        return False
    if scope_type == "system":
        return True
    if scope_type == "workspace":
        return _clean_optional_str(row.get("account_id")) == workspace_id
    if scope_type == "user":
        return (
            _clean_optional_str(row.get("account_id")) == workspace_id
            and _clean_optional_str(row.get("owner_user_id")) == user_id
        )
    return False


def _recipe_matches_query(recipe: InfographicRecipe, query: str) -> bool:
    needle = (query or "").strip().lower()
    if not needle:
        return True

    haystacks = [
        recipe.recipe_id,
        recipe.slug,
        recipe.name,
        recipe.description or "",
        " ".join(recipe.tags),
    ]
    return any(needle in (item or "").lower() for item in haystacks)
