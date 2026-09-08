from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
from typing import Iterable, Optional
from urllib.parse import urlparse

import jwt


def _b64url_nopad(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("utf-8").rstrip("=")


def _is_timestamp_valid(claims: dict, now_ts: Optional[int], skew_sec: int) -> bool:
    now_value = int(now_ts or time.time())
    nbf = claims.get("nbf")
    exp = claims.get("exp")

    if isinstance(nbf, (int, float)) and now_value + skew_sec < int(nbf):
        return False
    if isinstance(exp, (int, float)) and now_value - skew_sec > int(exp):
        return False
    return True


def _matches_subject(subject: str, request_url: str) -> bool:
    if not subject:
        return True
    lhs = subject.rstrip("/")
    rhs = request_url.rstrip("/")
    if lhs == rhs:
        return True

    lhs_path = urlparse(lhs).path.rstrip("/")
    rhs_path = urlparse(rhs).path.rstrip("/")
    return bool(lhs_path and lhs_path == rhs_path)


def _matches_body_hash(claim_body: str, raw_body: bytes) -> bool:
    if not claim_body:
        return True

    digest_bytes = hashlib.sha256(raw_body or b"").digest()
    digest_hex = digest_bytes.hex()
    digest_b64 = base64.b64encode(digest_bytes).decode("utf-8")
    digest_b64url = _b64url_nopad(digest_bytes)

    normalized_claim = claim_body.strip().rstrip("=")
    candidates = {
        digest_hex,
        digest_b64.rstrip("="),
        digest_b64url,
    }
    return normalized_claim in candidates


def verify_qstash_signature(
    *,
    signature_header: str,
    raw_body: bytes,
    request_url: str,
    signing_keys: Iterable[str],
    skew_sec: int = 300,
    now_ts: Optional[int] = None,
) -> bool:
    token = (signature_header or "").strip()
    if not token:
        return False

    parts = token.split(".")
    if len(parts) != 3:
        return False

    signed_data = f"{parts[0]}.{parts[1]}".encode("utf-8")
    sig_part = parts[2].strip()

    for key in signing_keys:
        if not key:
            continue
        key_bytes = key.encode("utf-8")
        expected = _b64url_nopad(hmac.new(key_bytes, signed_data, hashlib.sha256).digest())
        if not hmac.compare_digest(expected, sig_part):
            continue

        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=["HS256", "HS512"],
                options={"verify_aud": False},
            )
        except Exception:
            continue

        if not _is_timestamp_valid(claims, now_ts=now_ts, skew_sec=skew_sec):
            continue

        issuer = str(claims.get("iss") or "")
        if issuer and issuer.lower() != "upstash":
            continue

        if not _matches_subject(str(claims.get("sub") or ""), request_url):
            continue

        if not _matches_body_hash(str(claims.get("body") or ""), raw_body):
            continue

        return True

    return False


def verify_qstash_signature_from_env(
    *,
    signature_header: str,
    raw_body: bytes,
    request_url: str,
    skew_sec: int = 300,
) -> bool:
    current_key = os.getenv("QSTASH_CURRENT_SIGNING_KEY", "").strip()
    next_key = os.getenv("QSTASH_NEXT_SIGNING_KEY", "").strip()

    keys = [k for k in [current_key, next_key] if k]
    if not keys:
        return False

    return verify_qstash_signature(
        signature_header=signature_header,
        raw_body=raw_body,
        request_url=request_url,
        signing_keys=keys,
        skew_sec=skew_sec,
    )
