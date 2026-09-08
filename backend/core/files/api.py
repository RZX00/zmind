from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import asyncio
import math
import re
import uuid

from fastapi import APIRouter, HTTPException, Request, Body, Query
from pydantic import BaseModel, Field

from core.billing.config import get_storage_limits
from core.billing import entitlements
from core.services.supabase import DBConnection
from core.services.r2_storage import (
    create_presigned_put_url,
    create_presigned_get_url,
    create_multipart_upload,
    create_presigned_upload_part_url,
    list_multipart_parts,
    complete_multipart_upload,
    abort_multipart_upload,
    get_r2_client,
    get_r2_bucket,
    head_object,
)
from core.files.processing import process_file_upload
from core.utils.auth_utils import resolve_user_and_workspace
from core.utils.config import config
from core.utils.logger import logger
from core.utils.errors import raise_file_removed

router = APIRouter(prefix="/files", tags=["files"])


class UploadIntentRequest(BaseModel):
    filename: str = Field(min_length=1)
    size: int = Field(gt=0)
    content_type: Optional[str] = None
    source: str = Field(default="chat")
    sha256: Optional[str] = None


class UploadIntentResponse(BaseModel):
    file_id: str
    upload_url: str
    method: str
    headers: dict
    storage_key: str
    expires_in: int
    reuse: bool = False
    upload_id: Optional[str] = None
    part_size: Optional[int] = None
    part_count: Optional[int] = None
    parts: Optional[list[dict]] = None
    resume: bool = False


class UploadCompleteRequest(BaseModel):
    file_id: str
    upload_id: Optional[str] = None
    parts: Optional[list[dict]] = None


class UploadAbortRequest(BaseModel):
    file_id: str

class OCRRequest(BaseModel):
    force: bool = False

class FileLinkRequest(BaseModel):
    entity_type: str = Field(min_length=1)
    entity_id: str = Field(min_length=1)

class StorageUsageResponse(BaseModel):
    used_bytes: int
    max_total_bytes: int
    max_file_bytes: int
    tier_name: str
    tier_display_name: Optional[str] = None


class FileLibraryItem(BaseModel):
    file_id: str
    storage_path: str
    original_filename: str
    file_size: int
    content_type: Optional[str] = None
    updated_at: Optional[str] = None
    created_at: Optional[str] = None


class FileRenameRequest(BaseModel):
    filename: str = Field(min_length=1)


def _sanitize_filename(name: str) -> str:
    name = name.strip() or "file"
    name = re.sub(r"[^a-zA-Z0-9._-]+", "_", name)
    return name[:200]


def _normalize_source(source: Optional[str]) -> str:
    value = (source or "chat").strip().lower()
    value = re.sub(r"[^a-z0-9-]+", "-", value).strip("-")
    return value or "chat"


async def _get_storage_usage_bytes(account_id: str, client) -> int:
    resp = await client.table("file_uploads") \
        .select("file_size, status") \
        .eq("account_id", account_id) \
        .is_("deleted_at", "null") \
        .execute()
    rows = resp.data or []
    valid_statuses = {"uploaded", "processing", "ready", ""}
    total = 0
    for row in rows:
        status = (row.get("status") or "").lower()
        if status not in valid_statuses:
            continue
        total += int(row.get("file_size") or 0)
    return total


