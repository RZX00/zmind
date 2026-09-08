// Offline unit tests for provenance auto-stamping (WS5-5). node:test, no deps.
// Run: node --test tests/provenance.test.mjs   (from services/canvas-realtime)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCanvasOps } from "../src/ops/applyCanvasOps.js";

const emptyDoc = () => ({ id: "c1", title: "T", version: "1.0.0", nodes: [], connections: [] });
const textNode = (id) => ({ id, type: "text", x: 0, y: 0, width: 100, height: 50, content: "hi" });

test("add_node stamps createdBy + derives ai for an agent actor", () => {
  const res = applyCanvasOps({
    doc: emptyDoc(),
    operations: [{ op: "add_node", node: textNode("n1") }],
    now: 1,
    actor: { actor: "agent", model: "opus" },
  });
  const n = res.doc.nodes.find((x) => x.id === "n1");
  assert.equal(n.provenance.createdBy.actor, "agent");
  assert.equal(n.provenance.createdBy.model, "opus");
  assert.equal(n.provenance.updatedBy.actor, "agent");
  assert.equal(n.ai, true);
});

test("a human update stamps updatedBy and leaves createdBy intact", () => {
  let res = applyCanvasOps({ doc: emptyDoc(), operations: [{ op: "add_node", node: textNode("n1") }], now: 1, actor: { actor: "agent" } });
  res = applyCanvasOps({ doc: res.doc, operations: [{ op: "update_node", id: "n1", patch: { content: "edited" } }], now: 2, actor: { actor: "human", id: "u42" } });
  const n = res.doc.nodes.find((x) => x.id === "n1");
  assert.equal(n.provenance.createdBy.actor, "agent");
  assert.equal(n.provenance.updatedBy.actor, "human");
  assert.equal(n.provenance.updatedBy.id, "u42");
});

test("no actor -> no provenance stamped (back-compat)", () => {
  const res = applyCanvasOps({ doc: emptyDoc(), operations: [{ op: "add_node", node: textNode("n1") }], now: 1 });
  const n = res.doc.nodes.find((x) => x.id === "n1");
  assert.equal(n.provenance, undefined);
  assert.equal(n.ai, undefined);
});

test("connection createdBy is stamped from the actor", () => {
  const doc = {
    id: "c1",
    title: "T",
    version: "1.0.0",
    nodes: [textNode("a"), { ...textNode("b"), x: 200 }],
    connections: [],
  };
  const res = applyCanvasOps({ doc, operations: [{ op: "add_connection", from: "a", to: "b" }], now: 1, actor: { actor: "agent" } });
  assert.equal(res.doc.connections[0].provenance.createdBy.actor, "agent");
});

// --- update vs create attribution (review follow-up) ---

test("an update-only op (move_node) stamps updatedBy but never forges createdBy or ai", () => {
  const doc = { id: "c1", title: "T", version: "1.0.0", nodes: [textNode("a")], connections: [] };
  const res = applyCanvasOps({ doc, operations: [{ op: "move_node", id: "a", x: 50, y: 60 }], now: 2, actor: { actor: "agent", model: "opus" } });
  const n = res.doc.nodes.find((x) => x.id === "a");
  assert.equal(n.provenance.updatedBy.actor, "agent");
  assert.equal(n.provenance.createdBy, undefined); // not a creating op -> no createdBy
  assert.equal(n.ai, undefined); // ai is derived only for create ops
});

test("apply_style on a pre-existing node attributes updatedBy only", () => {
  const doc = { id: "c1", title: "T", version: "1.0.0", nodes: [textNode("a")], connections: [] };
  const res = applyCanvasOps({ doc, operations: [{ op: "apply_style", id: "a", patch: { accentColor: "#f00" } }], now: 2, actor: { actor: "human", id: "u9" } });
  const n = res.doc.nodes.find((x) => x.id === "a");
  assert.equal(n.provenance.updatedBy.actor, "human");
  assert.equal(n.provenance.updatedBy.id, "u9");
  assert.equal(n.provenance.createdBy, undefined);
});
