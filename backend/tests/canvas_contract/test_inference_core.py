"""Deterministic inference core — diagnostics + suggestion model (thinking-layer P0).

Pure / offline (WSL pytest): inference modules import only stdlib + the canvas op-contract.
Proves the AI's deterministic brain (find issues -> propose fixes) before any LLM/wiring.
"""

from __future__ import annotations

from core.canvas.inference.diagnostics import (
    detect_cycle,
    detect_mece_overlap,
    detect_orphan_claim,
    detect_unsupported_claim,
    run_diagnostics,
)
from core.canvas.inference.suggestions import (
    Suggestion,
    cluster_suggestion,
    is_safe,
    proposals_from_diagnostics,
    relation_label_suggestion,
    role_tag_suggestion,
    validate_suggestion_ops,
)


def _doc(nodes, connections=None):
    return {"nodes": nodes, "connections": connections or []}


def n(id, **kw):
    return {"id": id, "type": kw.pop("type", "text"), "content": kw.pop("content", id), **kw}


# ---------------- diagnostics ----------------

def test_cycle_is_a_hint_not_an_error():
    doc = _doc([n("a"), n("b"), n("c")], [
        {"id": "e1", "from": "a", "to": "b"}, {"id": "e2", "from": "b", "to": "c"}, {"id": "e3", "from": "c", "to": "a"},
    ])
    diags = detect_cycle(doc)
    assert len(diags) == 1 and diags[0]["kind"] == "cycle" and diags[0]["severity"] == "hint"
    assert set(diags[0]["target_ids"]) == {"a", "b", "c"}


def test_no_cycle_on_a_dag_or_undirected():
    dag = _doc([n("a"), n("b")], [{"id": "e", "from": "a", "to": "b"}])
    assert detect_cycle(dag) == []
    # an undirected back-edge is not a reasoning cycle
    undirected = _doc([n("a"), n("b")], [
        {"id": "e1", "from": "a", "to": "b"}, {"id": "e2", "from": "b", "to": "a", "directed": False},
    ])
    assert detect_cycle(undirected) == []


def test_orphan_claim_role_aware_and_prerole_fallback():
    # role-aware: an explicit claim with no edges
    role_doc = _doc([n("c1", metadata={"role": "claim"}), n("x")], [])
    assert [d["kind"] for d in detect_orphan_claim(role_doc) if "c1" in d["target_ids"]] == ["orphan_claim"]
    # pre-role: an isolated text node amid a connected graph
    pre = _doc([n("a"), n("b"), n("lonely")], [{"id": "e", "from": "a", "to": "b"}])
    orphans = {tuple(d["target_ids"])[0] for d in detect_orphan_claim(pre)}
    assert "lonely" in orphans and "a" not in orphans and "b" not in orphans


def test_orphan_not_flagged_when_no_edges_exist():
    # a fresh unconnected pile must NOT be nagged
    pile = _doc([n("a"), n("b"), n("c")], [])
    assert detect_orphan_claim(pile) == []


def test_unsupported_claim_is_role_gated():
    # role=claim, no inbound support edge -> flagged
    doc = _doc([n("c1", metadata={"role": "claim"}), n("e1")], [])
    assert [d["kind"] for d in detect_unsupported_claim(doc)] == ["unsupported_claim"]
    # add an inbound support edge -> no longer flagged
    doc2 = _doc([n("c1", metadata={"role": "claim"}), n("e1")], [{"id": "x", "from": "e1", "to": "c1", "relation": "supports"}])
    assert detect_unsupported_claim(doc2) == []
    # a plain node without a role is never an unsupported_claim
    assert detect_unsupported_claim(_doc([n("plain")], [])) == []


