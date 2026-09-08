/**
 * 模块：Canvas REST write queue
 *
 * 职责：
 * - 同一 canvasId 上串行 REST 写（apply / update）。
 * - If-Match 只使用上一次 ACK 的 serverVersion。
 *
 * 边界：
 * - 不负责 Yjs。
 * - 不负责把失败 patch 无界塞回 UI 队列。
 *
 * 关键契约：
 * - 409 最多 rebase 3 次。
 * - 5xx 最多再试 1 次，且必须带服务端 serverVersion（若有）。
 * - Idempotency-Key 按 canvasId + baseVersion + ops 指纹稳定，重试复用。
 *
 * 修改注意：
 * - 所有 REST apply/update 必须入队，禁止并行 If-Match。
 *
 * 验证方式：
 * - node --test frontend/src/canvas/services/canvas-write-queue.test.mjs
 */

export const MAX_CONFLICT_RETRIES = 3;
export const MAX_SERVER_ERROR_RETRIES = 1;

const queues = new Map();

const asRecord = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
};

const parseVersion = (raw) => {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

export const extractServerVersion = (body) => {
  const root = asRecord(body);
  if (!root) return undefined;
  const detail = asRecord(root.detail) ?? root;
  const extras = asRecord(detail.extras) ?? asRecord(root.extras);
  const error = asRecord(detail.error) ?? asRecord(root.error);
  return (
    parseVersion(detail.serverVersion) ??
    parseVersion(root.serverVersion) ??
    parseVersion(extras?.serverVersion) ??
    parseVersion(error?.serverVersion) ??
    parseVersion(asRecord(detail.detail)?.serverVersion)
  );
};

export const fingerprintOps = (ops) => {
  const json = JSON.stringify(ops ?? null);
  let hash = 2166136261;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

export const makeApplyIdempotencyKey = (canvasId, ops, baseVersion) => {
  const versionPart = typeof baseVersion === "number" ? String(baseVersion) : "na";
  return `canvas_apply_${canvasId}_${versionPart}_${fingerprintOps(ops)}`;
};

const readAckVersion = (result) => {
  const fromRoot = result?.serverVersion;
  const fromCanvas = result?.canvas?.serverVersion;
  if (typeof fromRoot === "number" && Number.isFinite(fromRoot)) return fromRoot;
  if (typeof fromCanvas === "number" && Number.isFinite(fromCanvas)) return fromCanvas;
  return undefined;
};

const conflictVersion = (error) => {
  const details = error?.details;
  const fromDetails = typeof details?.serverVersion === "number" ? details.serverVersion : undefined;
  return fromDetails ?? extractServerVersion(details?.body) ?? extractServerVersion(details);
};

const errorCode = (error) => (typeof error?.code === "string" ? error.code : undefined);

const errorStatus = (error) => {
  const status = error?.details?.status;
  return typeof status === "number" ? status : undefined;
};

const isConflict = (error) => errorCode(error) === "VERSION_CONFLICT";

const isRetryableServerError = (error) => {
  const code = errorCode(error);
  if (code === "NETWORK_ERROR") return true;
  const status = errorStatus(error);
  return code === "OPERATION_FAILED" && typeof status === "number" && status >= 500;
};

export class CanvasWriteQueue {
  constructor() {
    this.chain = Promise.resolve();
    this.lastAckedVersion = undefined;
    this.active = 0;
    this.running = 0;
  }

  get inFlight() {
    return this.running;
  }

  get ackedVersion() {
    return this.lastAckedVersion;
  }

  acknowledge(version) {
    if (typeof version === "number" && Number.isFinite(version)) {
      this.lastAckedVersion = version;
    }
  }

  idle() {
    return this.chain;
  }

  enqueueApply(args) {
    return this.enqueue(() => this.runApply(args));
  }

  enqueueUpdate(args) {
    return this.enqueue(() => this.runUpdate(args));
  }

  enqueue(fn) {
    let release = () => {};
    const nextSlot = new Promise((resolve) => {
      release = resolve;
    });
    const previous = this.chain;
    this.chain = previous.then(() => nextSlot);
    this.active += 1;
    const run = previous.then(
      () => this.runGuarded(fn),
      () => this.runGuarded(fn),
    );
    void run.finally(() => {
      this.active = Math.max(0, this.active - 1);
      release();
    }).catch(() => {});
    return run;
  }

  async runGuarded(fn) {
    this.running += 1;
    try {
      return await fn();
    } finally {
      this.running = Math.max(0, this.running - 1);
    }
  }

  resolveVersion(fallback) {
    if (typeof this.lastAckedVersion === "number") return this.lastAckedVersion;
    if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
    return undefined;
  }

  async runApply(args) {
    let version = this.resolveVersion(args.fallbackVersion);
    const idempotencyKey = makeApplyIdempotencyKey(args.canvasId, args.ops, version);
    let serverErrors = 0;
    for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES + MAX_SERVER_ERROR_RETRIES + 1; attempt += 1) {
      try {
        const result = await args.apply(args.ops, version, idempotencyKey);
        this.acknowledge(readAckVersion(result) ?? version);
        return result;
      } catch (error) {
        const echoed = conflictVersion(error);
        if (isConflict(error)) {
          if (typeof echoed !== "number") throw error;
          this.acknowledge(echoed);
          if (attempt >= MAX_CONFLICT_RETRIES - 1) throw error;
          version = echoed;
          continue;
        }
        if (isRetryableServerError(error) && serverErrors < MAX_SERVER_ERROR_RETRIES) {
          const canRetryServer = errorCode(error) === "NETWORK_ERROR" || typeof echoed === "number";
          if (!canRetryServer) throw error;
          serverErrors += 1;
          if (typeof echoed === "number") {
            this.acknowledge(echoed);
            version = echoed;
          }
          continue;
        }
        throw error;
      }
    }
    throw Object.assign(new Error("canvas write queue exhausted"), {
      name: "CanvasRepositoryError",
      code: "OPERATION_FAILED",
    });
  }

  async runUpdate(args) {
    let version = this.resolveVersion(args.fallbackVersion);
    let serverErrors = 0;
    for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES + MAX_SERVER_ERROR_RETRIES + 1; attempt += 1) {
      try {
        const result = await args.update(args.payload, version);
        this.acknowledge(readAckVersion(result) ?? version);
        return result;
      } catch (error) {
        const echoed = conflictVersion(error);
        if (isConflict(error)) {
          if (typeof echoed !== "number") throw error;
          this.acknowledge(echoed);
          if (attempt >= MAX_CONFLICT_RETRIES - 1) throw error;
          version = echoed;
          continue;
        }
        if (isRetryableServerError(error) && serverErrors < MAX_SERVER_ERROR_RETRIES) {
          const canRetryServer = errorCode(error) === "NETWORK_ERROR" || typeof echoed === "number";
          if (!canRetryServer) throw error;
          serverErrors += 1;
          if (typeof echoed === "number") {
            this.acknowledge(echoed);
            version = echoed;
          }
          continue;
        }
        throw error;
      }
    }
    throw Object.assign(new Error("canvas write queue exhausted"), {
      name: "CanvasRepositoryError",
      code: "OPERATION_FAILED",
    });
  }
}

export const getCanvasWriteQueue = (canvasId) => {
  const key = String(canvasId || "");
  let queue = queues.get(key);
  if (!queue) {
    queue = new CanvasWriteQueue();
    queues.set(key, queue);
  }
  return queue;
};

export const resetCanvasWriteQueues = () => {
  queues.clear();
};
