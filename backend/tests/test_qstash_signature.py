from __future__ import annotations

import base64
import hashlib
import time

import jwt

from core.triggers.scheduling.signature import verify_qstash_signature


def _make_signature(*, key: str, body: bytes, url: str, now_ts: int) -> str:
    claims = {
        "iss": "upstash",
        "sub": url,
        "body": base64.b64encode(hashlib.sha256(body).digest()).decode("utf-8"),
        "nbf": now_ts - 10,
        "exp": now_ts + 60,
    }
    return jwt.encode(claims, key, algorithm="HS256")


def test_verify_qstash_signature_accepts_valid_token() -> None:
    key = "test-signing-key"
    body = b'{"trigger_id":"abc"}'
    url = "https://example.com/api/triggers/abc/webhook"
    now_ts = int(time.time())

    signature = _make_signature(key=key, body=body, url=url, now_ts=now_ts)

    assert (
        verify_qstash_signature(
            signature_header=signature,
            raw_body=body,
            request_url=url,
            signing_keys=[key],
            now_ts=now_ts,
        )
        is True
    )


def test_verify_qstash_signature_rejects_body_mismatch() -> None:
    key = "test-signing-key"
    body = b'{"trigger_id":"abc"}'
    tampered_body = b'{"trigger_id":"xyz"}'
    url = "https://example.com/api/triggers/abc/webhook"
    now_ts = int(time.time())

    signature = _make_signature(key=key, body=body, url=url, now_ts=now_ts)

    assert (
        verify_qstash_signature(
            signature_header=signature,
            raw_body=tampered_body,
            request_url=url,
            signing_keys=[key],
            now_ts=now_ts,
        )
        is False
    )
