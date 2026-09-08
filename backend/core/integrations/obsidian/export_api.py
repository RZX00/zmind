from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from core.utils.auth_utils import resolve_user_and_workspace

from .export_service import ObsidianExportService


router = APIRouter(prefix="/exports/obsidian", tags=["obsidian"])
service = ObsidianExportService()


class CreateExportJobRequest(BaseModel):
    scopeType: Literal["workspace", "folder"] = "workspace"
    scopeId: Optional[str] = None


class ExportJobResponse(BaseModel):
    id: str
    status: str
    progress: int
    scopeType: str
    scopeId: Optional[str] = None
    stats: dict[str, Any] = Field(default_factory=dict)
    errorMessage: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None
    completedAt: Optional[str] = None
    downloadUrl: Optional[str] = None


def _to_job_response(row: dict[str, Any]) -> ExportJobResponse:
    return ExportJobResponse(
        id=row.get("id"),
        status=row.get("status") or "pending",
        progress=int(row.get("progress") or 0),
        scopeType=row.get("scope_type") or "workspace",
        scopeId=row.get("scope_id"),
        stats=row.get("stats") or {},
        errorMessage=row.get("error_message"),
        createdAt=row.get("created_at"),
        updatedAt=row.get("updated_at"),
        completedAt=row.get("completed_at"),
        downloadUrl=f"/exports/obsidian/jobs/{row.get('id')}/download" if row.get("status") == "completed" else None,
    )


@router.post("/jobs", response_model=ExportJobResponse)
async def create_export_job(payload: CreateExportJobRequest, request: Request):
    user_id, workspace_id = await resolve_user_and_workspace(request)
    row = await service.create_job(
        workspace_id=workspace_id,
        user_id=user_id,
        scope_type=payload.scopeType,
        scope_id=payload.scopeId,
    )
    return _to_job_response(row)


@router.get("/jobs/{job_id}", response_model=ExportJobResponse)
async def get_export_job(job_id: str, request: Request):
    user_id, workspace_id = await resolve_user_and_workspace(request)
    _ = user_id
    row = await service.get_job(workspace_id=workspace_id, job_id=job_id)
    return _to_job_response(row)


@router.get("/jobs/{job_id}/download")
async def download_export_job(job_id: str, request: Request):
    user_id, workspace_id = await resolve_user_and_workspace(request)
    _ = user_id
    payload = await service.get_download_bytes(workspace_id=workspace_id, job_id=job_id)
    return Response(
        content=payload,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="zmind-obsidian-{job_id}.zip"',
        },
    )

