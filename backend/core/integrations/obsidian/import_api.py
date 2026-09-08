from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from core.utils.auth_utils import resolve_user_and_workspace

from .import_service import ObsidianImportService


router = APIRouter(prefix="/imports/obsidian", tags=["obsidian"])
service = ObsidianImportService()


class UploadFilePayload(BaseModel):
    path: str = Field(min_length=1)
    content: str = ""


class UploadAssetPayload(BaseModel):
    path: str = Field(min_length=1)
    base64: str = Field(min_length=1)
    contentType: Optional[str] = None
    originalFilename: Optional[str] = None


class CreateImportJobRequest(BaseModel):
    sourceType: Literal["zip", "directory"] = "zip"


class UploadImportPayloadRequest(BaseModel):
    files: list[UploadFilePayload] = Field(default_factory=list)
    assets: list[UploadAssetPayload] = Field(default_factory=list)
    zipBase64: Optional[str] = None


class ImportJobStats(BaseModel):
    total_files: int = 0
    imported_docs: int = 0
    imported_assets: int = 0
    created_references: int = 0
    unresolved_links: int = 0
    failed_files: int = 0


class ImportJobResponse(BaseModel):
    id: str
    status: str
    sourceType: str
    progress: int
    stats: ImportJobStats
    reportUrl: str
    errorMessage: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None
    completedAt: Optional[str] = None


def _to_job_response(row: dict[str, Any]) -> ImportJobResponse:
    return ImportJobResponse(
        id=row.get("id"),
        status=row.get("status") or "pending",
        sourceType=row.get("source_type") or "zip",
        progress=int(row.get("progress") or 0),
        stats=ImportJobStats(**(row.get("stats") or {})),
        reportUrl=f"/imports/obsidian/jobs/{row.get('id')}/report",
        errorMessage=row.get("error_message"),
        createdAt=row.get("created_at"),
        updatedAt=row.get("updated_at"),
        completedAt=row.get("completed_at"),
    )


@router.post("/jobs", response_model=ImportJobResponse)
async def create_import_job(payload: CreateImportJobRequest, request: Request):
    user_id, workspace_id = await resolve_user_and_workspace(request)
    row = await service.create_job(
        workspace_id=workspace_id,
        user_id=user_id,
        source_type=payload.sourceType,
    )
    return _to_job_response(row)


@router.post("/jobs/{job_id}/upload", response_model=ImportJobResponse)
async def upload_import_payload(job_id: str, payload: UploadImportPayloadRequest, request: Request):
    user_id, workspace_id = await resolve_user_and_workspace(request)
    row = await service.upload_payload(
        workspace_id=workspace_id,
        user_id=user_id,
        job_id=job_id,
        payload=payload.model_dump(),
    )
    return _to_job_response(row)


@router.post("/jobs/{job_id}/commit", response_model=ImportJobResponse)
async def commit_import_job(job_id: str, request: Request):
    user_id, workspace_id = await resolve_user_and_workspace(request)
    row = await service.commit_job(
        workspace_id=workspace_id,
        user_id=user_id,
        job_id=job_id,
    )
    return _to_job_response(row)


@router.get("/jobs/{job_id}", response_model=ImportJobResponse)
async def get_import_job(job_id: str, request: Request):
    user_id, workspace_id = await resolve_user_and_workspace(request)
    _ = user_id
    row = await service.get_job(workspace_id=workspace_id, job_id=job_id)
    return _to_job_response(row)


@router.get("/jobs/{job_id}/report")
async def get_import_report(job_id: str, request: Request):
    user_id, workspace_id = await resolve_user_and_workspace(request)
    _ = user_id
    return await service.get_report(workspace_id=workspace_id, job_id=job_id)