@router.post("/upload-intent", response_model=UploadIntentResponse)
async def create_upload_intent(payload: UploadIntentRequest, request: Request):
    user_id, account_id = await resolve_user_and_workspace(request)
    file_size = int(payload.size)

    db = DBConnection()
    client = await db.client

    sha256 = (payload.sha256 or "").strip().lower()
    if sha256 and not re.fullmatch(r"[0-9a-f]{64}", sha256):
        sha256 = ""
    multipart_threshold = int(config.R2_MULTIPART_THRESHOLD_BYTES or 0)
    part_size = int(config.R2_MULTIPART_PART_SIZE_BYTES or 0)
    if part_size < 5 * 1024 * 1024:
        part_size = 5 * 1024 * 1024

    if sha256:
        try:
            reuse_resp = await client.table("file_uploads") \
                .select("id, storage_path, status, upload_method, multipart_upload_id, multipart_part_size, multipart_part_count, storage_provider, storage_bucket, metadata") \
                .eq("account_id", account_id) \
                .eq("hash_sha256", sha256) \
                .eq("file_size", file_size) \
                .is_("deleted_at", "null") \
                .in_("status", ["uploaded", "processing", "ready", "uploading"]) \
                .limit(1) \
                .execute()
            if reuse_resp.data:
                record = reuse_resp.data[0]
                storage_key = record.get("storage_path") or ""
                status = (record.get("status") or "").lower()
                upload_method = (record.get("upload_method") or "put").lower()
                storage_provider = (record.get("storage_provider") or "supabase").lower()
                if storage_key and status in ("uploaded", "processing", "ready"):
                    if storage_provider == "r2":
                        try:
                            head_object(storage_key)
                        except Exception as e:
                            message = str(e)
                            logger.warning(f"[files] reuse candidate head check failed: {storage_key} ({message})")
                            if "NoSuchKey" in message or "not found" in message.lower() or "404" in message:
                                try:
                                    metadata = record.get("metadata") or {}
                                    if isinstance(metadata, str):
                                        metadata = {}
                                    metadata.update({
                                        "missing_object": True,
                                        "missing_object_at": datetime.now(timezone.utc).isoformat(),
                                    })
                                    await client.table("file_uploads").update({
                                        "status": "failed",
                                        "metadata": metadata,
                                    }).eq("id", record.get("id")).execute()
                                except Exception:
                                    pass
                            storage_key = ""
                    else:
                        storage_key = ""
                    if storage_key:
                        return UploadIntentResponse(
                            file_id=str(record.get("id")),
                            upload_url="",
                            method="REUSE",
                            headers={},
                            storage_key=storage_key,
                            expires_in=0,
                            reuse=True,
                        )
                if storage_key and status == "uploading" and upload_method == "multipart":
                    upload_id = record.get("multipart_upload_id")
                    if upload_id:
                        effective_part_size = int(record.get("multipart_part_size") or part_size)
                        effective_part_count = int(record.get("multipart_part_count") or math.ceil(file_size / effective_part_size))
                        parts = [
                            {
                                "part_number": idx,
                                "url": create_presigned_upload_part_url(
                                    key=storage_key,
                                    upload_id=upload_id,
                                    part_number=idx,
                                    expires_in=config.R2_SIGNED_URL_TTL_SECONDS,
                                ),
                            }
                            for idx in range(1, effective_part_count + 1)
                        ]
                        return UploadIntentResponse(
                            file_id=str(record.get("id")),
                            upload_url="",
                            method="MULTIPART",
                            headers={},
                            storage_key=storage_key,
                            expires_in=config.R2_SIGNED_URL_TTL_SECONDS,
                            upload_id=upload_id,
                            part_size=effective_part_size,
                            part_count=effective_part_count,
                            parts=parts,
                            resume=True,
                        )
        except Exception as e:
            logger.warning(f"[files] reuse lookup failed: {e}")

    tier_info = await entitlements.get_user_subscription_tier(account_id)
    limits = get_storage_limits(tier_info["name"])

    if file_size > limits.max_file_bytes:
        raise HTTPException(status_code=413, detail={
            "message": "File exceeds per-file limit",
            "max_file_bytes": limits.max_file_bytes,
            "file_size": file_size,
            "tier": tier_info["name"],
        })

    used_bytes = await _get_storage_usage_bytes(account_id, client)
    if used_bytes + file_size > limits.max_total_bytes:
        raise HTTPException(status_code=402, detail={
            "message": "Storage quota exceeded",
            "max_total_bytes": limits.max_total_bytes,
            "used_bytes": used_bytes,
            "file_size": file_size,
            "tier": tier_info["name"],
        })

    safe_name = _sanitize_filename(payload.filename)
    source = _normalize_source(payload.source)
    today = datetime.now(timezone.utc)
    file_id = str(uuid.uuid4())
    key = f"{account_id}/{source}/{today:%Y/%m/%d}/{file_id}-{safe_name}"
    content_type = payload.content_type or "application/octet-stream"
    use_multipart = bool(multipart_threshold and file_size >= multipart_threshold)
    part_count = math.ceil(file_size / part_size) if use_multipart else 0

    try:
        await client.table("file_uploads").insert({
            "id": file_id,
            "account_id": account_id,
            "user_id": user_id,
            "bucket_name": "file-uploads",
            "storage_provider": "r2",
            "storage_bucket": get_r2_bucket(),
            "storage_path": key,
            "original_filename": payload.filename,
            "file_size": file_size,
            "content_type": content_type,
            "status": "uploading" if use_multipart else "pending",
            "source": source,
            "hash_sha256": sha256 or None,
            "upload_method": "multipart" if use_multipart else "put",
            "multipart_part_size": part_size if use_multipart else None,
            "multipart_part_count": part_count if use_multipart else None,
        }).execute()
    except Exception as e:
        logger.error(f"[files] upload-intent insert failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to create upload intent")

    if use_multipart:
        try:
            upload_id = create_multipart_upload(key=key, content_type=content_type)
        except Exception as e:
            try:
                await client.table("file_uploads").update({
                    "status": "failed",
                }).eq("id", file_id).execute()
            except Exception:
                pass
            logger.error(f"[files] multipart init failed: {e}")
            raise HTTPException(status_code=500, detail="Failed to create multipart upload")
        parts = [
            {
                "part_number": idx,
                "url": create_presigned_upload_part_url(
                    key=key,
                    upload_id=upload_id,
                    part_number=idx,
                    expires_in=config.R2_SIGNED_URL_TTL_SECONDS,
                ),
            }
            for idx in range(1, part_count + 1)
        ]
        try:
            await client.table("file_uploads").update({
                "multipart_upload_id": upload_id,
            }).eq("id", file_id).execute()
        except Exception as e:
            logger.warning(f"[files] failed to persist multipart upload id: {e}")
        return UploadIntentResponse(
            file_id=file_id,
            upload_url="",
            method="MULTIPART",
            headers={},
            storage_key=key,
            expires_in=config.R2_SIGNED_URL_TTL_SECONDS,
            upload_id=upload_id,
            part_size=part_size,
            part_count=part_count,
            parts=parts,
        )

    upload_url = create_presigned_put_url(
        key=key,
        content_type=content_type,
        expires_in=config.R2_SIGNED_URL_TTL_SECONDS,
    )

    return UploadIntentResponse(
        file_id=file_id,
        upload_url=upload_url,
        method="PUT",
        headers={"Content-Type": content_type},
        storage_key=key,
        expires_in=config.R2_SIGNED_URL_TTL_SECONDS,
    )


