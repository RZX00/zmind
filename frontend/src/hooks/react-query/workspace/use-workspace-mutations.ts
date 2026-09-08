import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '@/contexts/workspace-context';
import { canvasManager } from '@/canvas/services/canvas-manager.service';
import { folderManager } from '@/canvas/services/folder-manager.service';
import type { Canvas } from '@/canvas/types/canvas';
import type { Folder, MoveCanvasOptions, MoveFolderOptions } from '@/canvas/types/folder';
import { workspaceKeys } from './keys';
import type { WorkspaceCanvas, WorkspacePayload } from '@/hooks/useWorkspaceData';

const makeTempId = (prefix: string) => {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
};

const normalizeWorkspaceCanvas = (canvas: Canvas): WorkspaceCanvas => {
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : [];
  const connections = Array.isArray(canvas.connections) ? canvas.connections : [];
  const nodeCount = typeof (canvas as any).nodeCount === 'number'
    ? (canvas as any).nodeCount
    : nodes.length;
  return {
    ...canvas,
    nodes,
    connections,
    nodeCount,
  } as WorkspaceCanvas;
};

const updateWorkspaceCache = (
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: ReturnType<typeof workspaceKeys.detail>,
  updater: (prev: WorkspacePayload) => WorkspacePayload,
) => {
  queryClient.setQueryData<WorkspacePayload | null>(queryKey, (prev) => {
    if (!prev) return prev;
    return updater(prev);
  });
};

const removeId = (items: string[], id: string) => items.filter((item) => item !== id);
const addId = (items: string[], id: string) => (items.includes(id) ? items : [...items, id]);

const buildFolderLevel = (folders: Folder[], parentId: string | null): number => {
  if (!parentId) return 0;
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  let level = 0;
  let current = parentId;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) break;
    seen.add(current);
    const parent = folderMap.get(current);
    if (!parent) break;
    level += 1;
    current = parent.parentId ?? null;
  }
  return level;
};

const removeCanvasFromFolders = (folders: Folder[], canvasId: string) => {
  let changed = false;
  const next = folders.map((folder) => {
    if (!folder.canvasIds?.includes(canvasId)) return folder;
    changed = true;
    return {
      ...folder,
      canvasIds: folder.canvasIds.filter((id) => id !== canvasId),
    };
  });
  return changed ? next : folders;
};

