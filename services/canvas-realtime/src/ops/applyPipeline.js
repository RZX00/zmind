/**
 * 模块：Canvas apply lock + persist-then-commit
 *
 * 职责：
 * - 每张画布一把 Redis 锁，关掉并发 /apply 的 TOCTOU。
 * - persist 成功之后才把 serverVersion 写进 Redis。
 *
 * 边界：
 * - 不负责业务 op 校验，不负责 HTTP 信封。
 *
 * 关键契约：
 * - persist 失败时 Redis 版本不变。
 * - 锁 TTL 默认 8s；释放时核对 token，避免误删别人的锁。
 *
 * 修改注意：
 * - apply 持锁时调用 persistCanvasSnapshot 必须 alreadyLocked，否则死锁。
 *
 * 验证方式：
 * - node --test tests/apply_pipeline.test.mjs
 */

export const CANVAS_APPLY_LOCK_TTL_MS = 8000;
export const CANVAS_APPLY_LOCK_WAIT_MS = 8000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const canvasApplyLockKey = (prefix, canvasId) =>
  `${prefix || "canvas"}:apply-lock:${canvasId}`;

export const assignNextServerVersion = (current, fallback) => {
  const currentNum =
    current === null || current === undefined || current === "" ? Number.NaN : Number(current);
  if (Number.isFinite(currentNum)) return currentNum + 1;
  const fallbackNum =
    fallback === null || fallback === undefined || fallback === "" ? Number.NaN : Number(fallback);
  if (Number.isFinite(fallbackNum)) return fallbackNum + 1;
  return Date.now();
};

export const withCanvasApplyLock = async (
  redis,
  canvasId,
  fn,
  options = {},
) => {
  if (!redis || !canvasId) {
    return fn();
  }
  const ttlMs = options.ttlMs ?? CANVAS_APPLY_LOCK_TTL_MS;
  const waitMs = options.waitMs ?? CANVAS_APPLY_LOCK_WAIT_MS;
  const prefix = options.prefix ?? "canvas";
  const key = canvasApplyLockKey(prefix, canvasId);
  const token = `${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= waitMs) {
    const acquired = await redis.set(key, token, "PX", ttlMs, "NX");
    if (acquired === "OK") {
      try {
        return await fn();
      } finally {
        try {
          const script =
            'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
          await redis.eval(script, 1, key, token);
        } catch {
          // Best-effort unlock. TTL still expires the lock.
        }
      }
    }
    await sleep(options.retryDelayMs ?? 50);
  }

  const error = new Error("canvas apply lock timeout");
  error.code = "lock_timeout";
  throw error;
};

export const persistThenCommitVersion = async ({
  persist,
  commitVersion,
  snapshot,
  nextVersion,
}) => {
  const nextDoc = { ...snapshot, serverVersion: nextVersion };
  const persisted = await persist(nextDoc);
  await commitVersion(nextVersion);
  return persisted ?? nextDoc;
};
