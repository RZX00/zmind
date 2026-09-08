from __future__ import annotations

from core.canvas.ops_normalization import normalize_ops


def test_normalize_ops_op_alias_and_node_fields() -> None:
    ops = [
        {
            "type": "addNode",
            "node": {"nodeType": "text", "childrenIds": ["n1"]},
        }
    ]
    normalized, _warnings = normalize_ops(ops)
    op = normalized[0]
    assert op["op"] == "add_node"
    assert op["node"]["type"] == "text"
    assert op["node"]["children"] == ["n1"]


def test_normalize_ops_update_canvas_patch_aliases() -> None:
    ops = [
        {
            "op": "update_canvas",
            "patch": {
                "background_color": "#fff",
                "text_opacity_preset": "soft",
            },
        }
    ]
    normalized, _warnings = normalize_ops(ops)
    patch = normalized[0]["patch"]
    assert patch["backgroundColor"] == "#fff"
    assert patch["textOpacityPreset"] == "soft"


def test_normalize_ops_connection_aliases() -> None:
    ops = [
        {
            "op": "add_connection",
            "connection_id": "c1",
            "source": "n1",
            "target": "n2",
        }
    ]
    normalized, _warnings = normalize_ops(ops)
    op = normalized[0]
    assert op["id"] == "c1"
    assert op["from"] == "n1"
    assert op["to"] == "n2"


def test_normalize_ops_update_connection_patch_aliases() -> None:
    ops = [
        {
            "op": "update_connection",
            "id": "c1",
            "patch": {
                "from_id": "n1",
                "to_id": "n2",
                "curve_anchor": {"x": 1, "y": 2},
            },
        }
    ]
    normalized, _warnings = normalize_ops(ops)
    patch = normalized[0]["patch"]
    assert patch["from"] == "n1"
    assert patch["to"] == "n2"
    assert patch["curveAnchor"] == {"x": 1, "y": 2}


def test_normalize_ops_update_node_id_alias() -> None:
    ops = [
        {
            "operation": "updateNode",
            "nodeId": "n1",
            "patch": {"code_type": "mermaid"},
        }
    ]
    normalized, _warnings = normalize_ops(ops)
    op = normalized[0]
    assert op["op"] == "update_node"
    assert op["id"] == "n1"
    assert op["patch"]["codeType"] == "mermaid"
