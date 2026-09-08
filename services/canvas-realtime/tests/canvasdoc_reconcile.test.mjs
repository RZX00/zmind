// The live Y.Doc executor must run the SAME containment reconcile as the snapshot
// executor (WS5-3 parity). node:test, real Y.Doc via the installed yjs.
// Run: node --test tests/canvasdoc_reconcile.test.mjs   (from services/canvas-realtime)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createYDocFromCanvas, applyOpsToYDoc, exportCanvasFromDocument } from "../src/ydoc/canvasDoc.js";
import { applyCanvasOps } from "../src/ops/applyCanvasOps.js";

const grp = (id, children = []) => ({ id, type: "group", x: 0, y: 0, width: 100, height: 100, content: id, children });
const leaf = (id, extra = {}) => ({ id, type: "text", x: 10, y: 10, width: 50, height: 30, content: id, ...extra });
const docOf = (nodes) => ({ id: "c1", title: "T", version: "1.0.0", nodes, connections: [] });
const touch = (id) => [{ op: "update_node", id, patch: { content: `${id}!` } }];
const exp = (doc) => exportCanvasFromDocument(doc);
const yNode = (doc, id) => exp(doc).nodes.find((n) => n.id === id);

test("live Y.Doc back-fills children[] from a parentGroupId back-reference", () => {
  const doc = createYDocFromCanvas(docOf([grp("g", []), leaf("a", { parentGroupId: "g" })]));
  applyOpsToYDoc(doc, touch("a"), 1);
  assert.deepEqual(yNode(doc, "g").children, ["a"]);
});

test("live Y.Doc drops a dangling child id", () => {
  const doc = createYDocFromCanvas(docOf([grp("g", ["a", "ghost"]), leaf("a", { parentGroupId: "g" })]));
  applyOpsToYDoc(doc, touch("a"), 1);
  assert.deepEqual(yNode(doc, "g").children, ["a"]);
});

test("live Y.Doc clears a truly-dangling back-pointer", () => {
  const doc = createYDocFromCanvas(docOf([leaf("a", { parentGroupId: "gone" })]));
  applyOpsToYDoc(doc, touch("a"), 1);
  assert.equal(yNode(doc, "a").parentGroupId, undefined);
});

test("snapshot and live Y.Doc agree on containment after the same op", () => {
  const canvas = docOf([grp("g", ["a", "ghost"]), leaf("a"), leaf("b", { parentGroupId: "g" })]);
  const snap = applyCanvasOps({ doc: structuredClone(canvas), operations: touch("a"), now: 1 });
  const doc = createYDocFromCanvas(canvas);
  applyOpsToYDoc(doc, touch("a"), 1);
  const norm = (nodes) =>
    nodes
      .map((n) => ({ id: n.id, children: n.children ?? null, parentGroupId: n.parentGroupId ?? null }))
      .sort((x, y) => x.id.localeCompare(y.id));
  assert.deepEqual(norm(exp(doc).nodes), norm(snap.doc.nodes));
});
