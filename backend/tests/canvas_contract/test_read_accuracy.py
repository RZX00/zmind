"""Read-projection accuracy fixes from the agent-surface audit (POS-1/3/4, REL-6/8).
read_projection imports standalone — offline pytest."""

from __future__ import annotations

from core.canvas.read_projection import (
    budget_read_result,
    count_free_edges,
    nodes_in_viewport,
    scope_edges,
    outline_canvas_connections,
    outline_containers,
    simplify_canvas_connections,
    simplify_canvas_nodes,
)

CAM = {"x": 0, "y": 0, "zoom": 1, "vw": 100, "vh": 100}  # visible rect [0,100]x[0,100]


def test_viewport_keeps_unpositioned_nodes():
    nodes = [{"id": "u", "type": "text"}, {"id": "p", "type": "text", "x": 10, "y": 10, "width": 5, "height": 5}]
    ids = {n["id"] for n in nodes_in_viewport(nodes, CAM)}
    assert "u" in ids and "p" in ids  # POS-1: un-positioned node kept, not hidden at origin


def test_viewport_includes_edge_flush_and_zero_size_nodes():
    nodes = [
        {"id": "edge", "type": "text", "x": 100, "y": 0, "width": 0, "height": 10},  # flush on right edge
        {"id": "pt", "type": "text", "x": 0, "y": 0, "width": 0, "height": 0},  # zero-size point at origin
        {"id": "out", "type": "text", "x": 500, "y": 500, "width": 10, "height": 10},  # clearly outside
    ]
    ids = {n["id"] for n in nodes_in_viewport(nodes, CAM)}
    assert "edge" in ids and "pt" in ids  # POS-4 inclusive
    assert "out" not in ids


def test_structure_marks_unpositioned_node_instead_of_null_geometry():
    [n] = simplify_canvas_nodes([{"id": "u", "type": "text", "content": "x"}])
    assert n.get("positioned") is False
    assert "x" not in n and "y" not in n  # POS-3: no null coords for overlap math
    [p] = simplify_canvas_nodes([{"id": "p", "type": "text", "content": "x", "x": 5, "y": 6, "width": 1, "height": 1}])
    assert p["x"] == 5 and "positioned" not in p
    # half-positioned (x set, y missing) -> still positioned:false, never a null coordinate (POS-3 OR)
    [h] = simplify_canvas_nodes([{"id": "h", "type": "text", "content": "x", "x": 5}])
    assert h.get("positioned") is False and "x" not in h and "y" not in h


def test_set_but_empty_relation_is_not_dropped():
    [s] = simplify_canvas_connections([{"id": "e", "from": "a", "to": "b", "relation": ""}])
    assert s["relation"] == ""  # REL-6: set-but-empty open-vocab relation preserved
    [o] = outline_canvas_connections([{"id": "e", "from": "a", "to": "b", "relation": ""}])
    assert o["relation"] == ""


def test_outline_containers_and_free_edge_count():
    nodes = [
        {"id": "g", "type": "group", "children": ["a", "b"], "groupMode": "mindmap", "mindmap": {"rootId": "g"}},
        {"id": "a", "type": "text"},
        {"id": "b", "type": "text"},
    ]
    [c] = outline_containers(nodes)
    assert c == {"id": "g", "type": "group", "childCount": 2, "groupMode": "mindmap", "mindmapRootId": "g"}
    conns = [{"id": "e1", "from": "a", "to": "b"}, {"id": "e2", "fromPoint": {"x": 0, "y": 0}, "to": "b"}]
    assert count_free_edges(conns) == 1


def _big(level):
    return {"canvas": {"nodes": [{"id": "n1", "type": "code", "content": "X" * 5000}]}}, level


def test_full_read_keeps_complete_content_pos2():
    result, level = _big("full")
    out = budget_read_result(result, max_chars=200, level=level)
    n = out["canvas"]["nodes"][0]
    assert len(n["content"]) == 5000 and not n.get("contentTruncated")  # full = complete content


def test_structure_read_still_shrinks_content():
    result, level = _big("structure")
    out = budget_read_result(result, max_chars=200, level=level)
    n = out["canvas"]["nodes"][0]
    assert n.get("contentTruncated") is True and len(n["content"]) < 5000


def test_scope_edges_keeps_cross_boundary_and_free_counts_boundary():
    conns = [
        {"id": "in", "from": "a", "to": "b"},  # both inside
        {"id": "cross", "from": "a", "to": "z"},  # one inside, one outside -> kept + counted
        {"id": "out", "from": "y", "to": "z"},  # both outside -> dropped
        {"id": "free", "fromPoint": {"x": 0, "y": 0}, "toPoint": {"x": 1, "y": 1}},  # both free -> kept, not boundary
    ]
    kept, boundary = scope_edges(conns, {"a", "b"})
    assert {c["id"] for c in kept} == {"in", "cross", "free"}  # REL-7: cross-boundary not lost (viewport)
    assert "out" not in {c["id"] for c in kept}
    assert boundary == 1
    # An explicit node selection must NOT pull in unrelated free edges (include_free=False).
    kept_sel, _ = scope_edges(conns, {"a", "b"}, include_free=False)
    assert {c["id"] for c in kept_sel} == {"in", "cross"}  # free dropped, cross-boundary kept
