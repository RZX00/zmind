"""Fixtures for the Canvas AI Operation & Comprehension Contract test suite.

Backs the §8 acceptance matrix (read slice). Provides:
- `make_simple`  : factory for an N-plain-text-node canvas (JSON-validity / sizing — RD1).
- `rich_canvas`  : a mixed canvas (mindmap group + column + todo + media + code + free edge)
                   for topology/containment tests (RD4/RD5).
"""

from __future__ import annotations

from typing import Any, Callable, Dict

import pytest


def make_simple_canvas(n: int) -> Dict[str, Any]:
    """N plain text nodes with non-trivial content — for JSON-validity and budget sizing."""
    nodes = [
        {
            "id": f"node-{i}",
            "type": "text",
            "x": (i % 20) * 60,
            "y": (i // 20) * 60,
            "width": 200,
            "height": 60,
            "content": f"note {i} " + ("lorem ipsum dolor sit amet " * 6),
        }
        for i in range(n)
    ]
    return {"title": "Sizing", "nodes": nodes, "connections": []}


def make_rich_canvas() -> Dict[str, Any]:
    """A mixed canvas exercising every containment mechanism + a free-floating edge."""
    group_id, root_id = "group-1", "node-root"
    branch_ids = [f"node-mm-{i}" for i in range(3)]
    col_id = "column-1"
    col_children = ["node-todo-0", "node-todo-1"]

    nodes = [
        {
            "id": group_id, "type": "group", "x": 0, "y": 0, "width": 480, "height": 360,
            "content": "Mindmap", "groupMode": "mindmap",
            "children": [root_id, *branch_ids],
            "mindmap": {
                "rootId": root_id, "orientation": "right",
                "siblingOrder": {root_id: branch_ids}, "collapsed": {},
            },
            "ai": True,
        },
        {
            "id": root_id, "type": "text", "x": 20, "y": 20, "width": 200, "height": 60,
            "content": "Root idea", "parentGroupId": group_id,
        },
    ]
    for i, cid in enumerate(branch_ids):
        nodes.append({
            "id": cid, "type": "text", "x": 260, "y": 20 + i * 80,
            "width": 200, "height": 60, "content": f"Branch {i}", "parentGroupId": group_id,
        })
    nodes.append({
        "id": col_id, "type": "column", "x": 700, "y": 0, "width": 300, "height": 220,
        "content": "Tasks", "children": col_children, "isCollapsed": False,
    })
    for i, cid in enumerate(col_children):
        nodes.append({
            "id": cid, "type": "todo", "x": 710, "y": 40 + i * 60, "width": 280, "height": 50,
            "content": f"todo {i}", "completed": i == 0, "parentGroupId": col_id,
        })
    nodes.append({
        "id": "media-1", "type": "media", "x": 1100, "y": 0, "width": 240, "height": 160,
        "content": "image", "mediaType": "image", "fileName": "d.png",
        "fileUrl": "https://signed.example/x", "storagePath": "ws/d.png", "locked": True,
    })
    nodes.append({
        "id": "code-1", "type": "code", "codeType": "mermaid", "x": 1100, "y": 220,
        "width": 350, "height": 250, "content": "flowchart TD\nA-->B",
    })

    connections = [
        {
            "id": f"connection-{cid}", "from": root_id, "to": cid, "label": "branch",
            "controlPoints": [{"x": 1, "y": 1}], "appearance": {"color": "#000", "width": 2},
        }
        for cid in branch_ids
    ]
    connections.append({
        "id": "connection-free", "from": None, "to": None,
        "fromPoint": {"x": 0, "y": 0}, "toPoint": {"x": 100, "y": 100},
    })
    return {"title": "Rich", "nodes": nodes, "connections": connections}


@pytest.fixture
def make_simple() -> Callable[[int], Dict[str, Any]]:
    return make_simple_canvas


@pytest.fixture
def rich_canvas() -> Dict[str, Any]:
    return make_rich_canvas()
