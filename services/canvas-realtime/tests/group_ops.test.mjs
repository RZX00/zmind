// Offline unit tests for group_nodes / ungroup (WS3-3). node:test, no deps.
// Run: node --test tests/group_ops.test.mjs   (from services/canvas-realtime)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCanvasOps } from "../src/ops/applyCanvasOps.js";

const freeDoc = () => ({
  id: "c1",
  title: "T",
  version: "1.0.0",
  nodes: [
    { id: "n1", type: "text", x: 10, y: 10, width: 100, height: 50, content: "a" },
    { id: "n2", type: "text", x: 200, y: 100, width: 100, height: 50, content: "b" },
  ],
  connections: [],
});

test("group_nodes creates a group with children, tight bbox, and back-pointers", () => {
  const res = applyCanvasOps({ doc: freeDoc(), operations: [{ op: "group_nodes", ids: ["n1", "n2"] }], now: 1 });
  const entry = res.applied.find((a) => a.op === "group_nodes");
  assert.ok(entry && entry.id, "group_nodes should report the new group id");
  const g = res.doc.nodes.find((n) => n.id === entry.id);
  assert.equal(g.type, "group");
  assert.deepEqual(g.children, ["n1", "n2"]);
  assert.deepEqual([g.x, g.y, g.width, g.height], [10, 10, 290, 140]);
  for (const id of ["n1", "n2"]) {
    assert.equal(res.doc.nodes.find((n) => n.id === id).parentGroupId, entry.id);
  }
});

test("group_nodes detaches members from a previous container (single parent)", () => {
  const doc = {
    id: "c1",
    title: "T",
    version: "1.0.0",
    nodes: [
      { id: "col1", type: "column", x: 0, y: 0, width: 300, height: 200, content: "Col", children: ["n1"] },
      { id: "n1", type: "text", x: 10, y: 40, width: 100, height: 50, content: "a", parentGroupId: "col1" },
      { id: "n2", type: "text", x: 200, y: 100, width: 100, height: 50, content: "b" },
    ],
    connections: [],
  };
  const res = applyCanvasOps({ doc, operations: [{ op: "group_nodes", ids: ["n1", "n2"] }], now: 1 });
  const gid = res.applied.find((a) => a.op === "group_nodes").id;
  assert.deepEqual(res.doc.nodes.find((n) => n.id === "col1").children, []);
  assert.equal(res.doc.nodes.find((n) => n.id === "n1").parentGroupId, gid);
});

test("group_nodes rejects empty ids, a missing node, and nesting a group", () => {
  assert.throws(() => applyCanvasOps({ doc: freeDoc(), operations: [{ op: "group_nodes", ids: [] }], now: 1 }), /non-empty/);
  assert.throws(() => applyCanvasOps({ doc: freeDoc(), operations: [{ op: "group_nodes", ids: ["nope"] }], now: 1 }), /not found/);
  const withGroup = freeDoc();
  withGroup.nodes.push({ id: "g0", type: "group", x: 0, y: 0, width: 10, height: 10, content: "", children: [] });
  assert.throws(() => applyCanvasOps({ doc: withGroup, operations: [{ op: "group_nodes", ids: ["g0"] }], now: 1 }), /cannot nest/);
});

test("ungroup removes the group and frees its members (members survive)", () => {
  const doc = {
    id: "c1",
    title: "T",
    version: "1.0.0",
    nodes: [
      { id: "g1", type: "group", x: 0, y: 0, width: 300, height: 200, content: "G", children: ["a", "b"] },
      { id: "a", type: "text", x: 10, y: 40, width: 100, height: 50, content: "a", parentGroupId: "g1" },
      { id: "b", type: "text", x: 120, y: 40, width: 100, height: 50, content: "b", parentGroupId: "g1" },
    ],
    connections: [],
  };
  const res = applyCanvasOps({ doc, operations: [{ op: "ungroup", id: "g1" }], now: 1 });
  assert.equal(res.doc.nodes.find((n) => n.id === "g1"), undefined);
  for (const id of ["a", "b"]) {
    const n = res.doc.nodes.find((x) => x.id === id);
    assert.ok(n);
    assert.equal(n.parentGroupId, undefined);
  }
});

test("ungroup rejects a non-group node and a missing id", () => {
  assert.throws(() => applyCanvasOps({ doc: freeDoc(), operations: [{ op: "ungroup", id: "n1" }], now: 1 }), /not a group/);
  assert.throws(() => applyCanvasOps({ doc: freeDoc(), operations: [{ op: "ungroup", id: "zzz" }], now: 1 }), /not found/);
});
