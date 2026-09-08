'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { useWorkspace } from '@/contexts/workspace-context';
import { useWorkspaceData } from '@/hooks/useWorkspaceData';
import { useWorkspaceMutations } from '@/hooks/react-query/workspace/use-workspace-mutations';
import { useDocMutations } from '@/hooks/react-query/docs/use-doc-mutations';
import { useAgentRunStatus, requestStopAgentRun, setAgentRunStatus } from '@/hooks/useAgentRunStatus';
import { useCanvasStore } from '@/canvas/stores/canvas.store';
import { buildCanvasPath, buildDocPath } from '@/lib/workspace-path';
import type { Canvas } from '@/canvas/types/canvas';
import type { UnifiedSearchResult } from '@/types/search';
import type { WorkspaceItemType } from '@/types/workspace-item';

const AUTO_COLLAPSE_SIDEBAR_KEY = 'sidebar:autoCollapseOnCanvasOpen';

type LauncherAction = () => Promise<void> | void;

export interface WorkspaceRecentItem {
  id: string;
  type: WorkspaceItemType;
  title: string;
  updatedAt: number;
  sourceId?: string;
}

interface NavigationOptions {
  search?: string;
  autoCollapseSidebar?: boolean;
}

interface CreateOptions extends NavigationOptions {
  title?: string;
  contentMd?: string;
}

const makeUniqueTitle = (baseTitle: string, existingTitles: Set<string>) => {
  const normalizedBase = baseTitle.trim();
  if (!normalizedBase) {
    return '';
  }
  if (!existingTitles.has(normalizedBase)) {
    return normalizedBase;
  }
  let suffix = 2;
  let nextTitle = `${normalizedBase} ${suffix}`;
  while (existingTitles.has(nextTitle)) {
    suffix += 1;
    nextTitle = `${normalizedBase} ${suffix}`;
  }
  return nextTitle;
};

const getBasePath = (path: string) => path.split('?')[0]?.split('#')[0] || path;

const markAutoCollapse = (enabled?: boolean) => {
  if (!enabled || typeof window === 'undefined') {
    return;
  }
  try {
    sessionStorage.setItem(AUTO_COLLAPSE_SIDEBAR_KEY, '1');
  } catch {}
};

