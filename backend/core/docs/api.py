from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from core.integrations.openclaw.service import (
    extract_openclaw_context,
    get_openclaw_integration_service,
)
from core.utils.auth_utils import resolve_user_and_workspace
from core.utils.config import config
from core.utils.feature_flags import is_workspace_feature_enabled

from .api_models import (
    ApplyDocOpsRequest,
    ApplyDocOpsResponse,
    CreateDocRequest,
    DocBlocksResponse,
    DocContent,
    DocImageResponse,
    DocRevision,
    DocRevisionListResponse,
    EnsureDocThreadResponse,
    PeekDocThreadResponse,
    UndoDocRevisionRequest,
    UpdateDocRequest,
    UpdateDocResponse,
)
from .service import DocsService


router = APIRouter(tags=["docs"])
service = DocsService()
openclaw_service = get_openclaw_integration_service()


def _docs_enabled(workspace_id: str) -> bool:
    return is_workspace_feature_enabled(
        enabled_globally=bool(getattr(config, "FEATURE_DOCS_ON", False)),
        workspace_id=workspace_id,
        allowlist=getattr(config, "FEATURE_DOCS_WORKSPACES", None),
    )


def _doc_images_enabled(workspace_id: str) -> bool:
    return is_workspace_feature_enabled(
        enabled_globally=bool(getattr(config, "FEATURE_DOC_IMAGES_ON", False)),
        workspace_id=workspace_id,
        allowlist=getattr(config, "FEATURE_DOC_IMAGES_WORKSPACES", None),
    )


async def _resolve_context(request: Request, token: Optional[str]) -> tuple[str, str]:
    return await resolve_user_and_workspace(request, token)


class DocImageInsertRequest(BaseModel):
    url: str = Field(min_length=1)
    alt: Optional[str] = "image"
    fileId: Optional[str] = None


