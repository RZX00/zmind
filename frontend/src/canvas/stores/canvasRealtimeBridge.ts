/**
 * 模块：Canvas realtime adapter bridge
 *
 * 职责：
 * - 向 store 暴露当前 Yjs adapter，以及 provider 是否已连接（live）。
 *
 * 边界：
 * - 不负责发 REST。
 * - 不在这里写 Y.Doc。
 *
 * 关键契约：
 * - REST 灾备以 isCanvasRealtimeLive() 为准，不以 adapter 是否非空为准。
 *
 * 修改注意：
 * - destroy / 断线 grace 后必须把 live 设为 false，避免一边 REST 一边写残骸 adapter。
 *
 * 验证方式：
 * - node --test frontend/src/canvas/services/canvas-write-queue.test.ts
 */

import type * as Y from 'yjs';

export interface CanvasRealtimeAdapter {
  readonly doc: Y.Doc;
  transact: (fn: (doc: Y.Doc) => void, origin?: unknown) => void;
  notifyLocalEdit?: (timestamp?: number) => void;
}

let currentAdapter: CanvasRealtimeAdapter | null = null;
let realtimeLive = false;

export const setCanvasRealtimeAdapter = (adapter: CanvasRealtimeAdapter | null) => {
  currentAdapter = adapter;
};

export const getCanvasRealtimeAdapter = (): CanvasRealtimeAdapter | null => currentAdapter;

export const setCanvasRealtimeLive = (live: boolean) => {
  realtimeLive = Boolean(live);
};

export const isCanvasRealtimeLive = (): boolean => realtimeLive && currentAdapter != null;

export const withCanvasRealtimeAdapter = (
  fn: (adapter: CanvasRealtimeAdapter) => void,
): boolean => {
  if (!currentAdapter) {
    return false;
  }
  fn(currentAdapter);
  return true;
};
