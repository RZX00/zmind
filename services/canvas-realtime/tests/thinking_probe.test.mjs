// §7 thin thinking probe — the SUBSTRATE half, offline (WS6 gate).
// The probe reads structure, finds an isolated node, and attaches a "question" node
// via a typed edge using ONLY the universal vocabulary: `relation` is an open string
// the substrate stores but never enum-validates (epistemic meaning lives in the layer
// above). This proves the substrate is ready for the thinking layer without baking any
// epistemic vocabulary into it. node:test, no deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCanvasOps } from "../src/ops/applyCanvasOps.js";

const canvas = () => ({
  id: "c1",
  title: "T",
  version: "1.0.0",
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 100, height: 50, content: "claim A" },
    { id: "b", type: "text", x: 200, y: 0, width: 100, height: 50, content: "claim B" },
    { id: "lonely", type: "text", x: 400, y: 200, width: 100, height: 50, content: "orphan idea" },
  ],
  connections: [{ id: "e1", from: "a", to: "b", relation: "supports" }],
});

const isolatedIds = (doc) => {
  const touched = new Set();
  for (const c of doc.connections) {
    if (c.from) touched.add(c.from);
    if (c.to) touched.add(c.to);
  }
  return doc.nodes.filter((n) => !touched.has(n.id)).map((n) => n.id);
};

test("probe step 1: structure read surfaces the isolated node", () => {
  assert.deepEqual(isolatedIds(canvas()), ["lonely"]);
});

test("probe step 2: attach a question node via an open-vocabulary typed edge", () => {
  const c = canvas();
  const target = isolatedIds(c)[0];
  const res = applyCanvasOps({
    doc: c,
    operations: [
      { op: "add_node", node: { id: "q1", type: "text", x: 400, y: 100, width: 120, height: 60, content: "What evidence supports this?" } },
      { op: "add_connection", from: "q1", to: target, relation: "question", directed: true },
    ],
    now: 1,
    actor: { actor: "agent", model: "opus" },
  });

  const edge = res.doc.connections.find((e) => e.from === "q1" && e.to === target);
  assert.ok(edge, "question edge created");
  assert.equal(edge.relation, "question"); // open vocabulary, stored unvalidated
  assert.equal(edge.directed, true);
  assert.deepEqual(isolatedIds(res.doc), []); // nothing isolated anymore

  // provenance: the probe ran as an agent, so the new node is attributed + ai-flagged.
  const q = res.doc.nodes.find((n) => n.id === "q1");
  assert.equal(q.ai, true);
  assert.equal(q.provenance.createdBy.actor, "agent");
  assert.equal(q.provenance.createdBy.model, "opus");
});

test("probe stays substrate-pure: an unconventional relation value is still accepted", () => {
  const c = canvas();
  const res = applyCanvasOps({
    doc: c,
    operations: [{ op: "add_connection", from: "lonely", to: "a", relation: "provokes-reconsideration-of" }],
    now: 1,
  });
  const edge = res.doc.connections.find((e) => e.from === "lonely" && e.to === "a");
  assert.equal(edge.relation, "provokes-reconsideration-of"); // no enum gate in the substrate
});
