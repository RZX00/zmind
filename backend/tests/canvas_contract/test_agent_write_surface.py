"""Agent-facing write/read surface — typed edges authorable, connection id echoed,
edges queryable (REL-1 / WRITE-3 / ID-4 / REL-3 / intent passthrough). Offline:
cac.types, cac.engine, read_projection, intent_compiler all import standalone.
"""

from __future__ import annotations

from core.canvas.cac.types import ConnectionInput, NodeInput, TreeNodeInput
from core.canvas.cac.engine import CaCEngine
from core.canvas.read_projection import match_predicate, find_connections, find_nodes
from core.canvas.intent_compiler import compile_canvas_intent


def test_connection_input_reads_typed_slots():
    c = ConnectionInput.from_dict(
        {"from": "a", "to": "b", "relation": "question", "directed": True, "relationData": {"w": 2}, "$id": "$e1"}
    )
    assert c.relation == "question" and c.directed is True and c.relation_data == {"w": 2} and c.temp_id == "$e1"


def test_engine_carries_typed_slots_and_echoes_connection_id():
    eng = CaCEngine({"nodes": [], "connections": []})
    id_map: dict = {}
    conns = [ConnectionInput.from_dict({"from": "a", "to": "b", "relation": "supports", "directed": True, "relationData": {"k": 1}, "$id": "$e1"})]
    out = eng.create_connections(conns, [{"id": "a"}, {"id": "b"}], id_map)
    assert out[0]["relation"] == "supports" and out[0]["directed"] is True and out[0]["relationData"] == {"k": 1}
    assert id_map["$e1"] == out[0]["id"]  # ID-4: connection $id echoed into idMap


def test_connection_id_does_not_clobber_an_existing_node_idmap_entry():
    # IDMAP-COLLISION guard: a connection $id reusing a node's $id must NOT overwrite the
    # node mapping (children/parentGroupId refs to that $id must still resolve to the node).
    eng = CaCEngine({"nodes": [], "connections": []})
    id_map = {"$x": "real-node-x"}  # node temp ids are populated first
    eng.create_connections([ConnectionInput.from_dict({"from": "a", "to": "b", "$id": "$x"})], [{"id": "a"}, {"id": "b"}], id_map)
    assert id_map["$x"] == "real-node-x"  # node mapping preserved, not clobbered by the edge


def test_engine_plain_connection_has_no_typed_slots():
    eng = CaCEngine({"nodes": [], "connections": []})
    out = eng.create_connections([ConnectionInput.from_dict({"from": "a", "to": "b"})], [{"id": "a"}, {"id": "b"}], {})
    assert "relation" not in out[0] and "directed" not in out[0] and "relationData" not in out[0]


def test_match_predicate_resolves_rel_and_actor_on_an_edge():
    edge = {"id": "e1", "from": "a", "to": "b", "relation": "reference", "provenance": {"createdBy": {"actor": "agent"}}}
    assert match_predicate(edge, {"rel": "reference"})
    assert match_predicate(edge, {"actor": "agent"})
    assert not match_predicate(edge, {"rel": "supports"})
    assert not match_predicate(edge, {"actor": "human"})


def test_find_connections_by_relation_is_entity_aware():
    conns = [
        {"id": "e1", "from": "a", "to": "b", "relation": "reference"},
        {"id": "e2", "from": "b", "to": "c", "relation": "supports"},
    ]
    assert [c["id"] for c in find_connections(conns, {"rel": "reference"})] == ["e1"]
    # an edge predicate finds no nodes (nodes have no `relation`) — so find(rel=...) returns the edge, not nodes
    assert find_nodes([{"id": "a", "type": "text"}], {"rel": "reference"}) == []


def test_intent_compiler_forwards_relation_directed_relationData():
    ops, _warnings = compile_canvas_intent(
        {
            "nodes": [{"type": "text", "content": "a"}, {"type": "text", "content": "b"}],
            "connections": [{"from_index": 0, "to_index": 1, "relation": "question", "directed": True, "relationData": {"q": 1}}],
        }
    )
    add_conn = [o for o in ops if o.get("op") == "add_connection"]
    assert add_conn and add_conn[0]["relation"] == "question" and add_conn[0]["directed"] is True and add_conn[0]["relationData"] == {"q": 1}


def test_node_input_splits_durable_vs_temp_id():
    durable = NodeInput.from_dict({"id": "durable-1", "type": "text"})
    assert durable.node_id == "durable-1" and durable.temp_id is None
    temp = NodeInput.from_dict({"$id": "$1", "type": "text"})
    assert temp.temp_id == "$1" and temp.node_id is None


def test_engine_honors_durable_id_else_mints():
    eng = CaCEngine({"nodes": [], "connections": []})
    kept = eng._build_node_dict(NodeInput(type="text", node_id="durable-1"), 0, 0, 100, 50)
    assert kept["id"] == "durable-1"  # ID-3: agent-supplied durable id honored
    minted = eng._build_node_dict(NodeInput(type="text"), 0, 0, 100, 50)
    assert minted["id"] and minted["id"] != "durable-1" and len(minted["id"]) >= 8


def test_tree_temp_ids_use_tmp_convention_and_idmap_excludes_internal():
    eng = CaCEngine({"nodes": [], "connections": []})
    tree = TreeNodeInput.from_dict({"content": "root", "children": [{"content": "child", "$id": "$kid"}]})
    nodes, _conns = eng.flatten_tree(tree, None, (0.0, 0.0), None)
    temps = [n.get("_temp_id") for n in nodes]
    assert all(not str(t).startswith("$tree_") for t in temps)  # no legacy $tree_ convention
    assert any(str(t).startswith("tmp:tree_") for t in temps)  # auto-gen uses the tmp: convention
    id_map = eng.build_id_map(nodes)
    assert all("_temp_id" not in n for n in nodes)  # internal marker stripped from the op
    assert all(not k.startswith("tmp:tree_") for k in id_map)  # internal auto ids not exposed
    assert "$kid" in id_map  # agent-authored temp ref IS exposed


def test_tree_preset_is_a_chain_not_a_hierarchy():
    # WRITE-7: documented contract — the 'tree' connection preset over a flat node list is a
    # sequential chain (real hierarchy is the `tree:` field), so it must match 'chain'.
    eng = CaCEngine({"nodes": [], "connections": []})
    flat = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
    tree_edges = [(e["from"], e["to"]) for e in eng._create_preset_connections("tree", flat)]
    chain_edges = [(e["from"], e["to"]) for e in eng._create_preset_connections("chain", flat)]
    assert tree_edges == chain_edges == [("a", "b"), ("b", "c")]
