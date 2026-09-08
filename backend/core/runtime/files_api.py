from __future__ import annotations

import asyncio
import mimetypes
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any, Optional
from uuid import uuid4

from botocore.exceptions import ClientError
from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from core.runtime.access import resolve_runtime_context_by_project_ref
from core.services.r2_storage import get_r2_bucket, get_r2_client
from core.services.supabase import DBConnection
from core.utils.auth_utils import get_optional_user_id, verify_sandbox_access_optional
from core.utils.files_utils import clean_path
from core.utils.logger import logger


router = APIRouter(prefix="/runtime", tags=["runtime-files"])


class RuntimeFileJsonWriteRequest(BaseModel):
    path: str = Field(min_length=1)
    content: str = ""


def _is_not_found(error: ClientError) -> bool:
    code = str((error.response or {}).get("Error", {}).get("Code", "")).lower()
    return code in {"nosuchkey", "404", "notfound", "no such key"}


def _normalize_runtime_relative_path(path: Optional[str], *, allow_empty: bool = False) -> str:
    raw_path = (path or "/workspace").strip()
    cleaned = clean_path(raw_path).replace("\\", "/").strip()

    safe_parts: list[str] = []
    for part in PurePosixPath(cleaned).parts:
        if part in ("", "."):
            continue
        if part == "..":
            raise HTTPException(status_code=400, detail="Path traversal is not allowed")
        safe_parts.append(part)

    relative = "/".join(safe_parts)
    if not relative and not allow_empty:
        raise HTTPException(status_code=400, detail="Path is required")
    return relative


def _runtime_workspace_path(relative_path: str) -> str:
    if not relative_path:
        return "/workspace"
    return f"/workspace/{relative_path.lstrip('/')}"


def _runtime_storage_prefix(account_id: str, runtime_ref: str) -> str:
    return f"{account_id}/runtime/{runtime_ref}/"


def _runtime_storage_key(account_id: str, runtime_ref: str, relative_path: str) -> str:
    if not relative_path:
        raise HTTPException(status_code=400, detail="File path is required")
    return f"{_runtime_storage_prefix(account_id, runtime_ref)}{relative_path}"


def _guess_content_type(path: str, fallback: Optional[str] = None) -> str:
    if fallback:
        return fallback
    guessed = mimetypes.guess_type(path)[0]
    return guessed or "application/octet-stream"


async def _resolve_runtime_read_context(
    runtime_ref: str,
    request: Request,
) -> tuple[Any, Optional[str], str, str]:
    db = DBConnection()
    client = await db.client
    user_id = await get_optional_user_id(request)
    runtime_data = await verify_sandbox_access_optional(client, runtime_ref, user_id=user_id)

    account_id = str(runtime_data.get("account_id") or "")
    project_id = str(runtime_data.get("project_id") or runtime_ref)
    if not account_id or not project_id:
        raise HTTPException(status_code=500, detail="Runtime metadata is incomplete")

    return client, user_id, account_id, project_id


async def _resolve_runtime_write_context(
    runtime_ref: str,
    request: Request,
) -> tuple[Any, str, str, str]:
    db = DBConnection()
    client = await db.client
    user_id = await get_optional_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required for runtime write operations")

    context = await resolve_runtime_context_by_project_ref(client, runtime_ref)
    account_id = str(context.account_id or "")
    project_id = str(context.project_id or runtime_ref)
    if not account_id or not project_id:
        raise HTTPException(status_code=500, detail="Runtime metadata is incomplete")

    if account_id != user_id:
        membership = (
            await client.schema("basejump")
            .from_("account_user")
            .select("account_role")
            .eq("user_id", user_id)
            .eq("account_id", account_id)
            .limit(1)
            .execute()
        )
        if not membership.data:
            raise HTTPException(status_code=403, detail="Not authorized to write runtime files")

    return client, user_id, account_id, project_id


