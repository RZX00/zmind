from __future__ import annotations

from types import SimpleNamespace

from core.integrations.openclaw.service import (
    DEFAULT_ALLOWED_CAPABILITIES,
    DEFAULT_ALLOWED_ROLES,
    extract_openclaw_context,
    normalize_activity_row,
    normalize_settings_row,
    sanitize_capability_list,
    sanitize_role_list,
)


def make_request(headers: dict[str, str]) -> SimpleNamespace:
    return SimpleNamespace(headers=headers)


def test_extract_openclaw_context_reads_headers() -> None:
    request = make_request(
        {
            "X-ZMind-Integration-Source": "openclaw",
            "X-ZMind-Integration-Client": "openclaw-plugin",
            "X-ZMind-Integration-Tool": "zmind_canvas_apply_ops",
            "X-Client-Request-Id": "req-1",
        }
    )

    context = extract_openclaw_context(request)

    assert context == {
        "source": "openclaw",
        "client": "openclaw-plugin",
        "tool_name": "zmind_canvas_apply_ops",
        "request_id": "req-1",
    }


def test_extract_openclaw_context_ignores_other_sources() -> None:
    request = make_request({"X-ZMind-Integration-Source": "obsidian"})

    assert extract_openclaw_context(request) is None


def test_sanitize_role_list_defaults_to_owner() -> None:
    assert sanitize_role_list(["owner", "OWNER", "member", "invalid"]) == ["owner", "member"]
    assert sanitize_role_list([]) == list(DEFAULT_ALLOWED_ROLES)


def test_sanitize_capability_list_filters_invalid_values() -> None:
    assert sanitize_capability_list(
        ["canvas.read", "canvas.read", "rollback.execute", "bad-capability"]
    ) == ["canvas.read", "rollback.execute"]
    assert sanitize_capability_list([]) == list(DEFAULT_ALLOWED_CAPABILITIES)
    assert "rollback.execute" in sanitize_capability_list([])


def test_normalize_settings_row_applies_defaults() -> None:
    row = normalize_settings_row(None, workspace_id="ws-1", workspace_role="owner")

    assert row["workspace_id"] == "ws-1"
    assert row["enabled"] is False
    assert row["allowed_roles"] == list(DEFAULT_ALLOWED_ROLES)
    assert row["allowed_capabilities"] == list(DEFAULT_ALLOWED_CAPABILITIES)
    assert row["workspace_role"] == "owner"


def test_normalize_activity_row_marks_rollback_availability() -> None:
    row = normalize_activity_row(
        {
            "id": "ocl_1",
            "workspace_id": "ws-1",
            "status": "succeeded",
            "rollback_payload": {"kind": "doc.undo_revision"},
            "rollback_status": "available",
            "metadata": {"version": 2},
        }
    )

    assert row["id"] == "ocl_1"
    assert row["can_rollback"] is True
    assert row["metadata"] == {"version": 2}
