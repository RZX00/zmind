// Executor parity (review's top-priority test): for a SNAPSHOT-ACCEPTED op array, the
// snapshot (applyCanvasOps) and the live Y.Doc (applyOpsToYDoc) must yield an equivalent
// doc. Scope note: the production /apply handler runs applyCanvasOps FIRST and returns
// 422 if it throws, so applyOpsToYDoc only ever runs on accepted batches — invalid input
// (snapshot throws vs live no-ops) is therefore NOT a production divergence; the
// "gate" tests below pin that contract. No actor is passed (matching prod), so
// provenance does not legitimately diverge. node:test, real Y.Doc via the installed yjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createYDocFromCanvas, applyOpsToYDoc, exportCanvasFromDocument } from "../src/ydoc/canvasDoc.js";
import { applyCanvasOps } from "../src/ops/applyCanvasOps.js";

const STRIP = new Set(["createdAt", "updatedAt"]);
const norm = (list) =>
  (list || [])
    .map((e) => {
      const o = {};
      for (const [k, v] of Object.entries(e)) if (!STRIP.has(k) && v !== undefined) o[k] = v;
      return o;
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

// Run the SAME ops array through both executors (applyCanvasOps mutates the ops with
// resolved ids; the live replay then uses them — exactly the prod /apply flow).
const expectParity = (label, canvas, operations) => {
  const snap = applyCanvasOps({ doc: structuredClone(canvas), operations, now: 7 });
  const doc = createYDocFromCanvas(structuredClone(canvas));
  applyOpsToYDoc(doc, operations, 7);
  const live = exportCanvasFromDocument(doc);
  assert.deepEqual(norm(live.nodes), norm(snap.doc.nodes), `${label}: nodes diverge`);
  assert.deepEqual(norm(live.connections), norm(snap.doc.connections), `${label}: connections diverge`);
  // Order-sensitive check (norm sorts by id, which would hide an ordering divergence).
  assert.deepEqual(live.nodes.map((n) => n.id), snap.doc.nodes.map((n) => n.id), `${label}: node order diverges`);
  assert.deepEqual(live.connections.map((c) => c.id), snap.doc.connections.map((c) => c.id), `${label}: connection order diverges`);
};

const txt = (id, extra = {}) => ({ id, type: "text", x: 0, y: 0, width: 100, height: 50, content: id, ...extra });
const tableNode = () => ({ id: "t", type: "table", x: 0, y: 0, width: 300, height: 200, content: "", data: { rows: [["A", "B"], ["1", "2"]], rowHeights: [40, 40], columnWidths: [160, 160] } });
const base = (nodes, connections = []) => ({ id: "c1", title: "T", version: "1.0.0", nodes, connections });

test("update_node + move_node (string coord coerced) parity", () => {
  expectParity("update/move", base([txt("a"), txt("b", { x: 200 })]), [
    { op: "update_node", id: "a", patch: { content: "edited" } },
    { op: "move_node", id: "b", x: "250", y: 40 },
  ]);
});

test("update_node table content-JSON -> data parity", () => {
  expectParity("table content", base([tableNode()]), [
    { op: "update_node", id: "t", patch: { content: '{"rows":[["x","y"],["1","2"]],"columnWidths":[100,100]}' } },
  ]);
});

test("add_connection with typed slots + update_connection (clear/clamp/invalid-style) parity", () => {
  expectParity("connections", base([txt("a"), txt("b", { x: 200 })]), [
    { op: "add_connection", id: "e1", from: "a", to: "b", relation: "supports", directed: true, relationData: { w: 3 } },
    { op: "update_connection", id: "e1", patch: { relation: null, style: "squiggly", tension: 5, label: "x" } },
  ]);
});

test("update_connection endpoint switch (point->node) drops the stale fromPoint in both", () => {
  // seed a point-anchored edge, then switch its from-end to node "a" (clearing the point).
  expectParity("endpoint switch", base([txt("a"), txt("b", { x: 200 })], [{ id: "e1", fromPoint: { x: 0, y: 0 }, to: "b" }]), [
    { op: "update_connection", id: "e1", patch: { from: "a", fromPoint: null } },
  ]);
});

test("update_node group/column title -> content fold parity", () => {
  expectParity("title fold", base([{ id: "g", type: "group", x: 0, y: 0, width: 200, height: 200, content: "", children: [] }]), [
    { op: "update_node", id: "g", patch: { title: "My Group" } },
  ]);
});

test("set_collapsed + table cell/row/col op parity", () => {
  expectParity("table ops", base([{ ...tableNode() }, { id: "col", type: "column", x: 400, y: 0, width: 200, height: 300, content: "C", children: [] }]), [
    { op: "set_collapsed", id: "col", collapsed: true },
    { op: "update_table_cell", id: "t", row: 1, col: 0, value: "Z" },
    { op: "table_row_op", id: "t", action: "insert", index: 1, rowData: ["p", "q"] },
    { op: "table_col_op", id: "t", action: "insert", index: 2, header: "H" },
  ]);
});

test("group_nodes (server-generated id) + member reparent parity", () => {
  expectParity("group", base([txt("a"), txt("b", { x: 200 })]), [{ op: "group_nodes", ids: ["a", "b"], content: "G" }]);
});

test("relayout_mindmap MERGE (preserves rootId/dir) parity", () => {
  const g = { id: "g", type: "group", x: 0, y: 0, width: 200, height: 200, content: "G", children: [], groupMode: "mindmap", mindmap: { rootId: "g", dir: "LR" } };
  expectParity("relayout", base([g]), [{ op: "relayout_mindmap", id: "g", patch: { mindmap: { spacing: 40 } } }]);
});

test("delete_node cascades connections identically", () => {
  expectParity("delete cascade", base([txt("a"), txt("b", { x: 200 })], [{ id: "e1", from: "a", to: "b" }]), [
    { op: "delete_node", id: "a" },
  ]);
});

test("id-less update_connection resolves the same edge in both (independent id resolution)", () => {
  // No connection id on the op: snapshot resolves by from+to, live by findConnectionIdByEndpoints.
  expectParity("idless update", base([txt("a"), txt("b", { x: 200 })], [{ id: "e1", from: "a", to: "b" }]), [
    { op: "update_connection", from: "a", to: "b", patch: { label: "linked", relation: "supports" } },
  ]);
});

// --- the production gate: applyCanvasOps rejects invalid input BEFORE the live executor runs ---

test("invalid ops are rejected by the snapshot executor (the prod /apply 422 gate)", () => {
  const canvas = base([{ ...tableNode() }]);
  const reject = (operations) => assert.throws(() => applyCanvasOps({ doc: structuredClone(canvas), operations, now: 1 }));
  reject([{ op: "update_table_cell", id: "t", row: 99, col: 0, value: "x" }]); // out-of-range
  reject([{ op: "table_col_op", id: "t", action: "insert", index: 50 }]); // index past colCount
  reject([{ op: "update_connection", id: "missing", patch: { label: "x" } }]); // unknown connection
});

test("MV1 move-on-container parity: snapshot and live drag the subtree identically", () => {
  const canvas = base([
    { id: "g", type: "group", x: 0, y: 0, width: 200, height: 200, content: "G", children: ["a", "b"] },
    txt("a", { x: 10, y: 10, parentGroupId: "g" }),
    txt("b", { x: 20, y: 30, parentGroupId: "g" }),
  ]);
  expectParity("mv1", canvas, [{ op: "move_node", id: "g", x: 100, y: 50 }]);
});
