'use client';

import { useEffect, useRef } from 'react';
import { useWorkspace } from '@/contexts/workspace-context';
import { useWorkspaceWs } from '@/canvas/hooks/useWorkspaceWs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { workspaceKeys } from '@/hooks/react-query/workspace/keys';
import { applyWorkspacePatch } from '@/hooks/react-query/workspace/apply-patch';
import { requiredEnv } from '@/lib/env-utils';
import type { WorkspaceDocMeta, WorkspaceItem } from '@/types/workspace-item';
import type { WorkspaceReferenceSummary } from '@/types/reference';

export interface WorkspaceCanvas {
  id: string;
  title: string;
  nodes?: any[];
  connections?: any[];
  nodeCount?: number;
  clientRequestId?: string;
  createdAt: number;
  updatedAt: number;
  version?: string;
  folderId?: string | null;
}

export interface WorkspacePayload {
  folders: any[];
  canvases: WorkspaceCanvas[];
  items?: WorkspaceItem[];
  docsMeta?: WorkspaceDocMeta[];
  refsSummary?: WorkspaceReferenceSummary;
  version: number;
  generatedAt: number;
}

const normalizeCanvas = (canvas: any): WorkspaceCanvas => {
  const nodes = Array.isArray(canvas?.nodes) ? canvas.nodes : [];
  const connections = Array.isArray(canvas?.connections) ? canvas.connections : [];
  const nodeCount = typeof canvas?.nodeCount === 'number' ? canvas.nodeCount : nodes.length;
  const createdAt = typeof canvas?.createdAt === 'number' ? canvas.createdAt : Date.now();
  const updatedAt = typeof canvas?.updatedAt === 'number' ? canvas.updatedAt : Date.now();
  return {
    ...canvas,
    nodes,
    connections,
    nodeCount,
    createdAt,
    updatedAt,
  };
};

const normalizePayload = (payload: any): WorkspacePayload => {
  const folders = Array.isArray(payload?.folders) ? payload.folders : [];
  const canvases = Array.isArray(payload?.canvases)
    ? payload.canvases.map(normalizeCanvas)
    : [];
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const docsMeta = Array.isArray(payload?.docsMeta) ? payload.docsMeta : [];
  const refsSummary = payload?.refsSummary && typeof payload.refsSummary === 'object'
    ? {
        inboundCountByItem: payload.refsSummary.inboundCountByItem || {},
        outboundCountByItem: payload.refsSummary.outboundCountByItem || {},
      }
    : {
        inboundCountByItem: {},
        outboundCountByItem: {},
      };
  return {
    folders,
    canvases,
    items,
    docsMeta,
    refsSummary,
    version: typeof payload?.version === 'number' ? payload.version : 0,
    generatedAt: typeof payload?.generatedAt === 'number' ? payload.generatedAt : Date.now(),
  };
};

