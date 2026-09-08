"""Canvas read projection — the AI's "eyes" into the canvas.

Pure, dependency-light (stdlib only) functions that turn a raw canvas doc into an
AI-facing representation: complete topology, JSON-valid, token-budgeted. Kept free of
DB / tool / framework imports so it is unit-testable in isolation and reusable by every
read path (the CaC `canvas_read` tool today; a future HTTP read endpoint tomorrow).

Detail levels:
- outline   : ids + short labels + topology + markers (no geometry / no content body)
- structure : topology + geometry + budgeted content (the default)
- full      : raw nodes, capped unless the read is narrowed (handled by the caller)
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

# detail='full' never returns a whole large canvas raw; the caller caps it unless the read
# is narrowed with where / limit / scope=selection.
FULL_NODE_CAP = 50


def compact_mindmap_tree(mindmap: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Compact mindmap descriptor: an edge-list tree, not the raw siblingOrder/collapsed maps."""
    mm = mindmap or {}
    tree: List[List[Any]] = []
    sibling_order = mm.get("siblingOrder")
    if isinstance(sibling_order, dict):
        for parent_id, child_ids in sibling_order.items():
            if not isinstance(child_ids, list):
                continue
            for order, child_id in enumerate(child_ids):
                tree.append([parent_id, child_id, order])
    return {
        "rootId": mm.get("rootId"),
        "orientation": mm.get("orientation", "right"),
        "tree": tree,
    }


TABLE_STRUCTURE_MAX_ROWS = 8
TABLE_CELL_CHAR_LIMIT = 80


def compact_table_data(
    data: Any,
    *,
    max_rows: int = TABLE_STRUCTURE_MAX_ROWS,
    cell_limit: int = TABLE_CELL_CHAR_LIMIT,
) -> Optional[Dict[str, Any]]:
    """Structure-level table summary: first N rows of data.rows, not the full grid."""
    if not isinstance(data, dict):
        return None
    raw_rows = data.get("rows")
    if not isinstance(raw_rows, list):
        return None
    total_rows = len(raw_rows)
    col_count = 0
    for row in raw_rows:
        if isinstance(row, list):
            col_count = max(col_count, len(row))
    limited = raw_rows[: max(0, max_rows)]
    rows_out: List[List[str]] = []
    for row in limited:
        if not isinstance(row, list):
            rows_out.append([])
            continue
        cells: List[str] = []
        for cell in row:
            text = "" if cell is None else str(cell)
            if len(text) > cell_limit:
                text = text[:cell_limit]
            cells.append(text)
        rows_out.append(cells)
    out: Dict[str, Any] = {
        "rows": rows_out,
        "totalRows": total_rows,
        "colCount": col_count,
        "truncated": total_rows > len(rows_out),
    }
    widths = data.get("columnWidths")
    if isinstance(widths, list) and widths:
        out["columnWidths"] = widths[:col_count] if col_count else widths
    return out


