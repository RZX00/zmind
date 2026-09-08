'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import type { Canvas } from '../types/canvas';
import { CanvasCollaborationManager } from './CanvasCollaborationManager';
import { useCanvasStore } from '../stores/canvas.store';
import type { CanvasPresenceMetadata } from '@/lib/canvas/realtime/CanvasRealtimeTypes';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/contexts/workspace-context';
import { CANVAS_REALTIME_ENABLED } from '@/lib/canvas/realtime/config';
import { computeCollaboratorColor } from './collaboratorColors';
import { getCurrentCanvasRepository } from '@/canvas/services/canvas-repository-factory.service';
import { useWorkspaceWs } from '@/canvas/hooks/useWorkspaceWs';
import { updateDocFromCanvas } from '@/lib/canvas/realtime/canvasYDoc';
import { getCanvasRealtimeAdapter } from '@/canvas/stores/canvasRealtimeBridge';
import { NodeIds } from '../utils/nodeIdUtils';
import {
  applyMetadataToCanvas,
  applyMermaidThemeDefaults,
  migrateAnchorParams,
  shouldMigrateAnchors,
} from '@/canvas/utils/canvasNormalization';

export type Collaborator = CanvasPresenceMetadata & { isSelf?: boolean };

interface UseCanvasCollaborationResult {
  collaborators: Collaborator[];
  connected: boolean;
}

/**
 * 在 Canvas 编辑页面内调用，为当前画布建立协作连接并返回协作者状态。
 */