async def _upsert_runtime_file_record(
    client: Any,
    *,
    account_id: str,
    user_id: str,
    storage_path: str,
    filename: str,
    content_type: str,
    size_bytes: int,
    runtime_ref: str,
    workspace_path: str,
) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    metadata = {
        "runtime_ref": runtime_ref,
        "workspace_path": workspace_path,
        "runtime_mode": "cloud",
    }
    try:
        existing = (
            await client.table("file_uploads")
            .select("id")
            .eq("account_id", account_id)
            .eq("storage_path", storage_path)
            .is_("deleted_at", "null")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if existing.data:
            file_id = str(existing.data[0].get("id"))
            await client.table("file_uploads").update(
                {
                    "user_id": user_id,
                    "status": "ready",
                    "file_size": int(size_bytes),
                    "content_type": content_type,
                    "original_filename": filename,
                    "metadata": metadata,
                    "source": "runtime-files",
                    "deleted_at": None,
                    "updated_at": now_iso,
                }
            ).eq("id", file_id).execute()
            return

        await client.table("file_uploads").insert(
            {
                "id": str(uuid4()),
                "account_id": account_id,
                "user_id": user_id,
                "bucket_name": "file-uploads",
                "storage_provider": "r2",
                "storage_bucket": get_r2_bucket(),
                "storage_path": storage_path,
                "original_filename": filename,
                "file_size": int(size_bytes),
                "content_type": content_type,
                "status": "ready",
                "source": "runtime-files",
                "metadata": metadata,
                "created_at": now_iso,
                "updated_at": now_iso,
            }
        ).execute()
    except Exception as exc:
        logger.warning(
            "runtime_file_record_upsert_failed",
            storage_path=storage_path,
            account_id=account_id,
            error=str(exc),
        )


@router.get("/{runtime_ref}/files")
async def list_or_download_runtime_files(
    runtime_ref: str,
    request: Request,
    path: str = Query("/workspace"),
) -> Any:
    _client, _user_id, account_id, project_id = await _resolve_runtime_read_context(runtime_ref, request)
    relative_path = _normalize_runtime_relative_path(path, allow_empty=True)

    r2 = get_r2_client()
    bucket = get_r2_bucket()
    storage_prefix = _runtime_storage_prefix(account_id, project_id)
    storage_key = f"{storage_prefix}{relative_path}" if relative_path else storage_prefix

    # Backward-compatible behavior: GET /files with file path returns downloadable bytes.
    if relative_path and not path.rstrip().endswith("/"):
        try:
            obj = await asyncio.to_thread(
                r2.get_object,
                Bucket=bucket,
                Key=storage_key,
            )
            body = await asyncio.to_thread(obj["Body"].read)
            content_type = _guess_content_type(relative_path, obj.get("ContentType"))
            filename = PurePosixPath(relative_path).name or "download"
            return Response(
                content=body,
                media_type=content_type,
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "X-Runtime-Ref": project_id,
                },
            )
        except ClientError as exc:
            if not _is_not_found(exc):
                logger.error(
                    "runtime_file_download_failed",
                    runtime_ref=project_id,
                    path=relative_path,
                    error=str(exc),
                )
                raise HTTPException(status_code=502, detail="Failed to read runtime file")

    list_prefix = storage_prefix
    if relative_path:
        list_prefix = f"{storage_prefix}{relative_path.rstrip('/')}/"

    try:
        listing = await asyncio.to_thread(
            r2.list_objects_v2,
            Bucket=bucket,
            Prefix=list_prefix,
            Delimiter="/",
            MaxKeys=1000,
        )
    except ClientError as exc:
        logger.error(
            "runtime_file_list_failed",
            runtime_ref=project_id,
            path=relative_path,
            error=str(exc),
        )
        raise HTTPException(status_code=502, detail="Failed to list runtime files")

    files: list[dict[str, Any]] = []

    for prefix_data in listing.get("CommonPrefixes", []) or []:
        child_prefix = str(prefix_data.get("Prefix") or "")
        child_relative = child_prefix[len(storage_prefix):].rstrip("/")
        if not child_relative:
            continue
        files.append(
            {
                "name": PurePosixPath(child_relative).name,
                "path": _runtime_workspace_path(child_relative),
                "is_dir": True,
                "size": 0,
                "mod_time": None,
            }
        )

    for entry in listing.get("Contents", []) or []:
        key = str(entry.get("Key") or "")
        if not key or key.endswith("/"):
            continue
        child_relative = key[len(storage_prefix):]
        if not child_relative:
            continue

        files.append(
            {
                "name": PurePosixPath(child_relative).name,
                "path": _runtime_workspace_path(child_relative),
                "is_dir": False,
                "size": int(entry.get("Size") or 0),
                "mod_time": (
                    entry.get("LastModified").isoformat()
                    if entry.get("LastModified") is not None
                    else None
                ),
            }
        )

    files.sort(key=lambda item: (0 if item["is_dir"] else 1, item["name"].lower()))
    return {
        "runtime_ref": project_id,
        "path": _runtime_workspace_path(relative_path),
        "files": files,
    }


@router.get("/{runtime_ref}/files/content")
async def get_runtime_file_content(
    runtime_ref: str,
    request: Request,
    path: str = Query(...),
) -> Response:
    _client, _user_id, account_id, project_id = await _resolve_runtime_read_context(runtime_ref, request)
    relative_path = _normalize_runtime_relative_path(path, allow_empty=False)
    storage_key = _runtime_storage_key(account_id, project_id, relative_path)

    r2 = get_r2_client()
    bucket = get_r2_bucket()

    try:
        obj = await asyncio.to_thread(
            r2.get_object,
            Bucket=bucket,
            Key=storage_key,
        )
        body = await asyncio.to_thread(obj["Body"].read)
        content_type = _guess_content_type(relative_path, obj.get("ContentType"))
        return Response(
            content=body,
            media_type=content_type,
            headers={"X-Runtime-Ref": project_id},
        )
    except ClientError as exc:
        if _is_not_found(exc):
            raise HTTPException(status_code=404, detail="Runtime file not found")
        logger.error(
            "runtime_file_content_read_failed",
            runtime_ref=project_id,
            path=relative_path,
            error=str(exc),
        )
        raise HTTPException(status_code=502, detail="Failed to read runtime file")


