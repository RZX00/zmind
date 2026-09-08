// Canvas View State persistence (localStorage-based)
// Stores per-canvas camera transform and optional viewport for better UX
// Schema v1 — safe to evolve later (e.g., cloud/per-user storage)

export interface CanvasViewportSize {
  width: number;
  height: number;
}

export interface CanvasViewState {
  scale: number;
  // pixel offsets are optional in v2 (we store center instead);
  // kept for backward compatibility and transitional writes
  positionX?: number;
  positionY?: number;
  // world-space center point (schema v2)
  centerX?: number;
  centerY?: number;
  viewport?: CanvasViewportSize;
}

export interface SavedCanvasViewState extends CanvasViewState {
  schema: number; // 1 or 2
  updatedAt: number; // epoch ms
  contentHash?: string; // optional geometry signature (e.g., positionSizeHash)
  canvasUpdatedAt?: number; // canvas.updatedAt at save time
}

const STORAGE_PREFIX = 'canvas:view:';

function getStorageKey(canvasId: string): string {
  return `${STORAGE_PREFIX}${canvasId}`;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isValidViewport(v: any): v is CanvasViewportSize {
  return v && isFiniteNumber(v.width) && isFiniteNumber(v.height) && v.width >= 0 && v.height >= 0;
}

function isValidSaved(obj: any): obj is SavedCanvasViewState {
  return (
    obj &&
    (obj.schema === 1 || obj.schema === 2) &&
    isFiniteNumber(obj.updatedAt) &&
    isFiniteNumber(obj.scale) && obj.scale > 0 &&
    // either we have position (v1) or center (v2)
    ((isFiniteNumber(obj.positionX) && isFiniteNumber(obj.positionY)) ||
      (isFiniteNumber(obj.centerX) && isFiniteNumber(obj.centerY))) &&
    (obj.viewport === undefined || isValidViewport(obj.viewport))
  );
}

export function clampScale(scale: number, minScale = 0.1, maxScale = 3): number {
  if (!isFiniteNumber(scale) || scale <= 0) return minScale;
  if (scale < minScale) return minScale;
  if (scale > maxScale) return maxScale;
  return scale;
}

export function loadView(canvasId: string): SavedCanvasViewState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(getStorageKey(canvasId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidSaved(parsed)) return null;
    return parsed as SavedCanvasViewState;
  } catch {
    return null;
  }
}

export function saveView(
  canvasId: string,
  state: CanvasViewState,
  meta?: { contentHash?: string; canvasUpdatedAt?: number }
): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: SavedCanvasViewState = {
      schema: 2,
      updatedAt: Date.now(),
      scale: state.scale,
      positionX: state.positionX, // optional: written for backward compatibility
      positionY: state.positionY,
      centerX: state.centerX,
      centerY: state.centerY,
      viewport: state.viewport,
      contentHash: meta?.contentHash,
      canvasUpdatedAt: meta?.canvasUpdatedAt,
    };
    localStorage.setItem(getStorageKey(canvasId), JSON.stringify(payload));
  } catch {
    // ignore persistence errors
  }
}

export function clearView(canvasId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(getStorageKey(canvasId));
  } catch {
    // ignore
  }
}

/**
 * Basic applicability check for a saved view state.
 * - If content hash matches, accept.
 * - Else accept if within TTL window (defaults to 7 days).
 */
export function isApplicable(
  saved: SavedCanvasViewState,
  current: { contentHash?: string; canvasUpdatedAt?: number },
  opts: { maxAgeMs?: number; requireSameHash?: boolean } = {}
): boolean {
  const hasHash = typeof saved.contentHash === 'string' && saved.contentHash.length > 0;
  const sameHash = hasHash && current.contentHash && saved.contentHash === current.contentHash;
  if (opts.requireSameHash !== false) {
    // 默认严格匹配当前画布几何签名，避免恢复到无关位置
    return Boolean(sameHash);
  }
  // 宽松模式（不默认启用）：允许在 TTL 内恢复
  const now = Date.now();
  const maxAgeMs = isFiniteNumber(opts.maxAgeMs) ? opts.maxAgeMs : 24 * 60 * 60 * 1000; // 24h
  const withinTtl = now - saved.updatedAt <= maxAgeMs;
  return Boolean(sameHash || withinTtl);
}

// ===== Conversion helpers =====
export function computeCenterFromPosition(
  positionX: number,
  positionY: number,
  scale: number,
  viewport: { width: number; height: number }
): { centerX: number; centerY: number } {
  const centerX = (viewport.width / 2 - positionX) / scale;
  const centerY = (viewport.height / 2 - positionY) / scale;
  return { centerX, centerY };
}

export function computePositionFromCenter(
  centerX: number,
  centerY: number,
  scale: number,
  viewport: { width: number; height: number }
): { positionX: number; positionY: number } {
  const positionX = viewport.width / 2 - centerX * scale;
  const positionY = viewport.height / 2 - centerY * scale;
  return { positionX, positionY };
}

export const canvasViewStateService = {
  loadView,
  saveView,
  clearView,
  clampScale,
  isApplicable,
  computeCenterFromPosition,
  computePositionFromCenter,
};

export default canvasViewStateService;
