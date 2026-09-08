from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from typing import Any, Optional

from core.domains.infographic.model import (
    DEFAULT_MERGE_MODE,
    DEFAULT_STYLE_LOCK,
    DEFAULT_SYSTEM_RECIPE_ID,
    InfographicGenerationRecord,
    InfographicMarketListing,
    InfographicPreferences,
    InfographicPreferencesBundle,
    InfographicRecipe,
    MergeMode,
    PreferenceScope,
    ResolvedInfographicConfig,
    StyleLock,
    normalize_merge_mode,
    normalize_style_lock,
)
from core.domains.infographic.ports.infographic_repository import InfographicRepository
from core.utils.logger import logger


@dataclass(frozen=True)
class InfographicServiceDependencies:
    repository: InfographicRepository


class InfographicService:
    def __init__(self, deps: InfographicServiceDependencies) -> None:
        self.deps = deps

    async def list_recipes(
        self,
        *,
        workspace_id: str,
        user_id: str,
        query: Optional[str] = None,
    ) -> list[InfographicRecipe]:
        return await self.deps.repository.list_accessible_recipes(
            workspace_id=workspace_id,
            user_id=user_id,
            query=query,
            include_disabled=False,
        )

    async def get_recipe(
        self,
        *,
        recipe_id: str,
        workspace_id: str,
        user_id: str,
    ) -> Optional[InfographicRecipe]:
        return await self.deps.repository.get_accessible_recipe(
            recipe_id=recipe_id,
            workspace_id=workspace_id,
            user_id=user_id,
        )

    async def list_market_listings(
        self,
        *,
        workspace_id: str,
        user_id: str,
        query: Optional[str] = None,
        limit: int = 30,
        offset: int = 0,
    ) -> list[InfographicMarketListing]:
        return await self.deps.repository.list_market_listings(
            workspace_id=workspace_id,
            user_id=user_id,
            query=query,
            limit=limit,
            offset=offset,
        )

    async def get_preferences_bundle(
        self,
        *,
        workspace_id: str,
        user_id: str,
    ) -> InfographicPreferencesBundle:
        return await self.deps.repository.get_preferences(workspace_id=workspace_id, user_id=user_id)

    async def update_preferences(
        self,
        *,
        workspace_id: str,
        user_id: str,
        scope: PreferenceScope,
        patch: dict[str, Any],
    ) -> InfographicPreferences:
        bundle = await self.get_preferences_bundle(workspace_id=workspace_id, user_id=user_id)
        current = bundle.user_preference if scope == "user" else bundle.workspace_preference

        base = current or InfographicPreferences(
            account_id=workspace_id,
            user_id=user_id if scope == "user" else None,
            default_recipe_id=None,
            default_custom_prompt=None,
            default_merge_mode=DEFAULT_MERGE_MODE,
            default_style_lock=DEFAULT_STYLE_LOCK,
        )

        default_recipe_id = base.default_recipe_id
        if "default_recipe_id" in patch:
            default_recipe_id = _clean_optional_text(patch.get("default_recipe_id"))
            if default_recipe_id:
                recipe = await self.get_recipe(recipe_id=default_recipe_id, workspace_id=workspace_id, user_id=user_id)
                if not recipe:
                    raise ValueError("Selected recipe does not exist or is not accessible")

        default_custom_prompt = base.default_custom_prompt
        if "default_custom_prompt" in patch:
            default_custom_prompt = _clean_optional_text(patch.get("default_custom_prompt"), max_len=1600)

        default_merge_mode = base.default_merge_mode
        if "default_merge_mode" in patch:
            default_merge_mode = _strict_merge_mode(patch.get("default_merge_mode"))

        default_style_lock = base.default_style_lock
        if "default_style_lock" in patch:
            default_style_lock = _strict_style_lock(patch.get("default_style_lock"))

        default_reference_image_file_id = base.default_reference_image_file_id
        if "default_reference_image_file_id" in patch:
            default_reference_image_file_id = _clean_optional_text(patch.get("default_reference_image_file_id"))

        preference = InfographicPreferences(
            account_id=workspace_id,
            user_id=user_id if scope == "user" else None,
            default_recipe_id=default_recipe_id,
            default_custom_prompt=default_custom_prompt,
            default_merge_mode=default_merge_mode,
            default_style_lock=default_style_lock,
            default_reference_image_file_id=default_reference_image_file_id,
        )

        return await self.deps.repository.save_preferences(
            workspace_id=workspace_id,
            user_id=user_id,
            scope=scope,
            preference=preference,
        )

    async def resolve_generation_config(
        self,
        *,
        workspace_id: str,
        user_id: str,
        requested_recipe_id: Optional[str],
        requested_custom_prompt: Optional[str],
        requested_merge_mode: Optional[str] = None,
        requested_style_lock: Optional[str] = None,
        requested_reference_image_file_id: Optional[str] = None,
    ) -> ResolvedInfographicConfig:
        bundle = await self.get_preferences_bundle(workspace_id=workspace_id, user_id=user_id)

        recipe, recipe_source = await self._resolve_recipe(
            workspace_id=workspace_id,
            user_id=user_id,
            requested_recipe_id=requested_recipe_id,
            bundle=bundle,
        )

        custom_prompt, custom_prompt_source = self._resolve_custom_prompt(
            requested_custom_prompt=requested_custom_prompt,
            bundle=bundle,
        )

        # merge_mode and style_lock are hardcoded for simplicity and consistency
        merge_mode: MergeMode = DEFAULT_MERGE_MODE  # "prepend"
        merge_mode_source = "hardcoded"
        style_lock: StyleLock = DEFAULT_STYLE_LOCK  # "strict"
        style_lock_source = "hardcoded"

        reference_image_file_id, reference_image_source = self._resolve_reference_image(
            requested_reference_image_file_id=requested_reference_image_file_id,
            bundle=bundle,
        )

        return ResolvedInfographicConfig(
            recipe=recipe,
            recipe_source=recipe_source,
            custom_prompt=custom_prompt,
            custom_prompt_source=custom_prompt_source,
            merge_mode=merge_mode,
            merge_mode_source=merge_mode_source,
            style_lock=style_lock,
            style_lock_source=style_lock_source,
            reference_image_file_id=reference_image_file_id,
            reference_image_source=reference_image_source,
        )

    def build_system_prompt_directive(
        self,
        *,
        resolved: ResolvedInfographicConfig,
        is_chinese: bool,
    ) -> str:
        recipe = resolved.recipe
        recipe_name = recipe.name if recipe else "System Default"
        recipe_id = recipe.recipe_id if recipe else DEFAULT_SYSTEM_RECIPE_ID
        prompt_template = recipe.latest_version.prompt_template if recipe and recipe.latest_version else ""

        style_manifest: dict[str, Any] = {}
        if recipe and recipe.latest_version and isinstance(recipe.latest_version.style_manifest, dict):
            style_manifest = recipe.latest_version.style_manifest
        style_manifest_json = json.dumps(style_manifest, ensure_ascii=False, sort_keys=True)

        if is_chinese:
            lock_desc = {
                "strict": "严格锁定风格：除非影响可读性，不得偏离该风格描述。",
                "soft": "柔性锁定风格：优先遵循该风格，但可为内容可读性做适度调整。",
                "off": "风格锁关闭：风格仅作参考。",
            }.get(resolved.style_lock, "柔性锁定风格：优先遵循该风格，但可为内容可读性做适度调整。")
            custom_line = f"用户自定义提示：{resolved.custom_prompt}" if resolved.custom_prompt else "用户自定义提示：无"
            ref_line = "\n参考图片已提供：请分析参考图的视觉风格（配色、排版、图形元素、字体风格等）并在生成中复现。" if resolved.reference_image_file_id else ""
            return (
                "\n\n[信息图风格指令]\n"
                f"当前 Recipe: {recipe_name} ({recipe_id})\n"
                f"Recipe Prompt: {prompt_template}\n"
                f"Recipe Style Manifest(JSON): {style_manifest_json}\n"
                f"合并模式: {resolved.merge_mode}\n"
                f"{lock_desc}\n"
                f"{custom_line}"
                f"{ref_line}\n"
                "在保持原始内容语义准确的前提下，优先满足上述风格与结构要求。"
            )

        lock_desc = {
            "strict": "Strict style lock: do not deviate from the recipe style unless readability would break.",
            "soft": "Soft style lock: follow the recipe by default; adapt moderately for readability.",
            "off": "Style lock is off: recipe style is advisory only.",
        }.get(resolved.style_lock, "Soft style lock: follow the recipe by default; adapt moderately for readability.")

        custom_line = f"Custom user instruction: {resolved.custom_prompt}" if resolved.custom_prompt else "Custom user instruction: none"
        ref_line = "\nA reference image has been provided: analyze its visual style (color palette, layout, graphic elements, typography) and replicate it." if resolved.reference_image_file_id else ""
        return (
            "\n\n[Infographic Recipe Directive]\n"
            f"Selected recipe: {recipe_name} ({recipe_id})\n"
            f"Recipe prompt template: {prompt_template}\n"
            f"Recipe style manifest (JSON): {style_manifest_json}\n"
            f"Merge mode: {resolved.merge_mode}\n"
            f"{lock_desc}\n"
            f"{custom_line}"
            f"{ref_line}\n"
            "Preserve factual semantics from the source selection while honoring these style constraints."
        )

    def build_user_content(
        self,
        *,
        selection_markdown: str,
        resolved: ResolvedInfographicConfig,
        is_chinese: bool,
    ) -> str:
        custom = (resolved.custom_prompt or "").strip()
        if not custom:
            return selection_markdown

        if is_chinese:
            if resolved.merge_mode == "prepend":
                return (
                    "用户自定义要求（优先考虑）：\n"
                    f"{custom}\n\n"
                    "源内容（必须保留核心语义）：\n"
                    f"{selection_markdown}"
                )
            if resolved.merge_mode == "replace":
                return (
                    "用户自定义要求（主导风格与构图）：\n"
                    f"{custom}\n\n"
                    "源内容（必须转化并完整表达其信息关系）：\n"
                    f"{selection_markdown}"
                )
            return (
                "源内容：\n"
                f"{selection_markdown}\n\n"
                "用户附加要求：\n"
                f"{custom}"
            )

        if resolved.merge_mode == "prepend":
            return (
                "Custom instruction (prioritize this):\n"
                f"{custom}\n\n"
                "Source content (must preserve core semantics):\n"
                f"{selection_markdown}"
            )
        if resolved.merge_mode == "replace":
            return (
                "Custom instruction (authoritative for style/composition):\n"
                f"{custom}\n\n"
                "Source content (must still be fully represented):\n"
                f"{selection_markdown}"
            )
        return (
            "Source content:\n"
            f"{selection_markdown}\n\n"
            "Additional custom instruction:\n"
            f"{custom}"
        )

    def compute_generation_fingerprint(
        self,
        *,
        canvas_id: str,
        selection_markdown: str,
        resolved: ResolvedInfographicConfig,
        llm_model: str,
        image_model: str,
        aspect_ratio: str,
    ) -> tuple[str, str]:
        selection_hash = hashlib.sha256(selection_markdown.encode("utf-8")).hexdigest()
        payload = {
            "canvas_id": canvas_id,
            "selection_hash": selection_hash,
            "recipe_id": resolved.recipe.recipe_id if resolved.recipe else None,
            "recipe_version": resolved.recipe.latest_version.version if resolved.recipe and resolved.recipe.latest_version else None,
            "custom_prompt": resolved.custom_prompt,
            "merge_mode": resolved.merge_mode,
            "style_lock": resolved.style_lock,
            "reference_image_file_id": resolved.reference_image_file_id,
            "llm_model": llm_model,
            "image_model": image_model,
            "aspect_ratio": aspect_ratio,
        }
        text = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        fingerprint = hashlib.sha256(text.encode("utf-8")).hexdigest()
        return fingerprint, selection_hash

    async def record_generation(
        self,
        *,
        generation_id: str,
        canvas_id: str,
        workspace_id: str,
        user_id: str,
        resolved: ResolvedInfographicConfig,
        fingerprint: str,
        selection_hash: str,
        llm_model: str,
        image_model: str,
        aspect_ratio: str,
        image_prompt: str,
        status: str = "succeeded",
        error_message: Optional[str] = None,
    ) -> None:
        recipe = resolved.recipe
        record = InfographicGenerationRecord(
            generation_id=generation_id,
            canvas_id=canvas_id,
            account_id=workspace_id,
            user_id=user_id,
            recipe_id=recipe.recipe_id if recipe else None,
            recipe_version=recipe.latest_version.version if recipe and recipe.latest_version else None,
            merge_mode=resolved.merge_mode,
            style_lock=resolved.style_lock,
            fingerprint=fingerprint,
            selection_hash=selection_hash,
            custom_prompt=resolved.custom_prompt,
            llm_model=llm_model,
            image_model=image_model,
            aspect_ratio=aspect_ratio,
            image_prompt=image_prompt,
            reference_image_file_id=resolved.reference_image_file_id,
            status="failed" if status == "failed" else "succeeded",
            error_message=error_message,
        )
        await self.deps.repository.create_generation_record(record=record)

    async def _resolve_recipe(
        self,
        *,
        workspace_id: str,
        user_id: str,
        requested_recipe_id: Optional[str],
        bundle: InfographicPreferencesBundle,
    ) -> tuple[Optional[InfographicRecipe], str]:
        requested = _clean_optional_text(requested_recipe_id)
        if requested:
            recipe = await self.get_recipe(recipe_id=requested, workspace_id=workspace_id, user_id=user_id)
            if not recipe:
                raise ValueError("Selected recipe does not exist or is not accessible")
            return recipe, "temporary"

        candidates: list[tuple[str, Optional[str]]] = [
            ("user_default", bundle.user_preference.default_recipe_id if bundle.user_preference else None),
            ("workspace_default", bundle.workspace_preference.default_recipe_id if bundle.workspace_preference else None),
            ("system_default", DEFAULT_SYSTEM_RECIPE_ID),
        ]

        for source, candidate in candidates:
            normalized = _clean_optional_text(candidate)
            if not normalized:
                continue
            recipe = await self.get_recipe(recipe_id=normalized, workspace_id=workspace_id, user_id=user_id)
            if recipe:
                return recipe, source
            logger.info(
                "Skipping inaccessible infographic default recipe",
                source=source,
                recipe_id=normalized,
                workspace_id=workspace_id,
                user_id=user_id,
            )

        return None, "fallback_none"

    def _resolve_custom_prompt(
        self,
        *,
        requested_custom_prompt: Optional[str],
        bundle: InfographicPreferencesBundle,
    ) -> tuple[Optional[str], str]:
        requested = _clean_optional_text(requested_custom_prompt, max_len=1600)
        if requested_custom_prompt is not None:
            return requested, "temporary"

        user_default = _clean_optional_text(bundle.user_preference.default_custom_prompt, max_len=1600) if bundle.user_preference else None
        if user_default:
            return user_default, "user_default"

        workspace_default = (
            _clean_optional_text(bundle.workspace_preference.default_custom_prompt, max_len=1600)
            if bundle.workspace_preference
            else None
        )
        if workspace_default:
            return workspace_default, "workspace_default"

        return None, "system_default"

    def _resolve_reference_image(
        self,
        *,
        requested_reference_image_file_id: Optional[str],
        bundle: InfographicPreferencesBundle,
    ) -> tuple[Optional[str], str]:
        requested = _clean_optional_text(requested_reference_image_file_id)
        if requested_reference_image_file_id is not None:
            return requested, "temporary"

        user_default = (
            _clean_optional_text(bundle.user_preference.default_reference_image_file_id)
            if bundle.user_preference
            else None
        )
        if user_default:
            return user_default, "user_default"

        workspace_default = (
            _clean_optional_text(bundle.workspace_preference.default_reference_image_file_id)
            if bundle.workspace_preference
            else None
        )
        if workspace_default:
            return workspace_default, "workspace_default"

        return None, "system_default"

    def _resolve_merge_mode(
        self,
        *,
        requested_merge_mode: Optional[str],
        bundle: InfographicPreferencesBundle,
    ) -> tuple[MergeMode, str]:
        if requested_merge_mode is not None:
            return _strict_merge_mode(requested_merge_mode), "temporary"

        if bundle.user_preference:
            return normalize_merge_mode(bundle.user_preference.default_merge_mode), "user_default"

        if bundle.workspace_preference:
            return normalize_merge_mode(bundle.workspace_preference.default_merge_mode), "workspace_default"

        return DEFAULT_MERGE_MODE, "system_default"

    def _resolve_style_lock(
        self,
        *,
        requested_style_lock: Optional[str],
        bundle: InfographicPreferencesBundle,
    ) -> tuple[StyleLock, str]:
        if requested_style_lock is not None:
            return _strict_style_lock(requested_style_lock), "temporary"

        if bundle.user_preference:
            return normalize_style_lock(bundle.user_preference.default_style_lock), "user_default"

        if bundle.workspace_preference:
            return normalize_style_lock(bundle.workspace_preference.default_style_lock), "workspace_default"

        return DEFAULT_STYLE_LOCK, "system_default"


