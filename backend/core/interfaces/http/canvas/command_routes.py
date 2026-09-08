from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Header, Request

from core.canvas.api_models import (
    CanvasApplyRequest,
    CanvasCreate,
    CanvasDoc,
    CanvasVersion,
    SaveCanvasVersionRequest,
)
from core.interfaces.http.canvas.service_bindings import get_canvas_command_service
from core.integrations.openclaw.service import (
    extract_openclaw_context,
    get_openclaw_integration_service,
)
from core.utils.auth_utils import resolve_user_and_workspace


router = APIRouter(tags=["canvas-command"])
command_service = get_canvas_command_service()
openclaw_service = get_openclaw_integration_service()


@router.post("/canvases", response_model=CanvasDoc, response_model_exclude_none=True)
async def create_canvas_route(
    payload: CanvasCreate,
    request: Request,
    token: Optional[str] = None,
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
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
            capability="canvas.create",
        )
    result = await command_service.create_canvas(
        payload=payload,
        request=request,
        token=token,
        client_request_id=client_request_id,
    )
    if context and user_id and workspace_id:
        await openclaw_service.record_activity(
            workspace_id=workspace_id,
            actor_id=user_id,
            operation_key="canvas.create",
            resource_type="canvas",
            resource_id=str(result.id),
            summary=f'Created canvas "{result.title}" via OpenClaw',
            metadata={
                "node_count": len(result.nodes or []),
                "connection_count": len(result.connections or []),
            },
            rollback_payload={
                "kind": "canvas.delete",
                "canvas_id": str(result.id),
            },
            request=request,
        )
    return result


@router.put("/canvases/{canvas_id}", response_model=CanvasDoc, response_model_exclude_none=True)
async def update_canvas_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
    expected_version: Optional[str] = Header(default=None, alias="If-Match"),
):
    return await command_service.update_canvas(
        canvas_id=canvas_id,
        request=request,
        token=token,
        expected_version=expected_version,
    )


@router.post("/canvases/{canvas_id}/apply")
async def apply_canvas_operations_route(
    canvas_id: str,
    payload: CanvasApplyRequest,
    request: Request,
    token: Optional[str] = None,
    expected_version: Optional[str] = Header(default=None, alias="If-Match"),
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
            capability="canvas.write",
        )
    rollback_version = None
    if context:
        rollback_version = await command_service.save_canvas_version(
            canvas_id=canvas_id,
            payload=SaveCanvasVersionRequest(
                is_auto_save=False,
                description="OpenClaw rollback checkpoint",
            ),
            request=request,
            token=token,
        )
    result = await command_service.apply_canvas_operations(
        canvas_id=canvas_id,
        payload=payload,
        request=request,
        token=token,
        expected_version=expected_version,
    )
    if context and user_id and workspace_id:
        operations = payload.operations if isinstance(payload.operations, list) else []
        await openclaw_service.record_activity(
            workspace_id=workspace_id,
            actor_id=user_id,
            operation_key="canvas.apply",
            resource_type="canvas",
            resource_id=canvas_id,
            summary=f"Applied {len(operations)} canvas operation(s) via OpenClaw",
            metadata={
                "operations_count": len(operations),
                "expected_version": expected_version,
                "server_version": result.get("serverVersion") if isinstance(result, dict) else None,
                "tool_name": context.get("tool_name"),
            },
            rollback_payload={
                "kind": "canvas.restore_version",
                "version_id": str(rollback_version.id) if rollback_version else None,
            } if rollback_version else None,
            request=request,
        )
    return result


@router.delete("/canvases/{canvas_id}")
async def delete_canvas_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
):
    return await command_service.delete_canvas(canvas_id=canvas_id, request=request, token=token)


@router.post("/canvases/{canvas_id}/versions", response_model=CanvasVersion, response_model_exclude_none=True)
async def save_canvas_version_route(
    canvas_id: str,
    payload: SaveCanvasVersionRequest,
    request: Request,
    token: Optional[str] = None,
):
    return await command_service.save_canvas_version(
        canvas_id=canvas_id,
        payload=payload,
        request=request,
        token=token,
    )


@router.post("/canvases/versions/{version_id}/restore", response_model=CanvasDoc, response_model_exclude_none=True)
async def restore_canvas_version_route(
    version_id: str,
    request: Request,
    token: Optional[str] = None,
):
    return await command_service.restore_canvas_version(version_id=version_id, request=request, token=token)


@router.delete("/canvases/versions/{version_id}")
async def delete_canvas_version_route(
    version_id: str,
    request: Request,
    token: Optional[str] = None,
):
    return await command_service.delete_canvas_version(version_id=version_id, request=request, token=token)


@router.post("/canvases/{canvas_id}/restore", response_model=CanvasDoc, response_model_exclude_none=True)
async def restore_canvas_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
):
    return await command_service.restore_canvas(canvas_id=canvas_id, request=request, token=token)


@router.post("/canvases/purge")
async def purge_deleted_canvases_route(
    days: int = Body(15, embed=True),
    request: Request = None,
    token: Optional[str] = None,
):
    return await command_service.purge_deleted_canvases(days=days, request=request, token=token)


@router.delete("/canvases/{canvas_id}/purge")
async def hard_delete_canvas_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
):
    return await command_service.hard_delete_canvas(canvas_id=canvas_id, request=request, token=token)


@router.post("/canvases/restore-batch")
async def restore_canvases_batch_route(
    payload: Dict[str, Any] = Body(...),
    request: Request = None,
    token: Optional[str] = None,
):
    return await command_service.restore_canvases_batch(payload=payload, request=request, token=token)


@router.post("/canvases/purge-by-ids")
async def purge_canvases_by_ids_route(
    payload: Dict[str, Any] = Body(...),
    request: Request = None,
    token: Optional[str] = None,
):
    return await command_service.purge_canvases_by_ids(payload=payload, request=request, token=token)


@router.post("/canvases/{canvas_id}/ensure-thread")
async def ensure_thread_for_canvas_route(
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
):
    return await command_service.ensure_thread_for_canvas(canvas_id=canvas_id, request=request, token=token)
