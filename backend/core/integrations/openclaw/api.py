from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Header, Query, Request
from pydantic import BaseModel, Field

from core.utils.auth_utils import resolve_user_and_workspace

from .service import (
    DEFAULT_ALLOWED_CAPABILITIES,
    DEFAULT_ALLOWED_ROLES,
    VALID_CAPABILITIES,
    VALID_ROLES,
    get_openclaw_integration_service,
)


router = APIRouter(prefix="/integrations/openclaw", tags=["openclaw"])
service = get_openclaw_integration_service()


class OpenClawSettingsResponse(BaseModel):
    workspace_id: str
    enabled: bool
    allowed_roles: list[str] = Field(default_factory=lambda: list(DEFAULT_ALLOWED_ROLES))
    allowed_capabilities: list[str] = Field(default_factory=lambda: list(DEFAULT_ALLOWED_CAPABILITIES))
    linked_at: Optional[str] = None
    linked_by: Optional[str] = None
    last_verified_at: Optional[str] = None
    last_verified_by: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    updated_by: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    workspace_role: Optional[str] = None


class OpenClawActivityResponse(BaseModel):
    id: str
    workspace_id: str
    actor_id: Optional[str] = None
    client: Optional[str] = None
    tool_name: Optional[str] = None
    operation_key: Optional[str] = None
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    status: str
    summary: Optional[str] = None
    request_id: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    rollback_payload: Optional[dict[str, Any]] = None
    rollback_status: str
    rollback_error: Optional[str] = None
    created_at: Optional[str] = None
    rolled_back_at: Optional[str] = None
    rolled_back_by: Optional[str] = None
    can_rollback: bool = False


class OpenClawStateResponse(BaseModel):
    settings: OpenClawSettingsResponse
    stats: dict[str, Any]
    available_roles: list[str] = Field(default_factory=lambda: list(VALID_ROLES))
    available_capabilities: list[str] = Field(default_factory=lambda: list(VALID_CAPABILITIES))


class UpdateOpenClawSettingsRequest(BaseModel):
    enabled: bool
    allowed_roles: list[str] = Field(default_factory=lambda: list(DEFAULT_ALLOWED_ROLES))
    allowed_capabilities: list[str] = Field(default_factory=lambda: list(DEFAULT_ALLOWED_CAPABILITIES))
    metadata: dict[str, Any] = Field(default_factory=dict)


class OpenClawActivityListResponse(BaseModel):
    items: list[OpenClawActivityResponse]
    total: int


class OpenClawRollbackResponse(BaseModel):
    activity: OpenClawActivityResponse
    result: Any


@router.get("/state", response_model=OpenClawStateResponse)
async def get_openclaw_state(
    request: Request,
    token: Optional[str] = None,
):
    user_id, workspace_id = await resolve_user_and_workspace(request, token)
    return await service.get_state(workspace_id=workspace_id, user_id=user_id)


@router.put("/state", response_model=OpenClawSettingsResponse)
async def update_openclaw_state(
    payload: UpdateOpenClawSettingsRequest,
    request: Request,
    token: Optional[str] = None,
):
    user_id, workspace_id = await resolve_user_and_workspace(request, token)
    return await service.update_settings(
        workspace_id=workspace_id,
        user_id=user_id,
        enabled=payload.enabled,
        allowed_roles=payload.allowed_roles,
        allowed_capabilities=payload.allowed_capabilities,
        metadata=payload.metadata,
    )


@router.get("/activity", response_model=OpenClawActivityListResponse)
async def list_openclaw_activity(
    request: Request,
    token: Optional[str] = None,
    limit: int = Query(20, ge=1, le=100),
):
    user_id, workspace_id = await resolve_user_and_workspace(request, token)
    return await service.list_activity(
        workspace_id=workspace_id,
        user_id=user_id,
        limit=limit,
    )


@router.post("/activity/{activity_id}/rollback", response_model=OpenClawRollbackResponse)
async def rollback_openclaw_activity(
    activity_id: str,
    request: Request,
    token: Optional[str] = None,
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    _ = client_request_id
    return await service.rollback_activity(
        activity_id=activity_id,
        request=request,
        token=token,
    )
