// Offline unit test for the update_table_cell op (WS3-2) — node's built-in runner, no deps.
// Run: node --test tests/update_table_cell.test.mjs   (from services/canvas-realtime)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCanvasOps } from "../src/ops/applyCanvasOps.js";

const baseDoc = () => ({
  id: "c1",
  title: "T",
  version: "1.0.0",
  nodes: [
    {
      id: "t1",
      type: "table",
      x: 0,
      y: 0,
      width: 400,
      height: 130,
      content: "",
      data: { rows: [["a", "b"], ["c", "d"]] },
    },
  ],
  connections: [],
});

test("update_table_cell mutates exactly one cell", () => {
  const { doc, applied } = applyCanvasOps({
    doc: baseDoc(),
    operations: [{ op: "update_table_cell", id: "t1", row: 1, col: 0, value: "X" }],
    now: 1700000000000,
  });
  assert.deepEqual(doc.nodes[0].data.rows, [["a", "b"], ["X", "d"]]);
  assert.ok(applied.some((a) => a.op === "update_table_cell" && a.id === "t1"));
});

test("update_table_cell coerces value to string", () => {
  const { doc } = applyCanvasOps({
    doc: baseDoc(),
    operations: [{ op: "update_table_cell", id: "t1", row: 0, col: 0, value: 42 }],
    now: 1,
  });
  assert.equal(doc.nodes[0].data.rows[0][0], "42");
});

test("update_table_cell rejects out-of-range cell", () => {
  assert.throws(
    () =>
      applyCanvasOps({
        doc: baseDoc(),
        operations: [{ op: "update_table_cell", id: "t1", row: 9, col: 0, value: "X" }],
        now: 1,
      }),
    /out of range/,
  );
});

test("update_table_cell rejects a non-table node", () => {
  const d = baseDoc();
  d.nodes.push({ id: "x1", type: "text", x: 0, y: 0, width: 100, height: 60, content: "hi" });
  assert.throws(
    () =>
      applyCanvasOps({
        doc: d,
        operations: [{ op: "update_table_cell", id: "x1", row: 0, col: 0, value: "X" }],
        now: 1,
      }),
    /not a table/,
  );
});

test("the updatetablecell alias normalizes to update_table_cell", () => {
  const { doc } = applyCanvasOps({
    doc: baseDoc(),
    operations: [{ op: "updatetablecell", id: "t1", row: 0, col: 1, value: "Z" }],
    now: 1,
  });
  assert.equal(doc.nodes[0].data.rows[0][1], "Z");
});
