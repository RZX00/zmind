from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple, Optional

from core.canvas.ops_contract import ALLOWED_OPS_SET, OP_ALIASES


def _normalize_op_value(value: Any) -> Optional[str]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    if raw in ALLOWED_OPS_SET:
        return raw
    raw_snake = raw.replace("-", "_").replace(" ", "_")
    if raw_snake in ALLOWED_OPS_SET:
        return raw_snake
    camel = re.sub(r"(?<!^)(?=[A-Z])", "_", raw_snake).lower()
    if camel in ALLOWED_OPS_SET:
        return camel
    compact = re.sub(r"[^a-zA-Z0-9]", "", raw).lower()
    return OP_ALIASES.get(compact)


def _normalize_key(
    target: Dict[str, Any],
    src: str,
    dst: str,
    ctx: str,
    warnings: List[str],
) -> None:
    if src in target and dst not in target:
        target[dst] = target[src]
        warnings.append(f"normalized {ctx}.{src} -> {dst}")


def normalize_ops(operations: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Normalize canvas ops to canonical field names.

    This mirrors the realtime apply normalization rules to keep backend
    writes consistent regardless of write path.
    """
    warnings: List[str] = []
    if not isinstance(operations, list):
        return operations, warnings

    for op in operations:
        if not isinstance(op, dict):
            continue
        raw_op = op.get("op")
        normalized_op = _normalize_op_value(raw_op)
        if normalized_op and normalized_op != raw_op:
            op["op"] = normalized_op
            warnings.append(f"normalized op value {raw_op} -> {normalized_op}")
        if not op.get("op"):
            for key in ("type", "operation", "action"):
                candidate = op.get(key)
                normalized = _normalize_op_value(candidate)
                if normalized:
                    op["op"] = normalized
                    warnings.append(f"normalized op.{key} -> op")
                    if candidate != normalized:
                        warnings.append(f"normalized op value {candidate} -> {normalized}")
                    break

        kind = op.get("op")
        if not kind:
            continue

        if kind in ("update_node", "delete_node", "move_node", "apply_style"):
            _normalize_key(op, "node_id", "id", kind, warnings)
            _normalize_key(op, "nodeId", "id", kind, warnings)
        if kind in ("add_connection", "update_connection", "delete_connection"):
            _normalize_key(op, "connection_id", "id", kind, warnings)
            _normalize_key(op, "connectionId", "id", kind, warnings)
        if kind == "relayout_mindmap":
            _normalize_key(op, "group_id", "id", kind, warnings)
            _normalize_key(op, "groupId", "id", kind, warnings)
        if kind in ("add_connection", "update_connection"):
            _normalize_key(op, "from_id", "from", kind, warnings)
            _normalize_key(op, "fromId", "from", kind, warnings)
            _normalize_key(op, "source", "from", kind, warnings)
            _normalize_key(op, "sourceId", "from", kind, warnings)
            _normalize_key(op, "to_id", "to", kind, warnings)
            _normalize_key(op, "toId", "to", kind, warnings)
            _normalize_key(op, "target", "to", kind, warnings)
            _normalize_key(op, "targetId", "to", kind, warnings)

        if kind == "add_node" and not isinstance(op.get("node"), dict):
            # Tolerate flat add_node: some models emit the node fields at the op top
            # level ({op, id, type, content, x, y, ...}) instead of nested under "node".
            # Realtime requires {op:"add_node", node:{...}} and silently drops top-level
            # fields, so wrap them here to preserve id/type/x/y/etc. across every write path.
            wrapped = {k: v for k, v in op.items() if k != "op"}
            if wrapped:
                for k in list(op.keys()):
                    if k != "op":
                        op.pop(k, None)
                op["node"] = wrapped
                warnings.append("wrapped flat add_node fields into node")

        if kind == "add_node" and isinstance(op.get("node"), dict):
            node = op["node"]
            _normalize_key(node, "node_type", "type", "node", warnings)
            _normalize_key(node, "nodeType", "type", "node", warnings)
            _normalize_key(node, "code_type", "codeType", "node", warnings)
            _normalize_key(node, "group_mode", "groupMode", "node", warnings)
            _normalize_key(node, "target_canvas_id", "targetCanvasId", "node", warnings)
            _normalize_key(node, "targetCanvasID", "targetCanvasId", "node", warnings)
            _normalize_key(node, "parent_group_id", "parentGroupId", "node", warnings)
            _normalize_key(node, "parentGroupID", "parentGroupId", "node", warnings)
            _normalize_key(node, "children_ids", "children", "node", warnings)
            _normalize_key(node, "childrenIds", "children", "node", warnings)
        elif kind in ("update_node", "apply_style") and isinstance(op.get("patch"), dict):
            patch = op["patch"]
            _normalize_key(patch, "node_type", "type", "patch", warnings)
            _normalize_key(patch, "nodeType", "type", "patch", warnings)
            _normalize_key(patch, "code_type", "codeType", "patch", warnings)
            _normalize_key(patch, "group_mode", "groupMode", "patch", warnings)
            _normalize_key(patch, "target_canvas_id", "targetCanvasId", "patch", warnings)
            _normalize_key(patch, "targetCanvasID", "targetCanvasId", "patch", warnings)
            _normalize_key(patch, "parent_group_id", "parentGroupId", "patch", warnings)
            _normalize_key(patch, "parentGroupID", "parentGroupId", "patch", warnings)
            _normalize_key(patch, "children_ids", "children", "patch", warnings)
            _normalize_key(patch, "childrenIds", "children", "patch", warnings)
            _normalize_key(patch, "curve_anchor", "curveAnchor", "patch", warnings)
            _normalize_key(patch, "anchor_params", "anchorParams", "patch", warnings)
            _normalize_key(patch, "curve_mode", "curveMode", "patch", warnings)
        elif kind == "update_canvas" and isinstance(op.get("patch"), dict):
            patch = op["patch"]
            _normalize_key(patch, "background_color", "backgroundColor", "patch", warnings)
            _normalize_key(patch, "background_style_id", "backgroundStyleId", "patch", warnings)
            _normalize_key(patch, "pattern_color", "patternColor", "patch", warnings)
            _normalize_key(patch, "corner_style", "cornerStyle", "patch", warnings)
            _normalize_key(patch, "font_style", "fontStyle", "patch", warnings)
            _normalize_key(patch, "text_opacity_preset", "textOpacityPreset", "patch", warnings)
            _normalize_key(patch, "text_layout_preset", "textLayoutPreset", "patch", warnings)
            _normalize_key(patch, "folder_id", "folderId", "patch", warnings)
        elif kind in ("add_connection", "update_connection"):
            _normalize_key(op, "from_point", "fromPoint", kind, warnings)
            _normalize_key(op, "to_point", "toPoint", kind, warnings)
            _normalize_key(op, "curve_anchor", "curveAnchor", kind, warnings)
            _normalize_key(op, "anchor_params", "anchorParams", kind, warnings)
            _normalize_key(op, "curve_mode", "curveMode", kind, warnings)
            if kind == "update_connection" and isinstance(op.get("patch"), dict):
                patch = op["patch"]
                _normalize_key(patch, "from_point", "fromPoint", "patch", warnings)
                _normalize_key(patch, "to_point", "toPoint", "patch", warnings)
                _normalize_key(patch, "from_id", "from", "patch", warnings)
                _normalize_key(patch, "fromId", "from", "patch", warnings)
                _normalize_key(patch, "source", "from", "patch", warnings)
                _normalize_key(patch, "sourceId", "from", "patch", warnings)
                _normalize_key(patch, "to_id", "to", "patch", warnings)
                _normalize_key(patch, "toId", "to", "patch", warnings)
                _normalize_key(patch, "target", "to", "patch", warnings)
                _normalize_key(patch, "targetId", "to", "patch", warnings)
                _normalize_key(patch, "curve_anchor", "curveAnchor", "patch", warnings)
                _normalize_key(patch, "anchor_params", "anchorParams", "patch", warnings)
                _normalize_key(patch, "curve_mode", "curveMode", "patch", warnings)

    return operations, warnings


def compute_idempotency_key(
    canvas_id: Optional[str],
    operations: List[Dict[str, Any]],
    expected_version: Any = None,
    prefix: str = "canvas_edit",
) -> str:
    """Deterministic idempotency key from the batch CONTENT (replay-safe dedup).

    The realtime /apply caches the first response under the Idempotency-Key header, so a
    retried timeout of the SAME logical batch must produce the SAME key — never a fresh
    timestamp/uuid (which would double-apply) nor a constant (which would false-dedup a
    genuinely different batch). Same (canvas_id, expected_version, operations) -> same key.
    """
    import hashlib
    import json

    raw = json.dumps(
        {"canvas_id": canvas_id, "expected_version": expected_version, "operations": operations},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return f"{prefix}:{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:32]}"
