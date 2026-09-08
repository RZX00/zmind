from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request

from core.utils.auth_utils import resolve_user_and_workspace
from core.utils.config import config
from core.utils.feature_flags import is_workspace_feature_enabled

from .api_models import BacklinksResponse, CreateReferenceRequest, ReferenceEdge, ResolveReferencesRequest, ResolveReferencesResponse, RefsSummary
from .service import ReferencesService


router = APIRouter(tags=["references"])
service = ReferencesService()


def _references_enabled(workspace_id: str) -> bool:
    return is_workspace_feature_enabled(
        enabled_globally=bool(getattr(config, "FEATURE_REFERENCES_ON", False)),
        workspace_id=workspace_id,
        allowlist=getattr(config, "FEATURE_REFERENCES_WORKSPACES", None),
    )


async def _resolve_context(request: Request, token: Optional[str]) -> tuple[str, str]:
    return await resolve_user_and_workspace(request, token)


@router.post("/references", response_model=ReferenceEdge)
async def create_reference(
    payload: CreateReferenceRequest,
    request: Request,
    token: Optional[str] = None,
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    user_id, workspace_id = await _resolve_context(request, token)
    if not _references_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="References API is disabled")

    return await service.create_reference(
        workspace_id=workspace_id,
        user_id=user_id,
        payload=payload,
        client_request_id=client_request_id,
    )


@router.delete("/references/{reference_id}")
async def delete_reference(
    reference_id: str,
    request: Request,
    token: Optional[str] = None,
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    user_id, workspace_id = await _resolve_context(request, token)
    if not _references_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="References API is disabled")

    await service.delete_reference(
        workspace_id=workspace_id,
        user_id=user_id,
        reference_id=reference_id,
        client_request_id=client_request_id,
    )
    return {"success": True}


@router.get("/references/backlinks", response_model=BacklinksResponse)
async def list_backlinks(
    request: Request,
    targetItemId: str = Query(...),
    targetAnchor: Optional[str] = Query(default=None),
    token: Optional[str] = None,
):
    user_id, workspace_id = await _resolve_context(request, token)
    _ = user_id
    if not _references_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="References API is disabled")

    refs = await service.list_backlinks(
        workspace_id=workspace_id,
        target_item_id=targetItemId,
        target_anchor=targetAnchor,
    )
    return BacklinksResponse(targetItemId=targetItemId, targetAnchor=targetAnchor, references=refs)


@router.post("/references/resolve", response_model=ResolveReferencesResponse)
async def resolve_references(
    payload: ResolveReferencesRequest,
    request: Request,
    token: Optional[str] = None,
):
    user_id, workspace_id = await _resolve_context(request, token)
    _ = user_id
    if not _references_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="References API is disabled")

    return await service.resolve_references(
        workspace_id=workspace_id,
        reference_ids=payload.referenceIds,
    )


@router.get("/references/summary", response_model=RefsSummary)
async def get_reference_summary(request: Request, token: Optional[str] = None):
    user_id, workspace_id = await _resolve_context(request, token)
    _ = user_id
    if not _references_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="References API is disabled")

    return await service.summarize_refs(workspace_id=workspace_id)
