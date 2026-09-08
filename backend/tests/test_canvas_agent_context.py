from __future__ import annotations

from core.canvas.agent_context import (
    evaluate_cross_canvas_write_guard,
    normalize_selection_context_payload,
)


def test_cross_canvas_guard_allows_explicit_target_canvas() -> None:
    error = evaluate_cross_canvas_write_guard(
        {
            "workspace_target_canvas": {"canvas_id": "cv-other"},
            "workspace_write_policy": {
                "cross_canvas_write_requires_explicit_target": True,
                "cross_canvas_write_allowed": True,
                "target_canvas_id": "cv-other",
            },
        },
        bound_canvas_id="cv-default",
        target_canvas_id="cv-other",
    )
    assert error is None


def test_cross_canvas_guard_blocks_policy_target_mismatch() -> None:
    error = evaluate_cross_canvas_write_guard(
        {
            "workspace_write_policy": {
                "cross_canvas_write_requires_explicit_target": True,
                "cross_canvas_write_allowed": True,
                "target_canvas_id": "cv-policy",
            },
        },
        bound_canvas_id="cv-default",
        target_canvas_id="cv-other",
    )
    assert isinstance(error, str)
    assert "policy target" in error


def test_normalize_selection_context_rejects_stale_payload() -> None:
    payload = {
        "meta": {"canvas_id": "cv-1", "selection_ts": 1000},
        "nodes": [{"id": "n1", "type": "text"}],
    }
    normalized, warnings = normalize_selection_context_payload(
        payload,
        now_ms=1000 + 31 * 60 * 1000,
    )
    assert normalized is None
    assert "selection_context_stale" in warnings


def test_normalize_selection_context_keeps_connection_only_payload() -> None:
    payload = {
        "meta": {"canvas_id": "cv-1", "selection_ts": 2000},
        "connections": [{"id": "c1", "from": "n1", "to": "n2"}],
    }
    normalized, warnings = normalize_selection_context_payload(
        payload,
        target_canvas_id="cv-1",
        now_ms=2001,
    )
    assert warnings == []
    assert normalized is not None
    assert normalized.get("nodes") == []
    assert normalized.get("connections") == [{"id": "c1", "from": "n1", "to": "n2"}]