export function useWorkspaceLauncherActions() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const { teamSlug } = useWorkspace();
  const { data: workspaceData } = useWorkspaceData();
  const { createCanvas } = useWorkspaceMutations();
  const { createDoc } = useDocMutations();
  const { isRunning } = useAgentRunStatus();

  const pendingActionRef = useRef<LauncherAction | null>(null);
  const bypassGuardRef = useRef(false);
  const [guardOpen, setGuardOpen] = useState(false);
  const [creatingCanvas, setCreatingCanvas] = useState(false);
  const [creatingDoc, setCreatingDoc] = useState(false);

  const canvasTitles = useMemo(
    () =>
      new Set(
        (workspaceData?.canvases || [])
          .map((canvas) => String(canvas?.title || '').trim())
          .filter((title) => title.length > 0),
      ),
    [workspaceData?.canvases],
  );

  const canvasTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const canvas of workspaceData?.canvases || []) {
      if (!canvas?.id) continue;
      map.set(
        canvas.id,
        String(canvas.title || '').trim()
        || t('canvas.untitled', { default: 'Untitled Canvas' }),
      );
    }
    return map;
  }, [t, workspaceData?.canvases]);

  const docTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of workspaceData?.items || []) {
      if (!item || item.type !== 'doc' || item.isDeleted || !item.id) continue;
      map.set(item.id, String(item.title || '').trim());
    }
    for (const meta of workspaceData?.docsMeta || []) {
      if (!meta?.itemId || map.has(meta.itemId)) continue;
      map.set(meta.itemId, String(meta.title || '').trim());
    }
    return map;
  }, [workspaceData?.items, workspaceData?.docsMeta]);

  const docTitles = useMemo(
    () => new Set(Array.from(docTitleById.values()).filter((title) => title.length > 0)),
    [docTitleById],
  );

  const itemById = useMemo(() => {
    const map = new Map<string, { sourceId?: string; type?: string }>();
    for (const item of workspaceData?.items || []) {
      map.set(item.id, { sourceId: item.sourceId, type: item.type });
    }
    return map;
  }, [workspaceData?.items]);

  const recentItems = useMemo<WorkspaceRecentItem[]>(() => {
    const docs: WorkspaceRecentItem[] = [];
    const seenDocIds = new Set<string>();

    for (const item of workspaceData?.items || []) {
      if (!item || item.type !== 'doc' || item.isDeleted || !item.id) continue;
      seenDocIds.add(item.id);
      docs.push({
        id: item.id,
        type: 'doc',
        title:
          String(item.title || '').trim()
          || docTitleById.get(item.id)
          || t('workspace.doc.untitled', { default: 'Untitled Doc' }),
        updatedAt: item.updatedAt || item.createdAt || Date.now(),
      });
    }

    for (const meta of workspaceData?.docsMeta || []) {
      if (!meta?.itemId || seenDocIds.has(meta.itemId)) continue;
      docs.push({
        id: meta.itemId,
        type: 'doc',
        title:
          String(meta.title || '').trim()
          || t('workspace.doc.untitled', { default: 'Untitled Doc' }),
        updatedAt: meta.updatedAt || Date.now(),
      });
    }

    const canvases: WorkspaceRecentItem[] = (workspaceData?.canvases || []).map((canvas) => ({
      id: canvas.id,
      type: 'canvas',
      title:
        String(canvas.title || '').trim()
        || t('canvas.untitled', { default: 'Untitled Canvas' }),
      updatedAt: canvas.updatedAt || canvas.createdAt || Date.now(),
      sourceId: canvas.id,
    }));

    return [...canvases, ...docs]
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, 8);
  }, [docTitleById, t, workspaceData?.canvases, workspaceData?.docsMeta, workspaceData?.items]);

  const runWithOptionalGuard = useCallback(
    (action: LauncherAction, options?: { targetPath?: string; forceGuardOnContentRoute?: boolean }) => {
      if (bypassGuardRef.current) {
        bypassGuardRef.current = false;
        void Promise.resolve(action()).catch((error) => {
          console.error('[WorkspaceLauncher] bypassed action failed', error);
        });
        return;
      }

      const isContentRoute = pathname?.includes('/canvas/') || pathname?.includes('/doc/');
      const baseTargetPath = options?.targetPath ? getBasePath(options.targetPath) : null;
      const shouldGuard =
        isRunning
        && Boolean(isContentRoute)
        && (
          options?.forceGuardOnContentRoute
          || (baseTargetPath !== null && baseTargetPath !== pathname)
        );

      if (shouldGuard) {
        pendingActionRef.current = action;
        setGuardOpen(true);
        return;
      }

      void Promise.resolve(action()).catch((error) => {
        console.error('[WorkspaceLauncher] action failed', error);
      });
    },
    [isRunning, pathname],
  );

  const openCanvas = useCallback(
    (
      canvas: Pick<Canvas, 'id' | 'title'> | string,
      options?: NavigationOptions,
    ) => {
      const canvasId = typeof canvas === 'string' ? canvas : canvas.id;
      const canvasTitle =
        (typeof canvas === 'string' ? undefined : canvas.title)
        || t('canvas.untitled', { default: 'Untitled Canvas' });
      const targetPath = buildCanvasPath(canvasId, teamSlug, options?.search);

      runWithOptionalGuard(
        () => {
          try {
            const { beginCanvasSwitch } = useCanvasStore.getState();
            beginCanvasSwitch(canvasId, canvasTitle);
          } catch {}

          markAutoCollapse(options?.autoCollapseSidebar);
          const shouldSkipNavigation = getBasePath(targetPath) === pathname && !options?.search;
          if (!shouldSkipNavigation) {
            router.push(targetPath);
          }
        },
        { targetPath },
      );
    },
    [pathname, router, runWithOptionalGuard, t, teamSlug],
  );

  const openDoc = useCallback(
    (itemId: string, options?: NavigationOptions & { title?: string }) => {
      const targetPath = buildDocPath(itemId, teamSlug, options?.search);
      runWithOptionalGuard(
        () => {
          markAutoCollapse(options?.autoCollapseSidebar);
          const shouldSkipNavigation = getBasePath(targetPath) === pathname && !options?.search;
          if (!shouldSkipNavigation) {
            router.push(targetPath);
          }
        },
        { targetPath },
      );
    },
    [pathname, router, runWithOptionalGuard, teamSlug],
  );

  const createCanvasAndOpen = useCallback(
    (options?: CreateOptions) => {
      runWithOptionalGuard(
        async () => {
          const fallbackTitle = t('canvas.untitled', { default: 'Untitled Canvas' });
          const title = makeUniqueTitle(options?.title || fallbackTitle, canvasTitles) || fallbackTitle;
          setCreatingCanvas(true);
          try {
            const created = await createCanvas(title);
            openCanvas(
              {
                id: created.id,
                title: created.title || title,
              },
              {
                search: options?.search,
                autoCollapseSidebar: options?.autoCollapseSidebar,
              },
            );
          } finally {
            setCreatingCanvas(false);
          }
        },
        { forceGuardOnContentRoute: true },
      );
    },
    [canvasTitles, createCanvas, openCanvas, runWithOptionalGuard, t],
  );

  const createDocAndOpen = useCallback(
    (options?: CreateOptions) => {
      runWithOptionalGuard(
        async () => {
          const fallbackTitle = t('workspace.doc.untitled', { default: 'Untitled Doc' });
          const title = makeUniqueTitle(options?.title || fallbackTitle, docTitles) || fallbackTitle;
          setCreatingDoc(true);
          try {
            const created = await createDoc({
              title,
              contentMd: options?.contentMd ?? '',
            });
            openDoc(created.itemId, {
              search: options?.search,
              autoCollapseSidebar: options?.autoCollapseSidebar,
              title,
            });
          } finally {
            setCreatingDoc(false);
          }
        },
        { forceGuardOnContentRoute: true },
      );
    },
    [createDoc, docTitles, openDoc, runWithOptionalGuard, t],
  );

  const openSearchResult = useCallback(
    (result: UnifiedSearchResult, options?: { autoCollapseSidebar?: boolean }) => {
      if (result.resultType === 'doc' && result.itemId) {
        const search = result.targetAnchor
          ? `focusBlock=${encodeURIComponent(result.targetAnchor)}`
          : undefined;
        openDoc(result.itemId, {
          search,
          autoCollapseSidebar: options?.autoCollapseSidebar,
          title: result.title,
        });
        return;
      }

      if (result.resultType === 'canvas_node' && result.canvasId) {
        const search = result.nodeId
          ? `focusNode=${encodeURIComponent(result.nodeId)}`
          : undefined;
        openCanvas(
          {
            id: result.canvasId,
            title:
              canvasTitleById.get(result.canvasId)
              || t('canvas.untitled', { default: 'Untitled Canvas' }),
          },
          {
            search,
            autoCollapseSidebar: options?.autoCollapseSidebar,
          },
        );
        return;
      }

      if (result.resultType === 'reference') {
        const targetType = result.targetType;
        if ((targetType === 'doc' || targetType === 'doc_block') && result.targetItemId) {
          const search = result.targetAnchor
            ? `focusBlock=${encodeURIComponent(result.targetAnchor)}`
            : undefined;
          openDoc(result.targetItemId, {
            search,
            autoCollapseSidebar: options?.autoCollapseSidebar,
            title: result.title,
          });
          return;
        }

        if (targetType === 'canvas') {
          const mappedCanvasId = result.targetItemId
            ? itemById.get(result.targetItemId)?.sourceId
            : undefined;
          const canvasId = result.targetCanvasId || mappedCanvasId;
          if (canvasId) {
            const search = result.targetAnchor
              ? `focusNode=${encodeURIComponent(result.targetAnchor)}`
              : undefined;
            openCanvas(
              {
                id: canvasId,
                title:
                  canvasTitleById.get(canvasId)
                  || t('canvas.untitled', { default: 'Untitled Canvas' }),
              },
              {
                search,
                autoCollapseSidebar: options?.autoCollapseSidebar,
              },
            );
          }
        }
      }
    },
    [canvasTitleById, itemById, openCanvas, openDoc, t],
  );

  const confirmPendingAction = useCallback(() => {
    const pendingAction = pendingActionRef.current;
    pendingActionRef.current = null;
    setGuardOpen(false);
    if (!pendingAction) {
      return;
    }
    bypassGuardRef.current = true;
    requestStopAgentRun();
    setAgentRunStatus('idle');
    void Promise.resolve(pendingAction())
      .catch((error) => {
        console.error('[WorkspaceLauncher] pending action failed', error);
      })
      .finally(() => {
        bypassGuardRef.current = false;
      });
  }, []);

  const cancelPendingAction = useCallback(() => {
    pendingActionRef.current = null;
    setGuardOpen(false);
  }, []);

  return {
    recentItems,
    creatingCanvas,
    creatingDoc,
    openCanvas,
    openDoc,
    createCanvasAndOpen,
    createDocAndOpen,
    openSearchResult,
    guardDialog: {
      open: guardOpen,
      title: t('workspace.switchGuard.title'),
      description: t('workspace.switchGuard.description'),
      confirmLabel: t('workspace.switchGuard.confirm'),
      cancelLabel: t('workspace.switchGuard.cancel'),
    },
    confirmPendingAction,
    cancelPendingAction,
  };
}

export default useWorkspaceLauncherActions;
