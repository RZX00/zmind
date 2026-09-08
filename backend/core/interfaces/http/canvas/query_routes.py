from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Query, Request

from core.canvas.api_models import CanvasDoc, CanvasMeta, CanvasVersion
from core.interfaces.http.canvas.service_bindings import get_canvas_query_service
from core.integrations.openclaw.service import (
    extract_openclaw_context,
    get_openclaw_integration_service,
)
from core.utils.auth_utils import resolve_user_and_workspace


router = APIRouter(tags=["canvas-query"])
query_service = get_canvas_query_service()
openclaw_service = get_openclaw_integration_service()


@router.get("/canvases", response_model=List[CanvasDoc], response_model_exclude_none=True)
async def list_canvases_route(
    request: Request,
    token: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    deleted: Optional[str] = None,
):
    context = extract_openclaw_context(request)
    user_id = None
    workspace_id = None
    if context:
        user_id, workspace_id = await resolve_user_and_workspace(request, token)
        await openclaw_service.ensure_request_allowed(
            request=request,
            user_id=user_id,
            workspace_id=workspace_id,
            capability="canvas.read",
        )
    result = await query_service.list_canvases(
        request=request,
        token=token,
        limit=limit,
        offset=offset,
        deleted=deleted,
    )
    if context and user_id and workspace_id:
        await openclaw_service.touch_verified(workspace_id=workspace_id, user_id=user_id)
    return result


@router.get("/canvases/meta", response_model=List[CanvasMeta], response_model_exclude_none=True)
async def list_canvas_meta_route(
    request: Request,
    token: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
):
    return await query_service.list_canvas_meta(
        request=request,
        token=token,
        limit=limit,
        offset=offset,
    )


@router.get("/canvases/trash")
async def list_deleted_canvases_with_meta_route(
    request: Request,
    token: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    retention_days: int = 15,
    q: Optional[str] = None,
    sort_by: Optional[str] = Query(default="deleted_at", pattern=r"^(deleted_at|title|node_count)$"),
    sort_dir: Optional[str] = Query(default="desc", pattern=r"^(asc|desc)$"),
):
    return await query_service.list_deleted_canvases_with_meta(
        request=request,
        token=token,
        limit=limit,
        offset=offset,
        retention_days=retention_days,
        q=q,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


@router.get("/canvases/{canvas_id}", response_model=CanvasDoc, response_model_exclude_none=True)
async def get_canvas_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
):
    context = extract_openclaw_context(request)
    user_id = None
    workspace_id = None
    if context:
        user_id, workspace_id = await resolve_user_and_workspace(request, token)
        await openclaw_service.ensure_request_allowed(
            request=request,
            user_id=user_id,
            workspace_id=workspace_id,
            capability="canvas.read",
        )
    result = await query_service.get_canvas(canvas_id=canvas_id, request=request, token=token)
    if context and user_id and workspace_id:
        await openclaw_service.touch_verified(workspace_id=workspace_id, user_id=user_id)
    return result


@router.get("/canvases/{canvas_id}/snapshot")
async def get_canvas_snapshot_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
):
    return await query_service.get_canvas_snapshot(canvas_id=canvas_id, request=request, token=token)


@router.head("/canvases/{canvas_id}")
async def head_canvas_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
):
    return await query_service.head_canvas(canvas_id=canvas_id, request=request, token=token)


@router.get("/canvases/{canvas_id}/versions", response_model=List[CanvasVersion], response_model_exclude_none=True)
async def list_canvas_versions_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
    limit: Optional[int] = None,
    is_auto_save: Optional[bool] = None,
    order_direction: Optional[str] = "desc",
):
    return await query_service.list_canvas_versions(
        canvas_id=canvas_id,
        request=request,
        token=token,
        limit=limit,
        is_auto_save=is_auto_save,
        order_direction=order_direction,
    )


@router.get("/canvases/{canvas_id}/thread")
async def get_canvas_thread_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
):
    return await query_service.get_canvas_thread(canvas_id=canvas_id, request=request, token=token)
