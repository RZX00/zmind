import type { Canvas } from '../types/canvas';

export interface CanvasCacheEntry {
  canvas: Canvas;
  version: string;
  updatedAt: number;
  lastVerifiedAt: number;
}

type Listener = () => void;

const SNAPSHOT_PREFIX = 'canvas_snapshot:';
const cache = new Map<string, CanvasCacheEntry>();
const listeners = new Map<string, Set<Listener>>();

const now = () => Date.now();

function persistSnapshot(id: string, canvas: Canvas) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${SNAPSHOT_PREFIX}${id}`, JSON.stringify(canvas));
  } catch {
    // ignore quota errors
  }
}

function readSnapshot(id: string): Canvas | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${SNAPSHOT_PREFIX}${id}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function notify(id: string) {
  const subs = listeners.get(id);
  if (!subs) return;
  subs.forEach((cb) => {
    try { cb(); } catch { /* ignore */ }
  });
}

export const canvasCache = {
  get(id: string): CanvasCacheEntry | null {
    return cache.get(id) || null;
  },

  set(id: string, entry: CanvasCacheEntry, options?: { persist?: boolean }) {
    cache.set(id, entry);
    if (options?.persist !== false) {
      persistSnapshot(id, entry.canvas);
    }
    notify(id);
  },

  remove(id: string) {
    cache.delete(id);
    notify(id);
  },

  subscribe(id: string, listener: Listener) {
    if (!listeners.has(id)) listeners.set(id, new Set());
    listeners.get(id)!.add(listener);
    return () => {
      const set = listeners.get(id);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) listeners.delete(id);
    };
  },

  hydrateFromSnapshot(id: string): CanvasCacheEntry | null {
    const existing = cache.get(id);
    if (existing) return existing;
    const snap = readSnapshot(id);
    if (!snap) return null;
    const entry: CanvasCacheEntry = {
      canvas: snap,
      version: String((snap as any).version || '1.0.0'),
      updatedAt: (snap as any).updatedAt || now(),
      lastVerifiedAt: now(),
    };
    cache.set(id, entry);
    return entry;
  },
};

export default canvasCache;
