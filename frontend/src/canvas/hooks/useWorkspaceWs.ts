"use client";

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { requiredEnv } from '@/lib/env-utils';

type WorkspaceWsHandler = (message: any) => void;

interface WorkspaceWsEntry {
  ws: WebSocket | null;
  handlers: Set<WorkspaceWsHandler>;
  id: number;
  connecting: Promise<void> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempt: number;
  lastAuthToastAt: number;
}

// 全局注册表：同一个 workspaceId 在浏览器 tab 内共用一条 WebSocket 连接
const workspaceWsRegistry = new Map<string, WorkspaceWsEntry>();
let workspaceWsNextId = 1;

const AUTH_TOAST_COOLDOWN_MS = 12_000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30_000;

const buildWorkspaceWsUrl = (base: string, token: string, workspaceId?: string | null) => {
  const httpBase = base.replace(/\/$/, '').replace(/\/api$/, '');
  const wsBase = httpBase.replace(/^http/, 'ws');
  const workspaceParam = workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : '';
  return `${wsBase}/api/workspace/ws?token=${encodeURIComponent(token)}${workspaceParam}`;
};

const computeReconnectDelay = (attempt: number) => {
  const exp = Math.min(10, Math.max(0, attempt));
  const delay = Math.min(RECONNECT_MAX_MS, Math.round(RECONNECT_BASE_MS * Math.pow(1.5, exp)));
  const jitter = Math.round(delay * 0.2 * Math.random());
  return Math.min(RECONNECT_MAX_MS, delay + jitter);
};

const maybeToastAuthIssue = (entry: WorkspaceWsEntry, code: number) => {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (now - entry.lastAuthToastAt < AUTH_TOAST_COOLDOWN_MS) return;
  entry.lastAuthToastAt = now;

  if (code === 4401) {
    toast('登录已过期', {
      description: '协作连接需要重新登录。请刷新页面后继续。',
      duration: 10_000,
      action: {
        label: '刷新',
        onClick: () => {
          try { window.location.reload(); } catch {}
        },
      },
    });
    return;
  }

  if (code === 4403) {
    toast('没有权限访问此工作区', {
      description: '请切换到有权限的工作区，或让管理员邀请你。',
      duration: 10_000,
    });
  }
};

const scheduleReconnect = (key: string, entryId: number, workspaceId?: string | null) => {
  const current = workspaceWsRegistry.get(key);
  if (!current || current.id !== entryId) return;
  if (current.handlers.size === 0) return;
  if (current.reconnectTimer) return;

  const delay = computeReconnectDelay(current.reconnectAttempt);
  current.reconnectAttempt += 1;
  current.reconnectTimer = setTimeout(() => {
    const latest = workspaceWsRegistry.get(key);
    if (!latest || latest.id !== entryId) return;
    latest.reconnectTimer = null;
    void connectWorkspaceWs(key, entryId, workspaceId);
  }, delay);
};

const connectWorkspaceWs = async (key: string, entryId: number, workspaceId?: string | null) => {
  const current = workspaceWsRegistry.get(key);
  if (!current || current.id !== entryId) return;
  if (current.connecting) return current.connecting;

  const activeWs = current.ws;
  if (
    activeWs &&
    (activeWs.readyState === WebSocket.OPEN || activeWs.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  if (current.reconnectTimer) {
    clearTimeout(current.reconnectTimer);
    current.reconnectTimer = null;
  }

  current.connecting = (async () => {
    try {
      const supabase = createClient();
      let token: string | null = null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token ?? null;
      } catch {}

      // Best-effort: refresh session if we don't have a token yet
      if (!token) {
        try { await supabase.auth.refreshSession(); } catch {}
        try {
          const { data: { session } } = await supabase.auth.getSession();
          token = session?.access_token ?? null;
        } catch {}
      }

      if (!token) {
        scheduleReconnect(key, entryId, workspaceId);
        return;
      }

      const base = requiredEnv('NEXT_PUBLIC_BACKEND_URL');
      const url = buildWorkspaceWsUrl(base, token, workspaceId);
      const ws = new WebSocket(url);

      const latest = workspaceWsRegistry.get(key);
      if (!latest || latest.id !== entryId) {
        try { ws.close(); } catch {}
        return;
      }

      latest.ws = ws;

      ws.onopen = () => {
        const entry = workspaceWsRegistry.get(key);
        if (!entry || entry.id !== entryId) return;
        entry.reconnectAttempt = 0;
      };

      ws.onmessage = (evt) => {
        const entry = workspaceWsRegistry.get(key);
        if (!entry || entry.id !== entryId) return;
        let msg: any;
        try {
          msg = JSON.parse(evt.data);
        } catch {
          return;
        }
        if (!msg) return;
        for (const h of entry.handlers) {
          try {
            h(msg);
          } catch {}
        }
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {}
      };

      ws.onclose = (evt) => {
        const entry = workspaceWsRegistry.get(key);
        if (!entry || entry.id !== entryId) return;
        entry.ws = null;

        if (evt?.code === 4401 || evt?.code === 4403) {
          maybeToastAuthIssue(entry, evt.code);
          if (evt.code === 4403) {
            return;
          }
        }

        scheduleReconnect(key, entryId, workspaceId);
      };
    } catch {
      scheduleReconnect(key, entryId, workspaceId);
    }
  })().finally(() => {
    const latest = workspaceWsRegistry.get(key);
    if (!latest || latest.id !== entryId) return;
    latest.connecting = null;
  });

  return current.connecting;
};

export function useWorkspaceWs(
  onMessage: (message: any) => void,
  workspaceId?: string | null,
  enabled: boolean = true,
) {
  const handlerRef = useRef(onMessage);

  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!enabled) return;
    const key = workspaceId || 'default';

    const handler: WorkspaceWsHandler = (msg: any) => {
      try {
        handlerRef.current?.(msg);
      } catch {}
    };

    let entry = workspaceWsRegistry.get(key);

    if (!entry) {
      entry = {
        ws: null,
        handlers: new Set(),
        id: workspaceWsNextId++,
        connecting: null,
        reconnectTimer: null,
        reconnectAttempt: 0,
        lastAuthToastAt: 0,
      };
      workspaceWsRegistry.set(key, entry);
    }

    entry.handlers.add(handler);
    void connectWorkspaceWs(key, entry.id, workspaceId);

    return () => {
      const current = workspaceWsRegistry.get(key);
      if (!current) return;
      current.handlers.delete(handler);
      if (current.handlers.size === 0) {
        if (current.reconnectTimer) {
          clearTimeout(current.reconnectTimer);
          current.reconnectTimer = null;
        }
        try {
          current.ws?.close();
        } catch {}
        workspaceWsRegistry.delete(key);
      }
    };
  }, [workspaceId, enabled]);
}
