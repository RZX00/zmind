"""CanvasWriteError envelope (WS4) — backend mirror. stdlib-only, no heavy deps.

Kept byte-for-byte parallel with services/canvas-realtime/tests/errors.test.mjs so
the two runtimes classify identical messages identically.
"""

from __future__ import annotations

import json
import pathlib

from core.canvas.errors import (
    CANVAS_ERROR_CODES,
    make_canvas_error,
    normalize_canvas_error,
)


def test_missing_connection_endpoint():
    e = normalize_canvas_error(ValueError("add_connection: 'from' must reference an existing node."))
    assert e["code"] == "CONNECTION_ENDPOINT_MISSING"
    assert e["retryable"] is False
    assert "self_heal" not in e


def test_ambiguous_endpoint():
    e = normalize_canvas_error(ValueError("update_connection: choose either 'from' (node id) or 'fromPoint', not both"))
    assert e["code"] == "CONNECTION_ENDPOINT_INVALID"


def test_missing_node_non_connection():
    e = normalize_canvas_error(ValueError("group_nodes: node not found: x1"))
    assert e["code"] == "NODE_NOT_FOUND"


def test_duplicate_id_is_validation():
    e = normalize_canvas_error(ValueError("add_connection: duplicate id 'c1'"))
    assert e["code"] == "VALIDATION"


def test_op_index_threads_through():
    e = normalize_canvas_error(ValueError("Validation failed: bad"), op_index=3)
    assert e["code"] == "VALIDATION" and e["op_index"] == 3


def test_envelope_passthrough():
    env = {"code": "STALE_RELOAD", "retryable": True, "message": "stale"}
    assert normalize_canvas_error(env) is env


def test_make_canvas_error_attaches_self_heal():
    e = make_canvas_error("STALE_RELOAD", "doc moved on")
    assert e["code"] == "STALE_RELOAD" and e["retryable"] is True
    assert e["self_heal"] == {"action": "reload_canvas"}


def test_make_canvas_error_rejects_unknown_code():
    try:
        make_canvas_error("NOPE", "x")
    except ValueError as exc:
        assert "unknown canvas error code" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected ValueError")


def test_required_fields_present_and_code_in_enum():
    e = normalize_canvas_error("plain string failure")
    assert isinstance(e["message"], str) and e["message"]
    assert isinstance(e["retryable"], bool)
    assert e["code"] in CANVAS_ERROR_CODES


def test_classifier_branch_coverage():
    assert normalize_canvas_error(ValueError("node n1 is locked"))["code"] == "NODE_LOCKED"
    assert normalize_canvas_error(ValueError("operations must be a non-empty array"))["code"] == "EMPTY_BATCH"
    assert normalize_canvas_error(ValueError("batch too large: 600 ops exceeds the limit of 500"))["code"] == "BATCH_TOO_LARGE"
    assert normalize_canvas_error(ValueError("group_nodes: node not found: x"))["code"] == "NODE_NOT_FOUND"


def test_field_passthrough():
    assert normalize_canvas_error(ValueError("bad"), field="width")["field"] == "width"


def test_canvas_error_suffix_renders_code_retryable_self_heal():
    from core.canvas.errors import canvas_error_suffix, make_canvas_error

    s = canvas_error_suffix(make_canvas_error("STALE_RELOAD", "doc moved on"))
    assert "code=STALE_RELOAD" in s and "retryable=True" in s and "self_heal=reload_canvas" in s
    # a plain validation error (non-retryable, no recipe) renders code+retryable only
    s2 = canvas_error_suffix(normalize_canvas_error(ValueError("add_connection: duplicate id 'c1'")))
    assert "code=VALIDATION" in s2 and "retryable=False" in s2 and "self_heal" not in s2
    assert canvas_error_suffix({}) == "" and canvas_error_suffix(None) == ""


def test_codes_match_canonical_schema():
    """The code enum must equal schemas/canvas-schema.json's CanvasWriteError.code."""
    root = pathlib.Path(__file__).resolve().parents[3]
    schema = json.loads((root / "schemas" / "canvas-schema.json").read_text(encoding="utf-8"))
    schema_codes = schema["$defs"]["CanvasWriteError"]["properties"]["code"]["enum"]
    assert sorted(schema_codes) == sorted(CANVAS_ERROR_CODES)
