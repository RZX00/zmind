from __future__ import annotations

from typing import Mapping, Optional

try:
    from starlette.requests import Request
except Exception:  # pragma: no cover - starlette not available in some tooling contexts
    Request = None  # type: ignore


_DEFAULT_HEADER_KEYS = (
    "X-Idempotency-Key",
    "Idempotency-Key",
    "X-Client-Request-Id",
    "X-Request-Id",
)


def normalize_idempotency_key(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    if not isinstance(value, str):
        value = str(value)
    cleaned = value.strip()
    if not cleaned:
        return None
    # Avoid oversized keys in DB indexes.
    return cleaned[:200]


def extract_idempotency_key_from_headers(
    headers: Mapping[str, str],
    *,
    header_keys: tuple[str, ...] = _DEFAULT_HEADER_KEYS,
) -> Optional[str]:
    for key in header_keys:
        if key in headers and headers[key]:
            return normalize_idempotency_key(headers[key])
    # Try lower-case lookups if headers is a plain dict.
    lowered = {str(k).lower(): v for k, v in headers.items()}
    for key in header_keys:
        low = key.lower()
        if low in lowered and lowered[low]:
            return normalize_idempotency_key(lowered[low])
    return None


def get_idempotency_key(request: Request) -> Optional[str]:
    if request is None:
        return None
    headers = getattr(request, "headers", None)
    if not headers:
        return None
    return extract_idempotency_key_from_headers(headers)