export function useWorkspaceData() {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const etagByWorkspaceRef = useRef<Map<string, string>>(new Map());
  const pendingRefetchRef = useRef<{ version: number | null; timeoutId: ReturnType<typeof setTimeout> } | null>(null);

  const fetchWorkspace = async (): Promise<WorkspacePayload | null> => {
    if (!workspaceId) return null;
    const requestWorkspaceMeta = async (headers: Record<string, string>) => {
      let resp = await fetch('/api/workspace/meta', { headers, cache: 'no-store' });
      if (resp.status === 404) {
        const base = requiredEnv('NEXT_PUBLIC_BACKEND_URL').replace(/\/$/, '');
        const url = base
          ? (base.endsWith('/api') ? `${base}/workspace/meta` : `${base}/api/workspace/meta`)
          : '/api/workspace/meta';
        resp = await fetch(url, { headers, cache: 'no-store' });
      }
      return resp;
    };

    const etag = etagByWorkspaceRef.current.get(workspaceId);
    const headers: Record<string, string> = { 'X-Workspace-Id': workspaceId };
    if (etag) headers['If-None-Match'] = etag;

    let resp = await requestWorkspaceMeta(headers);
    if (resp.status === 304) {
      const cached = queryClient.getQueryData<WorkspacePayload>(workspaceKeys.detail(workspaceId)) || null;
      if (cached) {
        return cached;
      }
      etagByWorkspaceRef.current.delete(workspaceId);
      resp = await requestWorkspaceMeta({ 'X-Workspace-Id': workspaceId });
    }
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const nextEtag = resp.headers.get('etag');
    if (nextEtag) etagByWorkspaceRef.current.set(workspaceId, nextEtag);
    const json = await resp.json();
    return normalizePayload(json);
  };

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<WorkspacePayload | null>({
    queryKey: workspaceKeys.detail(workspaceId || null),
    queryFn: fetchWorkspace,
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  // 后端通过 workspace WebSocket 推送更新时，标记失效，触发后台刷新
  useWorkspaceWs(
    (message: any) => {
      if (!message) return;
      if (message.type === 'workspace_patch') {
        if (message.workspaceId && workspaceId && message.workspaceId !== workspaceId) return;
        const current = queryClient.getQueryData<WorkspacePayload | null>(
          workspaceKeys.detail(workspaceId || null),
        );
        if (!current) {
          queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId || null) });
          return;
        }
        const { next, applied, needsRefetch } = applyWorkspacePatch(current, message);
        if (applied) {
          queryClient.setQueryData(workspaceKeys.detail(workspaceId || null), next);
        }
        if (needsRefetch) {
          if (pendingRefetchRef.current) {
            clearTimeout(pendingRefetchRef.current.timeoutId);
            pendingRefetchRef.current = null;
          }
          queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId || null) });
        }
        if (pendingRefetchRef.current) {
          const pendingVersion = pendingRefetchRef.current.version;
          if (pendingVersion === null || message.version >= pendingVersion) {
            clearTimeout(pendingRefetchRef.current.timeoutId);
            pendingRefetchRef.current = null;
          }
        }
        return;
      }
      if (message.type === 'workspace_updated') {
        if (message.workspaceId && workspaceId && message.workspaceId !== workspaceId) return;
        const version = typeof message.version === 'number' ? message.version : null;
        const current = queryClient.getQueryData<WorkspacePayload | null>(
          workspaceKeys.detail(workspaceId || null),
        );
        if (current && version !== null && current.version >= version) {
          return;
        }
        if (pendingRefetchRef.current) {
          clearTimeout(pendingRefetchRef.current.timeoutId);
        }
        const timeoutId = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId || null) });
          pendingRefetchRef.current = null;
        }, 400);
        pendingRefetchRef.current = { version, timeoutId };
      }
    },
    workspaceId,
    !!workspaceId,
  );

  useEffect(() => {
    return () => {
      if (pendingRefetchRef.current) {
        clearTimeout(pendingRefetchRef.current.timeoutId);
        pendingRefetchRef.current = null;
      }
    };
  }, []);

  // Optimistically update local cache on title change for instant UI
  useEffect(() => {
    const handleTitleChanged = (e: any) => {
      try {
        const id = e?.detail?.id;
        const title = e?.detail?.title;
        if (!id || typeof title !== 'string') return;
        queryClient.setQueryData<WorkspacePayload | null>(
          workspaceKeys.detail(workspaceId || null),
          (prev) => {
            if (!prev) return prev;
            let changed = false;
            const canvases = prev.canvases.map((c) => {
              if (c.id === id && c.title !== title) {
                changed = true;
                return { ...c, title, updatedAt: Date.now() };
              }
              return c;
            });
            if (!changed) return prev;
            return { ...prev, canvases };
          },
        );
      } catch {}
    };
    try { window.addEventListener('canvas:title-changed', handleTitleChanged as any); } catch {}
    return () => { try { window.removeEventListener('canvas:title-changed', handleTitleChanged as any); } catch {} };
  }, [queryClient, workspaceId]);

  const loading = isLoading || (!data && isFetching);

  return {
    data: data || null,
    loading,
    error: error ? (error as any).message || String(error) : null,
    refetch,
    etag: workspaceId ? etagByWorkspaceRef.current.get(workspaceId) || null : null,
  };
}

