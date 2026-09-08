"""Canvas read contract — predicate find + container subtree resolution (WS2-6)."""

from __future__ import annotations

from core.canvas.read_projection import children_subtree, find_nodes, match_predicate


def _nodes():
    # g(children a,b) ; b is a sub-container(children c) ; d is a straggler (parentGroupId=g,
    # not listed in g.children) ; x is loose.
    return [
        {"id": "g", "type": "group", "children": ["a", "b"]},
        {"id": "a", "type": "text", "parentGroupId": "g", "content": "alpha TODO beta"},
        {"id": "b", "type": "column", "parentGroupId": "g", "children": ["c"]},
        {"id": "c", "type": "todo", "parentGroupId": "b", "content": "gamma"},
        {"id": "d", "type": "text", "parentGroupId": "g", "content": "straggler"},
        {"id": "x", "type": "text", "content": "loose"},
    ]


def test_match_predicate_exact_and_parent_alias():
    n = _nodes()[1]
    assert match_predicate(n, {"type": "text"}) is True
    assert match_predicate(n, {"type": "todo"}) is False
    assert match_predicate(n, {"parentId": "g"}) is True  # parentId aliases parentGroupId
    assert match_predicate(n, {"parentId": "b"}) is False
    assert match_predicate({}, {"type": "text"}) is False
    assert match_predicate(n, {}) is True  # empty predicate matches everything


def test_match_predicate_operators():
    n = {"type": "text", "content": "alpha TODO beta"}
    assert match_predicate(n, {"content": {"$contains": "TODO"}}) is True
    assert match_predicate(n, {"content": {"$startsWith": "alpha"}}) is True
    assert match_predicate(n, {"content": {"$regex": r"TO.O"}}) is True
    assert match_predicate(n, {"type": ["text", "todo"]}) is True  # multi-value membership
    assert match_predicate(n, {"type": ["code", "todo"]}) is False


def test_find_nodes():
    nodes = _nodes()
    assert [n["id"] for n in find_nodes(nodes, {"type": "todo"})] == ["c"]
    assert {n["id"] for n in find_nodes(nodes, {"parentId": "g"})} == {"a", "b", "d"}


def test_children_subtree_direct_includes_straggler():
    # ordered children [a, b] first, then the straggler d (parentGroupId=g, not in children[])
    assert [n["id"] for n in children_subtree(_nodes(), "g")] == ["a", "b", "d"]


def test_children_subtree_recursive_descends():
    # g -> a, b, d ; b -> c  (depth-first by appearance)
    assert [n["id"] for n in children_subtree(_nodes(), "g", recursive=True)] == ["a", "b", "c", "d"]


def test_children_subtree_missing_container():
    assert children_subtree(_nodes(), "does-not-exist") == []
