"use client";

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

function getStorageKey(userId?: string, teamId?: string) {
  const u = userId || 'anon';
  const t = teamId || 'default';
  return `workspace:expand:${u}:${t}`;
}

export function useLocalExpandState(opts?: { userId?: string; teamId?: string }) {
  const userId = opts?.userId;
  const teamId = opts?.teamId;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const EVENT = 'workspace:expand-updated';

  useEffect(() => {
    try {
      const raw = localStorage.getItem(getStorageKey(userId, teamId));
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        setExpanded(new Set(arr));
      }
    } catch {}
  }, [userId, teamId]);

  const persist = useCallback((next: Set<string>) => {
    setExpanded(prev => {
      // If equal, do nothing to avoid re-render loops
      if (prev.size === next.size) {
        let same = true;
        for (const id of prev) { if (!next.has(id)) { same = false; break; } }
        if (same) return prev;
      }
      try { localStorage.setItem(getStorageKey(userId, teamId), JSON.stringify(Array.from(next))); } catch {}
      // Broadcast to sync other components in the same tab
      try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { userId, teamId, ids: Array.from(next) } })); } catch {}
      return new Set(next);
    });
  }, [userId, teamId]);

  const toggle = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(getStorageKey(userId, teamId), JSON.stringify(Array.from(next))); } catch {}
      try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { userId, teamId, ids: Array.from(next) } })); } catch {}
      return next;
    });
  }, [userId, teamId]);

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded]);

  const clearInvalid = useCallback((validIds: Set<string>) => {
    setExpanded(prev => {
      const next = new Set<string>();
      prev.forEach(id => { if (validIds.has(id)) next.add(id); });
      if (prev.size === next.size) {
        let same = true;
        for (const id of prev) { if (!next.has(id)) { same = false; break; } }
        if (same) return prev;
      }
      try { localStorage.setItem(getStorageKey(userId, teamId), JSON.stringify(Array.from(next))); } catch {}
      try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { userId, teamId, ids: Array.from(next) } })); } catch {}
      return next;
    });
  }, [userId, teamId]);

  const setAll = useCallback((ids: string[]) => {
    const next = new Set(ids);
    setExpanded(prev => {
      if (prev.size === next.size) {
        let same = true;
        for (const id of prev) { if (!next.has(id)) { same = false; break; } }
        if (same) return prev;
      }
      try { localStorage.setItem(getStorageKey(userId, teamId), JSON.stringify(Array.from(next))); } catch {}
      try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { userId, teamId, ids: Array.from(next) } })); } catch {}
      return next;
    });
  }, [userId, teamId]);

  // Clean user key on sign-out
  useEffect(() => {
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        try { localStorage.removeItem(getStorageKey(userId, teamId)); } catch {}
      }
    });
    return () => { sub.subscription.unsubscribe(); };
  }, [userId, teamId]);

  return { expanded, isExpanded, toggle, setAll, clearInvalid };
}

