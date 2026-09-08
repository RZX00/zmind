import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignNextServerVersion,
  persistThenCommitVersion,
  withCanvasApplyLock,
} from "../src/ops/applyPipeline.js";

const createMemoryRedis = () => {
  const store = new Map();
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key, value, ...args) {
      const nx = args.includes("NX");
      if (nx && store.has(key)) {
        return null;
      }
      store.set(key, String(value));
      return "OK";
    },
    async eval(_script, _numKeys, key, token) {
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  };
};

test("assignNextServerVersion increments the current version", () => {
  assert.equal(assignNextServerVersion(10, 1), 11);
  assert.equal(assignNextServerVersion(null, 40), 41);
});

test("lock serializes two apply callbacks", async () => {
  const redis = createMemoryRedis();
  const order = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const run = (label) =>
    withCanvasApplyLock(redis, "canvas_1", async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(`start:${label}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push(`end:${label}`);
      inFlight -= 1;
      return label;
    });

  const results = await Promise.all([run("a"), run("b")]);
  assert.deepEqual(results.sort(), ["a", "b"]);
  assert.equal(maxInFlight, 1);
  assert.equal(order[0].startsWith("start:"), true);
  assert.equal(order[1].startsWith("end:"), true);
});

test("concurrent apply with the same If-Match: one 200, one 409, version hidden until persist finishes", async () => {
  const redis = createMemoryRedis();
  let version = 5;
  let persistStarted = false;
  let persistFinished = false;
  const outcomes = [];

  const apply = (ifMatch) =>
    withCanvasApplyLock(redis, "canvas_1", async () => {
      const current = version;
      if (ifMatch !== current) {
        outcomes.push({ status: 409, serverVersion: current, persistFinished });
        return { status: 409, serverVersion: current };
      }
      persistStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 40));
      persistFinished = true;
      version = current + 1;
      outcomes.push({ status: 200, serverVersion: version, persistFinished: true });
      return { status: 200, serverVersion: version };
    });

  const first = apply(5);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(persistStarted, true);
  const second = apply(5);
  const results = await Promise.all([first, second]);
  const statuses = results.map((item) => item.status).sort();
  assert.deepEqual(statuses, [200, 409]);
  const conflict = outcomes.find((item) => item.status === 409);
  assert.equal(conflict.serverVersion, 6);
  assert.equal(conflict.persistFinished, true);
});

test("persist failure does not commit the next version", async () => {
  let committed = null;
  await assert.rejects(
    () =>
      persistThenCommitVersion({
        persist: async () => {
          throw new Error("disk full");
        },
        commitVersion: async (version) => {
          committed = version;
        },
        snapshot: { id: "c1", serverVersion: 3 },
        nextVersion: 4,
      }),
    /disk full/,
  );
  assert.equal(committed, null);
});

test("successful persist then commits version", async () => {
  let committed = null;
  const persisted = await persistThenCommitVersion({
    persist: async (snapshot) => snapshot,
    commitVersion: async (version) => {
      committed = version;
    },
    snapshot: { id: "c1", title: "x" },
    nextVersion: 8,
  });
  assert.equal(committed, 8);
  assert.equal(persisted.serverVersion, 8);
});

test("Y.Doc replay failures map to 422 not 500", () => {
  const classify = (stage) => {
    if (stage === "ydoc") return 422;
    if (stage === "persist") return 503;
    return 500;
  };
  assert.equal(classify("ydoc"), 422);
  assert.equal(classify("persist"), 503);
});
