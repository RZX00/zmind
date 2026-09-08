"""Canvas read contract — topology completeness & projection shape.

Acceptance IDs (contract §8): RD4 (full id enumeration), RD5 (bidirectional containment),
plus the mindmap-compaction and connection-projection guarantees that back them.
"""

from __future__ import annotations

from core.canvas.read_projection import (
    compact_mindmap_tree,
    simplify_canvas_connections,
    simplify_canvas_nodes,
)


def test_rd4_all_node_and_edge_ids_present(rich_canvas):
    """RD4: every node id and edge id is recoverable from one projection (no guessing)."""
    proj_nodes = simplify_canvas_nodes(rich_canvas["nodes"])
    proj_conns = simplify_canvas_connections(rich_canvas["connections"])
    assert {n["id"] for n in proj_nodes} == {n["id"] for n in rich_canvas["nodes"]}
    assert {c["id"] for c in proj_conns} == {c["id"] for c in rich_canvas["connections"]}


def test_rd5_containment_bidirectional(rich_canvas):
    """RD5: every member resolves its container, and every container its ordered members."""
    proj = simplify_canvas_nodes(rich_canvas["nodes"])
    by_id = {n["id"]: n for n in proj}

    # child -> container: every node with parentGroupId is listed in that container's children
    for n in proj:
        pid = n.get("parentGroupId")
        if pid:
            assert pid in by_id, f"dangling parentGroupId {pid}"
            assert n["id"] in by_id[pid].get("children", [])

    # container -> child: every child id resolves and points back
    for n in proj:
        for cid in n.get("children", []):
            assert cid in by_id, f"dangling child id {cid}"
            assert by_id[cid].get("parentGroupId") == n["id"]


def test_topology_fields_restored(rich_canvas):
    """The fields the old _simplify_nodes dropped (parentGroupId / ai / mediaType / etc.) are back."""
    proj = {n["id"]: n for n in simplify_canvas_nodes(rich_canvas["nodes"])}
    assert proj["node-root"]["parentGroupId"] == "group-1"
    assert proj["group-1"]["ai"] is True
    assert proj["media-1"]["mediaType"] == "image"
    assert proj["media-1"]["locked"] is True
    assert proj["node-todo-0"]["completed"] is True
    # signed url / storage internals are NOT projected to the model
    assert "fileUrl" not in proj["media-1"]
    assert "storagePath" not in proj["media-1"]


def test_mindmap_compact_tree(rich_canvas):
    """Mindmap is projected as a compact edge-list tree, not the raw siblingOrder/collapsed maps."""
    proj = {n["id"]: n for n in simplify_canvas_nodes(rich_canvas["nodes"])}
    mm = proj["group-1"]["mindmap"]
    assert mm["rootId"] == "node-root"
    assert ["node-root", "node-mm-0", 0] in mm["tree"]
    assert "siblingOrder" not in mm and "collapsed" not in mm


def test_connection_projection_drops_render_geometry(rich_canvas):
    """Connections keep topology (+ label, free endpoints); render geometry is excluded."""
    proj = simplify_canvas_connections(rich_canvas["connections"])
    for c in proj:
        assert "controlPoints" not in c and "appearance" not in c
    free = next(c for c in proj if c["id"] == "connection-free")
    assert free["fromPoint"] == {"x": 0, "y": 0}
    assert free["toPoint"] == {"x": 100, "y": 100}
    branch = next(c for c in proj if c["from"] == "node-root")
    assert branch["label"] == "branch"


def test_compact_mindmap_tree_pure():
    out = compact_mindmap_tree({"rootId": "r", "siblingOrder": {"r": ["a", "b"]}})
    assert out["rootId"] == "r"
    assert out["tree"] == [["r", "a", 0], ["r", "b", 1]]


def test_table_structure_projects_compact_data():
    """Table nodes expose a capped data.rows summary in structure projection."""
    from core.canvas.read_projection import compact_table_data, outline_canvas_nodes

    rows = [[f"r{i}c{j}" for j in range(3)] for i in range(12)]
    node = {"id": "t1", "type": "table", "content": "", "data": {"rows": rows, "columnWidths": [160, 160, 160]}}
    [proj] = simplify_canvas_nodes([node])
    assert proj["data"]["totalRows"] == 12
    assert proj["data"]["colCount"] == 3
    assert proj["data"]["truncated"] is True
    assert len(proj["data"]["rows"]) == 8
    assert proj["data"]["rows"][0][0] == "r0c0"

    compact = compact_table_data({"rows": [["a" * 200]]}, max_rows=8, cell_limit=80)
    assert compact is not None
    assert len(compact["rows"][0][0]) == 80

    [outline] = outline_canvas_nodes([node])
    assert outline["label"] == "12×3"
    assert outline["rowCount"] == 12
    assert outline["colCount"] == 3
    assert compact_mindmap_tree(None)["tree"] == []
