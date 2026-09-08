"""Canvas read contract — detail levels (outline | structure | full).

WS2-4. The `outline` projection is the lightest read for orienting on large canvases;
`structure` (default) is covered by test_read_contract.py. Method-level routing + the
`full` cap live in CanvasReadTool.read (syntax-checked; exercised by the full suite).
"""

from __future__ import annotations

from core.canvas.read_projection import (
    _content_label,
    outline_canvas_connections,
    outline_canvas_nodes,
)


def test_content_label_first_nonempty_line_truncated():
    assert _content_label("  first line  \n second") == "first line"
    assert _content_label("\n\n  hello world") == "hello world"
    assert _content_label("x" * 200) == "x" * 80
    assert _content_label(None) == ""
    assert _content_label("") == ""


def test_outline_node_shape(rich_canvas):
    """Outline rows carry only id/type/label/topology/markers — no geometry, no content body."""
    rows = {n["id"]: n for n in outline_canvas_nodes(rich_canvas["nodes"])}
    g = rows["group-1"]
    assert g["type"] == "group"
    assert g["label"] == "Mindmap"
    assert g["groupMode"] == "mindmap"
    assert g["childCount"] == 4  # root + 3 branches
    assert g["ai"] is True
    # geometry and full content body are NOT in the outline
    for forbidden in ("x", "y", "width", "height", "content", "children", "mindmap"):
        assert forbidden not in g
    assert rows["media-1"]["locked"] is True
    assert rows["node-root"]["parentGroupId"] == "group-1"


def test_outline_enumerates_all_ids(rich_canvas):
    """RD4 also holds at outline level: every node id is recoverable."""
    rows = outline_canvas_nodes(rich_canvas["nodes"])
    assert {r["id"] for r in rows} == {n["id"] for n in rich_canvas["nodes"]}


def test_outline_connections_minimal(rich_canvas):
    conns = outline_canvas_connections(rich_canvas["connections"])
    assert {c["id"] for c in conns} == {c["id"] for c in rich_canvas["connections"]}
    for c in conns:
        assert set(c.keys()) <= {"id", "from", "to", "relation"}  # no label / geometry
