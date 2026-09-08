// Offline tests for the CanvasWriteError envelope (WS4). node:test, no deps.
// Run: node --test tests/errors.test.mjs   (from services/canvas-realtime)
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCanvasError, makeCanvasError, CANVAS_ERROR_CODES } from "../src/ops/errors.js";

test("missing connection endpoint -> CONNECTION_ENDPOINT_MISSING, non-retryable", () => {
  const e = normalizeCanvasError(new Error("add_connection: 'from' must reference an existing node."));
  assert.equal(e.code, "CONNECTION_ENDPOINT_MISSING");
  assert.equal(e.retryable, false);
  assert.equal(e.self_heal, undefined);
});

test("ambiguous endpoint -> CONNECTION_ENDPOINT_INVALID", () => {
  const e = normalizeCanvasError(new Error("update_connection: choose either 'from' (node id) or 'fromPoint', not both"));
  assert.equal(e.code, "CONNECTION_ENDPOINT_INVALID");
});

test("missing node (non-connection) -> NODE_NOT_FOUND", () => {
  const e = normalizeCanvasError(new Error("group_nodes: node not found: x1"));
  assert.equal(e.code, "NODE_NOT_FOUND");
});

test("duplicate id -> VALIDATION", () => {
  const e = normalizeCanvasError(new Error("add_connection: duplicate id 'c1'"));
  assert.equal(e.code, "VALIDATION");
});

test("op_index threads through", () => {
  const e = normalizeCanvasError(new Error("Validation failed: bad"), { opIndex: 3 });
  assert.equal(e.code, "VALIDATION");
  assert.equal(e.op_index, 3);
});

test("an already-built envelope passes through unchanged", () => {
  const env = { code: "STALE_RELOAD", retryable: true, message: "stale", self_heal: { action: "reload_canvas" } };
  assert.equal(normalizeCanvasError(env), env);
});

test("makeCanvasError attaches the default self-heal recipe", () => {
  const e = makeCanvasError("STALE_RELOAD", "doc moved on");
  assert.equal(e.code, "STALE_RELOAD");
  assert.equal(e.retryable, true);
  assert.deepEqual(e.self_heal, { action: "reload_canvas" });
});

test("makeCanvasError rejects an unknown code", () => {
  assert.throws(() => makeCanvasError("NOPE", "x"), /unknown canvas error code/);
});

test("every required field is present and code is in the enum", () => {
  const e = normalizeCanvasError("plain string failure");
  assert.ok(typeof e.message === "string" && e.message.length > 0);
  assert.ok(typeof e.retryable === "boolean");
  assert.ok(CANVAS_ERROR_CODES.includes(e.code));
});

// --- classifier branch coverage (review follow-ups) ---

test("a 'locked' message classifies as NODE_LOCKED", () => {
  assert.equal(normalizeCanvasError(new Error("node n1 is locked")).code, "NODE_LOCKED");
});

test("the real empty-batch message classifies as EMPTY_BATCH", () => {
  assert.equal(normalizeCanvasError(new Error("operations must be a non-empty array")).code, "EMPTY_BATCH");
});

test("a 'too large' message classifies as BATCH_TOO_LARGE", () => {
  assert.equal(normalizeCanvasError(new Error("batch too large: 600 ops exceeds the limit of 500")).code, "BATCH_TOO_LARGE");
});

test("opts.field passes through onto the envelope", () => {
  assert.equal(normalizeCanvasError(new Error("bad"), { field: "width" }).field, "width");
});

test("a non-connection 'not found' is NODE_NOT_FOUND, not a connection code", () => {
  assert.equal(normalizeCanvasError(new Error("group_nodes: node not found: x")).code, "NODE_NOT_FOUND");
});
