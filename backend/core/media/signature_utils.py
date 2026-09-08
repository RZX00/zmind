"""HMAC-based URL signing for presentation image embedding.

Generates and verifies signatures that allow sandboxed iframes
to access media files without JWT authentication.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from urllib.parse import quote, urlencode

from core.utils.logger import logger

_CANVAS_SIGNATURE_PREFIX = "pres_v1"
_DOC_SIGNATURE_PREFIX = "doc_v1"
_DEFAULT_TTL = 604800  # 7 days


def _get_signing_key() -> bytes:
    from core.utils.config import config
    secret = config.SUPABASE_JWT_SECRET
    if not secret:
        raise RuntimeError("SUPABASE_JWT_SECRET not configured — cannot sign media URLs")
    return secret.encode("utf-8")


def _build_canonical(
    *,
    prefix: str,
    path: str,
    entity_id: str,
    ts: int,
    ttl: int,
) -> bytes:
    return f"{prefix}|{path}|{entity_id}|{ts}|{ttl}".encode("utf-8")


def generate_media_signature(
    path: str,
    canvas_id: str,
    ttl: int = _DEFAULT_TTL,
) -> tuple[str, int]:
    """Generate an HMAC-SHA256 signature for a media storage path.

    Returns:
        (signature_hex, unix_timestamp)
    """
    ts = int(time.time())
    canonical = _build_canonical(
        prefix=_CANVAS_SIGNATURE_PREFIX,
        path=path,
        entity_id=canvas_id,
        ts=ts,
        ttl=ttl,
    )
    sig = hmac.new(_get_signing_key(), canonical, hashlib.sha256).hexdigest()
    return sig, ts


def verify_media_signature(
    path: str,
    canvas_id: str | None,
    sig: str,
    ts: int,
    ttl: int,
) -> bool:
    """Verify an HMAC-SHA256 media signature.

    Returns True only if the signature is valid AND not expired.
    """
    if not sig or not ts or not canvas_id:
        return False

    now = int(time.time())
    if now - ts > ttl:
        logger.debug("media signature expired: age=%ds ttl=%ds", now - ts, ttl)
        return False

    canonical = _build_canonical(
        prefix=_CANVAS_SIGNATURE_PREFIX,
        path=path,
        entity_id=canvas_id,
        ts=ts,
        ttl=ttl,
    )
    expected = hmac.new(_get_signing_key(), canonical, hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


def build_signed_media_url(
    storage_path: str,
    canvas_id: str,
    *,
    ttl: int = _DEFAULT_TTL,
    base: str = "/api/media/file-uploads",
) -> str:
    """Build a complete signed URL ready for embedding in HTML.

    Example output:
        /api/media/file-uploads/acc123/canvas-media/img.png?canvas_id=c1&sig=ab12&ts=170000&ttl=604800
    """
    sig, ts = generate_media_signature(storage_path, canvas_id, ttl=ttl)
    encoded_path = quote(storage_path, safe="/")
    params = urlencode({
        "canvas_id": canvas_id,
        "sig": sig,
        "ts": str(ts),
        "ttl": str(ttl),
    })
    return f"{base}/{encoded_path}?{params}"


def generate_doc_media_signature(
    path: str,
    doc_item_id: str,
    ttl: int = _DEFAULT_TTL,
) -> tuple[str, int]:
    ts = int(time.time())
    canonical = _build_canonical(
        prefix=_DOC_SIGNATURE_PREFIX,
        path=path,
        entity_id=doc_item_id,
        ts=ts,
        ttl=ttl,
    )
    sig = hmac.new(_get_signing_key(), canonical, hashlib.sha256).hexdigest()
    return sig, ts


def verify_doc_media_signature(
    path: str,
    doc_item_id: str | None,
    sig: str,
    ts: int,
    ttl: int,
) -> bool:
    if not sig or not ts or not doc_item_id:
        return False

    now = int(time.time())
    if now - ts > ttl:
        logger.debug("doc media signature expired: age=%ds ttl=%ds", now - ts, ttl)
        return False

    canonical = _build_canonical(
        prefix=_DOC_SIGNATURE_PREFIX,
        path=path,
        entity_id=doc_item_id,
        ts=ts,
        ttl=ttl,
    )
    expected = hmac.new(_get_signing_key(), canonical, hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


def build_signed_doc_media_url(
    storage_path: str,
    doc_item_id: str,
    *,
    ttl: int = _DEFAULT_TTL,
    base: str = "/api/media/file-uploads",
) -> str:
    sig, ts = generate_doc_media_signature(storage_path, doc_item_id, ttl=ttl)
    encoded_path = quote(storage_path, safe="/")
    params = urlencode({
        "doc_item_id": doc_item_id,
        "sig": sig,
        "ts": str(ts),
        "ttl": str(ttl),
    })
    return f"{base}/{encoded_path}?{params}"
