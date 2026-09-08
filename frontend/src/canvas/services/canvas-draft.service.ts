import type { Canvas } from '../types/canvas';

export type CanvasDraftReason =
  | 'edit'
  | 'drag'
  | 'save_error'
  | 'before_unload'
  | 'manual';

export interface CanvasDraftEntry {
  canvasId: string;
  savedAt: number;
  serverVersion?: number;
  reason?: string;
  doc: Canvas;
}

const DRAFT_PREFIX = 'canvas_draft:';
const MAX_DRAFT_AGE_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

const now = () => Date.now();

const getKey = (canvasId: string) => `${DRAFT_PREFIX}${canvasId}`;

const readRaw = (canvasId: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(getKey(canvasId));
  } catch {
    return null;
  }
};

const writeRaw = (canvasId: string, payload: string) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getKey(canvasId), payload);
  } catch {
    // ignore quota / access errors
  }
};

const removeRaw = (canvasId: string) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(getKey(canvasId));
  } catch {
    // ignore
  }
};

const isStale = (entry: CanvasDraftEntry) => {
  if (!entry?.savedAt) return false;
  return now() - entry.savedAt > MAX_DRAFT_AGE_MS;
};

export const canvasDraftService = {
  readDraft(canvasId: string): CanvasDraftEntry | null {
    if (!canvasId) return null;
    const raw = readRaw(canvasId);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as CanvasDraftEntry;
      if (!parsed || !parsed.doc) return null;
      if (!parsed.canvasId) parsed.canvasId = canvasId;
      if (isStale(parsed)) {
        removeRaw(canvasId);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  },

  writeDraft(canvas: Canvas, options?: { reason?: CanvasDraftReason | string; savedAt?: number }): CanvasDraftEntry | null {
    if (!canvas || !canvas.id) return null;
    const entry: CanvasDraftEntry = {
      canvasId: canvas.id,
      savedAt: options?.savedAt ?? now(),
      serverVersion: typeof canvas.serverVersion === 'number' ? canvas.serverVersion : undefined,
      reason: options?.reason,
      doc: canvas,
    };
    try {
      writeRaw(canvas.id, JSON.stringify(entry));
      return entry;
    } catch {
      return null;
    }
  },

  clearDraft(canvasId: string) {
    if (!canvasId) return;
    removeRaw(canvasId);
  },

  isDraftNewer(draft: CanvasDraftEntry, canvas: Canvas): boolean {
    if (!draft || !canvas) return false;
    const draftVersion = typeof draft.serverVersion === 'number' ? draft.serverVersion : (draft.doc as any)?.serverVersion;
    const canvasVersion = (canvas as any)?.serverVersion;
    if (typeof draftVersion === 'number' && typeof canvasVersion === 'number' && draftVersion > canvasVersion) {
      return true;
    }
    const draftTs = draft.savedAt || (draft.doc as any)?.updatedAt || 0;
    const canvasTs = (canvas as any)?.updatedAt || 0;
    return draftTs > canvasTs + 1000;
  },
};

export default canvasDraftService;
