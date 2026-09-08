from __future__ import annotations

import math
import time
from typing import Any, Dict, List, Optional, Tuple


SELECTION_CONTEXT_MAX_AGE_MS = 30 * 60 * 1000
SELECTION_CONTEXT_MAX_NODES = 120
SELECTION_CONTEXT_MAX_CONNECTIONS = 160
SELECTION_CONTEXT_MAX_GROUPS = 80
SELECTION_CONTEXT_MAX_GROUP_CHILDREN = 200

_NODE_KEYS = (
    "id",
    "type",
    "x",
    "y",
    "width",
    "height",
    "parentGroupId",
    "groupMode",
    "codeType",
    "fileName",
    "fileType",
    "fileExtension",
    "fileSize",
    "mediaType",
    "fileUrl",
    "fileDownloadUrl",
    "storagePath",
    "fileId",
    "localPath",
)
_CONNECTION_KEYS = ("id", "from", "to", "label")
_GROUP_KEYS = ("id", "groupMode", "mindmap")


def extract_canvas_id_from_payload(value: Any) -> Optional[str]:
    if isinstance(value, dict):
        raw = value.get("canvas_id") or value.get("canvasId") or value.get("id")
        if isinstance(raw, str):
            raw = raw.strip()
            if raw:
                return raw
    elif isinstance(value, str):
        trimmed = value.strip()
        if trimmed:
            return trimmed
    return None