def _strict_merge_mode(value: Any) -> MergeMode:
    candidate = (str(value or "").strip().lower())
    if candidate in {"append", "prepend", "replace"}:
        return candidate  # type: ignore[return-value]
    raise ValueError("Invalid merge mode")


def _strict_style_lock(value: Any) -> StyleLock:
    candidate = (str(value or "").strip().lower())
    if candidate in {"off", "soft", "strict"}:
        return candidate  # type: ignore[return-value]
    raise ValueError("Invalid style lock")


def _clean_optional_text(value: Any, *, max_len: Optional[int] = None) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    text = value.strip()
    if not text:
        return None
    if max_len and len(text) > max_len:
        text = text[:max_len]
    return text


def recipe_to_dict(recipe: InfographicRecipe) -> dict[str, Any]:
    version = recipe.latest_version
    return {
        "recipe_id": recipe.recipe_id,
        "scope_type": recipe.scope_type,
        "visibility": recipe.visibility,
        "account_id": recipe.account_id,
        "owner_user_id": recipe.owner_user_id,
        "slug": recipe.slug,
        "name": recipe.name,
        "description": recipe.description,
        "locale": recipe.locale,
        "tags": recipe.tags,
        "cover_url": recipe.cover_url,
        "status": recipe.status,
        "latest_version": {
            "version": version.version,
            "prompt_template": version.prompt_template,
            "style_manifest": version.style_manifest,
            "metadata": version.metadata,
            "is_published": version.is_published,
            "created_at": version.created_at,
        }
        if version
        else None,
    }


