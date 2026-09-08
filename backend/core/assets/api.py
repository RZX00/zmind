from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, validator

from core.auth import require_admin
from core.services.supabase import DBConnection
from core.services.r2_storage import create_presigned_get_url
from core.utils.logger import logger

router = APIRouter(tags=["assets"])

ASSET_KEY_WECHAT_QR = "wechat-qr"
SIGNED_TTL = 60 * 60 * 24 * 7  # 7 days


class AssetPayload(BaseModel):
    path: str
    public_url: str

    @validator("path", "public_url")
    def non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("value is required")
        return v.strip()


def _serialize(row: dict, effective_url: Optional[str] = None) -> dict:
    return {
        "key": row.get("key"),
        "path": row.get("path"),
        "public_url": effective_url or row.get("public_url"),
        "updated_at": row.get("updated_at"),
        "updated_by": row.get("updated_by"),
    }


async def _fetch_asset(client, key: str) -> Optional[dict]:
    res = await client.table("public_assets").select("*").eq("key", key).limit(1).execute()
    if res.data:
        return res.data[0]
    return None


async def _with_signed_url(client, row: dict) -> str:
    """
    Generate a fresh signed URL for the stored path (R2).
    Falls back to stored public_url.
    """
    path = row.get("path")
    if not path:
        return row.get("public_url")
    if isinstance(path, str) and path.lower().startswith("http"):
        return path
    try:
        url = create_presigned_get_url(path, SIGNED_TTL)
        return url or row.get("public_url")
    except Exception as e:
        logger.debug(f"[ASSETS] Failed to sign URL for {path}: {e}")
        return row.get("public_url")


@router.get("/public/assets/wechat-qr")
async def get_public_wechat_qr() -> dict:
    """
    Public endpoint: returns the currently active WeChat QR code asset.
    """
    try:
        db = DBConnection()
        client = await db.client
        row = await _fetch_asset(client, ASSET_KEY_WECHAT_QR)
        if not row:
            raise HTTPException(status_code=404, detail="WeChat QR not set")
        url = await _with_signed_url(client, row)
        return _serialize(row, url)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ASSETS] Failed to load public WeChat QR: {e}")
        raise HTTPException(status_code=500, detail="Failed to load WeChat QR asset")


@router.get("/admin/assets/wechat-qr")
async def get_admin_wechat_qr(_: dict = Depends(require_admin)) -> dict:
    """
    Admin endpoint: fetch current asset metadata.
    """
    try:
        db = DBConnection()
        client = await db.client
        row = await _fetch_asset(client, ASSET_KEY_WECHAT_QR)
        if not row:
            raise HTTPException(status_code=404, detail="WeChat QR not set")
        url = await _with_signed_url(client, row)
        return _serialize(row, url)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ASSETS] Failed to load admin WeChat QR: {e}")
        raise HTTPException(status_code=500, detail="Failed to load WeChat QR asset")


@router.post("/admin/assets/wechat-qr")
async def upsert_wechat_qr(
    payload: AssetPayload,
    admin: dict = Depends(require_admin),
) -> dict:
    """
    Admin endpoint: set/replace WeChat QR asset metadata after upload.
    """
    try:
        if not payload.public_url.lower().startswith("http"):
            raise HTTPException(status_code=400, detail="Invalid public_url")

        db = DBConnection()
        client = await db.client
        now = datetime.now(timezone.utc).isoformat()

        row = {
            "key": ASSET_KEY_WECHAT_QR,
            "path": payload.path,
            "public_url": payload.public_url,
            "updated_by": admin.get("user_id"),
            "updated_at": now,
        }
        await client.table("public_assets").upsert(row).execute()

        saved = await _fetch_asset(client, ASSET_KEY_WECHAT_QR)
        effective = await _with_signed_url(client, saved or row)
        return _serialize(saved or row, effective)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ASSETS] Failed to upsert WeChat QR asset: {e}")
        raise HTTPException(status_code=500, detail="Failed to save WeChat QR asset")
