"""Deterministic auto-relayout (thinking-layer, no LLM).

When the LayoutCritic flags an unreadable shape, the substrate can FIX it itself —
deterministically, server-side, with zero extra LLM turns — instead of asking the agent
to retry (which it does unreliably). This is the "substrate owns layout" half of the
capability: the agent declares content; the substrate guarantees a readable arrangement.

``plan_reflow(doc)`` returns a list of ``move_node`` ops that turn a dead vertical column
of FREE (non-container-child, non-pinned) nodes into a balanced grid. It is intentionally
conservative — it only touches nodes it can move safely:
  * skips any node inside a group/column (``parentGroupId``) — moving those fights
    containment; those cases fall back to the agent steer (re-render as a table).
  * skips pinned / intentionally-placed nodes (``pinned`` / ``positionIsIntentional``).
Returns [] when there is nothing it can safely fix, so the caller can fall back.
stdlib-only -> offline-testable.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List

from core.canvas.inference.layout_critic import score_layout

GRID_GAP_X = 48.0
GRID_GAP_Y = 36.0


def _is_movable(node: Dict[str, Any]) -> bool:
    if node.get("parentGroupId"):
        return False
    if node.get("pinned") or node.get("positionIsIntentional"):
        return False
    if node.get("type") in ("group", "column"):
        return False
    return True


def _grid_cols(n: int) -> int:
    """Prefer a slightly-wide grid (readable landscape, not a tall stack)."""
    if n <= 1:
        return 1
    return max(2, int(math.ceil(math.sqrt(n * 1.6))))


def plan_reflow(doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return move_node ops that reflow safely-movable dead columns into a grid, or []."""
    crit = score_layout(doc)
    columns = [f for f in crit.get("findings", []) if f.get("code") == "overflow_column"]
    if not columns:
        return []

    by_id = {n.get("id"): n for n in (doc.get("nodes") or []) if isinstance(n, dict) and n.get("id")}
    ops: List[Dict[str, Any]] = []

    for finding in columns:
        ids = [i for i in (finding.get("target_ids") or []) if i in by_id]
        nodes = [by_id[i] for i in ids]
        if len(nodes) < 2 or not all(_is_movable(n) for n in nodes):
            # cannot safely auto-fix this pile (grouped / pinned) -> leave for the agent steer
            continue

        # anchor the grid at the pile's current top-left
        x0 = min(float(n.get("x", 0)) for n in nodes)
        y0 = min(float(n.get("y", 0)) for n in nodes)
        cols = _grid_cols(len(nodes))

        # uniform pitch from the max box in the pile keeps the grid aligned (no ragged cells)
        cell_w = max(float(n.get("width") or 300) for n in nodes) + GRID_GAP_X
        cell_h = max(float(n.get("height") or 60) for n in nodes) + GRID_GAP_Y

        for idx, n in enumerate(nodes):
            row, col = divmod(idx, cols)
            ops.append({
                "op": "move_node",
                "id": n["id"],
                "x": round(x0 + col * cell_w, 2),
                "y": round(y0 + row * cell_h, 2),
            })

    return ops
