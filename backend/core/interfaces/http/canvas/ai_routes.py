from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Request

from core.canvas.api import (
    CanvasSelectionChatRequest,
    CanvasSelectionInfographicRequest,
    ExternalVideoMetadataRequest,
)
from core.interfaces.http.canvas.service_bindings import get_canvas_ai_service


router = APIRouter(tags=["canvas-ai"])
ai_service = get_canvas_ai_service()


@router.post("/canvases/{canvas_id}/selection-chat/stream")
async def stream_canvas_selection_chat_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
    payload: CanvasSelectionChatRequest = Body(...),
):
    return await ai_service.stream_canvas_selection_chat(
        canvas_id=canvas_id,
        request=request,
        token=token,
        payload=payload,
    )


@router.post("/canvases/{canvas_id}/selection-infographic/generate")
async def generate_selection_infographic_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
    payload: CanvasSelectionInfographicRequest = Body(...),
):
    return await ai_service.generate_selection_infographic(
        canvas_id=canvas_id,
        request=request,
        token=token,
        payload=payload,
    )


@router.post("/canvases/{canvas_id}/generate-title")
async def generate_canvas_title_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
    payload: Dict[str, Any] = Body(...),
):
    return await ai_service.generate_canvas_title(
        canvas_id=canvas_id,
        request=request,
        token=token,
        payload=payload,
    )


@router.post("/canvases/{canvas_id}/media/external-metadata")
async def resolve_external_video_metadata_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
    payload: ExternalVideoMetadataRequest = Body(...),
):
    return await ai_service.resolve_external_video_metadata(
        canvas_id=canvas_id,
        request=request,
        token=token,
        payload=payload,
    )


@router.post("/canvases/{canvas_id}/media/generate")
async def generate_canvas_media_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
    payload: Dict[str, Any] = Body(...),
):
    return await ai_service.generate_canvas_media(
        canvas_id=canvas_id,
        request=request,
        token=token,
        payload=payload,
    )
