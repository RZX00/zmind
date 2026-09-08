// Offline unit tests for typed-edge slots on connections (WS5-1). node:test, no deps.
// Run: node --test tests/edge_slots.test.mjs   (from services/canvas-realtime)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCanvasOps } from "../src/ops/applyCanvasOps.js";

const docWith2 = () => ({
  id: "c1",
  title: "T",
  version: "1.0.0",
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 100, height: 50, content: "a" },
    { id: "b", type: "text", x: 200, y: 0, width: 100, height: 50, content: "b" },
  ],
  connections: [],
});

test("add_connection carries relation / directed / relationData", () => {
  const res = applyCanvasOps({
    doc: docWith2(),
    operations: [{ op: "add_connection", from: "a", to: "b", relation: "reference", directed: true, relationData: { weight: 3 } }],
    now: 1,
  });
  const c = res.doc.connections[0];
  assert.equal(c.relation, "reference");
  assert.equal(c.directed, true);
  assert.deepEqual(c.relationData, { weight: 3 });
});

test("add_connection without slots leaves them unset (back-compat)", () => {
  const res = applyCanvasOps({ doc: docWith2(), operations: [{ op: "add_connection", from: "a", to: "b" }], now: 1 });
  const c = res.doc.connections[0];
  assert.equal(c.relation, undefined);
  assert.equal(c.directed, undefined);
});

test("relation value is stored unvalidated (open vocabulary)", () => {
  const res = applyCanvasOps({ doc: docWith2(), operations: [{ op: "add_connection", from: "a", to: "b", relation: "xyzzy" }], now: 1 });
  assert.equal(res.doc.connections[0].relation, "xyzzy");
});

test("update_connection sets then clears relation, sets directed", () => {
  let res = applyCanvasOps({ doc: docWith2(), operations: [{ op: "add_connection", from: "a", to: "b", relation: "link" }], now: 1 });
  const id = res.doc.connections[0].id;
  res = applyCanvasOps({ doc: res.doc, operations: [{ op: "update_connection", id, patch: { relation: "supports", directed: false } }], now: 2 });
  let c = res.doc.connections.find((x) => x.id === id);
  assert.equal(c.relation, "supports");
  assert.equal(c.directed, false);
  res = applyCanvasOps({ doc: res.doc, operations: [{ op: "update_connection", id, patch: { relation: null } }], now: 3 });
  c = res.doc.connections.find((x) => x.id === id);
  assert.equal(c.relation, undefined);
});
