"""Canonical canvas schema artifact — structural contract (WS1-1).

Pins that schemas/canvas-schema.json exists, parses, and covers the substrate contract:
the 8 node types, the closed op-set, the universal connection slots + provenance (kept
OPEN), the canvas-link title rule, the one canvas_edit grammar, and the error envelope.
A later ticket (WS1-2) codegens ops_contract.py / contract.js / types from this file and
adds a 3-runtime drift test; this test guards the artifact itself.
"""

from __future__ import annotations

import json
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parents[3] / "schemas" / "canvas-schema.json"


def _load() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def test_artifact_exists_and_is_valid_json():
    assert SCHEMA_PATH.exists(), f"missing {SCHEMA_PATH}"
    doc = _load()
    assert doc["$schema"].startswith("https://json-schema.org/")


def test_covers_eight_node_types():
    doc = _load()
    assert doc["x-node-types"] == [
        "text", "code", "column", "table", "canvas-link", "todo", "media", "group"
    ]
    for variant in (
        "TextNode", "CodeNode", "ColumnNode", "TableNode",
        "CanvasLinkNode", "TodoNode", "MediaNode", "GroupNode",
    ):
        assert variant in doc["$defs"], f"missing $def {variant}"
    assert len(doc["$defs"]["Node"]["oneOf"]) == 8


def test_closed_op_set():
    ops = set(_load()["$defs"]["Op"]["enum"])
    base = {
        "add_node", "update_node", "delete_node", "move_node", "apply_style",
        "add_connection", "update_connection", "delete_connection", "update_canvas", "relayout_mindmap",
    }
    added = {"update_table_cell", "table_row_op", "table_col_op", "group_nodes", "ungroup", "set_collapsed"}
    assert base <= ops and added <= ops
    assert "attach_media" not in ops  # deferred (Appendix A.6)


def test_connection_has_universal_slots():
    conn = _load()["$defs"]["Connection"]["properties"]
    for slot in ("relation", "directed", "relationData", "provenance"):
        assert slot in conn


def test_provenance_state_and_origin_stay_open():
    prov = _load()["$defs"]["Provenance"]["properties"]
    assert "enum" not in prov["state"]   # never enum-validated by the substrate
    assert "enum" not in prov["origin"]


def test_canvas_link_title_required_only_there():
    doc = _load()
    assert "title" in doc["$defs"]["CanvasLinkNode"]["required"]
    assert "title" not in doc["$defs"]["TextNode"].get("required", [])


def test_one_canvas_edit_grammar():
    g = _load()["$defs"]["CanvasEditGrammar"]
    assert set(g["required"]) == {"operations"}
    assert g["additionalProperties"] is False


def test_error_envelope_codes():
    codes = set(_load()["$defs"]["CanvasWriteError"]["properties"]["code"]["enum"])
    assert {
        "STALE_RELOAD", "ID_REMAPPED", "VALIDATION", "NODE_LOCKED",
        "BATCH_TOO_LARGE", "TRANSPORT_RETRYABLE",
    } <= codes


def test_op_set_and_patch_keys_match_live_ops_contract():
    """Drift guard (WS1-2 intent): the artifact must stay aligned with the live Python op
    contract. The live base op-set is a subset of the artifact's (which adds the 6 new ops);
    patch keys must match exactly."""
    from core.canvas.ops_contract import ALLOWED_OPS, CANVAS_PATCH_KEYS

    artifact = _load()
    artifact_ops = set(artifact["$defs"]["Op"]["enum"])
    assert set(ALLOWED_OPS) <= artifact_ops, f"live ops not in artifact: {set(ALLOWED_OPS) - artifact_ops}"
    assert set(CANVAS_PATCH_KEYS) == set(artifact["$defs"]["CanvasPatchKey"]["enum"])