@router.post("/upload-complete")
async def complete_upload(payload: UploadCompleteRequest, request: Request):
    user_id, account_id = await resolve_user_and_workspace(request)
    db = DBConnection()
    client = await db.client

    record_resp = await client.table("file_uploads") \
        .select("*") \
        .eq("id", payload.file_id) \
        .eq("account_id", account_id) \
        .limit(1) \
        .execute()
    if not record_resp.data:
        raise HTTPException(status_code=404, detail="Upload record not found")

    record = record_resp.data[0]
    key = record.get("storage_path")
    if not key:
        raise HTTPException(status_code=400, detail="Missing storage path")

    upload_method = (record.get("upload_method") or "put").lower()
    if upload_method == "multipart":
        upload_id = payload.upload_id or record.get("multipart_upload_id")
        if not upload_id:
            raise HTTPException(status_code=400, detail="Missing upload_id for multipart upload")
        parts_payload = payload.parts or []
        parts: list[dict] = []
        if parts_payload:
            for item in parts_payload:
                if not isinstance(item, dict):
                    continue
                pn = item.get("part_number") or item.get("PartNumber")
                etag = item.get("etag") or item.get("ETag")
                if pn and etag:
                    try:
                        parts.append({"PartNumber": int(pn), "ETag": str(etag)})
                    except Exception:
                        continue
        if not parts:
            listed = list_multipart_parts(key, upload_id)
            parts = [
                {"PartNumber": int(p.get("PartNumber")), "ETag": p.get("ETag")}
                for p in listed
                if p.get("PartNumber") and p.get("ETag")
            ]
        expected = record.get("multipart_part_count")
        if expected and len(parts) < int(expected):
            raise HTTPException(status_code=400, detail="Missing upload parts")
        try:
            parts = sorted(parts, key=lambda x: x.get("PartNumber", 0))
            complete_multipart_upload(key, upload_id, parts)
        except Exception as e:
            logger.error(f"[files] multipart complete failed: {e}")
            raise HTTPException(status_code=400, detail="Failed to finalize multipart upload")

    try:
        head = head_object(key)
        actual_size = int(head.get("ContentLength") or 0)
        content_type = head.get("ContentType") or record.get("content_type") or "application/octet-stream"
    except Exception as e:
        logger.error(f"[files] head_object failed: {e}")
        raise HTTPException(status_code=400, detail="Uploaded object not found")

    tier_info = await entitlements.get_user_subscription_tier(account_id)
    limits = get_storage_limits(tier_info["name"])
    used_bytes = await _get_storage_usage_bytes(account_id, client)
    used_bytes = max(0, used_bytes - int(record.get("file_size") or 0))

    if actual_size > limits.max_file_bytes or used_bytes + actual_size > limits.max_total_bytes:
        try:
            from core.services.r2_storage import get_r2_client, get_r2_bucket
            r2 = get_r2_client()
            r2.delete_object(Bucket=get_r2_bucket(), Key=key)
        except Exception:
            logger.warning("[files] failed to delete over-limit object")

        await client.table("file_uploads").update({
            "status": "failed",
        }).eq("id", payload.file_id).execute()

        raise HTTPException(status_code=402, detail={
            "message": "Storage quota exceeded",
            "max_total_bytes": limits.max_total_bytes,
            "max_file_bytes": limits.max_file_bytes,
            "used_bytes": used_bytes,
            "file_size": actual_size,
            "tier": tier_info["name"],
        })

    await client.table("file_uploads").update({
        "status": "uploaded",
        "file_size": actual_size,
        "content_type": content_type,
    }).eq("id", payload.file_id).execute()

    try:
        asyncio.create_task(process_file_upload(payload.file_id, account_id=account_id))
    except Exception:
        pass

    return {"file_id": payload.file_id, "status": "uploaded"}


