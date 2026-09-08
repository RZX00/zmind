from __future__ import annotations

from typing import Any, Mapping, Optional


def read_header_value(headers: Mapping[str, Any] | Any, name: str) -> Optional[str]:
    if headers is None:
        return None
    getter = getattr(headers, "get", None)
    if not callable(getter):
        return None
    value = getter(name)
    if value is None:
        value = getter(name.lower())
    if value is None:
        value = getter(name.upper())
    if value is None:
        return None
    if isinstance(value, list):
        return str(value[0]) if value else None
    return str(value)


def extract_request_id(headers: Mapping[str, Any] | Any) -> Optional[str]:
    return read_header_value(headers, "X-Client-Request-Id") or read_header_value(
        headers, "Idempotency-Key"
    )


def extract_idempotency_key(headers: Mapping[str, Any] | Any) -> Optional[str]:
    return read_header_value(headers, "Idempotency-Key") or read_header_value(
        headers, "X-Client-Request-Id"
    )


def extract_session_id(
    headers: Mapping[str, Any] | Any,
    *,
    fallback: Optional[str] = None,
) -> Optional[str]:
    return (
        read_header_value(headers, "X-Canvas-Session-Id")
        or read_header_value(headers, "X-Client-Session-Id")
        or fallback
    )


def parse_expected_server_version(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        return int(str(value))
    except Exception as exc:
        raise ValueError("If-Match must be a numeric serverVersion") from exc


def build_error_payload(
    *,
    code: str,
    message: str,
    field: Optional[str] = None,
    hint: Optional[str] = None,
    extras: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if field:
        error["field"] = field
    if hint:
        error["hint"] = hint
    payload: dict[str, Any] = {"error": error, "code": code, "message": message}
    if extras:
        for key, value in extras.items():
            if value is not None and key not in payload:
                payload[key] = value
    return payload


def build_invalid_expected_version_detail() -> dict[str, Any]:
    return build_error_payload(
        code="invalid_expected_version",
        message="If-Match must be a numeric serverVersion",
        field="expected_version",
    )


def build_version_conflict_detail(
    *,
    expected_server_version: Optional[int] = None,
    current_server_version: Optional[int] = None,
) -> dict[str, Any]:
    return build_error_payload(
        code="version_conflict",
        message="Version conflict",
        hint="Reload the canvas and retry with latest serverVersion.",
        extras={
            "expectedVersion": expected_server_version,
            "serverVersion": current_server_version,
        },
    )
