// Offline unit tests for table_row_op / table_col_op (WS3-2 cont'd). node:test, no deps.
// Run: node --test tests/   (from services/canvas-realtime)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCanvasOps } from "../src/ops/applyCanvasOps.js";

const tableDoc = () => ({
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
      data: { rows: [["a", "b"], ["c", "d"]], columnWidths: [160, 160], rowHeights: [40, 40] },
    },
  ],
  connections: [],
});

const apply = (ops) => applyCanvasOps({ doc: tableDoc(), operations: ops, now: 1 }).doc.nodes[0].data;

test("table_row_op insert with rowData keeps rowHeights consistent", () => {
  const d = apply([{ op: "table_row_op", id: "t1", action: "insert", index: 1, rowData: ["e", "f"] }]);
  assert.deepEqual(d.rows, [["a", "b"], ["e", "f"], ["c", "d"]]);
  assert.equal(d.rowHeights.length, 3);
});

test("table_row_op insert without rowData creates an empty row of the right width", () => {
  const d = apply([{ op: "table_row_op", id: "t1", action: "insert", index: 0 }]);
  assert.deepEqual(d.rows[0], ["", ""]);
  assert.equal(d.rows.length, 3);
});

test("table_row_op delete removes the row and its height", () => {
  const d = apply([{ op: "table_row_op", id: "t1", action: "delete", index: 0 }]);
  assert.deepEqual(d.rows, [["c", "d"]]);
  assert.equal(d.rowHeights.length, 1);
});

test("table_col_op insert with header keeps columnWidths consistent", () => {
  const d = apply([{ op: "table_col_op", id: "t1", action: "insert", index: 1, header: "H" }]);
  assert.deepEqual(d.rows, [["a", "H", "b"], ["c", "", "d"]]);
  assert.equal(d.columnWidths.length, 3);
});

test("table_col_op delete removes the column from every row", () => {
  const d = apply([{ op: "table_col_op", id: "t1", action: "delete", index: 0 }]);
  assert.deepEqual(d.rows, [["b"], ["d"]]);
  assert.equal(d.columnWidths.length, 1);
});

test("rejects an invalid action", () => {
  assert.throws(() => apply([{ op: "table_row_op", id: "t1", action: "nope", index: 0 }]), /action/);
});

test("rejects an out-of-range index", () => {
  assert.throws(() => apply([{ op: "table_col_op", id: "t1", action: "delete", index: 9 }]), /out of range/);
});

test("aliases (tablerowop) normalize", () => {
  const d = apply([{ op: "tablerowop", id: "t1", action: "delete", index: 1 }]);
  assert.deepEqual(d.rows, [["a", "b"]]);
});

// --- table integrity (review follow-ups) ---

test("row insert normalizes oversized rowData to the table width (no ragged row)", () => {
  const d = apply([{ op: "table_row_op", id: "t1", action: "insert", index: 1, rowData: ["x", "y", "z", "w"] }]);
  assert.deepEqual(d.rows[1], ["x", "y"]); // truncated to 2 cols
  assert.ok(d.rows.every((r) => r.length === 2));
});

test("row insert pads undersized rowData to the table width", () => {
  const d = apply([{ op: "table_row_op", id: "t1", action: "insert", index: 1, rowData: ["only"] }]);
  assert.deepEqual(d.rows[1], ["only", ""]);
});

test("row insert into an empty table backfills columnWidths to match the new width", () => {
  const emptyTable = () => ({
    id: "c1", title: "T", version: "1.0.0",
    nodes: [{ id: "t1", type: "table", x: 0, y: 0, width: 400, height: 130, content: "", data: { rows: [], columnWidths: [], rowHeights: [] } }],
    connections: [],
  });
  const d = applyCanvasOps({ doc: emptyTable(), operations: [{ op: "table_row_op", id: "t1", action: "insert", index: 0, rowData: ["a", "b", "c"] }], now: 1 }).doc.nodes[0].data;
  assert.deepEqual(d.rows, [["a", "b", "c"]]);
  assert.equal(d.columnWidths.length, 3); // backfilled, not left at 0
});

test("col insert into a zero-row table is rejected (no width without a column)", () => {
  const emptyTable = () => ({
    id: "c1", title: "T", version: "1.0.0",
    nodes: [{ id: "t1", type: "table", x: 0, y: 0, width: 400, height: 130, content: "", data: { rows: [], columnWidths: [], rowHeights: [] } }],
    connections: [],
  });
  assert.throws(
    () => applyCanvasOps({ doc: emptyTable(), operations: [{ op: "table_col_op", id: "t1", action: "insert", index: 0, header: "H" }], now: 1 }),
    /no rows/,
  );
});
