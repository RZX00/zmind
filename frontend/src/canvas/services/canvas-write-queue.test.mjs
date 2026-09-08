import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractServerVersion, parseCanvasWriteErrorBody } from './canvas-write-error.ts';
import {
  CanvasWriteQueue,
  MAX_CONFLICT_RETRIES,
  MAX_SERVER_ERROR_RETRIES,
  fingerprintOps,
  makeApplyIdempotencyKey,
  resetCanvasWriteQueues,
} from './canvas-write-queue.mjs';

class WriteError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'CanvasRepositoryError';
    this.code = code;
    this.details = details;
  }
}

const conflict = (serverVersion) =>
  new WriteError('Version conflict', 'VERSION_CONFLICT', { status: 409, serverVersion });

const serverError = (status, serverVersion) =>
  new WriteError('Internal Server Error', 'OPERATION_FAILED', {
    status,
    serverVersion,
    body: { message: 'apply failed', serverVersion },
  });

test('fingerprint is stable for the same ops', () => {
  const ops = [{ op: 'update_node', id: 'n1', patch: { content: 'hi' } }];
  assert.equal(fingerprintOps(ops), fingerprintOps(ops));
  assert.equal(
    makeApplyIdempotencyKey('c1', ops, 7),
    makeApplyIdempotencyKey('c1', ops, 7),
  );
  assert.notEqual(
    makeApplyIdempotencyKey('c1', ops, 7),
    makeApplyIdempotencyKey('c1', ops, 8),
  );
});

test('parse FastAPI detail and realtime extras for serverVersion', () => {
  assert.equal(
    extractServerVersion({ detail: { message: 'apply failed', serverVersion: 12 } }),
    12,
  );
  assert.equal(
    extractServerVersion({ error: { code: 'apply_failed', message: 'apply failed' }, serverVersion: 9 }),
    9,
  );
  const parsed = parseCanvasWriteErrorBody({
    detail: { error: { message: 'persist failed', code: 'persist_failed' }, serverVersion: 4 },
  });
  assert.equal(parsed.message, 'persist failed');
  assert.equal(parsed.code, 'persist_failed');
  assert.equal(parsed.serverVersion, 4);
});

test('serial apply+update shares one in-flight slot and If-Match increases', async () => {
  resetCanvasWriteQueues();
  const queue = new CanvasWriteQueue();
  const seen = [];
  let current = 10;
  const apply = async (_ops, version) => {
    seen.push({ kind: 'apply', version, inFlight: queue.inFlight });
    assert.equal(queue.inFlight, 1);
    current += 1;
    return { serverVersion: current };
  };
  const update = async (_payload, version) => {
    seen.push({ kind: 'update', version, inFlight: queue.inFlight });
    assert.equal(queue.inFlight, 1);
    current += 1;
    return { canvas: { serverVersion: current } };
  };

  const p1 = queue.enqueueApply({ canvasId: 'c1', ops: [{ op: 'a' }], fallbackVersion: 10, apply });
  const p2 = queue.enqueueApply({ canvasId: 'c1', ops: [{ op: 'b' }], fallbackVersion: 10, apply });
  const p3 = queue.enqueueUpdate({ fallbackVersion: 10, payload: { title: 'x' }, update });
  await Promise.all([p1, p2, p3]);

  assert.deepEqual(
    seen.map((item) => item.version),
    [10, 11, 12],
  );
  assert.equal(queue.ackedVersion, 13);
  assert.equal(queue.inFlight, 0);
});

test('409 rebases from body serverVersion and succeeds', async () => {
  const queue = new CanvasWriteQueue();
  const versions = [];
  const apply = async (_ops, version) => {
    versions.push(version);
    if (version === 3) {
      throw conflict(8);
    }
    if (version === 8) {
      return { serverVersion: 9 };
    }
    throw new Error(`unexpected version ${version}`);
  };
  const result = await queue.enqueueApply({
    canvasId: 'c1',
    ops: [{ op: 'update_node' }],
    fallbackVersion: 3,
    apply,
  });
  assert.deepEqual(versions, [3, 8]);
  assert.equal(result.serverVersion, 9);
});

test('5xx retries once with echoed serverVersion then stops', async () => {
  const queue = new CanvasWriteQueue();
  const versions = [];
  const apply = async (_ops, version) => {
    versions.push(version);
    throw serverError(500, 15);
  };
  await assert.rejects(
    () =>
      queue.enqueueApply({
        canvasId: 'c1',
        ops: [{ op: 'update_node' }],
        fallbackVersion: 14,
        apply,
      }),
    (error) => error instanceof WriteError && error.details?.status === 500,
  );
  assert.equal(versions.length, 1 + MAX_SERVER_ERROR_RETRIES);
  assert.deepEqual(versions, [14, 15]);
});

test('5xx without serverVersion does not retry', async () => {
  const queue = new CanvasWriteQueue();
  let calls = 0;
  const apply = async () => {
    calls += 1;
    throw serverError(500, undefined);
  };
  await assert.rejects(() =>
    queue.enqueueApply({
      canvasId: 'c1',
      ops: [{ op: 'update_node' }],
      fallbackVersion: 1,
      apply,
    }),
  );
  assert.equal(calls, 1);
});

test('409 without serverVersion stops immediately', async () => {
  const queue = new CanvasWriteQueue();
  let calls = 0;
  const apply = async () => {
    calls += 1;
    throw new WriteError('Version conflict', 'VERSION_CONFLICT', { status: 409 });
  };
  await assert.rejects(() =>
    queue.enqueueApply({
      canvasId: 'c1',
      ops: [{ op: 'x' }],
      fallbackVersion: 1,
      apply,
    }),
  );
  assert.equal(calls, 1);
});

test('conflict retries are bounded', async () => {
  const queue = new CanvasWriteQueue();
  let calls = 0;
  const apply = async (_ops, version) => {
    calls += 1;
    throw conflict((version || 0) + 1);
  };
  await assert.rejects(() =>
    queue.enqueueApply({
      canvasId: 'c1',
      ops: [{ op: 'x' }],
      fallbackVersion: 1,
      apply,
    }),
  );
  assert.equal(calls, MAX_CONFLICT_RETRIES);
});
