from __future__ import annotations

import copy
import json
import random
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from core.canvas.ops_normalization import normalize_ops


REPO_ROOT = Path(__file__).resolve().parents[2]
REALTIME_APPLY_FILE = REPO_ROOT / "services" / "canvas-realtime" / "src" / "ops" / "applyCanvasOps.js"
FRONTEND_OPS_CONTRACT_FILE = (
    REPO_ROOT / "frontend" / "src" / "lib" / "canvas" / "realtime" / "opsContract.ts"
)


def _base_doc() -> dict[str, Any]:
    return {
        "id": "canvas-1",
        "title": "Canvas",
        "nodes": [
            {
                "id": "n1",
                "type": "text",
                "content": "node-1",
                "x": 0,
                "y": 0,
                "width": 300,
                "height": 60,
            },
            {
                "id": "n2",
                "type": "text",
                "content": "node-2",
                "x": 380,
                "y": 0,
                "width": 300,
                "height": 60,
            },
        ],
        "connections": [
            {
                "id": "connection-1",
                "from": "n1",
                "to": "n2",
            }
        ],
        "version": "1.0.0",
        "updatedAt": 1,
    }


def _normalize_with_realtime(operations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if shutil.which("node") is None:
        pytest.skip("node is required for realtime parity test")
    script = f"""
import {{ applyCanvasOps }} from {json.dumps(REALTIME_APPLY_FILE.as_uri())};
const operations = {json.dumps(operations, ensure_ascii=False)};
const doc = {json.dumps(_base_doc(), ensure_ascii=False)};
applyCanvasOps({{ doc, operations, now: 1, enforceClientIds: false }});
process.stdout.write(JSON.stringify(operations));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(f"realtime normalize failed: {result.stderr.strip()}")
    return json.loads(result.stdout.strip())


def _normalize_with_frontend(operations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if shutil.which("node") is None:
        pytest.skip("node is required for frontend parity test")
    script = f"""
import {{ normalizeCanvasOps }} from {json.dumps(FRONTEND_OPS_CONTRACT_FILE.as_uri())};
const operations = {json.dumps(operations, ensure_ascii=False)};
const cloned = globalThis.structuredClone ? structuredClone(operations) : JSON.parse(JSON.stringify(operations));
const result = normalizeCanvasOps(cloned);
process.stdout.write(JSON.stringify(result.operations));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(f"frontend normalize failed: {result.stderr.strip()}")
    return json.loads(result.stdout.strip())


def _normalization_projection(op: dict[str, Any]) -> dict[str, Any]:
    projection: dict[str, Any] = {"op": op.get("op")}
    for key in ("id", "from", "to"):
        if key in op:
            projection[key] = op.get(key)

    if isinstance(op.get("node"), dict):
        node = op["node"]
        projection["node"] = {
            key: node.get(key)
            for key in (
                "id",
                "type",
                "codeType",
                "groupMode",
                "targetCanvasId",
                "parentGroupId",
                "children",
            )
            if key in node
        }

    if isinstance(op.get("patch"), dict):
        patch = op["patch"]
        projection["patch"] = {
            key: patch.get(key)
            for key in (
                "type",
                "codeType",
                "groupMode",
                "targetCanvasId",
                "parentGroupId",
                "children",
                "curveAnchor",
                "anchorParams",
                "curveMode",
                "backgroundColor",
                "backgroundStyleId",
                "patternColor",
                "cornerStyle",
                "fontStyle",
                "textOpacityPreset",
                "textLayoutPreset",
                "folderId",
                "fromPoint",
                "toPoint",
                "from",
                "to",
            )
            if key in patch
        }

    return projection


@pytest.mark.parametrize(
    "operations,assertions",
    [
        (
            [{"type": "addNode", "node": {"id": "text-99", "nodeType": "text", "childrenIds": ["n1"]}}],
            lambda op: (op["op"], op["node"]["type"], op["node"]["children"]),
        ),
        (
            [{"op": "update_canvas", "patch": {"background_color": "#fff", "text_opacity_preset": "soft"}}],
            lambda op: (op["patch"]["backgroundColor"], op["patch"]["textOpacityPreset"]),
        ),
        (
            [{"op": "add_connection", "id": "connection-2", "source": "n1", "target": "n2"}],
            lambda op: (op["id"], op["from"], op["to"]),
        ),
        (
            [
                {
                    "op": "update_connection",
                    "id": "connection-1",
                    "patch": {"from_id": "n1", "to_id": "n2", "curve_anchor": {"x": 1, "y": 2}},
                }
            ],
            lambda op: (op["patch"]["from"], op["patch"]["to"], op["patch"]["curveAnchor"]),
        ),
        (
            [{"operation": "updateNode", "nodeId": "n1", "patch": {"code_type": "mermaid"}}],
            lambda op: (op["op"], op["id"], op["patch"]["codeType"]),
        ),
    ],
)
def test_backend_normalization_matches_realtime_behavior(
    operations: list[dict[str, Any]],
    assertions,
) -> None:
    backend_input = copy.deepcopy(operations)
    realtime_input = copy.deepcopy(operations)
    frontend_input = copy.deepcopy(operations)
    backend_normalized, _warnings = normalize_ops(backend_input)
    realtime_normalized = _normalize_with_realtime(realtime_input)
    frontend_normalized = _normalize_with_frontend(frontend_input)

    backend_op = backend_normalized[0]
    realtime_op = realtime_normalized[0]
    frontend_op = frontend_normalized[0]
    assert assertions(backend_op) == assertions(realtime_op)
    assert assertions(backend_op) == assertions(frontend_op)


def _random_operation_cases(seed: int, count: int) -> list[list[dict[str, Any]]]:
    rng = random.Random(seed)
    builders = [
        lambda idx: {
            "type": rng.choice(["addNode", "add_node"]),
            "node": {"id": f"n{idx + 1000}", "nodeType": "text", "childrenIds": [f"n{idx + 999}"]},
        },
        lambda idx: {
            "operation": rng.choice(["updateNode", "update_node"]),
            "nodeId": "n1" if idx % 2 == 0 else "n2",
            "patch": {"code_type": "mermaid", "children_ids": ["n2"]},
        },
        lambda idx: {
            "op": "add_connection",
            "connection_id": f"connection-{idx + 2}",
            "source": "n1",
            "target": "n2",
        },
        lambda idx: {
            "op": "update_connection",
            "id": "connection-1",
            "patch": {"from_id": "n1", "to_id": "n2", "curve_anchor": {"x": idx, "y": idx + 1}},
        },
        lambda idx: {
            "action": "updateCanvas",
            "patch": {"background_color": "#fff", "text_layout_preset": "compact"},
        },
    ]
    return [[rng.choice(builders)(i)] for i in range(count)]


def test_backend_realtime_frontend_fuzz_parity() -> None:
    for operations in _random_operation_cases(seed=20260219, count=20):
        backend_input = copy.deepcopy(operations)
        realtime_input = copy.deepcopy(operations)
        frontend_input = copy.deepcopy(operations)
        backend_normalized, _warnings = normalize_ops(backend_input)
        realtime_normalized = _normalize_with_realtime(realtime_input)
        frontend_normalized = _normalize_with_frontend(frontend_input)
        assert _normalization_projection(backend_normalized[0]) == _normalization_projection(realtime_normalized[0])
        assert _normalization_projection(backend_normalized[0]) == _normalization_projection(frontend_normalized[0])
