from __future__ import annotations

import json
import re
from pathlib import Path

from core.canvas.ops_contract import ALLOWED_OPS, CANVAS_PATCH_KEYS, OP_ALIASES


REPO_ROOT = Path(__file__).resolve().parents[2]
REALTIME_CONTRACT_FILE = REPO_ROOT / "services" / "canvas-realtime" / "src" / "ops" / "contract.js"
FRONTEND_CONTRACT_FILE = REPO_ROOT / "frontend" / "src" / "lib" / "canvas" / "realtime" / "opsContract.ts"
DOC_SCHEMA_FILE = (
    REPO_ROOT / "docs" / "canvas-contract-v1" / "schema" / "canvas.ops.v1.json"
)


def _extract_array(file_content: str, const_name: str) -> list[str]:
    match = re.search(
        rf"export const {re.escape(const_name)}\s*=\s*Object\.freeze\(\[(.*?)\]\);",
        file_content,
        re.S,
    )
    assert match, f"Cannot locate array constant: {const_name}"
    return [token for token in re.findall(r"['\"]([^'\"]+)['\"]", match.group(1))]


def _extract_alias_object(file_content: str, const_name: str) -> dict[str, str]:
    match = re.search(
        rf"export const {re.escape(const_name)}\s*=\s*Object\.freeze\(\{{(.*?)\}}\);",
        file_content,
        re.S,
    )
    assert match, f"Cannot locate object constant: {const_name}"
    pairs = re.findall(r"([a-zA-Z0-9_]+)\s*:\s*['\"]([^'\"]+)['\"]", match.group(1))
    return {key: value for key, value in pairs}


def _schema_ops() -> set[str]:
    payload = json.loads(DOC_SCHEMA_FILE.read_text(encoding="utf-8"))
    ops: set[str] = set()
    for item in payload.get("items", {}).get("oneOf", []):
        op = item.get("properties", {}).get("op", {}).get("const")
        if isinstance(op, str):
            ops.add(op)
    return ops


def test_backend_allowed_ops_align_with_schema() -> None:
    assert set(ALLOWED_OPS) == _schema_ops()


def test_realtime_contract_matches_backend_contract() -> None:
    content = REALTIME_CONTRACT_FILE.read_text(encoding="utf-8")
    assert set(_extract_array(content, "ALLOWED_OPS")) == set(ALLOWED_OPS)
    assert _extract_alias_object(content, "OP_ALIASES") == OP_ALIASES
    assert set(_extract_array(content, "CANVAS_PATCH_KEYS")) == set(CANVAS_PATCH_KEYS)


def test_frontend_contract_matches_backend_contract() -> None:
    content = FRONTEND_CONTRACT_FILE.read_text(encoding="utf-8")
    assert set(_extract_array(content, "ALLOWED_OPS")) == set(ALLOWED_OPS)
    assert _extract_alias_object(content, "OP_ALIASES") == OP_ALIASES
    assert set(_extract_array(content, "CANVAS_PATCH_KEYS")) == set(CANVAS_PATCH_KEYS)

