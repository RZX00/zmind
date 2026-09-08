"""Deterministic presentation critic — the readability fitness function (thinking-layer).

Pure / offline (WSL pytest): layout_critic imports only stdlib. Pins the golden corpus —
the persona-disaster (45 identical nodes in one column) MUST score below floor; a healthy
grid MUST score above it. This corpus is the regression floor the layout backend is tuned
against; every future readability bug appends a case here.
"""

from __future__ import annotations

from core.canvas.inference.layout_critic import (
    detect_node_overlap,
    detect_overflow_column,
    score_layout,
    SCORE_FLOOR_DEFAULT,
)


def _persona_disaster() -> dict:
    """Reproduces the real failure: ~40 text nodes 300x60 piled at x=792, y=0,90,180,..."""
    nodes = []
    for i in range(40):
        nodes.append({
            "id": f"n{i}", "type": "text", "content": f"item {i}",
            "x": 792, "y": i * 90, "width": 300, "height": 60,
            "parentGroupId": "g1",
        })
    # the mindmap group container itself (must be ignored by the body-node filter)
    nodes.append({
        "id": "g1", "type": "group", "x": -80, "y": -80, "width": 1252, "height": 3460,
        "groupMode": "mindmap", "children": [f"n{i}" for i in range(40)],
    })
    return {"nodes": nodes, "connections": []}


def _healthy_grid() -> dict:
    """9 nodes in a real 3x3 grid: distinct x columns, distinct y rows, well spread."""
    nodes = []
    k = 0
    for row in range(3):
        for col in range(3):
            nodes.append({
                "id": f"c{k}", "type": "text", "content": f"cell {k}",
                "x": col * 360, "y": row * 160, "width": 300, "height": 120,
            })
            k += 1
    return {"nodes": nodes, "connections": []}


def test_persona_disaster_below_floor():
    res = score_layout(_persona_disaster())
    assert res["below_floor"] is True, res
    assert res["score"] < SCORE_FLOOR_DEFAULT
    codes = {f["code"] for f in res["findings"]}
    assert "overflow_column" in codes
    # the dead-column finding must carry a concrete relayout suggestion
    col = next(f for f in res["findings"] if f["code"] == "overflow_column")
    assert col["severity"] == "error"
    assert "table" in col["suggestion"] or "mindmap" in col["suggestion"]


def test_healthy_grid_above_floor():
    res = score_layout(_healthy_grid())
    assert res["below_floor"] is False, res
    assert res["score"] >= SCORE_FLOOR_DEFAULT
    assert not any(f["code"] == "overflow_column" for f in res["findings"])


def test_empty_canvas_is_perfect_and_never_crashes():
    assert score_layout({"nodes": [], "connections": []})["score"] == 1.0
    assert score_layout({})["score"] == 1.0
    # malformed nodes must not crash the critic
    assert score_layout({"nodes": [{"id": "x"}, None, 5]})["score"] == 1.0


def test_small_canvas_not_flagged_as_column():
    # 5 nodes stacked is fine — only a real pile (>=8) is a "dead column"
    doc = {"nodes": [
        {"id": f"s{i}", "type": "text", "x": 0, "y": i * 90, "width": 300, "height": 60}
        for i in range(5)
    ], "connections": []}
    assert detect_overflow_column(doc) == []


def test_node_overlap_detected():
    doc = {"nodes": [
        {"id": "a", "type": "text", "x": 0, "y": 0, "width": 300, "height": 120},
        {"id": "b", "type": "text", "x": 10, "y": 10, "width": 300, "height": 120},
    ], "connections": []}
    out = detect_node_overlap(doc)
    assert out and out[0]["code"] == "node_overlap"
    assert set(out[0]["target_ids"]) == {"a", "b"}


# --- deterministic auto-relayout (substrate owns layout) -------------------------------
from core.canvas.inference.autolayout import plan_reflow


def _free_column(n: int = 24) -> dict:
    return {"nodes": [
        {"id": f"f{i}", "type": "text", "content": f"item {i}",
         "x": 800, "y": i * 90, "width": 300, "height": 60}
        for i in range(n)
    ], "connections": []}


def _apply_moves(doc: dict, ops: list) -> dict:
    by_id = {n["id"]: dict(n) for n in doc["nodes"]}
    for op in ops:
        if op["op"] == "move_node" and op["id"] in by_id:
            by_id[op["id"]]["x"] = op["x"]
            by_id[op["id"]]["y"] = op["y"]
    return {"nodes": list(by_id.values()), "connections": doc.get("connections", [])}


def test_reflow_turns_free_column_into_readable_grid():
    doc = _free_column(24)
    assert score_layout(doc)["below_floor"] is True  # starts as a dead column
    ops = plan_reflow(doc)
    assert len(ops) == 24 and all(o["op"] == "move_node" for o in ops)
    fixed = score_layout(_apply_moves(doc, ops))
    assert fixed["below_floor"] is False, fixed  # substrate fixed it deterministically
    assert not any(f["code"] == "overflow_column" for f in fixed["findings"])


def test_reflow_skips_grouped_nodes():
    doc = _free_column(24)
    for n in doc["nodes"]:
        n["parentGroupId"] = "g1"  # inside a container -> unsafe to move
    assert plan_reflow(doc) == []


def test_reflow_skips_pinned_nodes():
    doc = _free_column(24)
    doc["nodes"][0]["pinned"] = True
    assert plan_reflow(doc) == []  # any pinned in the pile -> abstain


def test_reflow_noop_on_healthy_canvas():
    assert plan_reflow(_healthy_grid()) == []


def test_single_rich_node_is_perfect():
    # the GOOD outcome for explanatory content: one big code/html infographic node
    doc = {"nodes": [
        {"id": "h1", "type": "code", "codeType": "html",
         "content": "<!DOCTYPE html>...", "x": 0, "y": 0, "width": 960, "height": 3000},
    ], "connections": []}
    res = score_layout(doc)
    assert res["score"] == 1.0 and res["below_floor"] is False
    assert res["findings"] == []