export function useCanvasCollaboration(canvasId?: string, inviteWorkspaceId?: string): UseCanvasCollaborationResult {
  const [presenceMap, setPresenceMap] = useState<Record<string, CanvasPresenceMetadata>>({});
  const [connected, setConnected] = useState(false);
  const managerRef = useRef<CanvasCollaborationManager | null>(null);
  const presenceRef = useRef<CanvasPresenceMetadata | null>(null);
  const [localPresence, setLocalPresence] = useState<CanvasPresenceMetadata | null>(null);
  const canvasVersionRef = useRef<number | null>(null);
  const recoveryInFlightRef = useRef(false);
  const wasDisconnectedRef = useRef(false);
  const lastRemoteToastVersionRef = useRef<number | null>(null);

  const currentFileId = useCanvasStore((state) => state.currentFileId);
  const isLoading = useCanvasStore((state) => state.isLoading);
  const { workspaceId } = useWorkspace();
  const decodeInviteWorkspace = useCallback((): string | undefined => {
    if (!canvasId || typeof window === 'undefined') return undefined;
    try {
      const raw = window.sessionStorage.getItem(`canvas_invite_token:${canvasId}`);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw);
      const token = parsed?.token as string | undefined;
      if (!token) return undefined;
      const parts = token.split('.');
      if (parts.length < 2) return undefined;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      const ws = payload?.workspaceId || payload?.workspace_id;
      if (typeof ws === 'string' && ws.trim()) return ws;
    } catch {
      return undefined;
    }
    return undefined;
  }, [canvasId]);

  // 加载当前用户信息作为 presence 元数据
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        if (!mounted) return;
        if (!user) {
          const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          const guestId = `guest-${randomId}`;
          const fallback: CanvasPresenceMetadata = {
            userId: guestId,
            name: 'Guest',
            color: computeCollaboratorColor(guestId),
            lastActiveAt: Date.now(),
          };
          presenceRef.current = fallback;
          setLocalPresence(fallback);
          return;
        }
        const metadata: CanvasPresenceMetadata = {
          userId: user.id,
          name:
            (user.user_metadata?.name as string | undefined) ||
            user.email?.split('@')[0] ||
            'Anonymous',
          avatar: user.user_metadata?.avatar_url as string | undefined,
          color: computeCollaboratorColor(user.id),
          lastActiveAt: Date.now(),
        };
        presenceRef.current = metadata;
        setLocalPresence(metadata);
      } catch (error) {
        console.error('[useCanvasCollaboration] Failed to load user metadata', error);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // 销毁旧的 manager
  useEffect(() => {
    return () => {
      managerRef.current?.destroy();
      managerRef.current = null;
    };
  }, []);

  // 当 canvasId 变化时，重置 manager
  useEffect(() => {
    if (!canvasId) {
      managerRef.current?.destroy();
      managerRef.current = null;
      setPresenceMap({});
      setConnected(false);
      return;
    }
    if (managerRef.current && managerRef.current.getCanvasId() !== canvasId) {
      managerRef.current.destroy();
      managerRef.current = null;
    }
  }, [canvasId]);

  // 初始化协作
  useEffect(() => {
    const effectiveWorkspaceId = inviteWorkspaceId || workspaceId || decodeInviteWorkspace();
    if (!canvasId) return;
    if (!CANVAS_REALTIME_ENABLED) return;
    if (isLoading) return;
    if (currentFileId !== canvasId) return;
    if (!effectiveWorkspaceId) return;
    if (!presenceRef.current) return;
    if (managerRef.current) {
      managerRef.current.updatePresence(presenceRef.current);
      return;
    }

    const snapshot = useCanvasStore.getState().canvas;
    if (!snapshot) return;
    const initialCanvas: Canvas = snapshot;
    const manager = new CanvasCollaborationManager({
      canvasId,
      initialCanvas,
      store: useCanvasStore,
      workspaceId: effectiveWorkspaceId,
      presence: presenceRef.current,
      onPresenceUpdate: (map) => setPresenceMap(map),
      onStatusChange: (status) => setConnected(status),
    });
    void manager.connect();
    managerRef.current = manager;

    return () => {
      manager.destroy();
      managerRef.current = null;
    };
  }, [canvasId, currentFileId, isLoading, localPresence, workspaceId, inviteWorkspaceId, decodeInviteWorkspace]);

  // 广播本地选择：把当前选中的节点ID（数组形式）写入 presence，
  // 远端据此渲染“谁在编辑什么”的彩色高亮。
  useEffect(() => {
    if (!CANVAS_REALTIME_ENABLED) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = (nodeIds: Set<string>) => {
      const manager = managerRef.current;
      if (!manager) return;
      manager.updatePresence({ selectedNodeIds: Array.from(nodeIds) });
    };

    const unsub = useCanvasStore.subscribe((state, prev) => {
      if (state.selections.nodeIds === prev.selections.nodeIds) return;
      const nextNodeIds = state.selections.nodeIds;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        flush(nextNodeIds);
      }, 150);
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsub();
    };
  }, [canvasId, connected]);

  const collaborators = useMemo<Collaborator[]>(() => {
    const entries: Collaborator[] = Object.entries(presenceMap).map(([key, value]) => ({
      ...value,
      userId: value.userId || key,
      isSelf: (presenceRef.current?.userId || localPresence?.userId) === (value.userId || key),
    }));

    return entries
      .sort((a, b) => {
        if (a.isSelf && !b.isSelf) return -1;
        if (b.isSelf && !a.isSelf) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [presenceMap, localPresence]);

  useEffect(() => {
    canvasVersionRef.current = useCanvasStore.getState().canvas?.serverVersion ?? null;
    const unsub = useCanvasStore.subscribe((state) => {
      const version = state.canvas?.serverVersion;
      canvasVersionRef.current = typeof version === 'number' ? version : null;
    });
    return () => {
      unsub();
    };
  }, []);

  const recoverFromServer = useCallback(
    async (minVersion?: number) => {
      if (!CANVAS_REALTIME_ENABLED) return;
      if (!canvasId || recoveryInFlightRef.current) return;
      recoveryInFlightRef.current = true;
      try {
        const repository = getCurrentCanvasRepository();
        const latest = await repository.findById(canvasId);
        if (!latest) return;
        const latestVersion =
          typeof (latest as any).serverVersion === 'number'
            ? ((latest as any).serverVersion as number)
            : null;
        if (
          typeof minVersion === 'number' &&
          typeof latestVersion === 'number' &&
          latestVersion < minVersion
        ) {
          return;
        }
        const normalized = applyMetadataToCanvas(latest as Canvas);
        const migrated = shouldMigrateAnchors(normalized) ? migrateAnchorParams(normalized).out : normalized;
        const themed = applyMermaidThemeDefaults(migrated);
        useCanvasStore.setState(
          (state) => ({
            ...state,
            canvas: themed,
            isDirty: false,
            lastSaved: new Date(themed.updatedAt || Date.now()),
            error: null,
          }),
          false,
        );
        try {
          NodeIds.initialize(themed.id, themed.nodes, themed.connections);
        } catch {}
        const adapter = getCanvasRealtimeAdapter();
        if (adapter) {
          adapter.transact((doc) => {
            updateDocFromCanvas(doc, themed);
          }, 'manual-reload');
        }
      } catch (error) {
        console.error('[useCanvasCollaboration] Recovery fetch failed', error);
      } finally {
        recoveryInFlightRef.current = false;
      }
    },
    [canvasId],
  );

  useWorkspaceWs(
    useCallback(
      (message: any) => {
        if (!CANVAS_REALTIME_ENABLED) return;
        if (!canvasId || !workspaceId) return;
        if (!message || message.type !== 'canvas_updated') return;
        if (message.canvasId !== canvasId) return;
        const incomingVersion =
          typeof message.serverVersion === 'number' ? message.serverVersion : null;
        if (incomingVersion !== null) {
          useCanvasStore.setState((state) => {
            if (!state.canvas || state.canvas.id !== canvasId) {
              return state;
            }
            if (state.canvas.serverVersion === incomingVersion) {
              return state;
            }
            return {
              ...state,
              canvas: { ...state.canvas, serverVersion: incomingVersion },
            };
          }, false);
          canvasVersionRef.current = incomingVersion;
        }
        if (connected) return;
        const updatedBy = message.updatedBy;
        if (updatedBy && presenceRef.current?.userId && updatedBy === presenceRef.current.userId) {
          return;
        }

        // ✅ 不再自动“覆盖式恢复”：离线/未连接时，自动覆盖会让用户感觉被“回滚”。
        // 改为：提示 + 手动重载（用户确认后才替换本地内容）。
        if (typeof incomingVersion === 'number') {
          if (lastRemoteToastVersionRef.current === incomingVersion) {
            return;
          }
          lastRemoteToastVersionRef.current = incomingVersion;
        }

        toast('画布有新内容', {
          description: '你当前未连接协作。为了避免覆盖你本地正在编辑的内容，我们不会自动刷新。需要用云端版本替换当前画布吗？',
          duration: 10_000,
          action: {
            label: '重载云端版本',
            onClick: () => {
              void recoverFromServer(incomingVersion ?? undefined);
            },
          },
        });
      },
      [canvasId, workspaceId, connected, recoverFromServer],
    ),
    workspaceId,
    CANVAS_REALTIME_ENABLED && Boolean(canvasId && workspaceId),
  );

  useEffect(() => {
    if (!CANVAS_REALTIME_ENABLED) return;
    if (!canvasId || !workspaceId) return;
    if (!connected) {
      wasDisconnectedRef.current = true;
      return;
    }
    if (wasDisconnectedRef.current) {
      wasDisconnectedRef.current = false;
      // 重连后由 Yjs/Hocuspocus 自动做增量合并，不再拉取 DB 快照覆盖本地。
    }
  }, [canvasId, workspaceId, connected, recoverFromServer]);

  return { collaborators, connected };
}
