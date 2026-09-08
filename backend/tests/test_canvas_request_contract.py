from __future__ import annotations

import pytest

from core.canvas.request_contract import (
    build_invalid_expected_version_detail,
    build_version_conflict_detail,
    extract_idempotency_key,
    extract_request_id,
    extract_session_id,
    parse_expected_server_version,
    read_header_value,
)


def test_read_header_value_case_insensitive() -> None:
    headers = {"x-client-request-id": "req-1"}
    assert read_header_value(headers, "X-Client-Request-Id") == "req-1"


def test_extract_request_and_idempotency_priorities() -> None:
    headers = {
        "X-Client-Request-Id": "req-1",
        "Idempotency-Key": "idem-1",
    }
    assert extract_request_id(headers) == "req-1"
    assert extract_idempotency_key(headers) == "idem-1"

    fallback_headers = {"X-Client-Request-Id": "req-2"}
    assert extract_idempotency_key(fallback_headers) == "req-2"


def test_extract_session_id_priority_chain() -> None:
    headers = {
        "X-Canvas-Session-Id": "canvas-session",
        "X-Client-Session-Id": "client-session",
    }
    assert extract_session_id(headers, fallback="fallback") == "canvas-session"

    client_only_headers = {"X-Client-Session-Id": "client-session"}
    assert extract_session_id(client_only_headers, fallback="fallback") == "client-session"

    assert extract_session_id({}, fallback="fallback") == "fallback"


def test_parse_expected_server_version() -> None:
    assert parse_expected_server_version(None) is None
    assert parse_expected_server_version("") is None
    assert parse_expected_server_version("42") == 42
    assert parse_expected_server_version(7) == 7

    with pytest.raises(ValueError):
        parse_expected_server_version("abc")


def test_build_invalid_expected_version_detail() -> None:
    detail = build_invalid_expected_version_detail()
    assert detail["code"] == "invalid_expected_version"
    assert detail["error"]["field"] == "expected_version"


def test_build_version_conflict_detail() -> None:
    detail = build_version_conflict_detail(
        expected_server_version=12,
        current_server_version=14,
    )
    assert detail["code"] == "version_conflict"
    assert detail["message"] == "Version conflict"
    assert detail["serverVersion"] == 14
    assert detail["expectedVersion"] == 12
    assert "hint" in detail["error"]
