// End-to-end Yjs persistence test for typed-edge slots (WS5-1) through canvasDoc.js.
// Uses the installed `yjs` package. Run: node --test tests/canvasdoc_edge_slots.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createYDocFromCanvas, applyOpsToYDoc, exportCanvasFromDocument } from "../src/ydoc/canvasDoc.js";

const baseCanvas = () => ({
  id: "c1",
  title: "T",
  version: "1.0.0",
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 100, height: 50, content: "a" },
    { id: "b", type: "text", x: 200, y: 0, width: 100, height: 50, content: "b" },
  ],
  connections: [],
});

test("add_connection persists relation/directed/relationData through the Y.Doc", () => {
  const doc = createYDocFromCanvas(baseCanvas());
  applyOpsToYDoc(
    doc,
    [{ op: "add_connection", id: "conn-1", from: "a", to: "b", relation: "reference", directed: true, relationData: { weight: 3 } }],
    1,
  );
  const c = exportCanvasFromDocument(doc).connections.find((x) => x.id === "conn-1");
  assert.equal(c.relation, "reference");
  assert.equal(c.directed, true);
  assert.deepEqual(c.relationData, { weight: 3 });
});

test("add_connection without slots persists none (back-compat)", () => {
  const doc = createYDocFromCanvas(baseCanvas());
  applyOpsToYDoc(doc, [{ op: "add_connection", id: "conn-2", from: "a", to: "b" }], 1);
  const c = exportCanvasFromDocument(doc).connections.find((x) => x.id === "conn-2");
  assert.equal(c.relation, undefined);
  assert.equal(c.directed, undefined);
  assert.equal(c.relationData, undefined);
});

test("provenance on the op persists through the Y.Doc", () => {
  const doc = createYDocFromCanvas(baseCanvas());
  applyOpsToYDoc(doc, [{ op: "add_connection", id: "conn-p", from: "a", to: "b", provenance: { createdBy: { actor: "agent" } } }], 1);
  const c = exportCanvasFromDocument(doc).connections.find((x) => x.id === "conn-p");
  assert.equal(c.provenance.createdBy.actor, "agent");
});

test("update_connection patch carries the relation slot (unrestricted patch path)", () => {
  const doc = createYDocFromCanvas(baseCanvas());
  applyOpsToYDoc(doc, [{ op: "add_connection", id: "conn-3", from: "a", to: "b" }], 1);
  applyOpsToYDoc(doc, [{ op: "update_connection", id: "conn-3", patch: { relation: "supports", directed: false } }], 2);
  const c = exportCanvasFromDocument(doc).connections.find((x) => x.id === "conn-3");
  assert.equal(c.relation, "supports");
  assert.equal(c.directed, false);
});
