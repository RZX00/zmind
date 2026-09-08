"""3-runtime op-set drift guard (WS1-2/3/4 codegen intent).

The canonical schema, the Python op contract, and the realtime JS op contract must
agree on the closed op-set. This delivers the no-drift guarantee that codegen would
enforce — without overwriting the load-bearing hand-written contract files (which the
audit flagged as risky to regenerate blind). If anyone adds an op to one runtime and
forgets the others, this test fails.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from core.canvas.ops_contract import ALLOWED_OPS as PY_OPS
from core.canvas.ops_contract import OP_ALIASES as PY_ALIASES

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = json.loads((ROOT / "schemas" / "canvas-schema.json").read_text(encoding="utf-8"))
CONTRACT_JS = (ROOT / "services" / "canvas-realtime" / "src" / "ops" / "contract.js").read_text(encoding="utf-8")


def _js_block(name: str) -> str:
    m = re.search(rf"{name}\s*=\s*Object\.freeze\(([\[{{].*?[\]}}])\)", CONTRACT_JS, re.S)
    assert m, f"{name} not found in contract.js"
    return m.group(1)


def _js_allowed_ops() -> set[str]:
    return set(re.findall(r'"([a-z_]+)"', _js_block("ALLOWED_OPS")))


def test_schema_python_js_op_sets_are_identical():
    schema_ops = set(SCHEMA["$defs"]["Op"]["enum"])
    py_ops = set(PY_OPS)
    js_ops = _js_allowed_ops()
    assert schema_ops == py_ops == js_ops, (
        f"op-set drift:\n  py-only={py_ops - schema_ops}\n  js-only={js_ops - schema_ops}\n  "
        f"schema-only={schema_ops - py_ops - js_ops}"
    )
    assert len(schema_ops) == 16


def test_aliases_resolve_into_the_canonical_set_in_both_runtimes():
    py_ops = set(PY_OPS)
    for target in PY_ALIASES.values():
        assert target in py_ops, f"py alias -> unknown op: {target}"
    js_targets = set(re.findall(r':\s*"([a-z_]+)"', _js_block("OP_ALIASES")))
    assert js_targets, "no JS alias targets parsed"
    assert js_targets <= _js_allowed_ops(), f"js alias -> unknown op: {js_targets - _js_allowed_ops()}"
