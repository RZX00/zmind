// NODE_LOCKED enforcement + MV1 move-on-container. node:test.
// Run: node --test tests/node_locked_move_container.test.mjs  (from services/canvas-realtime)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCanvasOps } from "../src/ops/applyCanvasOps.js";
import { normalizeCanvasError } from "../src/ops/errors.js";

const docOf = (nodes) => ({ id: "c1", title: "T", version: "1.0.0", nodes, connections: [] });
const txt = (id, extra = {}) => ({ id, type: "text", x: 0, y: 0, width: 100, height: 50, content: id, ...extra });
const find = (res, id) => res.doc.nodes.find((n) => n.id === id);

test("NODE_LOCKED: every content/geometry/structure op on a locked node is rejected (typed)", () => {
  for (const op of [
    { op: "update_node", id: "a", patch: { content: "x" } },
    { op: "move_node", id: "a", x: 50, y: 50 },
    { op: "apply_style", id: "a", patch: { accentColor: "#f00" } },
    { op: "delete_node", id: "a" },
  ]) {
    let err;
    try {
      applyCanvasOps({ doc: docOf([txt("a", { locked: true })]), operations: [op], now: 1 });
    } catch (e) {
      err = e;
    }
    assert.ok(err, `${op.op} must reject a locked node`);
    const env = normalizeCanvasError(err);
    assert.equal(env.code, "NODE_LOCKED");
    assert.equal(env.retryable, false);
  }
});

test("NODE_LOCKED: a locked table cell edit is rejected", () => {
  const table = { id: "t", type: "table", x: 0, y: 0, width: 300, height: 100, content: "", locked: true, data: { rows: [["a"]] } };
  let err;
  try {
    applyCanvasOps({ doc: docOf([table]), operations: [{ op: "update_table_cell", id: "t", row: 0, col: 0, value: "z" }], now: 1 });
  } catch (e) {
    err = e;
  }
  assert.ok(err);
  assert.equal(normalizeCanvasError(err).code, "NODE_LOCKED");
});

test("an unlocked node still mutates normally", () => {
  const res = applyCanvasOps({ doc: docOf([txt("a")]), operations: [{ op: "move_node", id: "a", x: 9, y: 9 }], now: 1 });
  assert.equal(find(res, "a").x, 9);
});

test("MV1: moving a group drags its children by the same delta", () => {
  const doc = docOf([
    { id: "g", type: "group", x: 0, y: 0, width: 200, height: 200, content: "G", children: ["a", "b"] },
    txt("a", { x: 10, y: 10, parentGroupId: "g" }),
    txt("b", { x: 20, y: 30, parentGroupId: "g" }),
  ]);
  const res = applyCanvasOps({ doc, operations: [{ op: "move_node", id: "g", x: 100, y: 50 }], now: 1 });
  assert.equal(find(res, "g").x, 100);
  assert.equal(find(res, "a").x, 110); // 10 + 100
  assert.equal(find(res, "a").y, 60); // 10 + 50
  assert.equal(find(res, "b").x, 120); // 20 + 100
  assert.equal(find(res, "b").y, 80); // 30 + 50
});

test("MV1: nested containers move recursively", () => {
  const doc = docOf([
    { id: "outer", type: "group", x: 0, y: 0, width: 300, height: 300, content: "O", children: ["inner"] },
    { id: "inner", type: "group", x: 50, y: 50, width: 100, height: 100, content: "I", children: ["leaf"], parentGroupId: "outer" },
    txt("leaf", { x: 60, y: 60, parentGroupId: "inner" }),
  ]);
  const res = applyCanvasOps({ doc, operations: [{ op: "move_node", id: "outer", x: 10, y: 0 }], now: 1 });
  assert.equal(find(res, "inner").x, 60); // 50 + 10
  assert.equal(find(res, "leaf").x, 70); // 60 + 10 (recursive)
});

test("MV1: moving a leaf does not move unrelated nodes", () => {
  const res = applyCanvasOps({ doc: docOf([txt("a", { x: 0, y: 0 }), txt("b", { x: 100, y: 100 })]), operations: [{ op: "move_node", id: "a", x: 5, y: 5 }], now: 1 });
  assert.equal(find(res, "b").x, 100);
});