def _table_dims_label(data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    raw_rows = data.get("rows")
    if not isinstance(raw_rows, list):
        return ""
    rows = len(raw_rows)
    cols = 0
    for row in raw_rows:
        if isinstance(row, list):
            cols = max(cols, len(row))
    if rows == 0 and cols == 0:
        return "table"
    return f"{rows}×{cols}"


def _compact_provenance(prov: Any) -> Optional[Dict[str, Any]]:
    """Compact, when-present view of a node/edge provenance slot for AI reading (RD6):
    who created/updated it and its open judgment-state. Emits only present sub-fields so
    the read stays budget-friendly; the full open bag is never surfaced verbatim."""
    if not isinstance(prov, dict):
        return None
    out: Dict[str, Any] = {}
    created = prov.get("createdBy")
    if isinstance(created, dict) and created.get("actor"):
        out["by"] = created["actor"]
    updated = prov.get("updatedBy")
    if isinstance(updated, dict) and updated.get("actor"):
        out["updatedBy"] = updated["actor"]
    if prov.get("state"):
        out["state"] = prov["state"]
    return out or None


def _created_actor(prov: Any) -> Optional[str]:
    if isinstance(prov, dict):
        created = prov.get("createdBy")
        if isinstance(created, dict) and created.get("actor"):
            return created["actor"]
    return None


def simplify_canvas_nodes(nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Project nodes for AI reading: complete topology (containment/group/mindmap), no render bloat.

    Content budgeting is handled separately by ``budget_read_result``; this only decides structure.
    """
    result: List[Dict[str, Any]] = []
    for n in nodes or []:
        if not isinstance(n, dict):
            continue
        simplified: Dict[str, Any] = {
            "id": n.get("id"),
            "type": n.get("type"),
            "content": n.get("content"),
        }
        # Geometry: emit x/y/width/height only when positioned. An un-positioned node
        # (x/y not yet computed) gets positioned:false instead of null coords, so the AI
        # can tell "at origin" from "unknown" and won't run overlap/align math on nulls (POS-3).
        if n.get("x") is None or n.get("y") is None:
            simplified["positioned"] = False
        else:
            simplified["x"] = n.get("x")
            simplified["y"] = n.get("y")
            simplified["width"] = n.get("width")
            simplified["height"] = n.get("height")
        # Topology / containment — RD4/RD5: the AI must recover membership in both directions.
        if n.get("parentGroupId"):
            simplified["parentGroupId"] = n["parentGroupId"]
        if n.get("children"):
            simplified["children"] = n["children"]
        if n.get("groupMode"):
            simplified["groupMode"] = n["groupMode"]
        if n.get("mindmap"):
            simplified["mindmap"] = compact_mindmap_tree(n["mindmap"])
        if n.get("isCollapsed"):
            simplified["isCollapsed"] = True
        # Type semantics + markers.
        if n.get("title"):
            simplified["title"] = n["title"]
        if n.get("codeType"):
            simplified["codeType"] = n["codeType"]
        if n.get("type") == "todo" and n.get("completed") is not None:
            simplified["completed"] = bool(n["completed"])
        if n.get("type") == "table":
            table = compact_table_data(n.get("data"))
            if table is not None:
                simplified["data"] = table
        if n.get("mediaType"):
            simplified["mediaType"] = n["mediaType"]
        if n.get("ai"):
            simplified["ai"] = True
        if n.get("locked"):
            simplified["locked"] = True
        # Provenance (RD6): who created/updated this + its open judgment-state.
        prov = _compact_provenance(n.get("provenance"))
        if prov:
            simplified["provenance"] = prov
        result.append(simplified)
    return result


def simplify_canvas_connections(connections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Compact connection projection: topology only, render geometry excluded.

    ``relation``/``directed`` are projected only when present (added by a later ticket).
    Free-floating endpoints (no node ref) are kept so the AI knows they exist.
    """
    out: List[Dict[str, Any]] = []
    for c in connections or []:
        if not isinstance(c, dict):
            continue
        s: Dict[str, Any] = {
            "id": c.get("id"),
            "from": c.get("from"),
            "to": c.get("to"),
        }
        if c.get("label"):
            s["label"] = c["label"]
        if c.get("from") is None and c.get("fromPoint") is not None:
            s["fromPoint"] = c["fromPoint"]
        if c.get("to") is None and c.get("toPoint") is not None:
            s["toPoint"] = c["toPoint"]
        if c.get("relation") is not None:
            s["relation"] = c["relation"]
        if c.get("directed") is not None:
            s["directed"] = bool(c["directed"])
        # relationData (typed-edge payload) round-trips: the agent writes it but previously
        # could never read it back. Project when present so typed edges are loss-free.
        if c.get("relationData") not in (None, {}, []):
            s["relationData"] = c["relationData"]
        # Provenance (RD6): who asserted this edge + its open judgment-state.
        prov = _compact_provenance(c.get("provenance"))
        if prov:
            s["provenance"] = prov
        out.append(s)
    return out


def _content_label(content: Any, limit: int = 80) -> str:
    """First non-empty line of a node's content, truncated — used as the outline label."""
    if not isinstance(content, str):
        return ""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped[:limit]
    return ""


def outline_canvas_nodes(nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """L1 outline: minimal per-node row for orienting on large canvases — no geometry, no body.

    Keeps just enough to enumerate and navigate: id, type, a short label, containment, markers.
    """
    out: List[Dict[str, Any]] = []
    for n in nodes or []:
        if not isinstance(n, dict):
            continue
        row: Dict[str, Any] = {
            "id": n.get("id"),
            "type": n.get("type"),
            "label": _content_label(n.get("content")),
        }
        if n.get("type") == "table":
            dims = _table_dims_label(n.get("data"))
            if dims:
                row["label"] = row["label"] or dims
                row["dims"] = dims
            raw = n.get("data") if isinstance(n.get("data"), dict) else {}
            rows = raw.get("rows") if isinstance(raw.get("rows"), list) else []
            cols = 0
            for r in rows:
                if isinstance(r, list):
                    cols = max(cols, len(r))
            row["rowCount"] = len(rows)
            row["colCount"] = cols
        if n.get("parentGroupId"):
            row["parentGroupId"] = n["parentGroupId"]
        if n.get("children"):
            row["childCount"] = len(n["children"])
        if n.get("groupMode"):
            row["groupMode"] = n["groupMode"]
        if n.get("ai"):
            row["ai"] = True
        if n.get("locked"):
            row["locked"] = True
        by = _created_actor(n.get("provenance"))
        if by:
            row["by"] = by
        out.append(row)
    return out


def outline_canvas_connections(connections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """L1 outline edges: id/from/to (+ relation when present); no label or geometry."""
    out: List[Dict[str, Any]] = []
    for c in connections or []:
        if not isinstance(c, dict):
            continue
        row: Dict[str, Any] = {"id": c.get("id"), "from": c.get("from"), "to": c.get("to")}
        if c.get("relation") is not None:
            row["relation"] = c["relation"]
        by = _created_actor(c.get("provenance"))
        if by:
            row["by"] = by
        out.append(row)
    return out


def outline_containers(nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """L1 containers block (§2.2): one row per group/column container so the agent can
    orient on large canvases without scanning every node — {id,type,childCount,groupMode?,mindmapRootId?}."""
    out: List[Dict[str, Any]] = []
    for n in nodes or []:
        if not isinstance(n, dict):
            continue
        if n.get("type") in ("group", "column") or n.get("children"):
            row: Dict[str, Any] = {
                "id": n.get("id"),
                "type": n.get("type"),
                "childCount": len(n.get("children") or []),
            }
            if n.get("groupMode"):
                row["groupMode"] = n["groupMode"]
            mm = n.get("mindmap")
            if isinstance(mm, dict) and mm.get("rootId"):
                row["mindmapRootId"] = mm["rootId"]
            out.append(row)
    return out


def count_free_edges(connections: List[Dict[str, Any]]) -> int:
    """Count free-floating edges (at least one point endpoint, no node ref) for the L1 tally."""
    return sum(
        1 for c in (connections or []) if isinstance(c, dict) and (c.get("from") is None or c.get("to") is None)
    )


def scope_edges(connections: List[Dict[str, Any]], node_ids, include_free: bool = True) -> tuple:
    """Scope edges to a node subset (selection/viewport) without losing relationships (REL-7).

    Keep an edge if BOTH endpoints are in the set, or if ONE is (cross-boundary — kept so the
    agent still sees the relationship to a node outside the scope). Free-floating edges (point
    endpoints) are kept only when ``include_free`` (true for viewport, false for an explicit
    node selection — a selection of specific nodes shouldn't pull in unrelated free edges).
    Returns ``(kept, boundary_count)``; the caller records boundary_count in meta.
    """
    ids = set(node_ids or [])
    kept: List[Dict[str, Any]] = []
    boundary = 0
    for c in connections or []:
        if not isinstance(c, dict):
            continue
        in_from = c.get("from") in ids
        in_to = c.get("to") in ids
        if in_from and in_to:
            kept.append(c)
        elif in_from or in_to:
            kept.append(c)
            boundary += 1
        elif include_free and (c.get("from") is None or c.get("to") is None):
            kept.append(c)
    return kept, boundary


def _canvas_read_max_chars() -> int:
    try:
        return int(os.getenv("TOOL_MESSAGE_CONTEXT_MAX_CHARS", "8000"))
    except Exception:
        return 8000


def budget_read_result(result: Dict[str, Any], max_chars: Optional[int] = None, level: Optional[str] = None) -> Dict[str, Any]:
    """Adaptively shrink node content so the serialized read fits within ``max_chars``.

    Canvas reads are exempt from byte-level tool-message truncation (which would cut JSON
    mid-structure); instead we budget here. Topology stays complete and the output is always
    valid JSON (final serialization is ``json.dumps`` downstream, so escaping is correct — RD3).
    Only node ``content`` shrinks; if still over budget, trailing nodes are dropped with a
    recorded omission so the result stays parseable. The byte-size guarantee holds for
    level != 'full'; a ``level='full'`` read keeps complete content (size is bounded by node
    COUNT via FULL_NODE_CAP / where / limit, not by max_chars), so it may exceed max_chars.
    """
    if max_chars is None:
        max_chars = _canvas_read_max_chars()
    if not max_chars or max_chars <= 0:
        return result

    def _size(obj: Any) -> int:
        return len(json.dumps(obj, ensure_ascii=False))

    if _size(result) <= max_chars:
        return result

    canvas = result.get("canvas")
    nodes = canvas.get("nodes") if isinstance(canvas, dict) else None
    if not isinstance(nodes, list) or not nodes:
        return result

    # 1) Progressively shrink per-node content (structure is the durable signal, not prose).
    #    Skipped for detail='full', whose contract is complete raw content (already
    #    count-bounded by FULL_NODE_CAP / where / limit); only the step-2 drop guards it.
    if level != "full":
        budget, floor = 240, 80
        while _size(result) > max_chars and budget >= floor:
            for n in nodes:
                if not isinstance(n, dict):
                    continue
                content = n.get("content")
                if isinstance(content, str) and len(content) > budget:
                    if not n.get("contentTruncated"):
                        n["contentChars"] = len(content)  # original length, recorded once
                    n["contentTruncated"] = True
                    n["content"] = content[:budget]
            budget = int(budget * 0.6)

    # 2) Last resort: drop trailing nodes until it fits. Loops to convergence (down to a single
    #    node) so the result is GUARANTEED within budget, and records the omission count.
    original_count = len(nodes)
    while _size(result) > max_chars and len(canvas["nodes"]) > 1:
        current = canvas["nodes"]
        drop = max(1, len(current) // 8)
        canvas["nodes"] = current[:-drop]
        result.setdefault("meta", {})["truncation"] = {
            "reason": "budget",
            "nodesOmitted": original_count - len(canvas["nodes"]),
        }
    return result


def match_predicate(node: Dict[str, Any], predicate: Dict[str, Any]) -> bool:
    """Backward-compatible superset of the flat ``where`` matcher (WS2-6 ``find``).

    Works for BOTH nodes and connections (E3). Each key matches the field of the same
    name, with aliases: ``parentId`` -> ``parentGroupId``, ``rel`` -> ``relation``, and
    ``actor`` -> ``provenance.createdBy.actor`` (nested). Conditions: dict ops
    ($contains / $startsWith / $regex), list (multi-value membership), or exact equality.
    Unknown fields simply fail to match.
    """
    if not isinstance(predicate, dict):
        return True
    for key, condition in predicate.items():
        if key == "actor":
            value = _created_actor(node.get("provenance"))
        else:
            field = {"parentId": "parentGroupId", "rel": "relation"}.get(key, key)
            value = node.get(field)
        if isinstance(condition, dict):
            if "$contains" in condition:
                if not isinstance(value, str) or condition["$contains"] not in value:
                    return False
            if "$startsWith" in condition:
                if not isinstance(value, str) or not value.startswith(condition["$startsWith"]):
                    return False
            if "$regex" in condition:
                import re

                if not isinstance(value, str) or not re.search(condition["$regex"], value):
                    return False
        elif isinstance(condition, list):
            if value not in condition:
                return False
        else:
            if value != condition:
                return False
    return True


def find_nodes(nodes: List[Dict[str, Any]], predicate: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return the raw node dicts matching ``predicate`` (caller projects to outline/structure)."""
    return [n for n in (nodes or []) if isinstance(n, dict) and match_predicate(n, predicate)]


def find_connections(connections: List[Dict[str, Any]], predicate: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return raw connection dicts matching ``predicate`` (E3: find by rel / actor / directed).

    Edges are not queryable via ``find_nodes`` (nodes have no ``relation``); the read tool
    routes an edge-shaped ``where`` here so ``find(rel="reference")`` returns the edge.
    """
    return [c for c in (connections or []) if isinstance(c, dict) and match_predicate(c, predicate)]


def children_subtree(
    nodes: List[Dict[str, Any]], container_id: str, recursive: bool = False
) -> List[Dict[str, Any]]:
    """Resolve a container's members in both directions (WS2-6 ``children_of``).

    Order = the container's ordered ``children[]`` first, then any straggler whose
    ``parentGroupId`` points at it but is not listed. ``recursive`` descends into
    sub-containers. Returns raw node dicts; empty list if the container is unknown.
    """
    by_id = {n.get("id"): n for n in (nodes or []) if isinstance(n, dict)}
    if container_id not in by_id:
        return []

    def direct(cid: str) -> List[Dict[str, Any]]:
        cont = by_id.get(cid) or {}
        ordered = [c for c in (cont.get("children") or []) if isinstance(c, str)]
        seen = set(ordered)
        stragglers = [
            n.get("id")
            for n in nodes
            if isinstance(n, dict) and n.get("parentGroupId") == cid and n.get("id") not in seen
        ]
        return [by_id[nid] for nid in (*ordered, *stragglers) if nid in by_id]

    result: List[Dict[str, Any]] = []
    visited: set = set()

    def walk(cid: str) -> None:
        for child in direct(cid):
            child_id = child.get("id")
            if child_id in visited:
                continue
            visited.add(child_id)
            result.append(child)
            if recursive:
                walk(child_id)

    walk(container_id)
    return result


def nodes_in_viewport(nodes: List[Dict[str, Any]], camera: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Filter to nodes whose bounding box intersects the visible canvas rect (WS2-7).

    ``camera`` = ``{x, y, zoom, vw, vh}``: (x, y) are the canvas coordinates of the viewport's
    top-left, vw/vh the viewport size in screen pixels, zoom the scale. The visible canvas rect
    spans ``[x, x + vw/zoom] x [y, y + vh/zoom]``. A missing or invalid camera returns the nodes
    unchanged (caller decides how to signal that).
    """
    if not isinstance(camera, dict):
        return list(nodes or [])
    try:
        vx = float(camera["x"])
        vy = float(camera["y"])
        vw = float(camera["vw"])
        vh = float(camera["vh"])
        zoom = float(camera.get("zoom", 1) or 1)
    except (KeyError, TypeError, ValueError):
        return list(nodes or [])
    if zoom <= 0:
        zoom = 1.0
    right = vx + vw / zoom
    bottom = vy + vh / zoom

    out: List[Dict[str, Any]] = []
    for n in nodes or []:
        if not isinstance(n, dict):
            continue
        # Genuinely-unpositioned nodes (missing geometry) are KEPT, not coerced to a
        # zero-box at the origin and silently hidden (POS-1).
        if n.get("x") is None or n.get("y") is None or n.get("width") is None or n.get("height") is None:
            out.append(n)
            continue
        try:
            nx = float(n["x"])
            ny = float(n["y"])
            nw = max(float(n["width"]), 0.0)
            nh = max(float(n["height"]), 0.0)
        except (TypeError, ValueError):
            out.append(n)  # un-parseable geometry: keep rather than silently hide
            continue
        # Inclusive + zero-extent tolerant so edge-flush and point-like (w/h=0) nodes
        # are not dropped (POS-4): treat the box as a closed region / point-in-rect.
        if nx <= right and nx + nw >= vx and ny <= bottom and ny + nh >= vy:
            out.append(n)
    return out
