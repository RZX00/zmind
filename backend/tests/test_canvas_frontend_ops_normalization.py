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
FRONTEND_OPS_CONTRACT_FILE = (
    REPO_ROOT / "frontend" / "src" / "lib" / "canvas" / "realtime" / "opsContract.ts"
)


def _normalize_with_frontend(operations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if shutil.which("node") is None:
        pytest.skip("node is required for frontend normalization parity test")
    script = f"""
import {{ normalizeCanvasOps }} from {json.dumps(FRONTEND_OPS_CONTRACT_FILE.as_uri())};
const input = {json.dumps(operations, ensure_ascii=False)};
const cloned = globalThis.structuredClone ? structuredClone(input) : JSON.parse(JSON.stringify(input));
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


@pytest.mark.parametrize(
    "operations",
    [
        [{"type": "addNode", "node": {"id": "n1", "nodeType": "text", "childrenIds": ["n0"]}}],
        [{"operation": "updateNode", "nodeId": "n1", "patch": {"code_type": "mermaid"}}],
        [{"op": "add_connection", "connection_id": "c1", "source": "n1", "target": "n2"}],
        [
            {
                "op": "update_connection",
                "id": "c1",
                "patch": {"from_id": "n1", "to_id": "n2", "curve_anchor": {"x": 1, "y": 2}},
            }
        ],
        [{"op": "update_canvas", "patch": {"background_color": "#fff", "text_opacity_preset": "soft"}}],
        [{"op": "relayout_mindmap", "groupId": "g1"}],
    ],
)
def test_frontend_normalization_matches_backend(operations: list[dict[str, Any]]) -> None:
    backend_input = copy.deepcopy(operations)
    frontend_input = copy.deepcopy(operations)

    backend_normalized, _warnings = normalize_ops(backend_input)
    frontend_normalized = _normalize_with_frontend(frontend_input)

    assert backend_normalized == frontend_normalized


def _random_operation_cases(seed: int, count: int) -> list[list[dict[str, Any]]]:
    rng = random.Random(seed)
    cases: list[list[dict[str, Any]]] = []
    op_variants = [
        lambda idx: {
            "type": rng.choice(["addNode", "add_node"]),
            "node": {"id": f"n{idx}", "nodeType": "text", "childrenIds": [f"n{max(0, idx-1)}"]},
        },
        lambda idx: {
            "operation": rng.choice(["updateNode", "update_node"]),
            "nodeId": f"n{idx}",
            "patch": {"code_type": "mermaid", "children_ids": [f"n{idx+1}"]},
        },
        lambda idx: {
            "op": "add_connection",
            "connection_id": f"c{idx}",
            "source": f"n{idx}",
            "target": f"n{idx+1}",
            "curve_anchor": {"x": idx, "y": idx + 1},
        },
        lambda idx: {
            "op": "update_connection",
            "id": f"c{idx}",
            "patch": {"from_id": f"n{idx}", "to_id": f"n{idx+1}", "anchor_params": {"mode": "curved"}},
        },
        lambda idx: {
            "op": "update_canvas",
            "patch": {
                "background_color": "#fff",
                "text_layout_preset": "compact",
                "folder_id": f"folder-{idx}",
            },
        },
        lambda idx: {"action": "relayoutMindmap", "group_id": f"g{idx}"},
        lambda idx: {"op": "delete_node", "node_id": f"n{idx}"},
    ]
    for i in range(count):
        fn = rng.choice(op_variants)
        cases.append([fn(i)])
    return cases


def test_frontend_backend_normalization_fuzz_parity() -> None:
    for operations in _random_operation_cases(seed=20260219, count=40):
        backend_input = copy.deepcopy(operations)
        frontend_input = copy.deepcopy(operations)
        backend_normalized, _warnings = normalize_ops(backend_input)
        frontend_normalized = _normalize_with_frontend(frontend_input)
        assert backend_normalized == frontend_normalized
