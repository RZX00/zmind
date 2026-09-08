// G4 (ratified): groups are connectable. Previously finalValidate rejected group
// endpoints; this guards the relaxation. node:test, no deps.
// Run: node --test tests/connect_group.test.mjs   (from services/canvas-realtime)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCanvasOps } from "../src/ops/applyCanvasOps.js";

const docWithGroup = () => ({
  id: "c1",
  title: "T",
  version: "1.0.0",
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 100, height: 50, content: "a" },
    { id: "g1", type: "group", x: 200, y: 0, width: 200, height: 200, content: "G", children: [] },
  ],
  connections: [],
});

test("G4: a connection may target a group node", () => {
  const res = applyCanvasOps({ doc: docWithGroup(), operations: [{ op: "add_connection", from: "a", to: "g1" }], now: 1 });
  assert.equal(res.doc.connections.length, 1);
  assert.equal(res.doc.connections[0].to, "g1");
});

test("G4: a connection may originate from a group node, with a relation slot", () => {
  const res = applyCanvasOps({
    doc: docWithGroup(),
    operations: [{ op: "add_connection", from: "g1", to: "a", relation: "contains-context" }],
    now: 1,
  });
  assert.equal(res.doc.connections.length, 1);
  assert.equal(res.doc.connections[0].from, "g1");
  assert.equal(res.doc.connections[0].relation, "contains-context");
});

test("G4: group-to-group connections are allowed", () => {
  const doc = docWithGroup();
  doc.nodes.push({ id: "g2", type: "group", x: 500, y: 0, width: 200, height: 200, content: "G2", children: [] });
  const res = applyCanvasOps({ doc, operations: [{ op: "add_connection", from: "g1", to: "g2" }], now: 1 });
  assert.equal(res.doc.connections.length, 1);
});
