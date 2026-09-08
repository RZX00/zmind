import type { WorkspaceCanvas, WorkspacePayload } from '@/hooks/useWorkspaceData';
import type { Folder } from '@/canvas/types/folder';

export type WorkspaceChange = {
  entity: 'canvas' | 'folder' | 'item' | 'doc' | 'reference';
  action: 'create' | 'update' | 'delete' | 'move';
  data: any;
};

export type WorkspacePatchMessage = {
  type: 'workspace_patch';
  version: number;
  ts?: number;
  workspaceId?: string;
  actorId?: string;
  requestId?: string;
  changes: WorkspaceChange[];
};

const cloneFolder = (folder: Folder): Folder => ({
  ...folder,
  canvasIds: Array.isArray(folder.canvasIds) ? [...folder.canvasIds] : [],
  childFolderIds: Array.isArray(folder.childFolderIds) ? [...folder.childFolderIds] : [],
});

const cloneCanvas = (canvas: WorkspaceCanvas): WorkspaceCanvas => ({
  ...canvas,
});

const buildLevel = (folderMap: Map<string, Folder>, folderId: string | null): number => {
  if (!folderId) return 0;
  let level = 0;
  let current: string | null = folderId;
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

const removeId = (items: string[], id: string) => items.filter((item) => item !== id);
const addId = (items: string[], id: string) => (items.includes(id) ? items : [...items, id]);

export const applyWorkspacePatch = (
  prev: WorkspacePayload,
  patch: WorkspacePatchMessage,
): { next: WorkspacePayload; applied: boolean; needsRefetch: boolean } => {
  if (!patch || !Array.isArray(patch.changes) || typeof patch.version !== 'number') {
    return { next: prev, applied: false, needsRefetch: true };
  }

  if (typeof prev.version === 'number') {
    if (patch.version <= prev.version) {
      return { next: prev, applied: false, needsRefetch: false };
    }
    if (patch.version > prev.version + 1) {
      return { next: prev, applied: false, needsRefetch: true };
    }
  }

  const folderMap = new Map<string, Folder>();
  prev.folders.forEach((folder) => folderMap.set(folder.id, cloneFolder(folder)));

  const canvasMap = new Map<string, WorkspaceCanvas>();
  prev.canvases.forEach((canvas) => canvasMap.set(canvas.id, cloneCanvas(canvas)));

  const ensureFolder = (folderId: string, fallback?: Partial<Folder>) => {
    if (folderMap.has(folderId)) return folderMap.get(folderId)!;
    const now = Date.now();
    const fresh: Folder = {
      id: folderId,
      name: fallback?.name || 'New Folder',
      parentId: fallback?.parentId ?? null,
      canvasIds: Array.isArray(fallback?.canvasIds) ? fallback?.canvasIds : [],
      childFolderIds: Array.isArray(fallback?.childFolderIds) ? fallback?.childFolderIds : [],
      level: typeof fallback?.level === 'number' ? fallback.level : 0,
      isExpanded: Boolean(fallback?.isExpanded),
      createdAt: typeof fallback?.createdAt === 'number' ? fallback.createdAt : now,
      updatedAt: typeof fallback?.updatedAt === 'number' ? fallback.updatedAt : now,
      sortOrder: typeof fallback?.sortOrder === 'number' ? fallback.sortOrder : 0,
      clientRequestId: (fallback as any)?.clientRequestId,
    };
    folderMap.set(folderId, fresh);
    return fresh;
  };

  const removeCanvasFromFolders = (canvasId: string) => {
    for (const folder of folderMap.values()) {
      if (folder.canvasIds.includes(canvasId)) {
        folder.canvasIds = removeId(folder.canvasIds, canvasId);
      }
    }
  };

  const removeFolderFromParents = (folderId: string) => {
    for (const folder of folderMap.values()) {
      if (folder.childFolderIds.includes(folderId)) {
        folder.childFolderIds = removeId(folder.childFolderIds, folderId);
      }
    }
  };

  for (const change of patch.changes) {
    if (!change || !change.entity) continue;
    if (change.entity === 'canvas') {
      const data = change.data || {};
      if (change.action === 'create') {
        const existingTemp = data.clientRequestId
          ? Array.from(canvasMap.values()).find((canvas) =>
              canvas.clientRequestId && canvas.clientRequestId === data.clientRequestId,
            )
          : undefined;
        const merged = {
          ...(existingTemp || {}),
          ...data,
        } as WorkspaceCanvas;
        if (existingTemp) {
          canvasMap.delete(existingTemp.id);
        }
        if (!merged.id && data.id) merged.id = data.id;
        if (merged.id) {
          canvasMap.set(merged.id, merged);
        }
        if (data.folderId) {
          const targetFolder = ensureFolder(data.folderId as string);
          targetFolder.canvasIds = addId(targetFolder.canvasIds, data.id);
        }
      } else if (change.action === 'update') {
        if (!data.id) continue;
        const existing = canvasMap.get(data.id);
        const next = { ...(existing || {}), ...data } as WorkspaceCanvas;
        canvasMap.set(data.id, next);
        if ('folderId' in data) {
          const existingFolderId = existing?.folderId ?? null;
          const nextFolderId = data.folderId ?? null;
          if (existingFolderId !== nextFolderId) {
            removeCanvasFromFolders(data.id);
            if (nextFolderId) {
              const targetFolder = ensureFolder(nextFolderId as string);
              targetFolder.canvasIds = addId(targetFolder.canvasIds, data.id);
            }
          }
        }
      } else if (change.action === 'move') {
        if (!data.id) continue;
        removeCanvasFromFolders(data.id);
        if (data.toFolderId) {
          const targetFolder = ensureFolder(data.toFolderId as string);
          targetFolder.canvasIds = addId(targetFolder.canvasIds, data.id);
        }
        const existing = canvasMap.get(data.id);
        if (existing) {
          canvasMap.set(data.id, { ...existing, folderId: data.toFolderId ?? null });
        }
      } else if (change.action === 'delete') {
        if (!data.id) continue;
        canvasMap.delete(data.id);
        removeCanvasFromFolders(data.id);
      }
    }

    if (change.entity === 'folder') {
      const data = change.data || {};
      if (change.action === 'create') {
        if (!data.id) continue;
        const existingTemp = data.clientRequestId
          ? Array.from(folderMap.values()).find((folder) =>
              (folder as any).clientRequestId === data.clientRequestId,
            )
          : undefined;
        const merged = { ...(existingTemp || {}), ...data } as Folder;
        if (existingTemp) {
          folderMap.delete(existingTemp.id);
        }
        if (!merged.id && data.id) merged.id = data.id;
        if (merged.id) {
          const folder = cloneFolder(merged);
          folderMap.set(merged.id, folder);
          if (folder.parentId) {
            const parent = ensureFolder(folder.parentId);
            parent.childFolderIds = addId(parent.childFolderIds, folder.id);
          }
        }
      } else if (change.action === 'update') {
        if (!data.id) continue;
        const existing = ensureFolder(data.id, data);
        const oldParentId = typeof data.oldParentId === 'string' ? data.oldParentId : existing.parentId ?? null;
        const next = { ...existing, ...data } as Folder;
        if (next.parentId !== oldParentId) {
          if (oldParentId) {
            const oldParent = ensureFolder(oldParentId);
            oldParent.childFolderIds = removeId(oldParent.childFolderIds, next.id);
          }
          if (next.parentId) {
            const newParent = ensureFolder(next.parentId);
            newParent.childFolderIds = addId(newParent.childFolderIds, next.id);
          }
        }
        if (typeof next.level !== 'number') {
          next.level = buildLevel(folderMap, next.parentId ?? null);
        }
        folderMap.set(next.id, cloneFolder(next));
      } else if (change.action === 'move') {
        if (!data.id) continue;
        const existing = ensureFolder(data.id);
        const oldParentId = data.oldParentId ?? existing.parentId ?? null;
        const newParentId = data.newParentId ?? null;
        if (oldParentId) {
          const oldParent = ensureFolder(oldParentId);
          oldParent.childFolderIds = removeId(oldParent.childFolderIds, data.id);
        }
        if (newParentId) {
          const newParent = ensureFolder(newParentId);
          newParent.childFolderIds = addId(newParent.childFolderIds, data.id);
        }
        const updated = { ...existing, parentId: newParentId } as Folder;
        updated.level = buildLevel(folderMap, newParentId);
        folderMap.set(updated.id, cloneFolder(updated));
      } else if (change.action === 'delete') {
        if (!data.id) continue;
        const target = folderMap.get(data.id);
        const parentId = data.parentId ?? target?.parentId ?? null;
        if (parentId) {
          const parent = ensureFolder(parentId);
          parent.childFolderIds = removeId(parent.childFolderIds, data.id);
        }
        folderMap.delete(data.id);
        const moveCanvases = data.moveCanvasesToParent ?? true;
        const canvasIds: string[] = Array.isArray(data.canvasIds)
          ? data.canvasIds
          : target?.canvasIds || [];
        if (moveCanvases && canvasIds.length > 0) {
          if (parentId) {
            const parent = ensureFolder(parentId);
            parent.canvasIds = Array.from(new Set([...parent.canvasIds, ...canvasIds]));
          }
          canvasIds.forEach((canvasId) => {
            const existing = canvasMap.get(canvasId);
            if (existing) {
              canvasMap.set(canvasId, { ...existing, folderId: parentId });
            }
          });
        }
        removeFolderFromParents(data.id);
      }
    }
  }

  const prevCanvasIds = new Set(prev.canvases.map((canvas) => canvas.id));
  const prevFolderIds = new Set(prev.folders.map((folder) => folder.id));

  const nextCanvases: WorkspaceCanvas[] = [];
  prev.canvases.forEach((canvas) => {
    const next = canvasMap.get(canvas.id);
    if (next) nextCanvases.push(next);
  });
  for (const [id, canvas] of canvasMap.entries()) {
    if (!prevCanvasIds.has(id)) nextCanvases.push(canvas);
  }

  const nextFolders: Folder[] = [];
  prev.folders.forEach((folder) => {
    const next = folderMap.get(folder.id);
    if (next) nextFolders.push(next);
  });
  for (const [id, folder] of folderMap.entries()) {
    if (!prevFolderIds.has(id)) nextFolders.push(folder);
  }

  const nextPayload: WorkspacePayload = {
    ...prev,
    canvases: nextCanvases,
    folders: nextFolders,
    version: patch.version,
    generatedAt: typeof patch.ts === 'number' ? patch.ts : Date.now(),
  };

  return { next: nextPayload, applied: true, needsRefetch: false };
};
