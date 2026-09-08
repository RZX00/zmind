"""Suggestion model + op compilation for the thinking-layer inference core.

A ``Suggestion`` is a *propose-don't-impose* unit: a human-readable nudge plus the
closed-op-set ops that WOULD apply it if the user accepts. Nothing here mutates a canvas —
on accept the ops flow through the normal write path (normalize_ops -> /apply); on reject
they are dropped, leaving no trace. Every suggestion carries a ``derivation`` (createdBy:
agent + source + a PER-BATCH id) so an accepted write is attributable and undoable as one
unit, and a rejected one leaves nothing behind.

Capture-first: a ``role_tag`` suggestion writes an INVISIBLE ``node.metadata.role`` — there
is no user-facing role/relation picker anywhere; the user only ever accepts or ignores.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from core.canvas.ops_contract import ALLOWED_OPS_SET
from core.canvas.ops_normalization import normalize_ops


def _stable_id(kind: str, target_ids: List[str], proposed_ops: List[Dict[str, Any]]) -> str:
    raw = json.dumps(
        {"kind": kind, "targets": sorted(target_ids or []), "ops": proposed_ops},
        sort_keys=True, separators=(",", ":"), default=str,
    )
    return f"{kind}:{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]}"


@dataclass
class Suggestion:
    kind: str  # relation_label | cluster | role_tag | diagnostic
    title: str
    rationale: str
    target_ids: List[str]
    proposed_ops: List[Dict[str, Any]]
    derivation: Dict[str, Any]
    confidence: float = 0.5
    severity: str = "hint"
    id: str = ""

    def __post_init__(self) -> None:
        if not self.id:
            self.id = _stable_id(self.kind, self.target_ids, self.proposed_ops)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id, "kind": self.kind, "title": self.title, "rationale": self.rationale,
            "target_ids": list(self.target_ids), "proposed_ops": [dict(o) for o in self.proposed_ops],
            "derivation": dict(self.derivation), "confidence": self.confidence, "severity": self.severity,
        }


def _derivation(source: str, batch_id: str, model: Optional[str] = None, inputs_hash: Optional[str] = None) -> Dict[str, Any]:
    created: Dict[str, Any] = {"actor": "agent"}
    if model:
        created["model"] = model
    d: Dict[str, Any] = {"createdBy": created, "source": source, "batchId": batch_id}
    if inputs_hash:
        d["inputsHash"] = inputs_hash
    return d


# --- builders: each compiles to closed-op-set ops, never a user-facing classification ---

def relation_label_suggestion(edge_id: str, relation: str, *, batch_id: str, confidence: float = 0.6, model: Optional[str] = None) -> Suggestion:
    op = {"op": "update_connection", "id": edge_id, "patch": {"relation": relation}}
    return Suggestion(
        kind="relation_label", title=f"Label this connection “{relation}”",
        rationale=f"This connection reads like a “{relation}” relationship.",
        target_ids=[edge_id], proposed_ops=[op],
        derivation=_derivation("relation_inference", batch_id, model), confidence=confidence,
    )


def cluster_suggestion(node_ids: List[str], *, batch_id: str, name: Optional[str] = None, confidence: float = 0.6, model: Optional[str] = None) -> Suggestion:
    op: Dict[str, Any] = {"op": "group_nodes", "ids": list(node_ids)}
    if name:
        op["content"] = name
    return Suggestion(
        kind="cluster",
        title=(f"Group these {len(node_ids)} into “{name}”" if name else f"Group these {len(node_ids)} nodes"),
        rationale="These look like they belong together.",
        target_ids=list(node_ids), proposed_ops=[op],
        derivation=_derivation("cluster_inference", batch_id, model), confidence=confidence,
    )


def role_tag_suggestion(node_id: str, role: str, *, batch_id: str, confidence: float = 0.55, model: Optional[str] = None) -> Suggestion:
    # role is INVISIBLE AI-derived metadata, never a user-facing/editable field.
    op = {"op": "update_node", "id": node_id, "patch": {"metadata": {"role": role}}}
    return Suggestion(
        kind="role_tag", title=f"(internal) tag as {role}",
        rationale=f"This reads like a {role}.",
        target_ids=[node_id], proposed_ops=[op],
        derivation=_derivation("role_inference", batch_id, model), confidence=confidence,
    )


def diagnostic_suggestion(diag: Dict[str, Any], *, batch_id: str) -> Suggestion:
    """A pure nudge (no auto-fix op) built from a deterministic diagnostic."""
    return Suggestion(
        kind="diagnostic", title=str(diag.get("kind", "issue")).replace("_", " "),
        rationale=str(diag.get("rationale", "")), target_ids=list(diag.get("target_ids") or []),
        proposed_ops=[], derivation=_derivation(str(diag.get("kind", "diagnostic")), batch_id),
        severity=str(diag.get("severity", "hint")), confidence=1.0,
    )


# --- validation + safety ---

def validate_suggestion_ops(sugg: Suggestion) -> List[str]:
    """Return warnings; empty == every proposed_op is a valid closed-set op."""
    warnings: List[str] = []
    for op in sugg.proposed_ops:
        if op.get("op") not in ALLOWED_OPS_SET:
            warnings.append(f"op '{op.get('op')}' not in ALLOWED_OPS")
    if sugg.proposed_ops:
        _normed, norm_warnings = normalize_ops([dict(o) for o in sugg.proposed_ops])
        warnings.extend(norm_warnings)
    return warnings


def is_safe(sugg: Suggestion, doc: Dict[str, Any]) -> bool:
    """Never propose what the executor will reject or what eats user intent: drop a
    suggestion whose ops touch a locked node, or move a pinned (positionIsIntentional) node."""
    by_id = {n.get("id"): n for n in (doc.get("nodes") or []) if isinstance(n, dict)}
    for op in sugg.proposed_ops:
        node = by_id.get(op.get("id"))
        if node and node.get("locked"):
            return False
        if op.get("op") == "move_node" and node and node.get("positionIsIntentional"):
            return False
    return True


def proposals_from_diagnostics(doc: Dict[str, Any], *, batch_id: str) -> List[Suggestion]:
    """The deterministic 'find issues' capability — run the LLM-free diagnostics and turn
    each into an accept/ignore nudge. No model call; fully offline."""
    from core.canvas.inference.diagnostics import run_diagnostics

    return [diagnostic_suggestion(d, batch_id=batch_id) for d in run_diagnostics(doc)]
