/**
 * 模块：Canvas write error parser
 *
 * 职责：
 * - 从 FastAPI / realtime 错误 JSON 抽出 message、code、serverVersion。
 *
 * 边界：
 * - 不发请求，不改写业务错误码。
 *
 * 关键契约：
 * - FastAPI 用 `detail`，realtime 用 `{error:{message,code}, extras.serverVersion}`。
 *
 * 修改注意：
 * - 5xx 也必须能读到 serverVersion，队列才能 rebase 而不是盲重试。
 *
 * 验证方式：
 * - node --test frontend/src/canvas/services/canvas-write-queue.test.mjs
 */

export type ParsedCanvasWriteError = {
  message?: string;
  code?: string;
  serverVersion?: number;
  body: unknown;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const parseVersion = (raw: unknown): number | undefined => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

export const extractServerVersion = (body: unknown): number | undefined => {
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

export const parseCanvasWriteErrorBody = (body: unknown): ParsedCanvasWriteError => {
  const root = asRecord(body);
  if (!root) {
    return { body, message: typeof body === 'string' ? body : undefined };
  }
  const detailRaw = root.detail;
  const detail = asRecord(detailRaw);
  const nested = detail ?? root;
  const error = asRecord(nested.error) ?? asRecord(root.error);
  const message =
    (typeof nested.message === 'string' && nested.message) ||
    (typeof error?.message === 'string' && error.message) ||
    (typeof root.message === 'string' && root.message) ||
    (typeof detailRaw === 'string' ? detailRaw : undefined);
  const code =
    (typeof nested.code === 'string' && nested.code) ||
    (typeof error?.code === 'string' && error.code) ||
    (typeof root.code === 'string' && root.code) ||
    undefined;
  return {
    message,
    code,
    serverVersion: extractServerVersion(body),
    body,
  };
};