def extract_ambiguous_titles(value: Any, *, limit: int = 8) -> List[str]:
    if not isinstance(value, list):
        return []
    titles: List[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        title = item.strip()
        if title and title not in titles:
            titles.append(title)
        if len(titles) >= max(limit, 1):
            break
    return titles


def evaluate_cross_canvas_write_guard(
    metadata: Dict[str, Any],
    *,
    bound_canvas_id: Optional[str],
    target_canvas_id: Optional[str],
) -> Optional[str]:
    if not bound_canvas_id or not target_canvas_id:
        return None
    if str(bound_canvas_id) == str(target_canvas_id):
        return None

    md = metadata if isinstance(metadata, dict) else {}
    explicit_target_canvas_id = extract_canvas_id_from_payload(md.get("workspace_target_canvas"))
    if explicit_target_canvas_id and str(explicit_target_canvas_id) == str(target_canvas_id):
        return None

    write_policy = md.get("workspace_write_policy")
    policy_target_canvas_id: Optional[str] = None
    cross_allowed = False
    requires_explicit_target = True
    if isinstance(write_policy, dict):
        policy_target_canvas_id = extract_canvas_id_from_payload(write_policy.get("target_canvas_id"))
        cross_allowed = bool(write_policy.get("cross_canvas_write_allowed"))
        requires_explicit_target = bool(
            write_policy.get("cross_canvas_write_requires_explicit_target", True)
        )
        if policy_target_canvas_id and str(policy_target_canvas_id) == str(target_canvas_id):
            if cross_allowed or not requires_explicit_target:
                return None

    ambiguous_titles = extract_ambiguous_titles(md.get("workspace_target_canvas_ambiguous"))
    if not ambiguous_titles and isinstance(write_policy, dict):
        ambiguous_titles = extract_ambiguous_titles(write_policy.get("ambiguous_titles"))

    if ambiguous_titles:
        preview = ", ".join(ambiguous_titles[:5])
        return (
            "Cross-canvas write blocked: target canvas is ambiguous. "
            f"Ask the user to choose one canvas explicitly ({preview})."
        )

    if explicit_target_canvas_id and str(explicit_target_canvas_id) != str(target_canvas_id):
        return (
            "Cross-canvas write blocked: target canvas differs from the explicit canvas confirmed by user. "
            "Use the confirmed target canvas_id or ask user to confirm a new one."
        )

    if policy_target_canvas_id and str(policy_target_canvas_id) != str(target_canvas_id):
        return (
            "Cross-canvas write blocked: target canvas differs from write policy target. "
            "Keep writing on current canvas or ask user to explicitly confirm another target canvas."
        )

    return (
        "Cross-canvas write blocked: no explicit target canvas confirmed by user. "
        "Keep writing on current canvas by default, or ask user to name a single target canvas."
    )


def _clean_text(value: Any, *, max_len: int = 512) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    return text[:max_len]


def _clean_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        number = float(value)
    except Exception:
        return None
    if not math.isfinite(number):
        return None
    return number


def _clean_timestamp(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        ts = int(float(value))
    except Exception:
        return None
    if ts <= 0:
        return None
    return ts


def _clean_node(raw: Any) -> Optional[Dict[str, Any]]:
    if isinstance(raw, str):
        node_id = _clean_text(raw, max_len=128)
        return {"id": node_id} if node_id else None
    if not isinstance(raw, dict):
        return None
    node_id = _clean_text(raw.get("id"), max_len=128)
    if not node_id:
        return None
    cleaned: Dict[str, Any] = {"id": node_id}
    for key in _NODE_KEYS:
        if key == "id" or key not in raw:
            continue
        value = raw.get(key)
        if key in ("x", "y", "width", "height", "fileSize"):
            num = _clean_number(value)
            if num is not None:
                cleaned[key] = int(num) if key == "fileSize" else num
            continue
        if key in ("parentGroupId", "groupMode", "codeType", "fileType", "fileExtension", "mediaType", "fileId"):
            text = _clean_text(value, max_len=128)
            if text is not None:
                cleaned[key] = text
            continue
        text = _clean_text(value)
        if text is not None:
            cleaned[key] = text
    return cleaned


def _clean_connection(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    conn_id = _clean_text(raw.get("id"), max_len=128)
    from_id = _clean_text(raw.get("from"), max_len=128)
    to_id = _clean_text(raw.get("to"), max_len=128)
    if not conn_id and not (from_id and to_id):
        return None
    cleaned: Dict[str, Any] = {}
    if conn_id:
        cleaned["id"] = conn_id
    if from_id:
        cleaned["from"] = from_id
    if to_id:
        cleaned["to"] = to_id
    label = _clean_text(raw.get("label"))
    if label:
        cleaned["label"] = label
    return cleaned if cleaned else None


def _clean_group(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    group_id = _clean_text(raw.get("id"), max_len=128)
    if not group_id:
        return None
    cleaned: Dict[str, Any] = {"id": group_id}
    group_mode = _clean_text(raw.get("groupMode"), max_len=32)
    if group_mode:
        cleaned["groupMode"] = group_mode
    if isinstance(raw.get("mindmap"), dict):
        cleaned["mindmap"] = raw.get("mindmap")
    children = raw.get("children")
    if isinstance(children, list):
        dedup: List[str] = []
        seen: set[str] = set()
        for child in children:
            child_id = _clean_text(child, max_len=128)
            if not child_id or child_id in seen:
                continue
            seen.add(child_id)
            dedup.append(child_id)
            if len(dedup) >= SELECTION_CONTEXT_MAX_GROUP_CHILDREN:
                break
        if dedup:
            cleaned["children"] = dedup
    return cleaned


def normalize_selection_context_payload(
    payload: Any,
    *,
    target_canvas_id: Optional[str] = None,
    now_ms: Optional[int] = None,
    max_age_ms: int = SELECTION_CONTEXT_MAX_AGE_MS,
    max_nodes: int = SELECTION_CONTEXT_MAX_NODES,
    max_connections: int = SELECTION_CONTEXT_MAX_CONNECTIONS,
    max_groups: int = SELECTION_CONTEXT_MAX_GROUPS,
) -> Tuple[Optional[Dict[str, Any]], List[str]]:
    warnings: List[str] = []
    if not isinstance(payload, dict):
        return None, warnings

    meta_raw = payload.get("meta")
    meta = meta_raw if isinstance(meta_raw, dict) else {}
    selection_canvas_id = extract_canvas_id_from_payload(
        meta.get("canvas_id") or meta.get("canvasId")
    )
    if not selection_canvas_id:
        selection_canvas_id = extract_canvas_id_from_payload(payload.get("canvas_id") or payload.get("canvasId"))

    selection_ts = _clean_timestamp(meta.get("selection_ts") or meta.get("selectionTs"))
    if selection_ts is not None:
        now = int(now_ms if now_ms is not None else time.time() * 1000)
        if max_age_ms > 0 and now - selection_ts > max_age_ms:
            warnings.append("selection_context_stale")
            return None, warnings

    if target_canvas_id and selection_canvas_id and str(target_canvas_id) != str(selection_canvas_id):
        warnings.append("selection_context_canvas_mismatch")
        return None, warnings

    nodes: List[Dict[str, Any]] = []
    seen_node_ids: set[str] = set()
    for raw in payload.get("nodes", []) if isinstance(payload.get("nodes"), list) else []:
        item = _clean_node(raw)
        if not item:
            continue
        node_id = str(item.get("id"))
        if node_id in seen_node_ids:
            continue
        seen_node_ids.add(node_id)
        nodes.append(item)
        if len(nodes) >= max(max_nodes, 1):
            warnings.append("selection_context_nodes_truncated")
            break

    connections: List[Dict[str, Any]] = []
    seen_connection_keys: set[Tuple[str, str, str]] = set()
    for raw in payload.get("connections", []) if isinstance(payload.get("connections"), list) else []:
        item = _clean_connection(raw)
        if not item:
            continue
        key = (
            str(item.get("id") or ""),
            str(item.get("from") or ""),
            str(item.get("to") or ""),
        )
        if key in seen_connection_keys:
            continue
        seen_connection_keys.add(key)
        connections.append(item)
        if len(connections) >= max(max_connections, 1):
            warnings.append("selection_context_connections_truncated")
            break

    groups: List[Dict[str, Any]] = []
    seen_group_ids: set[str] = set()
    for raw in payload.get("groups", []) if isinstance(payload.get("groups"), list) else []:
        item = _clean_group(raw)
        if not item:
            continue
        group_id = str(item.get("id"))
        if group_id in seen_group_ids:
            continue
        seen_group_ids.add(group_id)
        groups.append(item)
        if len(groups) >= max(max_groups, 1):
            warnings.append("selection_context_groups_truncated")
            break

    if not nodes and not connections and not groups:
        warnings.append("selection_context_empty")
        return None, warnings

    cleaned_meta: Dict[str, Any] = {}
    if selection_canvas_id:
        cleaned_meta["canvas_id"] = selection_canvas_id
    if selection_ts is not None:
        cleaned_meta["selection_ts"] = selection_ts

    cleaned: Dict[str, Any] = {"meta": cleaned_meta, "nodes": nodes}
    if connections:
        cleaned["connections"] = connections
    if groups:
        cleaned["groups"] = groups
    return cleaned, warnings
