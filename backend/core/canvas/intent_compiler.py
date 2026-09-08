from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from core.tools.constants import get_default_node_size


def _coerce_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return str(value)


def _resolve_node_ref(
    ref: Any,
    index_map: Dict[int, str],
    id_map: Dict[str, str],
) -> Optional[str]:
    if isinstance(ref, int):
        return index_map.get(ref)
    if isinstance(ref, str):
        return id_map.get(ref, ref)
    if isinstance(ref, dict):
        if "index" in ref and isinstance(ref.get("index"), int):
            return index_map.get(ref["index"])
        if "id" in ref:
            rid = _coerce_str(ref.get("id"))
            if rid:
                return id_map.get(rid, rid)
    return None


def compile_canvas_intent(intent: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Compile a high-level intent payload into low-level canvas ops."""
    warnings: List[str] = []
    if not isinstance(intent, dict):
        raise ValueError("intent must be an object")

    nodes_spec = intent.get("nodes") or []
    if not isinstance(nodes_spec, list):
        warnings.append("intent.nodes must be an array")
        nodes_spec = []

    layout = intent.get("layout") or {}
    if not isinstance(layout, dict):
        warnings.append("intent.layout must be an object when provided")
        layout = {}

    mode = str(layout.get("mode") or "stack").lower()
    if mode not in ("stack", "two_column"):
        warnings.append(f"unsupported layout.mode '{mode}', defaulting to 'stack'")
        mode = "stack"

    base_x = float(layout.get("x") or 80)
    base_y = float(layout.get("y") or 80)
    row_spacing = float(layout.get("row_spacing") or 140)
    left_x = float(layout.get("left_x") or 80)
    right_x = float(layout.get("right_x") or 520)

    ops: List[Dict[str, Any]] = []
    index_map: Dict[int, str] = {}
    id_map: Dict[str, str] = {}

    tmp_counter = 0
    stack_cursor = base_y
    left_row = 0
    right_row = 0

    for idx, raw in enumerate(nodes_spec):
        if not isinstance(raw, dict):
            warnings.append(f"node[{idx}] must be an object")
            continue

        node_id = _coerce_str(raw.get("id"))
        if not node_id:
            tmp_counter += 1
            node_id = f"tmp:n{tmp_counter}"
        index_map[idx] = node_id
        id_map[node_id] = node_id

        node_type = _coerce_str(raw.get("type") or raw.get("node_type")) or "text"
        code_type = _coerce_str(raw.get("code_type") or raw.get("codeType"))

        width = raw.get("width")
        height = raw.get("height")
        if width is None or height is None or float(width or 0) <= 0 or float(height or 0) <= 0:
            default_w, default_h = get_default_node_size(node_type, code_type)
            width = float(width or default_w)
            height = float(height or default_h)

        x = raw.get("x")
        y = raw.get("y")
        if x is None or y is None:
            if mode == "two_column":
                side = str(raw.get("side") or raw.get("column") or "left").lower()
                if side in ("right", "r", "2"):
                    x = right_x
                    y = base_y + (right_row * row_spacing)
                    right_row += 1
                else:
                    x = left_x
                    y = base_y + (left_row * row_spacing)
                    left_row += 1
            else:
                x = base_x
                y = stack_cursor
                stack_cursor += float(height) + row_spacing

        node: Dict[str, Any] = {
            "id": node_id,
            "type": node_type,
            "x": float(x),
            "y": float(y),
            "width": float(width),
            "height": float(height),
        }

        content = raw.get("content")
        if content is None and "text" in raw:
            content = raw.get("text")
        if content is not None:
            node["content"] = str(content)

        title = raw.get("title")
        if title is not None:
            node["title"] = str(title)

        if code_type:
            node["codeType"] = code_type

        for key in ("data", "metadata", "shapeDecoration", "textStyles", "tableStyles", "linkStyles"):
            if key in raw and raw[key] is not None:
                node[key] = raw[key]

        if raw.get("groupMode") or raw.get("group_mode"):
            node["groupMode"] = raw.get("groupMode") or raw.get("group_mode")
        if raw.get("children") or raw.get("children_ids"):
            node["children"] = raw.get("children") or raw.get("children_ids")
        if raw.get("parentGroupId") or raw.get("parent_group_id"):
            node["parentGroupId"] = raw.get("parentGroupId") or raw.get("parent_group_id")
        if raw.get("targetCanvasId") or raw.get("target_canvas_id"):
            node["targetCanvasId"] = raw.get("targetCanvasId") or raw.get("target_canvas_id")

        ops.append({"op": "add_node", "node": node})

    groups_spec = intent.get("groups") or []
    if isinstance(groups_spec, list):
        for idx, group in enumerate(groups_spec):
            if not isinstance(group, dict):
                warnings.append(f"group[{idx}] must be an object")
                continue
            title = _coerce_str(group.get("title") or group.get("label"))
            if not title:
                warnings.append(f"group[{idx}] missing title")
                continue
            members: List[str] = []
            for ref in (group.get("node_ids") or []):
                rid = _resolve_node_ref(ref, index_map, id_map)
                if rid:
                    members.append(rid)
            for ref in (group.get("node_indices") or []):
                rid = _resolve_node_ref(ref, index_map, id_map)
                if rid:
                    members.append(rid)
            if not members:
                warnings.append(f"group[{idx}] has no resolvable members")
                continue
            tmp_counter += 1
            group_id = f"tmp:g{tmp_counter}"
            ops.append({
                "op": "add_node",
                "node": {
                    "id": group_id,
                    "type": "group",
                    "content": title,
                    "x": left_x,
                    "y": base_y,
                    "width": 200.0,
                    "height": 120.0,
                    "children": members,
                },
            })

    connections_spec = intent.get("connections") or []
    if isinstance(connections_spec, list):
        for idx, conn in enumerate(connections_spec):
            if not isinstance(conn, dict):
                warnings.append(f"connection[{idx}] must be an object")
                continue
            from_ref = conn.get("from")
            to_ref = conn.get("to")
            if "from_index" in conn:
                from_ref = conn.get("from_index")
            if "to_index" in conn:
                to_ref = conn.get("to_index")
            from_id = _resolve_node_ref(from_ref, index_map, id_map)
            to_id = _resolve_node_ref(to_ref, index_map, id_map)
            op: Dict[str, Any] = {"op": "add_connection"}

            if from_id and to_id:
                op["from"] = from_id
                op["to"] = to_id
            elif conn.get("fromPoint") and conn.get("toPoint"):
                op["fromPoint"] = conn.get("fromPoint")
                op["toPoint"] = conn.get("toPoint")
            else:
                warnings.append(f"connection[{idx}] missing resolvable endpoints")
                continue

            for key in (
                "label", "style", "dashed", "curveAnchor", "anchorParams", "curveMode", "tension",
                "relation", "directed", "relationData",  # typed-edge slots (§4.1)
            ):
                if key in conn and conn[key] is not None:
                    op[key] = conn[key]
            ops.append(op)

    return ops, warnings