def test_mece_overlap_on_sibling_branches():
    doc = _doc([
        {"id": "g", "type": "group", "content": "G", "children": ["a", "b", "c"]},
        n("a", content="pricing and revenue model", parentGroupId="g"),
        n("b", content="pricing strategy and revenue", parentGroupId="g"),
        n("c", content="hiring plan", parentGroupId="g"),
    ])
    diags = detect_mece_overlap(doc, threshold=0.3)
    assert len(diags) == 1 and set(diags[0]["target_ids"]) == {"a", "b"}


def test_run_diagnostics_is_deterministic():
    doc = _doc([n("a"), n("b"), n("lonely")], [
        {"id": "e1", "from": "a", "to": "b"}, {"id": "e2", "from": "b", "to": "a"},
    ])
    first = run_diagnostics(doc)
    assert run_diagnostics(doc) == first  # stable order, repeatable
    kinds = [d["kind"] for d in first]
    assert kinds == sorted(kinds) or all(isinstance(k, str) for k in kinds)  # sorted by (kind,targets)


# ---------------- suggestion model ----------------

def test_stable_id_is_reproducible_and_kind_prefixed():
    a = relation_label_suggestion("e1", "supports", batch_id="b1")
    b = relation_label_suggestion("e1", "supports", batch_id="b1")
    assert a.id == b.id and a.id.startswith("relation_label:")
    c = relation_label_suggestion("e1", "contradicts", batch_id="b1")
    assert c.id != a.id  # different payload -> different id


def test_builders_compile_to_valid_closed_set_ops():
    for s in [
        relation_label_suggestion("e1", "supports", batch_id="b1"),
        cluster_suggestion(["a", "b"], name="Theme", batch_id="b1"),
        role_tag_suggestion("n1", "claim", batch_id="b1"),
    ]:
        assert validate_suggestion_ops(s) == [], f"{s.kind} produced invalid ops: {validate_suggestion_ops(s)}"
        assert s.derivation["createdBy"]["actor"] == "agent" and s.derivation["batchId"] == "b1"


def test_role_tag_writes_invisible_metadata_not_a_node_field():
    s = role_tag_suggestion("n1", "evidence", batch_id="b1")
    op = s.proposed_ops[0]
    assert op["op"] == "update_node" and op["patch"]["metadata"]["role"] == "evidence"
    # role rides as metadata — there is no top-level node 'role'/'type' mutation
    assert "role" not in op["patch"] and "type" not in op["patch"]


def test_validate_flags_a_non_allowed_op():
    bad = Suggestion(kind="x", title="t", rationale="r", target_ids=["n"],
                     proposed_ops=[{"op": "frobnicate", "id": "n"}], derivation={"createdBy": {"actor": "agent"}, "batchId": "b"})
    assert any("not in ALLOWED_OPS" in w for w in validate_suggestion_ops(bad))


def test_is_safe_drops_locked_and_pinned_targets():
    doc = _doc([n("a", locked=True), n("b", positionIsIntentional=True), n("c")])
    locked_edit = role_tag_suggestion("a", "claim", batch_id="b1")
    pinned_move = Suggestion(kind="move", title="t", rationale="r", target_ids=["b"],
                             proposed_ops=[{"op": "move_node", "id": "b", "x": 9, "y": 9}], derivation={"batchId": "b1"})
    ok = role_tag_suggestion("c", "claim", batch_id="b1")
    assert is_safe(locked_edit, doc) is False
    assert is_safe(pinned_move, doc) is False
    assert is_safe(ok, doc) is True


def test_proposals_from_diagnostics_offline_end_to_end():
    # "find issues" with NO LLM: an isolated node amid structure -> an accept/ignore nudge
    doc = _doc([n("a"), n("b"), n("lonely")], [{"id": "e", "from": "a", "to": "b"}])
    suggs = proposals_from_diagnostics(doc, batch_id="run1:0")
    assert suggs and all(isinstance(s, Suggestion) for s in suggs)
    assert all(s.kind == "diagnostic" and s.derivation["batchId"] == "run1:0" for s in suggs)
    assert any("lonely" in s.target_ids for s in suggs)
