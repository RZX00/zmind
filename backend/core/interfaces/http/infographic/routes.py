from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, Body, HTTPException, Query, Request
from pydantic import BaseModel, Field

from core.application.services.infographic_service import (
    listing_to_dict,
    preference_to_dict,
    recipe_to_dict,
    resolved_config_to_dict,
)
from core.utils.auth_utils import resolve_user_and_workspace
from core.services.supabase import DBConnection

from .service_bindings import get_infographic_service


router = APIRouter(tags=["infographic"])
infographic_service = get_infographic_service()


class InfographicPreferenceUpdateRequest(BaseModel):
    scope: Literal["user", "workspace"] = Field(default="user")
    default_recipe_id: Optional[str] = Field(default=None)
    default_custom_prompt: Optional[str] = Field(default=None)
    default_merge_mode: Optional[Literal["append", "prepend", "replace"]] = Field(default=None)
    default_style_lock: Optional[Literal["off", "soft", "strict"]] = Field(default=None)
    default_reference_image_file_id: Optional[str] = Field(default=None)


@router.get("/infographic/recipes")
async def list_infographic_recipes_route(
    request: Request,
    token: Optional[str] = None,
    query: Optional[str] = Query(default=None),
):
    user_id, workspace_id = await resolve_user_and_workspace(request, token)
    recipes = await infographic_service.list_recipes(
        workspace_id=workspace_id,
        user_id=user_id,
        query=query,
    )
    return {
        "recipes": [recipe_to_dict(recipe) for recipe in recipes],
        "count": len(recipes),
    }


@router.get("/infographic/recipes/{recipe_id}")
async def get_infographic_recipe_route(
    recipe_id: str,
    request: Request,
    token: Optional[str] = None,
):
    user_id, workspace_id = await resolve_user_and_workspace(request, token)
    recipe = await infographic_service.get_recipe(
        recipe_id=recipe_id,
        workspace_id=workspace_id,
        user_id=user_id,
    )
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe_to_dict(recipe)


@router.get("/infographic/market/listings")
async def list_infographic_market_listings_route(
    request: Request,
    token: Optional[str] = None,
    query: Optional[str] = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    user_id, workspace_id = await resolve_user_and_workspace(request, token)
    listings = await infographic_service.list_market_listings(
        workspace_id=workspace_id,
        user_id=user_id,
        query=query,
        limit=limit,
        offset=offset,
    )
    return {
        "listings": [listing_to_dict(item) for item in listings],
        "count": len(listings),
    }


@router.get("/infographic/preferences/defaults")
async def get_infographic_preferences_defaults_route(
    request: Request,
    token: Optional[str] = None,
):
    user_id, workspace_id = await resolve_user_and_workspace(request, token)
    bundle = await infographic_service.get_preferences_bundle(workspace_id=workspace_id, user_id=user_id)
    resolved = await infographic_service.resolve_generation_config(
        workspace_id=workspace_id,
        user_id=user_id,
        requested_recipe_id=None,
        requested_custom_prompt=None,
        requested_merge_mode=None,
        requested_style_lock=None,
    )
    return {
        "user": preference_to_dict(bundle.user_preference),
        "workspace": preference_to_dict(bundle.workspace_preference),
        "resolved": resolved_config_to_dict(resolved),
    }


@router.post("/infographic/preferences/defaults")
async def update_infographic_preferences_defaults_route(
    request: Request,
    payload: InfographicPreferenceUpdateRequest = Body(...),
    token: Optional[str] = None,
):
    user_id, workspace_id = await resolve_user_and_workspace(request, token)

    if payload.scope == "workspace":
        await _ensure_workspace_owner(workspace_id=workspace_id, user_id=user_id)

    patch: dict[str, Any] = {
        key: getattr(payload, key)
        for key in payload.model_fields_set
        if key
        in {
            "default_recipe_id",
            "default_custom_prompt",
            "default_merge_mode",
            "default_style_lock",
            "default_reference_image_file_id",
        }
    }
    if not patch:
        raise HTTPException(status_code=400, detail="No preference fields provided")

    try:
        saved = await infographic_service.update_preferences(
            workspace_id=workspace_id,
            user_id=user_id,
            scope=payload.scope,
            patch=patch,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"message": str(exc)})

    bundle = await infographic_service.get_preferences_bundle(workspace_id=workspace_id, user_id=user_id)
    resolved = await infographic_service.resolve_generation_config(
        workspace_id=workspace_id,
        user_id=user_id,
        requested_recipe_id=None,
        requested_custom_prompt=None,
        requested_merge_mode=None,
        requested_style_lock=None,
    )

    return {
        "saved_scope": payload.scope,
        "saved": preference_to_dict(saved),
        "user": preference_to_dict(bundle.user_preference),
        "workspace": preference_to_dict(bundle.workspace_preference),
        "resolved": resolved_config_to_dict(resolved),
    }


async def _ensure_workspace_owner(*, workspace_id: str, user_id: str) -> None:
    client = await DBConnection().client
    result = (
        await client.schema("basejump")
        .from_("account_user")
        .select("account_role")
        .eq("account_id", workspace_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    role = result.data[0].get("account_role") if result.data else None
    if role != "owner":
        raise HTTPException(status_code=403, detail="Only workspace owners can update workspace defaults")
