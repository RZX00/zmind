// BATCH_TOO_LARGE cap (WS4). node:test, no deps.
// Run: node --test tests/batch_too_large.test.mjs   (from services/canvas-realtime)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCanvasOps, MAX_OPS } from "../src/ops/applyCanvasOps.js";
import { normalizeCanvasError } from "../src/ops/errors.js";

const emptyDoc = () => ({ id: "c1", title: "T", version: "1.0.0", nodes: [], connections: [] });
const noop = (i) => ({ op: "add_node", node: { id: `n${i}`, type: "text", x: 0, y: 0, width: 10, height: 10, content: "x" } });

test("a batch over MAX_OPS throws a typed BATCH_TOO_LARGE envelope with split_batch self-heal", () => {
  const ops = Array.from({ length: MAX_OPS + 1 }, (_, i) => noop(i));
  let thrown;
  try {
    applyCanvasOps({ doc: emptyDoc(), operations: ops, now: 1 });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, "expected a throw");
  const env = normalizeCanvasError(thrown);
  assert.equal(env.code, "BATCH_TOO_LARGE");
  assert.equal(env.retryable, false);
  assert.equal(env.self_heal.action, "split_batch");
  assert.equal(env.self_heal.params.maxOps, MAX_OPS);
});

test("a batch exactly at MAX_OPS is not rejected by the cap", () => {
  const ops = Array.from({ length: MAX_OPS }, (_, i) => noop(i));
  // Should not throw BATCH_TOO_LARGE (it may do other work, but the cap guard passes).
  const res = applyCanvasOps({ doc: emptyDoc(), operations: ops, now: 1 });
  assert.equal(res.doc.nodes.length, MAX_OPS);
});