@router.get("/{file_id}/upload-status")
async def get_upload_status(file_id: str, request: Request):
    _, account_id = await resolve_user_and_workspace(request)
    db = DBConnection()
    client = await db.client

    record_resp = await client.table("file_uploads") \
        .select("storage_path, upload_method, multipart_upload_id, multipart_part_size, multipart_part_count") \
        .eq("id", file_id) \
        .eq("account_id", account_id) \
        .limit(1) \
        .execute()
    if not record_resp.data:
        raise HTTPException(status_code=404, detail="Upload record not found")
    record = record_resp.data[0]
    if (record.get("upload_method") or "").lower() != "multipart":
        raise HTTPException(status_code=400, detail="Not a multipart upload")
    upload_id = record.get("multipart_upload_id")
    key = record.get("storage_path")
    if not upload_id or not key:
        raise HTTPException(status_code=400, detail="Missing multipart upload metadata")

    parts = list_multipart_parts(key, upload_id)
    uploaded_parts = [
        {
            "part_number": int(p.get("PartNumber")),
            "etag": p.get("ETag"),
        }
        for p in parts
        if p.get("PartNumber") and p.get("ETag")
    ]
    return {
        "file_id": file_id,
        "upload_id": upload_id,
        "part_size": record.get("multipart_part_size"),
        "part_count": record.get("multipart_part_count"),
        "uploaded_parts": uploaded_parts,
    }


@router.post("/upload-abort")
async def abort_upload(payload: UploadAbortRequest, request: Request):
    _, account_id = await resolve_user_and_workspace(request)
    db = DBConnection()
    client = await db.client

    record_resp = await client.table("file_uploads") \
        .select("storage_path, upload_method, multipart_upload_id") \
        .eq("id", payload.file_id) \
        .eq("account_id", account_id) \
        .limit(1) \
        .execute()
    if not record_resp.data:
        raise HTTPException(status_code=404, detail="Upload record not found")
    record = record_resp.data[0]
    upload_method = (record.get("upload_method") or "").lower()
    upload_id = record.get("multipart_upload_id")
    key = record.get("storage_path")
    if upload_method == "multipart" and upload_id and key:
        try:
            abort_multipart_upload(key, upload_id)
        except Exception as e:
            logger.warning(f"[files] abort multipart failed: {e}")
    # Best-effort cleanup for any partially uploaded object
    if key:
        try:
            from core.services.r2_storage import get_r2_client, get_r2_bucket
            r2 = get_r2_client()
            r2.delete_object(Bucket=get_r2_bucket(), Key=key)
        except Exception:
            pass
    await client.table("file_uploads").update({
        "status": "failed",
    }).eq("id", payload.file_id).execute()
    return {"file_id": payload.file_id, "status": "aborted"}


