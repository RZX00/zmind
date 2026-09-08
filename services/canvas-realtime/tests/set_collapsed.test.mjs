// Offline unit test for the set_collapsed op (WS3-3). node:test, no deps.
// Run: node --test tests/set_collapsed.test.mjs   (from services/canvas-realtime)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCanvasOps } from "../src/ops/applyCanvasOps.js";

const mkDoc = () => ({
  id: "c1",
  title: "T",
  version: "1.0.0",
  nodes: [
    { id: "col1", type: "column", x: 0, y: 0, width: 300, height: 200, content: "Col", children: ["n1"] },
    { id: "n1", type: "text", x: 10, y: 40, width: 200, height: 60, content: "item", parentGroupId: "col1" },
    { id: "g1", type: "group", x: 400, y: 0, width: 300, height: 200, content: "G", children: ["n2"] },
    { id: "n2", type: "text", x: 410, y: 40, width: 200, height: 60, content: "x", parentGroupId: "g1" },
  ],
  connections: [],
});

const run = (ops) => applyCanvasOps({ doc: mkDoc(), operations: ops, now: 1 }).doc;
const byId = (doc, id) => doc.nodes.find((n) => n.id === id);

test("set_collapsed defaults to true on a column", () => {
  assert.equal(byId(run([{ op: "set_collapsed", id: "col1" }]), "col1").isCollapsed, true);
});

test("set_collapsed explicit false un-collapses", () => {
  assert.equal(byId(run([{ op: "set_collapsed", id: "col1", collapsed: false }]), "col1").isCollapsed, false);
});

test("set_collapsed works on a group container", () => {
  assert.equal(byId(run([{ op: "set_collapsed", id: "g1", collapsed: true }]), "g1").isCollapsed, true);
});

test("set_collapsed rejects a non-container node", () => {
  assert.throws(() => run([{ op: "set_collapsed", id: "n1", collapsed: true }]), /not a container/);
});

test("the setcollapsed alias normalizes", () => {
  assert.equal(byId(run([{ op: "setcollapsed", id: "col1" }]), "col1").isCollapsed, true);
});
