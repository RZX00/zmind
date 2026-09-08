"""Read projection surfaces provenance (RD6) — the AI must be able to read who
authored a node/edge and its open judgment-state. stdlib-only, no network."""

from __future__ import annotations

from core.canvas.read_projection import (
    outline_canvas_connections,
    outline_canvas_nodes,
    simplify_canvas_connections,
    simplify_canvas_nodes,
)

NODE = {
    "id": "n1", "type": "text", "x": 0, "y": 0, "width": 100, "height": 50, "content": "hi",
    "provenance": {"createdBy": {"actor": "agent", "model": "opus"}, "updatedBy": {"actor": "human"}, "state": "draft"},
}
EDGE = {"id": "e1", "from": "a", "to": "b", "relation": "supports", "directed": True,
        "provenance": {"createdBy": {"actor": "agent"}}}


def test_structure_node_carries_compact_provenance():
    p = simplify_canvas_nodes([NODE])[0]["provenance"]
    assert p == {"by": "agent", "updatedBy": "human", "state": "draft"}


def test_structure_edge_carries_provenance_and_slots():
    e = simplify_canvas_connections([EDGE])[0]
    assert e["relation"] == "supports" and e["directed"] is True
    assert e["provenance"] == {"by": "agent"}


def test_outline_rows_carry_created_actor():
    nrow = outline_canvas_nodes([NODE])[0]
    erow = outline_canvas_connections([EDGE])[0]
    assert nrow["by"] == "agent"
    assert erow["by"] == "agent"


def test_provenance_absent_when_node_has_none():
    bare = {"id": "n2", "type": "text", "x": 0, "y": 0, "width": 1, "height": 1, "content": "x"}
    assert "provenance" not in simplify_canvas_nodes([bare])[0]
    assert "by" not in outline_canvas_nodes([bare])[0]


def test_partial_provenance_emits_only_present_subfields():
    node = {**{k: NODE[k] for k in ("id", "type", "x", "y", "width", "height", "content")},
            "provenance": {"createdBy": {"actor": "human"}}}
    assert simplify_canvas_nodes([node])[0]["provenance"] == {"by": "human"}
