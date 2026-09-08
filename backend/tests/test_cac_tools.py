import json

import pytest

from core.canvas.cac.engine import CaCEngine
from core.canvas.cac.tools import CanvasWriteTool
from core.canvas.id_utils import is_canvas_entity_id


@pytest.mark.asyncio
async def test_canvas_write_returns_id_map_for_temp_ids(monkeypatch):
    tool = CanvasWriteTool(thread_id="th_test", canvas_id="cv_test")

    async def _get_account_id():
        return "acct_test"

    async def _get_canvas_id():
        return "cv_test"

    async def _fetch_canvas(_account_id, canvas_id):
        return {"id": canvas_id, "title": "", "nodes": [], "connections": []}

    async def _get_selection_context():
        return None

    captured = {}

    async def _apply_operations(_account_id, _canvas_id, operations):
        captured["operations"] = operations
        return {"success": True}

    monkeypatch.setattr(tool, "_get_account_id", _get_account_id)
    monkeypatch.setattr(tool, "_get_canvas_id", _get_canvas_id)
    monkeypatch.setattr(tool, "_fetch_canvas", _fetch_canvas)
    monkeypatch.setattr(tool, "_get_selection_context", _get_selection_context)
    monkeypatch.setattr(tool, "_apply_operations", _apply_operations)

    res = await tool.write(
        layout="stack",
        anchor="viewport.center",
        nodes=[
            {"$id": "$1", "type": "text", "content": "A"},
            {"$id": "$2", "type": "text", "content": "B"},
        ],
        connections=[
            {"from": "$1", "to": "$2", "label": "rel"},
        ],
    )

    assert res.success is True
    payload = json.loads(res.output)
    assert payload["success"] is True

    id_map = payload["idMap"]
    assert isinstance(id_map, dict)
    assert is_canvas_entity_id(id_map["$1"])
    assert is_canvas_entity_id(id_map["$2"])
    assert id_map["$1"] != id_map["$2"]

    # Ensure temp IDs were resolved inside the same call.
    conn_ops = [op for op in captured["operations"] if op.get("op") == "add_connection"]
    assert conn_ops
    assert conn_ops[0]["from"] == id_map["$1"]
    assert conn_ops[0]["to"] == id_map["$2"]


@pytest.mark.asyncio
async def test_canvas_write_tree_returns_id_map(monkeypatch):
    tool = CanvasWriteTool(thread_id="th_test", canvas_id="cv_test")

    async def _get_account_id():
        return "acct_test"

    async def _get_canvas_id():
        return "cv_test"

    async def _fetch_canvas(_account_id, canvas_id):
        return {"id": canvas_id, "title": "", "nodes": [], "connections": []}

    async def _get_selection_context():
        return None

    async def _apply_operations(_account_id, _canvas_id, _operations):
        return {"success": True}

    monkeypatch.setattr(tool, "_get_account_id", _get_account_id)
    monkeypatch.setattr(tool, "_get_canvas_id", _get_canvas_id)
    monkeypatch.setattr(tool, "_fetch_canvas", _fetch_canvas)
    monkeypatch.setattr(tool, "_get_selection_context", _get_selection_context)
    monkeypatch.setattr(tool, "_apply_operations", _apply_operations)

    res = await tool.write(
        layout="mindmap",
        anchor="viewport.center",
        tree={
            "$id": "$root",
            "content": "Root",
            "children": [
                {"$id": "$a", "content": "A"},
                {"$id": "$b", "content": "B"},
            ],
        },
    )

    assert res.success is True
    payload = json.loads(res.output)
    id_map = payload["idMap"]
    assert set(id_map.keys()) == {"$root", "$a", "$b"}
    assert all(is_canvas_entity_id(str(v)) for v in id_map.values())


@pytest.mark.asyncio
async def test_canvas_write_mindmap_tree_creates_group_and_parent_group_ids(monkeypatch):
    tool = CanvasWriteTool(thread_id="th_test", canvas_id="cv_test")

    async def _get_account_id():
        return "acct_test"

    async def _get_canvas_id():
        return "cv_test"

    async def _fetch_canvas(_account_id, canvas_id):
        return {"id": canvas_id, "title": "", "nodes": [], "connections": []}

    async def _get_selection_context():
        return None

    captured = {}

    async def _apply_operations(_account_id, _canvas_id, operations):
        captured["operations"] = operations
        return {"success": True}

    monkeypatch.setattr(tool, "_get_account_id", _get_account_id)
    monkeypatch.setattr(tool, "_get_canvas_id", _get_canvas_id)
    monkeypatch.setattr(tool, "_fetch_canvas", _fetch_canvas)
    monkeypatch.setattr(tool, "_get_selection_context", _get_selection_context)
    monkeypatch.setattr(tool, "_apply_operations", _apply_operations)

    res = await tool.write(
        layout="mindmap",
        anchor="viewport.center",
        tree={
            "$id": "$root",
            "content": "Root",
            "children": [
                {"$id": "$a", "content": "A"},
                {"$id": "$b", "content": "B"},
            ],
        },
    )

    assert res.success is True
    payload = json.loads(res.output)
    assert is_canvas_entity_id(payload.get("groupId") or "")

    ops = captured.get("operations") or []
    add_node_ops = [op for op in ops if op.get("op") == "add_node"]
    assert add_node_ops, "expected add_node operations"

    group_id = payload["groupId"]
    group_op = next((op for op in add_node_ops if (op.get("node") or {}).get("id") == group_id), None)
    assert group_op, "expected mindmap group add_node op"
    group_node = group_op["node"]
    assert group_node.get("type") == "group"
    assert group_node.get("groupMode") == "mindmap"
    assert isinstance(group_node.get("mindmap"), dict)
    assert group_node["mindmap"].get("rootId"), "mindmap.rootId is required"
    assert isinstance(group_node.get("children"), list)

    # Ensure member nodes created in the same call carry parentGroupId = groupId.
    member_ids = [cid for cid in group_node.get("children") if isinstance(cid, str)]
    member_ops = [
        op for op in add_node_ops
        if (op.get("node") or {}).get("id") in set(member_ids)
    ]
    assert member_ops, "expected member add_node ops"
    assert all((op.get("node") or {}).get("parentGroupId") == group_id for op in member_ops)


def test_cac_engine_combo_selector_supports_hyphen_types():
    doc = {
        "nodes": [
            {"id": "n1", "type": "canvas-link", "title": "My Link", "x": 0, "y": 0, "width": 100, "height": 50},
            {"id": "n2", "type": "text", "content": "Other", "x": 0, "y": 80, "width": 100, "height": 50},
        ],
        "connections": [],
    }
    engine = CaCEngine(canvas_doc=doc)
    matched = engine.match_selector(".canvas-link[title='My Link']")
    assert [n.get("id") for n in matched] == ["n1"]
