"""
Utility functions for handling image operations.
"""

import base64
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from core.utils.logger import logger
from core.services.supabase import DBConnection
from core.services.r2_storage import get_r2_client, get_r2_bucket, create_presigned_get_url


def _sanitize_filename(name: str) -> str:
    cleaned = (name or "file").strip()
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "_", cleaned)
    cleaned = cleaned.strip("._") or "file"
    return cleaned[:200]


def _build_storage_path(
    account_id: Optional[str],
    prefix: str,
    filename: str,
) -> str:
    safe_prefix = (prefix or "uploads").strip("/")
    timestamp = datetime.now(timezone.utc).strftime("%Y/%m/%d")
    unique_id = uuid.uuid4().hex[:8]
    if account_id:
        return f"{account_id}/{safe_prefix}/{timestamp}/{unique_id}-{filename}"
    return f"{safe_prefix}/{timestamp}/{unique_id}-{filename}"


async def upload_bytes_to_r2(
    file_bytes: bytes,
    *,
    filename: str,
    content_type: str,
    account_id: Optional[str] = None,
    user_id: Optional[str] = None,
    source: str = "agent",
    path_prefix: str = "agent-files",
    bucket_name: str = "file-uploads",
    project_id: Optional[str] = None,
    thread_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    ttl_seconds: Optional[int] = 86400,
    register_file: bool = True,
) -> dict:
    if not file_bytes:
        raise RuntimeError("Empty file payload")

    safe_name = _sanitize_filename(filename)
    storage_path = _build_storage_path(account_id, path_prefix, safe_name)

    try:
        r2 = get_r2_client()
        bucket = get_r2_bucket()
        r2.put_object(
            Bucket=bucket,
            Key=storage_path,
            Body=file_bytes,
            ContentType=content_type or "application/octet-stream",
        )
    except Exception as e:
        logger.error(f"Error uploading to R2: {e}")
        raise RuntimeError(f"Failed to upload image: {str(e)}")

    file_id: Optional[str] = None
    if register_file and account_id:
        try:
            file_id = str(uuid.uuid4())
            effective_bucket = bucket_name if bucket_name in ("file-uploads", "browser-screenshots") else "file-uploads"
            db = DBConnection()
            client = await db.client
            await client.table("file_uploads").insert({
                "id": file_id,
                "account_id": account_id,
                "user_id": user_id,
                "project_id": project_id,
                "thread_id": thread_id,
                "agent_id": agent_id,
                "bucket_name": effective_bucket,
                "storage_provider": "r2",
                "storage_bucket": get_r2_bucket(),
                "storage_path": storage_path,
                "original_filename": safe_name,
                "file_size": len(file_bytes),
                "content_type": content_type or "application/octet-stream",
                "status": "uploaded",
                "source": source,
            }).execute()
        except Exception as e:
            logger.warning(f"Failed to register file_uploads record: {e}")
            file_id = None

    signed_url: Optional[str] = None
    if ttl_seconds and ttl_seconds > 0:
        try:
            signed_url = create_presigned_get_url(
                key=storage_path,
                expires_in=ttl_seconds,
                download_filename=safe_name,
            )
        except Exception as e:
            logger.warning(f"Failed to create signed URL for {storage_path}: {e}")

    return {
        "file_id": file_id,
        "storage_path": storage_path,
        "signed_url": signed_url,
        "filename": safe_name,
        "content_type": content_type or "application/octet-stream",
        "size": len(file_bytes),
    }


async def upload_base64_image(
    base64_data: str,
    bucket_name: str = "image-uploads",
    account_id: Optional[str] = None,
    user_id: Optional[str] = None,
    source: str = "agent",
) -> str:
    """Upload a base64 encoded image to R2 and return a signed URL."""
    try:
        content_type = "image/png"
        if base64_data.startswith("data:"):
            header, _, payload = base64_data.partition(",")
            if payload:
                base64_data = payload
            header = header.lower()
            if ";" in header:
                content_type = header.split(";")[0].replace("data:", "") or content_type

        image_data = base64.b64decode(base64_data)

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        unique_id = str(uuid.uuid4())[:8]
        filename = f"image_{timestamp}_{unique_id}.png"

        result = await upload_bytes_to_r2(
            image_data,
            filename=filename,
            content_type=content_type,
            account_id=account_id,
            user_id=user_id,
            source=source,
            path_prefix=bucket_name,
            ttl_seconds=86400,
            register_file=bool(account_id),
        )

        if not result.get("signed_url"):
            raise RuntimeError("Signed URL unavailable")
        logger.debug(f"Successfully uploaded image to {result['signed_url']}")
        return result["signed_url"]
    except Exception as e:
        logger.error(f"Error uploading base64 image: {e}")
        raise RuntimeError(f"Failed to upload image: {str(e)}")


async def upload_image_bytes(
    image_bytes: bytes,
    content_type: str = "image/png",
    bucket_name: str = "agent-profile-images",
    account_id: Optional[str] = None,
    user_id: Optional[str] = None,
    source: str = "agent",
) -> str:
    try:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        unique_id = str(uuid.uuid4())[:8]
        ext = "png"
        if content_type in ("image/jpeg", "image/jpg"):
            ext = "jpg"
        elif content_type == "image/webp":
            ext = "webp"
        elif content_type == "image/gif":
            ext = "gif"
        filename = f"agent_profile_{timestamp}_{unique_id}.{ext}"

        result = await upload_bytes_to_r2(
            image_bytes,
            filename=filename,
            content_type=content_type,
            account_id=account_id,
            user_id=user_id,
            source=source,
            path_prefix=bucket_name,
            ttl_seconds=86400,
            register_file=bool(account_id),
        )
        if not result.get("signed_url"):
            raise RuntimeError("Signed URL unavailable")
        logger.debug(f"Successfully uploaded agent profile image to {result['signed_url']}")
        return result["signed_url"]
    except Exception as e:
        logger.error(f"Error uploading image bytes: {e}")
        raise RuntimeError(f"Failed to upload image: {str(e)}")
