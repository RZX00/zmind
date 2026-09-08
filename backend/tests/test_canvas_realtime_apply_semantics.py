from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
REALTIME_APPLY_FILE = REPO_ROOT / "services" / "canvas-realtime" / "src" / "ops" / "applyCanvasOps.js"


def _base_doc() -> dict[str, Any]:
    return {
        "id": "canvas-1",
        "title": "Canvas",
        "nodes": [
            {
                "id": "n1",
                "type": "text",
                "content": "A",
                "x": 0,
                "y": 0,
                "width": 300,
                "height": 60,
            },
            {
                "id": "n2",
                "type": "text",
                "content": "B",
                "x": 380,
                "y": 0,
                "width": 300,
                "height": 60,
            },
        ],
        "connections": [],
        "version": "1.0.0",
        "updatedAt": 1,
    }


def _run_apply(operations: list[dict[str, Any]]) -> dict[str, Any]:
    if shutil.which("node") is None:
        pytest.skip("node is required for realtime semantic tests")
    script = f"""
import {{ applyCanvasOps }} from {json.dumps(REALTIME_APPLY_FILE.as_uri())};
const operations = {json.dumps(operations, ensure_ascii=False)};
const doc = {json.dumps(_base_doc(), ensure_ascii=False)};
const result = applyCanvasOps({{ doc, operations, now: 1, enforceClientIds: false }});
process.stdout.write(JSON.stringify(result));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(f"realtime apply failed: {result.stderr.strip()}")
    return json.loads(result.stdout.strip())


def test_realtime_apply_maps_non_semantic_connection_id_for_followup_update() -> None:
    output = _run_apply(
        [
            {"op": "add_connection", "id": "client-conn-a", "from": "n1", "to": "n2"},
            {"op": "update_connection", "id": "client-conn-a", "patch": {"label": "mapped"}},
        ]
    )

    id_map = output.get("idMap") or {}
    mapped_id = id_map.get("client-conn-a")
    assert isinstance(mapped_id, str) and mapped_id
    assert mapped_id != "client-conn-a"

    connections = output["doc"]["connections"]
    target = next((conn for conn in connections if conn.get("id") == mapped_id), None)
    assert target is not None
    assert target.get("label") == "mapped"


def test_realtime_apply_maps_non_semantic_connection_id_for_followup_delete() -> None:
    output = _run_apply(
        [
            {"op": "add_connection", "id": "client-conn-b", "from": "n1", "to": "n2"},
            {"op": "delete_connection", "id": "client-conn-b"},
        ]
    )

    id_map = output.get("idMap") or {}
    mapped_id = id_map.get("client-conn-b")
    assert isinstance(mapped_id, str) and mapped_id
    assert mapped_id != "client-conn-b"

    remaining_ids = {str(conn.get("id")) for conn in output["doc"]["connections"]}
    assert mapped_id not in remaining_ids
