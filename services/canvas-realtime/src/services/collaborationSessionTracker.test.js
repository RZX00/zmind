import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRealtimeSessionId,
  createCollaborationSessionTracker,
} from "./collaborationSessionTracker.js";

const makePayload = (overrides = {}) => ({
  context: {
    canvasId: "canvas-1",
    workspaceId: "workspace-1",
    userId: "user-1",
  },
  documentName: "canvas-1",
  socketId: "socket-1",
  requestParameters: new URLSearchParams(),
  requestHeaders: {},
  ...overrides,
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test("buildRealtimeSessionId includes client session when provided", () => {
  const id = buildRealtimeSessionId({
    canvasId: "canvas-1",
    socketId: "socket-1",
    clientSessionId: "canvas_session_abc",
  });
  assert.equal(id, "rt:canvas-1:canvas_session_abc:socket-1");
});

test("tracker starts and closes once for one socket connection", async () => {
  const starts = [];
  const closes = [];
  const tracker = createCollaborationSessionTracker({
    startSession: async (payload) => {
      starts.push(payload);
    },
    closeSession: async (payload) => {
      closes.push(payload);
    },
    logger: { warn: () => {} },
  });
  const payload = makePayload();

  await tracker.handleConnected(payload);
  await Promise.all([
    tracker.handleDisconnect(payload),
    tracker.handleDisconnect(payload),
  ]);

  assert.equal(starts.length, 1);
  assert.equal(closes.length, 1);
  assert.equal(starts[0].sessionId, "rt:canvas-1:socket-1");
  assert.equal(closes[0].sessionId, starts[0].sessionId);
  assert.equal(tracker.getActiveCount(), 0);
});

test("tracker deduplicates duplicate connected events for same key", async () => {
  let startCount = 0;
  const tracker = createCollaborationSessionTracker({
    startSession: async () => {
      startCount += 1;
    },
    closeSession: async () => {},
    logger: { warn: () => {} },
  });
  const payload = makePayload();

  await Promise.all([
    tracker.handleConnected(payload),
    tracker.handleConnected(payload),
  ]);

  assert.equal(startCount, 1);
});

test("disconnect waits for start completion before close", async () => {
  const order = [];
  const gate = deferred();
  const tracker = createCollaborationSessionTracker({
    startSession: async () => {
      order.push("start-begin");
      await gate.promise;
      order.push("start-end");
    },
    closeSession: async () => {
      order.push("close");
    },
    logger: { warn: () => {} },
  });
  const payload = makePayload({
    requestParameters: new URLSearchParams("clientSessionId=canvas_session_2"),
  });

  const connectPromise = tracker.handleConnected(payload);
  const disconnectPromise = tracker.handleDisconnect(payload);

  await Promise.resolve();
  assert.equal(order.includes("close"), false);

  gate.resolve();
  await connectPromise;
  await disconnectPromise;

  assert.deepEqual(order, ["start-begin", "start-end", "close"]);
});
