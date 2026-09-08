// Containment cycles are HEALED deterministically by the shared reconcile (not
// rejected), so the snapshot and the live Y.Doc converge — the live path can't reject.
// node:test. Run: node --test tests/containment_cycle.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCanvasOps } from "../src/ops/applyCanvasOps.js";
import { createYDocFromCanvas, applyOpsToYDoc, exportCanvasFromDocument } from "../src/ydoc/canvasDoc.js";

const grp = (id, extra = {}) => ({ id, type: "group", x: 0, y: 0, width: 100, height: 100, content: id, children: [], ...extra });
const docOf = (nodes) => ({ id: "c1", title: "T", version: "1.0.0", nodes, connections: [] });
const touch = (id) => [{ op: "update_node", id, patch: { content: `${id}!` } }];
const find = (res, id) => res.doc.nodes.find((n) => n.id === id);

test("self-parent is cleared by the reconcile", () => {
  const res = applyCanvasOps({ doc: docOf([grp("g", { parentGroupId: "g" })]), operations: touch("g"), now: 1 });
  assert.equal(find(res, "g").parentGroupId, undefined);
});

test("a 2-node cycle (A<->B) is healed by severing the min-id back-pointer", () => {
  const res = applyCanvasOps({ doc: docOf([grp("A", { parentGroupId: "B" }), grp("B", { parentGroupId: "A" })]), operations: touch("A"), now: 1 });
  // min id "A" is severed -> A becomes a root, B still points at A (acyclic).
  assert.equal(find(res, "A").parentGroupId, undefined);
  assert.equal(find(res, "B").parentGroupId, "A");
});

test("a 3-node cycle (A->B->C->A) is healed (acyclic, min-id severed)", () => {
  const res = applyCanvasOps({
    doc: docOf([grp("A", { parentGroupId: "B" }), grp("B", { parentGroupId: "C" }), grp("C", { parentGroupId: "A" })]),
    operations: touch("A"),
    now: 1,
  });
  assert.equal(find(res, "A").parentGroupId, undefined); // min id severed
  const byId = Object.fromEntries(res.doc.nodes.map((n) => [n.id, n]));
  for (const start of res.doc.nodes) {
    const seen = new Set();
    let cur = start;
    while (cur && cur.parentGroupId != null) {
      assert.ok(!seen.has(cur.id), "no cycle remains");
      seen.add(cur.id);
      cur = byId[cur.parentGroupId];
    }
  }
});

test("a linear chain (A->B->C) is left intact", () => {
  const res = applyCanvasOps({
    doc: docOf([grp("A", { parentGroupId: "B" }), grp("B", { parentGroupId: "C" }), grp("C")]),
    operations: touch("A"),
    now: 1,
  });
  assert.equal(find(res, "A").parentGroupId, "B");
  assert.equal(find(res, "B").parentGroupId, "C");
});

test("snapshot and live Y.Doc heal a cycle to the SAME acyclic graph (parity)", () => {
  const canvas = docOf([grp("g1", { parentGroupId: "g2" }), grp("g2", { parentGroupId: "g1" })]);
  const snap = applyCanvasOps({ doc: structuredClone(canvas), operations: touch("g1"), now: 1 });
  const doc = createYDocFromCanvas(structuredClone(canvas));
  applyOpsToYDoc(doc, touch("g1"), 1);
  const norm = (nodes) =>
    nodes.map((n) => ({ id: n.id, parentGroupId: n.parentGroupId ?? null, children: n.children ?? null })).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(norm(exportCanvasFromDocument(doc).nodes), norm(snap.doc.nodes));
});
