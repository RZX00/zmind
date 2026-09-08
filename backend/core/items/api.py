from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request

from core.integrations.openclaw.service import (
    extract_openclaw_context,
    get_openclaw_integration_service,
)
from core.utils.auth_utils import resolve_user_and_workspace
from core.utils.config import config
from core.utils.feature_flags import is_workspace_feature_enabled

from .api_models import BackfillResult, CreateItemRequest, Item, ItemsListResponse, MoveItemRequest, UpdateItemRequest
from .service import ItemsService


router = APIRouter(tags=["items"])
service = ItemsService()
openclaw_service = get_openclaw_integration_service()


def _items_enabled(workspace_id: str) -> bool:
    return is_workspace_feature_enabled(
        enabled_globally=bool(getattr(config, "FEATURE_ITEM_MODEL_ON", False)),
        workspace_id=workspace_id,
        allowlist=getattr(config, "FEATURE_ITEM_MODEL_WORKSPACES", None),
    )


async def _resolve_context(request: Request, token: Optional[str]) -> tuple[str, str]:
    return await resolve_user_and_workspace(request, token)


@router.get("/items", response_model=ItemsListResponse)
async def list_items(
    request: Request,
    token: Optional[str] = None,
    type: Optional[str] = Query(default=None),
    folderId: Optional[str] = Query(default=None),
    parentItemId: Optional[str] = Query(default=None),
    includeDeleted: bool = Query(default=False),
):
    user_id, workspace_id = await _resolve_context(request, token)
    _ = user_id
    if not _items_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Items API is disabled")

    if type not in (None, "canvas", "doc"):
        raise HTTPException(status_code=400, detail="Invalid type filter")

    context = None
    if type == "doc" and extract_openclaw_context(request):
        context = await openclaw_service.ensure_request_allowed(
            request=request,
            user_id=user_id,
            workspace_id=workspace_id,
            capability="doc.read",
        )

    items = await service.list_items(
        workspace_id=workspace_id,
        item_type=type,
        folder_id=folderId,
        parent_item_id=parentItemId,
        include_deleted=includeDeleted,
    )
    if context:
        await openclaw_service.touch_verified(workspace_id=workspace_id, user_id=user_id)
    return ItemsListResponse(items=items, total=len(items))


@router.post("/items", response_model=Item)
async def create_item(
    payload: CreateItemRequest,
    request: Request,
    token: Optional[str] = None,
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    user_id, workspace_id = await _resolve_context(request, token)
    if not _items_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Items API is disabled")

    return await service.create_item(
        workspace_id=workspace_id,
        user_id=user_id,
        payload=payload,
        client_request_id=client_request_id,
    )


@router.get("/items/{item_id}", response_model=Item)
async def get_item(
    item_id: str,
    request: Request,
    token: Optional[str] = None,
):
    user_id, workspace_id = await _resolve_context(request, token)
    _ = user_id
    if not _items_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Items API is disabled")

    item = await service.get_item(workspace_id=workspace_id, item_id=item_id)
    if not item or item.isDeleted:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.put("/items/{item_id}", response_model=Item)
async def update_item(
    item_id: str,
    payload: UpdateItemRequest,
    request: Request,
    token: Optional[str] = None,
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    user_id, workspace_id = await _resolve_context(request, token)
    if not _items_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Items API is disabled")

    return await service.update_item(
        workspace_id=workspace_id,
        user_id=user_id,
        item_id=item_id,
        payload=payload,
        client_request_id=client_request_id,
    )


@router.post("/items/{item_id}/move", response_model=Item)
async def move_item(
    item_id: str,
    payload: MoveItemRequest,
    request: Request,
    token: Optional[str] = None,
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    user_id, workspace_id = await _resolve_context(request, token)
    if not _items_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Items API is disabled")

    return await service.move_item(
        workspace_id=workspace_id,
        user_id=user_id,
        item_id=item_id,
        payload=payload,
        client_request_id=client_request_id,
    )


@router.delete("/items/{item_id}")
async def delete_item(
    item_id: str,
    request: Request,
    token: Optional[str] = None,
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    user_id, workspace_id = await _resolve_context(request, token)
    if not _items_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Items API is disabled")

    await service.delete_item(
        workspace_id=workspace_id,
        user_id=user_id,
        item_id=item_id,
        client_request_id=client_request_id,
    )
    return {"success": True}


@router.post("/items/backfill/canvases", response_model=BackfillResult)
async def backfill_items_from_canvases(
    request: Request,
    token: Optional[str] = None,
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    user_id, workspace_id = await _resolve_context(request, token)
    if not _items_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Items API is disabled")

    return await service.backfill_canvas_items(
        workspace_id=workspace_id,
        user_id=user_id,
        client_request_id=client_request_id,
    )
