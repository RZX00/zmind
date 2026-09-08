"""Deterministic canvas diagnostics (thinking-layer inference core, no LLM).

Pure functions over the raw canvas doc ``{nodes, connections}`` — the same shape
read_projection consumes. They surface lightweight, capture-first *nudges* the user
accepts or ignores: an isolated node, a claim with no support, a reasoning cycle, MECE
overlap between sibling branches.

Roles (claim/evidence/...) are read ONLY from AI-derived ``node.metadata.role``; they are
NEVER a user-authored/editable field. When no role exists, detectors fall back to pure
topology, so the layer works *before* any role inference. stdlib-only -> offline-testable.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

# Open, non-normative — relation strings the substrate never validates. Used only to
# recognise an *inbound support* edge for the (role-gated) unsupported-claim nudge.
SUPPORT_RELATIONS = frozenset(
    {"supports", "support", "is-evidence-for", "evidence", "because", "backs", "justifies", "cites"}
)


def _nodes(doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [n for n in (doc.get("nodes") or []) if isinstance(n, dict) and n.get("id")]


def _conns(doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [c for c in (doc.get("connections") or []) if isinstance(c, dict)]


def _role(node: Dict[str, Any]) -> Optional[str]:
    md = node.get("metadata")
    return md.get("role") if isinstance(md, dict) else None


def _tokens(text: Any) -> set:
    return {t for t in re.split(r"[^0-9a-z一-鿿]+", str(text or "").lower()) if len(t) >= 2}


def detect_cycle(doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Directed-connection cycles. A cycle is a HINT, not an error — feedback loops are
    legitimate (systems thinking); we surface it so the user can confirm intent, never
    auto-remove. Undirected edges don't form reasoning cycles and are ignored."""
    node_ids = {n["id"] for n in _nodes(doc)}
    adj: Dict[str, List[str]] = {}
    for c in _conns(doc):
        if c.get("directed") is False:
            continue
        f, t = c.get("from"), c.get("to")
        if f in node_ids and t in node_ids:
            adj.setdefault(f, []).append(t)

    WHITE, GREY, BLACK = 0, 1, 2
    color: Dict[str, int] = {}
    cycle_nodes: set = set()

    def visit(u: str, stack: List[str]) -> None:
        color[u] = GREY
        stack.append(u)
        for v in adj.get(u, []):
            if color.get(v, WHITE) == GREY and v in stack:
                cycle_nodes.update(stack[stack.index(v):])  # the loop u..v
            elif color.get(v, WHITE) == WHITE:
                visit(v, stack)
        stack.pop()
        color[u] = BLACK

    for u in sorted(adj):  # sorted start order -> deterministic
        if color.get(u, WHITE) == WHITE:
            visit(u, [])

    if not cycle_nodes:
        return []
    return [{
        "kind": "cycle",
        "target_ids": sorted(cycle_nodes),
        "severity": "hint",
        "rationale": "These nodes form a directed loop — confirm it is an intended feedback cycle, not circular reasoning.",
    }]


def detect_orphan_claim(doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Role-aware: a node with role=='claim' that has no connection at all.
    Pre-role fallback: a non-empty text node isolated *within an otherwise-connected graph*
    (so a fresh unconnected pile of notes is never nagged — only a stray amid structure)."""
    nodes = _nodes(doc)
    touched: set = set()
    for c in _conns(doc):
        if c.get("from"):
            touched.add(c.get("from"))
        if c.get("to"):
            touched.add(c.get("to"))
    has_edges = bool(touched)

    out: List[Dict[str, Any]] = []
    for n in nodes:
        nid = n["id"]
        if nid in touched:
            continue
        role = _role(n)
        if role == "claim":
            out.append({"kind": "orphan_claim", "target_ids": [nid], "severity": "hint",
                        "rationale": "This claim has no supporting or related connection."})
        elif role is None and has_edges and n.get("type") == "text" and str(n.get("content") or "").strip():
            out.append({"kind": "orphan_node", "target_ids": [nid], "severity": "hint",
                        "rationale": "This node is isolated — nothing connects to it."})
    return out


def detect_unsupported_claim(doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Role-gated: a node with role=='claim' and NO inbound support/evidence edge. Only
    fires once role metadata exists (AI-derived) — no pre-role heuristic, to avoid nagging."""
    inbound_support: Dict[str, int] = {}
    for c in _conns(doc):
        to = c.get("to")
        rel = str(c.get("relation") or "").strip().lower()
        if to and rel in SUPPORT_RELATIONS:
            inbound_support[to] = inbound_support.get(to, 0) + 1
    out: List[Dict[str, Any]] = []
    for n in _nodes(doc):
        if _role(n) == "claim" and inbound_support.get(n["id"], 0) == 0:
            out.append({"kind": "unsupported_claim", "target_ids": [n["id"]], "severity": "hint",
                        "rationale": "This claim has no inbound evidence/support edge."})
    return out


def detect_mece_overlap(doc: Dict[str, Any], threshold: float = 0.5) -> List[Dict[str, Any]]:
    """Two sibling members of the same container whose content tokens overlap above a
    Jaccard threshold — a likely MECE violation (branches not mutually exclusive)."""
    by_parent: Dict[str, List[Dict[str, Any]]] = {}
    for n in _nodes(doc):
        p = n.get("parentGroupId")
        if p:
            by_parent.setdefault(p, []).append(n)

    out: List[Dict[str, Any]] = []
    for _p, raw in by_parent.items():
        sibs = sorted(raw, key=lambda n: n["id"])
        for i in range(len(sibs)):
            for j in range(i + 1, len(sibs)):
                a, b = _tokens(sibs[i].get("content")), _tokens(sibs[j].get("content"))
                if not a or not b:
                    continue
                jac = len(a & b) / len(a | b)
                if jac >= threshold:
                    out.append({
                        "kind": "mece_overlap",
                        "target_ids": [sibs[i]["id"], sibs[j]["id"]],
                        "severity": "hint",
                        "rationale": f"These sibling branches overlap (Jaccard {jac:.2f}) — they may not be mutually exclusive.",
                    })
    return out


def run_diagnostics(doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """All deterministic diagnostics, in a stable (kind, targets) order."""
    out: List[Dict[str, Any]] = []
    out.extend(detect_cycle(doc))
    out.extend(detect_orphan_claim(doc))
    out.extend(detect_unsupported_claim(doc))
    out.extend(detect_mece_overlap(doc))
    out.sort(key=lambda d: (d["kind"], tuple(d["target_ids"])))
    return out