@router.post("/docs", response_model=DocContent)
async def create_doc(
    payload: CreateDocRequest,
    request: Request,
    token: Optional[str] = None,
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    user_id, workspace_id = await _resolve_context(request, token)
    if not _docs_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Docs API is disabled")

    context = extract_openclaw_context(request)
    if context:
        await openclaw_service.ensure_request_allowed(
            request=request,
            user_id=user_id,
            workspace_id=workspace_id,
            capability="doc.create",
        )
    result = await service.create_doc(
        workspace_id=workspace_id,
        user_id=user_id,
        payload=payload,
        client_request_id=client_request_id,
    )
    if context:
        await openclaw_service.record_activity(
            workspace_id=workspace_id,
            actor_id=user_id,
            operation_key="doc.create",
            resource_type="doc",
            resource_id=str(result.itemId),
            summary=f'Created doc "{result.title}" via OpenClaw',
            metadata={
                "version": result.version,
            },
            rollback_payload={
                "kind": "item.delete",
                "item_id": str(result.itemId),
            },
            request=request,
        )
    return result


@router.get("/docs/{item_id}", response_model=DocContent)
async def get_doc(item_id: str, request: Request, token: Optional[str] = None):
    user_id, workspace_id = await _resolve_context(request, token)
    _ = user_id
    if not _docs_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Docs API is disabled")

    context = extract_openclaw_context(request)
    if context:
        await openclaw_service.ensure_request_allowed(
            request=request,
            user_id=user_id,
            workspace_id=workspace_id,
            capability="doc.read",
        )
    result = await service.get_doc(workspace_id=workspace_id, item_id=item_id)
    if context:
        await openclaw_service.touch_verified(workspace_id=workspace_id, user_id=user_id)
    return result


@router.put("/docs/{item_id}", response_model=UpdateDocResponse)
async def update_doc(
    item_id: str,
    payload: UpdateDocRequest,
    request: Request,
    token: Optional[str] = None,
    if_match: Optional[str] = Header(default=None, alias="If-Match"),
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    user_id, workspace_id = await _resolve_context(request, token)
    if not _docs_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Docs API is disabled")

    context = extract_openclaw_context(request)
    if context:
        await openclaw_service.ensure_request_allowed(
            request=request,
            user_id=user_id,
            workspace_id=workspace_id,
            capability="doc.write",
        )
    previous_doc = await service.get_doc(workspace_id=workspace_id, item_id=item_id) if context else None
    result = await service.update_doc(
        workspace_id=workspace_id,
        user_id=user_id,
        item_id=item_id,
        payload=payload,
        if_match=if_match,
        client_request_id=client_request_id,
    )
    if context and previous_doc is not None:
        await openclaw_service.record_activity(
            workspace_id=workspace_id,
            actor_id=user_id,
            operation_key="doc.update",
            resource_type="doc",
            resource_id=item_id,
            summary="Updated doc content via OpenClaw",
            metadata={
                "previous_version": previous_doc.version,
                "version": result.version,
            },
            rollback_payload={
                "kind": "doc.restore_content",
                "item_id": item_id,
                "content_md": previous_doc.contentMd,
                "frontmatter": previous_doc.frontmatter,
                "expected_current_version": result.version,
            },
            request=request,
        )
    return result


@router.get("/docs/{item_id}/blocks", response_model=DocBlocksResponse)
async def list_doc_blocks(item_id: str, request: Request, token: Optional[str] = None):
    user_id, workspace_id = await _resolve_context(request, token)
    _ = user_id
    if not _docs_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Docs API is disabled")

    blocks = await service.list_doc_blocks(workspace_id=workspace_id, item_id=item_id)
    return DocBlocksResponse(itemId=item_id, blocks=blocks)


@router.post("/docs/{item_id}/agent/apply-ops", response_model=ApplyDocOpsResponse)
async def apply_doc_ops(
    item_id: str,
    payload: ApplyDocOpsRequest,
    request: Request,
    token: Optional[str] = None,
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    user_id, workspace_id = await _resolve_context(request, token)
    if not _docs_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Docs API is disabled")

    context = extract_openclaw_context(request)
    if context:
        await openclaw_service.ensure_request_allowed(
            request=request,
            user_id=user_id,
            workspace_id=workspace_id,
            capability="doc.write",
        )
    result = await service.apply_doc_ops(
        workspace_id=workspace_id,
        user_id=user_id,
        item_id=item_id,
        payload=payload,
        client_request_id=client_request_id,
    )
    if context:
        await openclaw_service.record_activity(
            workspace_id=workspace_id,
            actor_id=user_id,
            operation_key="doc.apply",
            resource_type="doc",
            resource_id=item_id,
            summary=f"Applied {result.appliedOps} doc operation(s) via OpenClaw",
            metadata={
                "previous_version": result.previousVersion,
                "version": result.version,
                "revision_id": result.revisionId,
            },
            rollback_payload={
                "kind": "doc.undo_revision",
                "item_id": item_id,
                "revision_id": str(result.revisionId),
                "expected_current_version": result.version,
            },
            request=request,
        )
    return result


@router.get("/docs/{item_id}/revisions", response_model=DocRevisionListResponse)
async def list_doc_revisions(
    item_id: str,
    request: Request,
    token: Optional[str] = None,
    limit: int = 50,
):
    user_id, workspace_id = await _resolve_context(request, token)
    _ = user_id
    if not _docs_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Docs API is disabled")
    return await service.list_doc_revisions(
        workspace_id=workspace_id,
        item_id=item_id,
        limit=limit,
    )


@router.get("/docs/{item_id}/revisions/{revision_id}", response_model=DocRevision)
async def get_doc_revision(
    item_id: str,
    revision_id: str,
    request: Request,
    token: Optional[str] = None,
):
    user_id, workspace_id = await _resolve_context(request, token)
    _ = user_id
    if not _docs_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Docs API is disabled")
    return await service.get_doc_revision(
        workspace_id=workspace_id,
        item_id=item_id,
        revision_id=revision_id,
    )


@router.post("/docs/{item_id}/revisions/{revision_id}/undo", response_model=ApplyDocOpsResponse)
async def undo_doc_revision(
    item_id: str,
    revision_id: str,
    payload: UndoDocRevisionRequest,
    request: Request,
    token: Optional[str] = None,
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    user_id, workspace_id = await _resolve_context(request, token)
    if not _docs_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Docs API is disabled")
    return await service.undo_doc_revision(
        workspace_id=workspace_id,
        user_id=user_id,
        item_id=item_id,
        revision_id=revision_id,
        payload=payload,
        client_request_id=client_request_id,
    )


@router.post("/docs/{item_id}/images", response_model=DocImageResponse)
async def create_doc_image_markdown(
    item_id: str,
    payload: DocImageInsertRequest,
    request: Request,
    token: Optional[str] = None,
):
    user_id, workspace_id = await _resolve_context(request, token)
    _ = user_id
    if not _docs_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Docs API is disabled")
    if not _doc_images_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Doc images API is disabled")

    # Validate item ownership and type.
    await service.get_doc(workspace_id=workspace_id, item_id=item_id)

    alt = (payload.alt or "image").replace("]", "")
    markdown = f"![{alt}]({payload.url})"
    return DocImageResponse(url=payload.url, markdown=markdown, fileId=payload.fileId)


@router.post("/docs/{item_id}/ensure-thread", response_model=EnsureDocThreadResponse)
async def ensure_doc_thread(item_id: str, request: Request, token: Optional[str] = None):
    user_id, workspace_id = await _resolve_context(request, token)
    _ = user_id
    if not _docs_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Docs API is disabled")

    thread_id = await service.ensure_doc_thread(
        workspace_id=workspace_id,
        item_id=item_id,
    )
    return EnsureDocThreadResponse(thread_id=thread_id)


@router.get("/docs/{item_id}/thread", response_model=PeekDocThreadResponse)
async def peek_doc_thread(item_id: str, request: Request, token: Optional[str] = None):
    user_id, workspace_id = await _resolve_context(request, token)
    _ = user_id
    if not _docs_enabled(workspace_id):
        raise HTTPException(status_code=404, detail="Docs API is disabled")

    thread_id = await service.peek_doc_thread(
        workspace_id=workspace_id,
        item_id=item_id,
    )
    if not thread_id:
        return PeekDocThreadResponse(exists=False)
    return PeekDocThreadResponse(exists=True, thread_id=thread_id)