@router.post("/{file_id}/ocr")
async def request_file_ocr(file_id: str, payload: OCRRequest, request: Request):
    _, account_id = await resolve_user_and_workspace(request)
    if not config.DEEPSEEK_OCR_ENABLED:
        raise HTTPException(status_code=400, detail="DeepSeek OCR is disabled")
    if not (config.AIPING_API_KEY or config.OPENAI_COMPATIBLE_API_KEY or config.OPENAI_API_KEY):
        raise HTTPException(status_code=400, detail="AIPING API key is not configured")

    db = DBConnection()
    client = await db.client

    record_resp = await client.table("file_uploads") \
        .select("id, original_filename, content_type, metadata") \
        .eq("id", file_id) \
        .eq("account_id", account_id) \
        .limit(1) \
        .execute()
    if not record_resp.data:
        raise HTTPException(status_code=404, detail="File not found")
    record = record_resp.data[0]

    filename = record.get("original_filename") or "file"
    ext = Path(filename).suffix.lower()
    content_type = (record.get("content_type") or "").lower()
    if ext != ".pdf" and content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="DeepSeek OCR only supports PDF files")

    metadata = record.get("metadata") or {}
    if isinstance(metadata, str):
        metadata = {}
    ocr_meta = metadata.get("ocr")
    if not isinstance(ocr_meta, dict):
        ocr_meta = {}
    ocr_meta.update({
        "status": "queued",
        "provider": "deepseek-ocr",
        "queued_at": datetime.now(timezone.utc).isoformat(),
    })
    metadata["ocr"] = ocr_meta
    metadata["ocr_requested"] = True
    if payload.force:
        metadata["force_ocr"] = True

    await client.table("file_uploads").update({
        "metadata": metadata,
        "status": "processing",
    }).eq("id", file_id).execute()

    try:
        asyncio.create_task(process_file_upload(file_id, account_id=account_id))
    except Exception:
        pass

    return {"file_id": file_id, "status": "queued"}


@router.get("/usage", response_model=StorageUsageResponse)
async def get_storage_usage(request: Request):
    _, account_id = await resolve_user_and_workspace(request)
    db = DBConnection()
    client = await db.client

    tier_info = await entitlements.get_user_subscription_tier(account_id)
    limits = get_storage_limits(tier_info["name"])
    used_bytes = await _get_storage_usage_bytes(account_id, client)

    return StorageUsageResponse(
        used_bytes=used_bytes,
        max_total_bytes=limits.max_total_bytes,
        max_file_bytes=limits.max_file_bytes,
        tier_name=tier_info["name"],
        tier_display_name=tier_info.get("display_name"),
    )


@router.get("/library")
async def list_file_library(
    request: Request,
    prefix: Optional[str] = Query(default="canvas-media"),
    limit: int = Query(default=100, ge=1, le=500),
):
    _, account_id = await resolve_user_and_workspace(request)
    db = DBConnection()
    client = await db.client

    normalized_prefix = (prefix or "").strip().strip("/")
    if normalized_prefix:
        storage_prefix = f"{account_id}/{normalized_prefix}"
    else:
        storage_prefix = f"{account_id}/"

    try:
        resp = await client.table("file_uploads") \
            .select("id, storage_path, original_filename, file_size, content_type, updated_at, created_at, storage_provider") \
            .eq("account_id", account_id) \
            .is_("deleted_at", "null") \
            .ilike("storage_path", f"{storage_prefix}%") \
            .order("updated_at", desc=True) \
            .limit(limit) \
            .execute()
    except Exception as e:
        logger.error(f"[files] Failed to list library items: {e}")
        raise HTTPException(status_code=500, detail="Failed to list files")

    items: list[dict] = []
    for row in (resp.data or []):
        provider = (row.get("storage_provider") or "supabase").lower()
        if provider != "r2":
            continue
        items.append({
            "file_id": str(row.get("id")),
            "storage_path": row.get("storage_path"),
            "original_filename": row.get("original_filename") or "file",
            "file_size": int(row.get("file_size") or 0),
            "content_type": row.get("content_type"),
            "updated_at": row.get("updated_at"),
            "created_at": row.get("created_at"),
        })

    return {"items": items}