@router.post("/{runtime_ref}/files")
async def create_runtime_file(
    runtime_ref: str,
    request: Request,
    path: str = Form(...),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    client, user_id, account_id, project_id = await _resolve_runtime_write_context(runtime_ref, request)
    relative_path = _normalize_runtime_relative_path(path, allow_empty=False)
    storage_key = _runtime_storage_key(account_id, project_id, relative_path)
    workspace_path = _runtime_workspace_path(relative_path)

    content = await file.read()
    content_type = _guess_content_type(relative_path, file.content_type)
    filename = PurePosixPath(relative_path).name or (file.filename or "file")

    r2 = get_r2_client()
    bucket = get_r2_bucket()

    try:
        await asyncio.to_thread(
            r2.put_object,
            Bucket=bucket,
            Key=storage_key,
            Body=content,
            ContentType=content_type,
        )
    except ClientError as exc:
        logger.error(
            "runtime_file_write_failed",
            runtime_ref=project_id,
            path=relative_path,
            error=str(exc),
        )
        raise HTTPException(status_code=502, detail="Failed to write runtime file")

    await _upsert_runtime_file_record(
        client,
        account_id=account_id,
        user_id=user_id,
        storage_path=storage_key,
        filename=filename,
        content_type=content_type,
        size_bytes=len(content),
        runtime_ref=project_id,
        workspace_path=workspace_path,
    )

    return {
        "success": True,
        "runtime_ref": project_id,
        "path": workspace_path,
        "size": len(content),
    }


@router.post("/{runtime_ref}/files/json")
async def create_runtime_file_json(
    runtime_ref: str,
    request: Request,
    payload: RuntimeFileJsonWriteRequest,
) -> dict[str, Any]:
    client, user_id, account_id, project_id = await _resolve_runtime_write_context(runtime_ref, request)
    relative_path = _normalize_runtime_relative_path(payload.path, allow_empty=False)
    storage_key = _runtime_storage_key(account_id, project_id, relative_path)
    workspace_path = _runtime_workspace_path(relative_path)

    content_bytes = payload.content.encode("utf-8")
    content_type = _guess_content_type(relative_path, "application/json" if relative_path.endswith(".json") else "text/plain; charset=utf-8")
    filename = PurePosixPath(relative_path).name or "file.txt"

    r2 = get_r2_client()
    bucket = get_r2_bucket()

    try:
        await asyncio.to_thread(
            r2.put_object,
            Bucket=bucket,
            Key=storage_key,
            Body=content_bytes,
            ContentType=content_type,
        )
    except ClientError as exc:
        logger.error(
            "runtime_file_json_write_failed",
            runtime_ref=project_id,
            path=relative_path,
            error=str(exc),
        )
        raise HTTPException(status_code=502, detail="Failed to write runtime file")

    await _upsert_runtime_file_record(
        client,
        account_id=account_id,
        user_id=user_id,
        storage_path=storage_key,
        filename=filename,
        content_type=content_type,
        size_bytes=len(content_bytes),
        runtime_ref=project_id,
        workspace_path=workspace_path,
    )

    return {
        "success": True,
        "runtime_ref": project_id,
        "path": workspace_path,
        "size": len(content_bytes),
    }


@router.delete("/{runtime_ref}/files")
async def delete_runtime_file(
    runtime_ref: str,
    request: Request,
    path: str = Query(...),
) -> dict[str, Any]:
    client, _user_id, account_id, project_id = await _resolve_runtime_write_context(runtime_ref, request)
    relative_path = _normalize_runtime_relative_path(path, allow_empty=False)
    storage_key = _runtime_storage_key(account_id, project_id, relative_path)

    r2 = get_r2_client()
    bucket = get_r2_bucket()

    try:
        await asyncio.to_thread(
            r2.delete_object,
            Bucket=bucket,
            Key=storage_key,
        )
    except ClientError as exc:
        logger.error(
            "runtime_file_delete_failed",
            runtime_ref=project_id,
            path=relative_path,
            error=str(exc),
        )
        raise HTTPException(status_code=502, detail="Failed to delete runtime file")

    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        await client.table("file_uploads").update(
            {
                "status": "deleted",
                "deleted_at": now_iso,
                "updated_at": now_iso,
            }
        ).eq("account_id", account_id).eq("storage_path", storage_key).is_("deleted_at", "null").execute()
    except Exception as exc:
        logger.warning(
            "runtime_file_delete_marker_failed",
            runtime_ref=project_id,
            path=relative_path,
            error=str(exc),
        )

    return {
        "success": True,
        "runtime_ref": project_id,
        "path": _runtime_workspace_path(relative_path),
    }
