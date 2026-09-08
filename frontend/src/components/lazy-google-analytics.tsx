'use client';

import { useEffect, useState } from 'react';
import { GoogleAnalytics } from '@next/third-parties/google';

type LazyGoogleAnalyticsProps = {
  gaId: string;
  delayMs?: number;
};

export function LazyGoogleAnalytics({ gaId, delayMs = 1500 }: LazyGoogleAnalyticsProps) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const w: (Window & typeof globalThis) | undefined =
      typeof window === 'undefined' ? undefined : window;
    if (!w) return;

    const idleWindow = w as typeof w & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (typeof idleWindow.requestIdleCallback === 'function') {
      const idleId = idleWindow.requestIdleCallback(() => setEnabled(true), { timeout: delayMs });
      return () => {
        if (idleId && typeof idleWindow.cancelIdleCallback === 'function') {
          idleWindow.cancelIdleCallback(idleId);
        }
      };
    }

    const timeoutId = w.setTimeout(() => setEnabled(true), delayMs);
    return () => w.clearTimeout(timeoutId);
  }, [delayMs]);

  if (!enabled) return null;
  return <GoogleAnalytics gaId={gaId} />;
}
