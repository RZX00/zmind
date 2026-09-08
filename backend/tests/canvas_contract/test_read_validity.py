"""Canvas read contract — JSON validity, budget, and truncation exemption.

Acceptance IDs (contract §8): RD1, RD2, RD3.
"""

from __future__ import annotations

import json
from typing import Any, Dict

import pytest

from core.canvas.read_projection import (
    budget_read_result,
    simplify_canvas_connections,
    simplify_canvas_nodes,
)
from core.langgraph_engine.tool_message_truncation import (
    ToolMessageTruncation,
    truncate_tool_message_content,
)

MAX = 8000
_TRUNC = ToolMessageTruncation(max_chars=MAX, mode="head")


def _project_and_budget(canvas: Dict[str, Any], max_chars: int = MAX) -> Dict[str, Any]:
    result = {
        "canvas": {
            "id": "c1",
            "title": canvas.get("title", ""),
            "nodes": simplify_canvas_nodes(canvas["nodes"]),
            "connections": simplify_canvas_connections(canvas["connections"]),
        },
        "selection": [],
    }
    return budget_read_result(result, max_chars)


@pytest.mark.parametrize("n", [1, 50, 500, 5000])
def test_rd1_valid_budgeted_json(make_simple, n):
    """RD1: served read parses as JSON and stays within budget at every size."""
    result = _project_and_budget(make_simple(n))
    served = json.dumps(result, ensure_ascii=False)
    json.loads(served)  # must not raise
    assert len(served) <= MAX
    # topology is never dropped silently without a recorded omission marker
    kept = len(result["canvas"]["nodes"])
    if kept < n:
        assert result["meta"]["truncation"]["reason"] == "budget"
        assert result["meta"]["truncation"]["nodesOmitted"] == n - kept


def test_rd2_truncation_exempt_for_canvas_reads():
    """RD2: canvas read tools are exempt from byte-level head truncation; others are not."""
    big = "x" * (MAX * 3)
    out, was = truncate_tool_message_content(
        big, message_id="m", tool_name="canvas_read", truncation=_TRUNC
    )
    assert was is False and out == big  # exempt, byte-identical

    out2, was2 = truncate_tool_message_content(
        big, message_id="m", tool_name="some_other_tool", truncation=_TRUNC
    )
    assert was2 is True and len(out2) <= MAX  # non-canvas tools still truncate


def test_rd3_escaping_safe(make_simple):
    """RD3: control chars / quotes / lone surrogate in content still produce parseable JSON."""
    canvas = make_simple(3)
    canvas["nodes"][0]["content"] = 'ctrl\x00 "quote" \n newline \ud83d lone-surrogate'
    result = _project_and_budget(canvas)
    served = json.dumps(result, ensure_ascii=False)
    parsed = json.loads(served)  # must not raise
    assert parsed["canvas"]["nodes"][0]["id"] == "node-0"
