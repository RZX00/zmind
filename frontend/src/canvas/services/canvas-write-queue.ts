/**
 * 模块：Canvas REST write queue
 *
 * 职责：
 * - 向 TypeScript 调用方再导出 .mjs 实现。
 *
 * 边界：
 * - 算法以 canvas-write-queue.mjs 为准。
 *
 * 关键契约：
 * - 与 .mjs 的 FIFO / 409 / 5xx 行为一致。
 *
 * 修改注意：
 * - 改重试策略时先改 .mjs，再同步类型。
 *
 * 验证方式：
 * - node --test frontend/src/canvas/services/canvas-write-queue.test.mjs
 */

export {
  CanvasWriteQueue,
  MAX_CONFLICT_RETRIES,
  MAX_SERVER_ERROR_RETRIES,
  extractServerVersion,
  fingerprintOps,
  getCanvasWriteQueue,
  makeApplyIdempotencyKey,
  resetCanvasWriteQueues,
} from './canvas-write-queue.mjs';
