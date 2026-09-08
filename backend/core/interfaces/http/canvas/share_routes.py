from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Body, Request

from core.canvas.api import (
    CanvasInviteCreateRequest,
    CanvasInviteVerifyRequest,
    CanvasShareUpdateRequest,
)
from core.canvas.api_models import CanvasDoc, CanvasVersion
from core.interfaces.http.canvas.service_bindings import get_canvas_share_service


router = APIRouter(tags=["canvas-share"])
share_service = get_canvas_share_service()


@router.post("/canvases/{canvas_id}/invites")
async def create_canvas_invite_route(
    canvas_id: str,
    payload: CanvasInviteCreateRequest,
    request: Request,
    token: Optional[str] = None,
):
    return await share_service.create_canvas_invite(
        canvas_id=canvas_id,
        payload=payload,
        request=request,
        token=token,
    )


@router.get("/canvases/{canvas_id}/invites")
async def list_canvas_invites_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
):
    return await share_service.list_canvas_invites(canvas_id=canvas_id, request=request, token=token)


@router.post("/canvases/{canvas_id}/invites/{invite_id}/revoke")
async def revoke_canvas_invite_route(
    canvas_id: str,
    invite_id: str,
    request: Request,
    token: Optional[str] = None,
):
    return await share_service.revoke_canvas_invite(
        canvas_id=canvas_id,
        invite_id=invite_id,
        request=request,
        token=token,
    )


@router.post("/canvases/{canvas_id}/invite/verify")
async def verify_canvas_invite_route(
    canvas_id: str,
    payload: CanvasInviteVerifyRequest,
    request: Request,
):
    return await share_service.verify_canvas_invite(
        canvas_id=canvas_id,
        payload=payload,
        request=request,
    )


@router.get("/canvases/share/health")
async def get_canvas_share_health_route(
    request: Request,
    token: Optional[str] = None,
):
    return await share_service.get_canvas_share_health(request=request, token=token)


@router.get("/canvases/{canvas_id}/share")
async def get_canvas_share_status_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
):
    return await share_service.get_canvas_share_status(canvas_id=canvas_id, request=request, token=token)


@router.post("/canvases/{canvas_id}/share")
async def update_canvas_share_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
    payload: CanvasShareUpdateRequest = Body(...),
):
    return await share_service.update_canvas_share(
        canvas_id=canvas_id,
        request=request,
        token=token,
        payload=payload,
    )


@router.get("/public/canvases/{canvas_id}/snapshot", response_model=CanvasDoc, response_model_exclude_none=True)
async def get_public_canvas_snapshot_route(
    canvas_id: str,
):
    return await share_service.get_public_canvas_snapshot(canvas_id=canvas_id)


@router.get("/public/canvases/{canvas_id}/versions", response_model=List[CanvasVersion], response_model_exclude_none=True)
async def list_public_canvas_versions_route(
    canvas_id: str,
    order_direction: Optional[str] = "asc",
    limit: Optional[int] = None,
):
    return await share_service.list_public_canvas_versions(
        canvas_id=canvas_id,
        order_direction=order_direction,
        limit=limit,
    )


@router.get("/public/canvases/{canvas_id}/timeline")
async def list_public_canvas_timeline_route(
    canvas_id: str,
    order_direction: Optional[str] = "asc",
    limit: Optional[int] = 500,
):
    return await share_service.list_public_canvas_timeline(
        canvas_id=canvas_id,
        order_direction=order_direction,
        limit=limit,
    )
