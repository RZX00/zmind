// Offline tests for containment reconcile (WS5-3). node:test, no deps.
// parentGroupId = membership truth; children[] = derived ordered view.
// Run: node --test tests/containment_reconcile.test.mjs   (from services/canvas-realtime)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCanvasOps } from "../src/ops/applyCanvasOps.js";

const group = (id, children = []) => ({ id, type: "group", x: 0, y: 0, width: 200, height: 200, content: id, children });
const leaf = (id, extra = {}) => ({ id, type: "text", x: 10, y: 10, width: 50, height: 30, content: id, ...extra });
const docOf = (nodes) => ({ id: "c1", title: "T", version: "1.0.0", nodes, connections: [] });
// A benign op that only triggers the post-loop reconcile without touching containment.
const touch = (id) => [{ op: "update_node", id, patch: { content: `${id}!` } }];

const find = (res, id) => res.doc.nodes.find((n) => n.id === id);

test("back-fills children[] from a parentGroupId back-reference", () => {
  const res = applyCanvasOps({ doc: docOf([group("g", []), leaf("a", { parentGroupId: "g" })]), operations: touch("a"), now: 1 });
  assert.deepEqual(find(res, "g").children, ["a"]);
});

test("drops a dangling child id (no such node)", () => {
  const res = applyCanvasOps({ doc: docOf([group("g", ["a", "ghost"]), leaf("a", { parentGroupId: "g" })]), operations: touch("a"), now: 1 });
  assert.deepEqual(find(res, "g").children, ["a"]);
});

test("adopts an orphan listed in children[] (sets its parentGroupId)", () => {
  const res = applyCanvasOps({ doc: docOf([group("g", ["a"]), leaf("a")]), operations: touch("a"), now: 1 });
  assert.equal(find(res, "a").parentGroupId, "g");
  assert.deepEqual(find(res, "g").children, ["a"]);
});

test("single parent: a moved node is dropped from its old container", () => {
  const res = applyCanvasOps({
    doc: docOf([group("g1", ["a"]), group("g2", []), leaf("a", { parentGroupId: "g2" })]),
    operations: touch("a"),
    now: 1,
  });
  assert.deepEqual(find(res, "g1").children, []);
  assert.deepEqual(find(res, "g2").children, ["a"]);
});

test("clears a truly-dangling back-pointer (parent gone)", () => {
  const res = applyCanvasOps({ doc: docOf([leaf("a", { parentGroupId: "gone" })]), operations: touch("a"), now: 1 });
  assert.equal(find(res, "a").parentGroupId, undefined);
});

test("preserves the declared child order", () => {
  const res = applyCanvasOps({
    doc: docOf([group("g", ["b", "a", "c"]), leaf("a", { parentGroupId: "g" }), leaf("b", { parentGroupId: "g" }), leaf("c", { parentGroupId: "g" })]),
    operations: touch("a"),
    now: 1,
  });
  assert.deepEqual(find(res, "g").children, ["b", "a", "c"]);
});

test("is idempotent on an already-consistent doc", () => {
  const consistent = docOf([group("g", ["a", "b"]), leaf("a", { parentGroupId: "g" }), leaf("b", { parentGroupId: "g" })]);
  const res = applyCanvasOps({ doc: consistent, operations: touch("a"), now: 1 });
  assert.deepEqual(find(res, "g").children, ["a", "b"]);
  assert.equal(find(res, "a").parentGroupId, "g");
});
