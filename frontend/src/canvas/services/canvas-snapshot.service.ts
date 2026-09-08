import type { Canvas } from '../types/canvas';
import { canvasCache } from '../cache/canvas-cache';
import { apiClient } from '@/lib/api-client';

const SNAPSHOT_VERIFY_MS = 30_000;
const PREFETCH_CONCURRENCY = 1;
const PREFETCH_COOLDOWN_MS = 45_000;
const PREFETCH_IDLE_TIMEOUT_MS = 1200;
const PREFETCH_FALLBACK_DELAY_MS = 120;

const inFlight = new Map<string, Promise<Canvas | null>>();
const prefetchQueue: Array<{ id: string; allowStaleMs: number }> = [];
const lastPrefetchAt = new Map<string, number>();
let prefetchActive = 0;
let prefetchScheduled = false;

const buildCanvasEtag = (canvasId: string, version?: string, updatedAt?: number) => {
  const ver = version || '1.0.0';
  const ts = String(updatedAt || 0);
  return `W/"canvas:${canvasId}:${ver}:${ts}"`;
};

const normalizeCanvasTimestamps = (canvas: Canvas): Canvas => {
  const now = Date.now();
  const createdAt = typeof canvas.createdAt === 'number' ? canvas.createdAt : now;
  const updatedAt = typeof canvas.updatedAt === 'number' ? canvas.updatedAt : now;
  return { ...canvas, createdAt, updatedAt };
};

const canPrefetchNow = () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return false;
  }
  if (typeof navigator !== 'undefined') {
    const conn = (navigator as any).connection;
    if (conn?.saveData) return false;
    const type = conn?.effectiveType;
    if (type && ['slow-2g', '2g'].includes(type)) return false;
  }
  return true;
};

const schedulePrefetchDrain = () => {
  if (prefetchScheduled) return;
  prefetchScheduled = true;
  const run = () => {
    prefetchScheduled = false;
    drainPrefetchQueue();
  };
  if (typeof (globalThis as any).requestIdleCallback === 'function') {
    (globalThis as any).requestIdleCallback(run, { timeout: PREFETCH_IDLE_TIMEOUT_MS });
  } else {
    setTimeout(run, PREFETCH_FALLBACK_DELAY_MS);
  }
};

const drainPrefetchQueue = () => {
  if (prefetchActive >= PREFETCH_CONCURRENCY) return;
  if (!canPrefetchNow()) {
    prefetchQueue.length = 0;
    return;
  }
  const next = prefetchQueue.shift();
  if (!next) return;
  prefetchActive += 1;
  lastPrefetchAt.set(next.id, Date.now());
  canvasSnapshotService
    .fetch(next.id, { allowStaleMs: next.allowStaleMs, prefetch: true })
    .catch(() => {})
    .finally(() => {
      prefetchActive = Math.max(0, prefetchActive - 1);
      drainPrefetchQueue();
    });
};

export const canvasSnapshotService = {
  async fetch(
    canvasId: string,
    options?: { allowStaleMs?: number; prefetch?: boolean },
  ): Promise<Canvas | null> {
    const allowStaleMs = options?.allowStaleMs ?? SNAPSHOT_VERIFY_MS;
    const cached = canvasCache.get(canvasId) || canvasCache.hydrateFromSnapshot(canvasId);
    if (cached && Date.now() - cached.lastVerifiedAt < allowStaleMs) {
      return cached.canvas;
    }

    const existing = inFlight.get(canvasId);
    if (existing) return existing;

    const run = (async () => {
      const headers: Record<string, string> = {};
      if (cached?.canvas) {
        headers['If-None-Match'] = buildCanvasEtag(canvasId, cached.version, cached.updatedAt);
      }

      const response = await apiClient.request<Canvas>(`/api/canvases/${canvasId}/snapshot`, {
        method: 'GET',
        headers,
        showErrors: false,
        timeout: options?.prefetch ? 8000 : undefined,
      });

      if (response.success && response.status === 304) {
        if (cached?.canvas) {
          canvasCache.set(canvasId, { ...cached, lastVerifiedAt: Date.now() });
          return cached.canvas;
        }
        return null;
      }

      if (!response.success) {
        throw response.error || new Error('Snapshot fetch failed');
      }

      const normalized = normalizeCanvasTimestamps(response.data as Canvas);
      canvasCache.set(canvasId, {
        canvas: normalized,
        version: String((normalized as any).version || '1.0.0'),
        updatedAt: normalized.updatedAt,
        lastVerifiedAt: Date.now(),
      });
      return normalized;
    })();

    inFlight.set(canvasId, run);
    try {
      return await run;
    } finally {
      inFlight.delete(canvasId);
    }
  },

  async prefetch(canvasId: string, options?: { allowStaleMs?: number }) {
    if (!canvasId) return;
    const allowStaleMs = options?.allowStaleMs ?? SNAPSHOT_VERIFY_MS;
    if (!canPrefetchNow()) return;

    const cached = canvasCache.get(canvasId) || canvasCache.hydrateFromSnapshot(canvasId);
    if (cached && Date.now() - cached.lastVerifiedAt < allowStaleMs) {
      return;
    }

    const lastAttempt = lastPrefetchAt.get(canvasId) || 0;
    if (Date.now() - lastAttempt < PREFETCH_COOLDOWN_MS) {
      return;
    }

    if (inFlight.has(canvasId)) return;
    if (prefetchQueue.some((item) => item.id === canvasId)) return;

    prefetchQueue.push({ id: canvasId, allowStaleMs });
    schedulePrefetchDrain();
  },
};

export default canvasSnapshotService;
