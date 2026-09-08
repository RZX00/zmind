"use client";

import { useEffect, useRef, useState } from 'react';
import { canvasCache } from '../cache/canvas-cache';
import { useCanvasStore } from '../stores/canvas.store';

type HydrationStatus = 'idle' | 'hydrating' | 'loading' | 'ready';

/**
 * Hydrate CanvasEditor from cache/snapshot first, then trigger real openCanvas
 */
export function useCanvasHydrator(canvasId?: string) {
  return useCanvasHydratorWithOptions(canvasId, { enabled: true });
}

export function useCanvasHydratorWithOptions(canvasId?: string, options?: { enabled?: boolean }) {
  const openCanvas = useCanvasStore((state) => state.openCanvas);
  const loadCanvasFromStore = useCanvasStore((state) => state.loadCanvas);
  const hydrateForView = useCanvasStore((state) => state.hydrateCanvasForView);
  const [status, setStatus] = useState<HydrationStatus>('idle');
  const bootedRef = useRef(false);
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!enabled) return;
      if (!canvasId) {
        if (bootedRef.current) return;
        bootedRef.current = true;
        setStatus('loading');
        try {
          await loadCanvasFromStore();
          if (!cancelled) setStatus('ready');
        } catch {
          if (!cancelled) setStatus('ready');
        }
        return;
      }

      setStatus('loading');

      const cachedEntry = canvasCache.get(canvasId) || canvasCache.hydrateFromSnapshot(canvasId);
      if (cachedEntry) {
        try {
          hydrateForView(cachedEntry.canvas, { setFileId: canvasId });
          if (!cancelled) setStatus('hydrating');
        } catch {
          // ignore hydrate errors, still proceed with openCanvas
        }
      }

      try {
        await openCanvas(canvasId);
        if (!cancelled) {
          try { window.dispatchEvent(new CustomEvent('canvas:opened', { detail: { id: canvasId } })); } catch {}
        }
      } catch {
        // openCanvas already handles error state
      } finally {
        if (!cancelled) setStatus('ready');
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [canvasId, openCanvas, loadCanvasFromStore, hydrateForView, enabled]);

  return status;
}

export default useCanvasHydrator;