def preference_to_dict(pref: Optional[InfographicPreferences]) -> Optional[dict[str, Any]]:
    if not pref:
        return None
    return {
        "account_id": pref.account_id,
        "user_id": pref.user_id,
        "default_recipe_id": pref.default_recipe_id,
        "default_custom_prompt": pref.default_custom_prompt,
        "default_merge_mode": pref.default_merge_mode,
        "default_style_lock": pref.default_style_lock,
        "default_reference_image_file_id": pref.default_reference_image_file_id,
    }


def listing_to_dict(listing: InfographicMarketListing) -> dict[str, Any]:
    return {
        "listing_id": listing.listing_id,
        "recipe_id": listing.recipe_id,
        "listing_type": listing.listing_type,
        "account_id": listing.account_id,
        "badge": listing.badge,
        "rank": listing.rank,
        "featured": listing.featured,
        "is_active": listing.is_active,
        "recipe": recipe_to_dict(listing.recipe) if listing.recipe else None,
    }


def resolved_config_to_dict(resolved: ResolvedInfographicConfig) -> dict[str, Any]:
    return {
        "recipe_id": resolved.recipe.recipe_id if resolved.recipe else None,
        "recipe_version": resolved.recipe.latest_version.version if resolved.recipe and resolved.recipe.latest_version else None,
        "recipe_source": resolved.recipe_source,
        "custom_prompt": resolved.custom_prompt,
        "custom_prompt_source": resolved.custom_prompt_source,
        "merge_mode": resolved.merge_mode,
        "merge_mode_source": resolved.merge_mode_source,
        "style_lock": resolved.style_lock,
        "style_lock_source": resolved.style_lock_source,
        "reference_image_file_id": resolved.reference_image_file_id,
        "reference_image_source": resolved.reference_image_source,
        "resolved_at": datetime.now(timezone.utc).isoformat(),
    }
