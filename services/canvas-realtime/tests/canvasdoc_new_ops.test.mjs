// End-to-end Yjs tests: the 6 new write ops must reflect in the LIVE Y.Doc, not
// only in the persisted snapshot (applyOpsToYDoc parity with applyCanvasOps).
// Run: node --test tests/canvasdoc_new_ops.test.mjs   (from services/canvas-realtime)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createYDocFromCanvas, applyOpsToYDoc, exportCanvasFromDocument } from "../src/ydoc/canvasDoc.js";
import { applyCanvasOps } from "../src/ops/applyCanvasOps.js";

const base = (nodes) => ({ id: "c1", title: "T", version: "1.0.0", nodes, connections: [] });
const tableCanvas = () =>
  base([{ id: "t", type: "table", x: 0, y: 0, width: 300, height: 200, content: "", data: { rows: [["A", "B"], ["1", "2"]], rowHeights: [40, 40], columnWidths: [160, 160] } }]);
const twoLeaves = () =>
  base([
    { id: "a", type: "text", x: 0, y: 0, width: 100, height: 50, content: "a" },
    { id: "b", type: "text", x: 200, y: 0, width: 100, height: 50, content: "b" },
  ]);
const colCanvas = () => base([{ id: "col", type: "column", x: 0, y: 0, width: 200, height: 300, content: "C", children: [] }]);
const node = (doc, id) => exportCanvasFromDocument(doc).nodes.find((n) => n.id === id);

test("set_collapsed reflects in the live Y.Doc", () => {
  const doc = createYDocFromCanvas(colCanvas());
  applyOpsToYDoc(doc, [{ op: "set_collapsed", id: "col", collapsed: true }], 1);
  assert.equal(node(doc, "col").isCollapsed, true);
});

test("update_table_cell mutates the seeded (plain-object) table data", () => {
  const doc = createYDocFromCanvas(tableCanvas());
  applyOpsToYDoc(doc, [{ op: "update_table_cell", id: "t", row: 1, col: 0, value: "X" }], 1);
  assert.equal(node(doc, "t").data.rows[1][0], "X");
});

test("table_row_op insert adds a row at the index", () => {
  const doc = createYDocFromCanvas(tableCanvas());
  applyOpsToYDoc(doc, [{ op: "table_row_op", id: "t", action: "insert", index: 1, rowData: ["x", "y"] }], 1);
  const rows = node(doc, "t").data.rows;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ["x", "y"]);
});

test("table_col_op insert adds a column with a header", () => {
  const doc = createYDocFromCanvas(tableCanvas());
  applyOpsToYDoc(doc, [{ op: "table_col_op", id: "t", action: "insert", index: 2, header: "C" }], 1);
  const rows = node(doc, "t").data.rows;
  assert.equal(rows[0].length, 3);
  assert.equal(rows[0][2], "C");
  assert.equal(rows[1][2], "");
});

test("group_nodes creates the group + reparents members in the live Y.Doc", () => {
  const doc = createYDocFromCanvas(twoLeaves());
  applyOpsToYDoc(doc, [{ op: "group_nodes", id: "g1", ids: ["a", "b"], content: "G" }], 1);
  const g = node(doc, "g1");
  assert.equal(g.type, "group");
  assert.deepEqual(g.children, ["a", "b"]);
  assert.equal(node(doc, "a").parentGroupId, "g1");
});

test("ungroup removes the group + clears member back-pointers", () => {
  const doc = createYDocFromCanvas(twoLeaves());
  applyOpsToYDoc(doc, [{ op: "group_nodes", id: "g1", ids: ["a", "b"], content: "G" }], 1);
  applyOpsToYDoc(doc, [{ op: "ungroup", id: "g1" }], 2);
  assert.equal(node(doc, "g1"), undefined);
  assert.equal(node(doc, "a").parentGroupId, undefined);
});

test("group_nodes id parity: applyCanvasOps + applyOpsToYDoc agree on the generated id", () => {
  const canvas = twoLeaves();
  const ops = [{ op: "group_nodes", ids: ["a", "b"], content: "G" }]; // no id -> server generates
  const computed = applyCanvasOps({ doc: structuredClone(canvas), operations: ops, now: 5 });
  const generatedId = ops[0].id; // applyCanvasOps mutated the op with the resolved group id
  assert.ok(typeof generatedId === "string" && generatedId.length > 0);
  assert.equal(computed.doc.nodes.find((n) => n.type === "group").id, generatedId);
  const doc = createYDocFromCanvas(canvas);
  applyOpsToYDoc(doc, ops, 5); // replay the same (now id-carrying) op into the live doc
  assert.equal(node(doc, generatedId)?.type, "group");
});
