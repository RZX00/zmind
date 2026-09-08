"""Deterministic canvas PRESENTATION critic (thinking-layer, no LLM).

A content-agnostic *fitness function* for how READABLE a canvas layout is. Pure
functions over the raw doc ``{nodes, connections}`` (the shape read_projection /
diagnostics consume), stdlib-only -> offline-testable.

This is the substrate's measurement of quality — the thing prompts can only *assert*.
``score_layout(doc)`` returns a single scalar in [0,1] plus per-dimension breakdown and
hint-level findings, each carrying a ``suggestion`` of which representation to switch to.
The live agent receives this via the write-tool / canvas_read meta (same channel it
already trusts for ``diagnostics``), so it can SEE that its output is an unreadable
3240px column and fix it — instead of writing blind.

Geometric only: it never judges *meaning* (claim/evidence quality is a different axis).
Generalises by continuous geometry features (aspect ratio, x-spread, overlap, off-canvas
sprawl, content-fit), not per-scenario rules — unknown shapes degrade to the generic
judgments, so it is a total function that never crashes.
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

# Tunables (kept module-level so tests + the golden corpus pin exact thresholds).
COLUMN_MIN_NODES = 8           # a "column" only matters once it's a real pile
COLUMN_X_BUCKET = 60.0         # nodes within this x-distance count as the same column
COLUMN_ASPECT = 3.0            # height:width of the pile beyond which it's a "dead column"
OVERLAP_PADDING = 8.0          # gap below which two boxes are "overlapping"
OVERLAP_MAX_PENALTY = 0.3
OFFSCREEN_HEIGHT = 2200.0      # a single span taller than this scrolls off any screen
OFFSCREEN_ASPECT = 2.5         # whole-canvas bbox this tall-and-narrow = unreadable sprawl
UNDERSIZED_CHARS_PER_PX2 = 0.018  # chars per (width*height/1000); above => text won't fit
UNDERSIZED_MAX_PENALTY = 0.15
SCORE_FLOOR_DEFAULT = 0.5      # below this the live loop should offer/force a relayout

_CONTAINER_TYPES = frozenset({"group", "column"})


def _body_nodes(doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Positioned, non-container nodes — the things a reader actually scans."""
    out: List[Dict[str, Any]] = []
    for n in (doc.get("nodes") or []):
        if not isinstance(n, dict) or not n.get("id"):
            continue
        if n.get("type") in _CONTAINER_TYPES:
            continue
        try:
            float(n["x"]); float(n["y"]); float(n.get("width") or 0); float(n.get("height") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        out.append(n)
    return out


def _box(n: Dict[str, Any]) -> Dict[str, float]:
    return {
        "x": float(n["x"]), "y": float(n["y"]),
        "width": float(n.get("width") or 0.0), "height": float(n.get("height") or 0.0),
    }


def _overlaps(a: Dict[str, float], b: Dict[str, float], padding: float = OVERLAP_PADDING) -> bool:
    return not (
        a["x"] + a["width"] + padding <= b["x"]
        or b["x"] + b["width"] + padding <= a["x"]
        or a["y"] + a["height"] + padding <= b["y"]
        or b["y"] + b["height"] + padding <= a["y"]
    )


def _bbox(nodes: List[Dict[str, Any]]) -> Tuple[float, float, float, float]:
    xs0 = [float(n["x"]) for n in nodes]
    ys0 = [float(n["y"]) for n in nodes]
    xs1 = [float(n["x"]) + float(n.get("width") or 0) for n in nodes]
    ys1 = [float(n["y"]) + float(n.get("height") or 0) for n in nodes]
    return min(xs0), min(ys0), max(xs1), max(ys1)


def detect_overflow_column(doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The persona-disaster signature: many near-equal-width nodes piled at (nearly) one
    x, stacked monotonically down a tall-narrow span. This is what a degenerate
    mindmap/tree produces. A HINT to switch representation, never an auto-fix."""
    nodes = _body_nodes(doc)
    if len(nodes) < COLUMN_MIN_NODES:
        return []
    # bucket nodes by x (their left edge), find the biggest pile
    buckets: Dict[int, List[Dict[str, Any]]] = {}
    for n in nodes:
        key = int(round(float(n["x"]) / COLUMN_X_BUCKET))
        buckets.setdefault(key, []).append(n)
    pile = max(buckets.values(), key=len)
    if len(pile) < COLUMN_MIN_NODES:
        return []
    x0, y0, x1, y1 = _bbox(pile)
    w = max(x1 - x0, 1.0)
    h = max(y1 - y0, 1.0)
    aspect = h / w
    if aspect < COLUMN_ASPECT:
        return []
    return [{
        "code": "overflow_column",
        "severity": "error",
        "target_ids": [n["id"] for n in pile],
        "detail": (
            f"{len(pile)} nodes are stacked in one ~{int(w)}px-wide column spanning "
            f"~{int(h)}px tall (aspect 1:{aspect:.0f}) — an unreadable vertical pillar."
        ),
        "suggestion": (
            "Re-render as a readable shape: a `table` (for an attribute/items list), a "
            "`layout:'row'` of `column` containers (for parallel categories), a single "
            "`code` mermaid `mindmap` node (self-balancing), or — for rich explanatory/teach "
            "content — a SINGLE self-contained `code` html node (a full styled infographic that "
            "scrolls inside its box) or `code` svg node (vector diagram/chart). Do NOT use "
            "layout:'mindmap'/'tree' for wide, shallow content."
        ),
    }]


def detect_node_overlap(doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Body nodes whose rectangles collide (excluding same-parent containment), i.e.
    text sitting on top of text. O(n^2) but n is small for a single canvas."""
    nodes = _body_nodes(doc)
    boxes = [(n["id"], _box(n)) for n in nodes]
    pairs: List[List[str]] = []
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            (ida, a), (idb, b) = boxes[i], boxes[j]
            if _overlaps(a, b):
                pairs.append([ida, idb])
    if not pairs:
        return []
    flat = sorted({nid for p in pairs for nid in p})
    return [{
        "code": "node_overlap",
        "severity": "warn",
        "target_ids": flat,
        "pair_count": len(pairs),
        "detail": f"{len(pairs)} pair(s) of nodes visually overlap.",
        "suggestion": "Space nodes apart or use a layout preset (row/grid/stack) with adequate spacing.",
    }]


def detect_offscreen_sprawl(doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Whole-canvas bounding box is so tall-and-narrow it scrolls off any screen."""
    nodes = _body_nodes(doc)
    if len(nodes) < COLUMN_MIN_NODES:
        return []
    x0, y0, x1, y1 = _bbox(nodes)
    w = max(x1 - x0, 1.0)
    h = max(y1 - y0, 1.0)
    if h < OFFSCREEN_HEIGHT or (h / w) < OFFSCREEN_ASPECT:
        return []
    return [{
        "code": "offscreen_sprawl",
        "severity": "warn",
        "target_ids": [],
        "detail": f"Layout spans ~{int(w)}x{int(h)}px (aspect 1:{h / w:.0f}) — most is off-screen at once.",
        "suggestion": "Spread content horizontally (row/grid) or compress into a table / mermaid diagram.",
    }]


def detect_undersized_for_content(doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Long text crammed into a default-sized box -> it will be clipped. Heuristic on
    chars vs area; only flags clearly-undersized text/todo nodes."""
    out_ids: List[str] = []
    for n in _body_nodes(doc):
        if n.get("type") not in (None, "text", "todo"):
            continue
        content = n.get("content")
        if not isinstance(content, str):
            continue
        chars = len(content.strip())
        if chars < 60:
            continue
        area = max(float(n.get("width") or 0) * float(n.get("height") or 0), 1.0)
        if chars / (area / 1000.0) > UNDERSIZED_CHARS_PER_PX2 * 1000.0:
            out_ids.append(n["id"])
    if not out_ids:
        return []
    return [{
        "code": "undersized_for_content",
        "severity": "warn",
        "target_ids": out_ids,
        "detail": f"{len(out_ids)} node(s) have more text than their box can show (clipped).",
        "suggestion": "Give long-text nodes explicit width>=360 and height>=120 (>=180 for >6 lines).",
    }]


_DETECTORS = (
    detect_overflow_column,
    detect_node_overlap,
    detect_offscreen_sprawl,
    detect_undersized_for_content,
)


def score_layout(doc: Dict[str, Any], *, floor: float = SCORE_FLOOR_DEFAULT) -> Dict[str, Any]:
    """Single readability scalar in [0,1] + per-dimension breakdown + findings.

    score == 1.0 means no readability problem detected. ``below_floor`` is the signal the
    live loop uses to offer/force a relayout. Empty / tiny canvases score 1.0 (nothing to
    judge) — a total function.
    """
    # A single rich node (one `code` html/svg infographic, one table, ...) is the GOOD
    # outcome for explanatory content — it can never be a "dead column". Short-circuit so
    # no detector can misfire on it even if the 8-node gate is ever lowered.
    if len(_body_nodes(doc)) <= 1:
        return {"score": 1.0, "below_floor": False, "floor": floor, "dimensions": {}, "findings": []}

    findings: List[Dict[str, Any]] = []
    for det in _DETECTORS:
        try:
            findings.extend(det(doc) or [])
        except Exception:
            # a critic must never break a write; a failed detector just abstains
            continue

    penalties = {
        "overflow_column": 0.6,
        "offscreen_sprawl": 0.2,
    }
    score = 1.0
    by_code: Dict[str, int] = {}
    for f in findings:
        code = f.get("code", "")
        by_code[code] = by_code.get(code, 0) + 1
        if code in penalties:
            score -= penalties[code]
        elif code == "node_overlap":
            score -= min(OVERLAP_MAX_PENALTY, 0.06 * int(f.get("pair_count", 1)))
        elif code == "undersized_for_content":
            score -= min(UNDERSIZED_MAX_PENALTY, 0.03 * len(f.get("target_ids", [])))
    score = max(0.0, min(1.0, round(score, 3)))

    return {
        "score": score,
        "below_floor": score < floor,
        "floor": floor,
        "dimensions": by_code,
        "findings": findings,
    }