@router.patch("/{file_id}/rename")
async def rename_file(file_id: str, request: Request, payload: FileRenameRequest = Body(...)):
    _, account_id = await resolve_user_and_workspace(request)
    db = DBConnection()
    client = await db.client

    record_resp = await client.table("file_uploads") \
        .select("id, storage_path") \
        .eq("id", file_id) \
        .eq("account_id", account_id) \
        .limit(1) \
        .execute()
    if not record_resp.data:
        raise HTTPException(status_code=404, detail="File not found")

    sanitized = _sanitize_filename(payload.filename)
    await client.table("file_uploads").update({
        "original_filename": sanitized,
    }).eq("id", file_id).execute()

    record = record_resp.data[0]
    return {
        "file_id": file_id,
        "storage_path": record.get("storage_path"),
        "original_filename": sanitized,
    }


@router.delete("/{file_id}")
async def delete_file(file_id: str, request: Request):
    _, account_id = await resolve_user_and_workspace(request)
    db = DBConnection()
    client = await db.client

    record_resp = await client.table("file_uploads") \
        .select("id, storage_provider, storage_path") \
        .eq("id", file_id) \
        .eq("account_id", account_id) \
        .limit(1) \
        .execute()
    if not record_resp.data:
        raise HTTPException(status_code=404, detail="File not found")

    record = record_resp.data[0]
    provider = record.get("storage_provider") or "supabase"
    storage_path = record.get("storage_path")

    if provider == "r2" and storage_path:
        try:
            r2 = get_r2_client()
            r2.delete_object(Bucket=get_r2_bucket(), Key=storage_path)
        except Exception as e:
            logger.warning(f"[files] r2 delete failed for {storage_path}: {e}")
    else:
        logger.info(f"[files] skipping delete for legacy provider on {file_id}")

    await client.table("file_links") \
        .delete() \
        .eq("file_id", file_id) \
        .execute()

    await client.table("file_uploads").update({
        "deleted_at": datetime.now(timezone.utc).isoformat(),
        "status": "deleted",
    }).eq("id", file_id).execute()

    return {"success": True}


@router.get("/{file_id}/download")
async def get_download_url(file_id: str, request: Request):
    _, account_id = await resolve_user_and_workspace(request)
    db = DBConnection()
    client = await db.client

    record_resp = await client.table("file_uploads") \
        .select("*") \
        .eq("id", file_id) \
        .eq("account_id", account_id) \
        .limit(1) \
        .execute()
    if not record_resp.data:
        raise HTTPException(status_code=404, detail="File not found")

    record = record_resp.data[0]
    provider = record.get("storage_provider") or "supabase"
    key = record.get("storage_path")
    filename = record.get("original_filename") or "file"

    if provider == "r2":
        url = create_presigned_get_url(
            key=key,
            expires_in=config.R2_SIGNED_URL_TTL_SECONDS,
            download_filename=filename,
        )
        return {"url": url}
    raise_file_removed("FILE_REMOVED")


@router.post("/{file_id}/link")
async def link_file(request: Request, file_id: str, payload: FileLinkRequest = Body(...)):
    _, account_id = await resolve_user_and_workspace(request)
    db = DBConnection()
    client = await db.client

    record_resp = await client.table("file_uploads") \
        .select("id") \
        .eq("id", file_id) \
        .eq("account_id", account_id) \
        .limit(1) \
        .execute()
    if not record_resp.data:
        raise HTTPException(status_code=404, detail="File not found")

    await client.table("file_links").upsert({
        "file_id": file_id,
        "entity_type": payload.entity_type,
        "entity_id": payload.entity_id,
    }, on_conflict="file_id,entity_type,entity_id").execute()

    return {"success": True}


@router.delete("/{file_id}/link")
async def unlink_file(request: Request, file_id: str, payload: FileLinkRequest = Body(...)):
    _, account_id = await resolve_user_and_workspace(request)
    db = DBConnection()
    client = await db.client

    record_resp = await client.table("file_uploads") \
        .select("id") \
        .eq("id", file_id) \
        .eq("account_id", account_id) \
        .limit(1) \
        .execute()
    if not record_resp.data:
        raise HTTPException(status_code=404, detail="File not found")

    await client.table("file_links") \
        .delete() \
        .eq("file_id", file_id) \
        .eq("entity_type", payload.entity_type) \
        .eq("entity_id", payload.entity_id) \
        .execute()

    return {"success": True}