export function useWorkspaceMutations() {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const workspaceKey = workspaceKeys.detail(workspaceId || null);
  const safetyRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSafetyRefetch = (delayMs = 1200) => {
    if (!workspaceId) return;
    if (safetyRefetchTimerRef.current) {
      clearTimeout(safetyRefetchTimerRef.current);
    }
    safetyRefetchTimerRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId) });
      safetyRefetchTimerRef.current = null;
    }, delayMs);
  };

  useEffect(() => {
    return () => {
      if (safetyRefetchTimerRef.current) {
        clearTimeout(safetyRefetchTimerRef.current);
        safetyRefetchTimerRef.current = null;
      }
    };
  }, []);

  const ensureWorkspaceReady = () => {
    if (!workspaceId) {
      throw new Error('Workspace is not ready');
    }
  };

  const createCanvasMutation = useMutation({
    mutationFn: async ({ title, clientRequestId }: { title: string; clientRequestId?: string }) => {
      ensureWorkspaceReady();
      return canvasManager.createCanvas(title, undefined, { clientRequestId });
    },
    onMutate: async ({ title, clientRequestId }) => {
      await queryClient.cancelQueries({ queryKey: workspaceKey });
      const previous = queryClient.getQueryData<WorkspacePayload | null>(workspaceKey) || null;
      const tempId = makeTempId('temp_canvas');
      const now = Date.now();
      const optimistic: WorkspaceCanvas = {
        id: tempId,
        title,
        nodes: [],
        connections: [],
        nodeCount: 0,
        clientRequestId,
        createdAt: now,
        updatedAt: now,
        version: '1.0.0',
        folderId: null,
      };
      if (previous) {
        updateWorkspaceCache(queryClient, workspaceKey, (prev) => ({
          ...prev,
          canvases: [optimistic, ...prev.canvases],
        }));
      }
      return { previous, tempId, clientRequestId };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workspaceKey, context.previous);
      }
    },
    onSuccess: (canvas, _variables, context) => {
      if (!context?.tempId) return;
      const normalized = normalizeWorkspaceCanvas(canvas);
      if (context.clientRequestId) {
        (normalized as WorkspaceCanvas).clientRequestId = context.clientRequestId;
      }
      updateWorkspaceCache(queryClient, workspaceKey, (prev) => {
        const filtered = prev.canvases.filter((item) => item.id !== context.tempId);
        const existingById = filtered.find((item) => item.id === normalized.id);
        const existingByRequest = context.clientRequestId
          ? filtered.find((item) => item.clientRequestId === context.clientRequestId)
          : undefined;
        let canvases = filtered;
        if (existingById) {
          canvases = filtered.map((item) =>
            item.id === normalized.id ? { ...item, ...normalized } : item,
          );
        } else if (existingByRequest) {
          canvases = filtered.map((item) =>
            item.clientRequestId === context.clientRequestId ? { ...item, ...normalized } : item,
          );
        } else {
          canvases = [normalized, ...filtered];
        }
        return { ...prev, canvases };
      });
      scheduleSafetyRefetch();
    },
  });

  const deleteCanvasMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      ensureWorkspaceReady();
      await canvasManager.deleteCanvas(id);
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: workspaceKey });
      const previous = queryClient.getQueryData<WorkspacePayload | null>(workspaceKey) || null;
      if (previous) {
        updateWorkspaceCache(queryClient, workspaceKey, (prev) => ({
          ...prev,
          canvases: prev.canvases.filter((canvas) => canvas.id !== id),
          folders: removeCanvasFromFolders(prev.folders, id),
        }));
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workspaceKey, context.previous);
      }
    },
    onSuccess: () => {
      scheduleSafetyRefetch();
    },
  });

  const renameCanvasMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      ensureWorkspaceReady();
      return canvasManager.updateCanvas(id, { title });
    },
    onMutate: async ({ id, title }) => {
      await queryClient.cancelQueries({ queryKey: workspaceKey });
      const previous = queryClient.getQueryData<WorkspacePayload | null>(workspaceKey) || null;
      const now = Date.now();
      if (previous) {
        updateWorkspaceCache(queryClient, workspaceKey, (prev) => ({
          ...prev,
          canvases: prev.canvases.map((canvas) =>
            canvas.id === id
              ? { ...canvas, title, updatedAt: now }
              : canvas,
          ),
        }));
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workspaceKey, context.previous);
      }
    },
    onSuccess: (canvas) => {
      const normalized = normalizeWorkspaceCanvas(canvas);
      updateWorkspaceCache(queryClient, workspaceKey, (prev) => ({
        ...prev,
        canvases: prev.canvases.map((item) =>
          item.id === normalized.id ? { ...item, ...normalized } : item,
        ),
      }));
      scheduleSafetyRefetch();
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: async ({ name, parentId, clientRequestId }: { name: string; parentId?: string | null; clientRequestId?: string }) => {
      ensureWorkspaceReady();
      return folderManager.createFolder({ name, parentId: parentId ?? null, clientRequestId });
    },
    onMutate: async ({ name, parentId, clientRequestId }) => {
      await queryClient.cancelQueries({ queryKey: workspaceKey });
      const previous = queryClient.getQueryData<WorkspacePayload | null>(workspaceKey) || null;
      const tempId = makeTempId('temp_folder');
      const now = Date.now();
      if (previous) {
        updateWorkspaceCache(queryClient, workspaceKey, (prev) => {
          const level = buildFolderLevel(prev.folders, parentId ?? null);
          const newFolder: Folder = {
            id: tempId,
            name,
            parentId: parentId ?? null,
            canvasIds: [],
            childFolderIds: [],
            level,
            isExpanded: false,
            createdAt: now,
            updatedAt: now,
            sortOrder: 0,
            clientRequestId,
          };
          const folders = prev.folders.map((folder) =>
            folder.id === parentId
              ? { ...folder, childFolderIds: addId(folder.childFolderIds, tempId) }
              : folder,
          );
          return { ...prev, folders: [...folders, newFolder] };
        });
      }
      return { previous, tempId, clientRequestId };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workspaceKey, context.previous);
      }
    },
    onSuccess: (folder, variables, context) => {
      if (!context?.tempId) return;
      if (context.clientRequestId) {
        (folder as Folder).clientRequestId = context.clientRequestId;
      }
      const parentId = variables.parentId ?? null;
      updateWorkspaceCache(queryClient, workspaceKey, (prev) => {
        const folders = prev.folders.map((item) => {
          if (item.id === context.tempId) {
            return { ...item, ...folder };
          }
          if (parentId && item.id === parentId) {
            return {
              ...item,
              childFolderIds: item.childFolderIds.map((childId) =>
                childId === context.tempId ? folder.id : childId,
              ),
            };
          }
          return item;
        });
        return { ...prev, folders };
      });
      scheduleSafetyRefetch();
    },
  });

  const renameFolderMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      ensureWorkspaceReady();
      return folderManager.updateFolder(id, { name });
    },
    onMutate: async ({ id, name }) => {
      await queryClient.cancelQueries({ queryKey: workspaceKey });
      const previous = queryClient.getQueryData<WorkspacePayload | null>(workspaceKey) || null;
      const now = Date.now();
      if (previous) {
        updateWorkspaceCache(queryClient, workspaceKey, (prev) => ({
          ...prev,
          folders: prev.folders.map((folder) =>
            folder.id === id ? { ...folder, name, updatedAt: now } : folder,
          ),
        }));
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workspaceKey, context.previous);
      }
    },
    onSuccess: (folder) => {
      updateWorkspaceCache(queryClient, workspaceKey, (prev) => ({
        ...prev,
        folders: prev.folders.map((item) =>
          item.id === folder.id ? { ...item, ...folder } : item,
        ),
      }));
      scheduleSafetyRefetch();
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async ({ id, moveCanvasesToParent }: { id: string; moveCanvasesToParent?: boolean }) => {
      ensureWorkspaceReady();
      await folderManager.deleteFolder(id, moveCanvasesToParent ?? true);
    },
    onMutate: async ({ id, moveCanvasesToParent }) => {
      await queryClient.cancelQueries({ queryKey: workspaceKey });
      const previous = queryClient.getQueryData<WorkspacePayload | null>(workspaceKey) || null;
      if (previous) {
        updateWorkspaceCache(queryClient, workspaceKey, (prev) => {
          const target = prev.folders.find((folder) => folder.id === id);
          if (!target) return prev;
          const parentId = target.parentId ?? null;
          const canvasIds = Array.isArray(target.canvasIds) ? target.canvasIds : [];
          const moveCanvases = moveCanvasesToParent ?? true;
          const folders = prev.folders
            .filter((folder) => folder.id !== id)
            .map((folder) => {
              if (parentId && folder.id === parentId) {
                return {
                  ...folder,
                  childFolderIds: removeId(folder.childFolderIds, id),
                  canvasIds: moveCanvases
                    ? Array.from(new Set([...folder.canvasIds, ...canvasIds]))
                    : folder.canvasIds,
                };
              }
              return folder;
            });
          const canvases = moveCanvases
            ? prev.canvases.map((canvas) =>
                canvasIds.includes(canvas.id)
                  ? { ...canvas, folderId: parentId }
                  : canvas,
              )
            : prev.canvases;
          return { ...prev, folders, canvases };
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workspaceKey, context.previous);
      }
    },
    onSuccess: () => {
      scheduleSafetyRefetch();
    },
  });

  const moveCanvasMutation = useMutation({
    mutationFn: async (options: MoveCanvasOptions) => {
      ensureWorkspaceReady();
      await folderManager.moveCanvas(options);
    },
    onMutate: async ({ canvasId, toFolderId }) => {
      await queryClient.cancelQueries({ queryKey: workspaceKey });
      const previous = queryClient.getQueryData<WorkspacePayload | null>(workspaceKey) || null;
      const now = Date.now();
      if (previous) {
        updateWorkspaceCache(queryClient, workspaceKey, (prev) => {
          const withoutCanvas = removeCanvasFromFolders(prev.folders, canvasId);
          const folders = toFolderId
            ? withoutCanvas.map((folder) =>
                folder.id === toFolderId
                  ? { ...folder, canvasIds: addId(folder.canvasIds, canvasId) }
                  : folder,
              )
            : withoutCanvas;
          const canvases = prev.canvases.map((canvas) =>
            canvas.id === canvasId
              ? { ...canvas, updatedAt: now, folderId: toFolderId ?? null }
              : canvas,
          );
          return { ...prev, folders, canvases };
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workspaceKey, context.previous);
      }
    },
    onSuccess: () => {
      scheduleSafetyRefetch();
    },
  });

  const moveFolderMutation = useMutation({
    mutationFn: async (options: MoveFolderOptions) => {
      ensureWorkspaceReady();
      await folderManager.moveFolder(options);
    },
    onMutate: async ({ folderId, newParentId }) => {
      await queryClient.cancelQueries({ queryKey: workspaceKey });
      const previous = queryClient.getQueryData<WorkspacePayload | null>(workspaceKey) || null;
      const now = Date.now();
      if (previous) {
        updateWorkspaceCache(queryClient, workspaceKey, (prev) => {
          const folders = prev.folders.map((folder) => {
            if (folder.id === folderId) {
              return {
                ...folder,
                parentId: newParentId,
                updatedAt: now,
                level: buildFolderLevel(prev.folders, newParentId ?? null),
              };
            }
            if (folder.childFolderIds.includes(folderId)) {
              return { ...folder, childFolderIds: removeId(folder.childFolderIds, folderId) };
            }
            if (newParentId && folder.id === newParentId) {
              return { ...folder, childFolderIds: addId(folder.childFolderIds, folderId) };
            }
            return folder;
          });
          return { ...prev, folders };
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workspaceKey, context.previous);
      }
    },
    onSuccess: () => {
      scheduleSafetyRefetch();
    },
  });

  return {
    createCanvas: (title: string) =>
      createCanvasMutation.mutateAsync({
        title,
        clientRequestId: makeTempId('req_canvas'),
      }),
    deleteCanvas: deleteCanvasMutation.mutateAsync,
    renameCanvas: renameCanvasMutation.mutateAsync,
    createFolder: (options: { name: string; parentId?: string | null }) =>
      createFolderMutation.mutateAsync({
        ...options,
        clientRequestId: makeTempId('req_folder'),
      }),
    renameFolder: renameFolderMutation.mutateAsync,
    deleteFolder: deleteFolderMutation.mutateAsync,
    moveCanvas: moveCanvasMutation.mutateAsync,
    moveFolder: moveFolderMutation.mutateAsync,
  };
}
