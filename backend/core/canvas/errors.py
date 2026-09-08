"""CanvasWriteError envelope (WS4) — the ONE typed write-failure shape.

stdlib-only on purpose so it loads without the heavy supabase/jwt chain. Mirrors
schemas/canvas-schema.json #/$defs/CanvasWriteError and the realtime
services/canvas-realtime/src/ops/errors.js (keep the three in sync).

``normalize_canvas_error`` turns any Exception (or an already-built envelope dict)
into ``{code, retryable, message, self_heal?, op_index?, field?}``. The classifier
is message-driven so existing raise sites need no change to gain a typed code.
"""

from __future__ import annotations

import re
from typing import Any, Optional

CANVAS_ERROR_CODES: tuple[str, ...] = (
    "STALE_RELOAD",
    "ID_REMAPPED",
    "VALIDATION",
    "NODE_NOT_FOUND",
    "CONNECTION_ENDPOINT_MISSING",
    "CONNECTION_ENDPOINT_INVALID",
    "NODE_LOCKED",
    "EMPTY_BATCH",
    "BATCH_TOO_LARGE",
    "TRANSPORT_RETRYABLE",
)

_RETRYABLE = frozenset({"STALE_RELOAD", "TRANSPORT_RETRYABLE"})

_SELF_HEAL: dict[str, dict[str, str]] = {
    "STALE_RELOAD": {"action": "reload_canvas"},
    "ID_REMAPPED": {"action": "remap_ids"},
    "TRANSPORT_RETRYABLE": {"action": "retry"},
}


def _classify(message: str) -> str:
    m = message or ""
    about_connection = bool(re.search(r"connection|connect", m, re.I)) and bool(
        re.search(r"\b(from|to|fromPoint|toPoint)\b", m, re.I)
    )
    if about_connection:
        if re.search(r"must reference an existing node|references unknown node", m, re.I):
            return "CONNECTION_ENDPOINT_MISSING"
        return "CONNECTION_ENDPOINT_INVALID"
    if re.search(r"locked", m, re.I):
        return "NODE_LOCKED"
    if re.search(r"duplicate id|already exists", m, re.I):
        return "VALIDATION"
    if re.search(r"not found|references unknown node", m, re.I):
        return "NODE_NOT_FOUND"
    if re.search(r"non-empty|no operations|empty batch", m, re.I):
        return "EMPTY_BATCH"
    if re.search(r"too many|too large|exceeds the limit", m, re.I):
        return "BATCH_TOO_LARGE"
    return "VALIDATION"


def _is_envelope(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and value.get("code") in CANVAS_ERROR_CODES
        and isinstance(value.get("retryable"), bool)
    )


def normalize_canvas_error(
    err: Any, *, op_index: Optional[int] = None, field: Optional[str] = None
) -> dict[str, Any]:
    if _is_envelope(err):
        return err  # type: ignore[return-value]
    if isinstance(err, BaseException):
        message = str(err) or err.__class__.__name__
    else:
        message = "unknown error" if err is None else str(err)
    code = _classify(message)
    envelope: dict[str, Any] = {"code": code, "retryable": code in _RETRYABLE, "message": message}
    if code in _SELF_HEAL:
        envelope["self_heal"] = dict(_SELF_HEAL[code])
    if isinstance(op_index, int) and not isinstance(op_index, bool):
        envelope["op_index"] = op_index
    if isinstance(field, str):
        envelope["field"] = field
    return envelope


def make_canvas_error(
    code: str,
    message: str,
    *,
    op_index: Optional[int] = None,
    field: Optional[str] = None,
    self_heal: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Construct an envelope directly — for the transport / id-remap / staleness
    layers that emit STALE_RELOAD, ID_REMAPPED, TRANSPORT_RETRYABLE (which the
    message classifier never infers). The default self_heal recipe is attached."""
    if code not in CANVAS_ERROR_CODES:
        raise ValueError(f"unknown canvas error code: {code}")
    envelope: dict[str, Any] = {"code": code, "retryable": code in _RETRYABLE, "message": str(message or code)}
    if code in _SELF_HEAL:
        envelope["self_heal"] = dict(_SELF_HEAL[code])
    if self_heal is not None:
        envelope["self_heal"] = self_heal
    if isinstance(op_index, int) and not isinstance(op_index, bool):
        envelope["op_index"] = op_index
    if isinstance(field, str):
        envelope["field"] = field
    return envelope


def canvas_error_suffix(envelope: Any) -> str:
    """Render a CanvasWriteError envelope into a machine-actionable suffix an agent can
    parse from a failure message: ``[canvasError code=… retryable=… self_heal=…]``.

    Used where the failure surface is a plain string (legacy tool fail_response); a
    structured caller should prefer the envelope dict directly."""
    if not isinstance(envelope, dict) or not envelope.get("code"):
        return ""
    heal = (envelope.get("self_heal") or {}).get("action")
    parts = [f"code={envelope['code']}", f"retryable={envelope.get('retryable')}"]
    if heal:
        parts.append(f"self_heal={heal}")
    return " [canvasError " + " ".join(parts) + "]"
