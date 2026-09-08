/**
 * Sidebar File Tree component (shared for ASB)
 * Moved from canvas UnifiedSidebar to a neutral location.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Loader2, Plus } from 'lucide-react';
import { FoldersIcon } from '@/canvas/components/shared/toolbar/FoldersIcon';
import { ChevronsUpDownIcon } from '@/canvas/components/shared/toolbar/ChevronsUpDownIcon';
import { useCanvas } from '@/canvas/hooks/useCanvas';
import { useFolders } from '@/canvas/hooks/useFolders';
import { useWorkspaceMutations } from '@/hooks/react-query/workspace/use-workspace-mutations';
import { useDocMutations } from '@/hooks/react-query/docs/use-doc-mutations';
import FolderTree from '@/canvas/components/shared/folders/FolderTree';
import type { Canvas } from '@/canvas/types/canvas';
import type { FolderTreeNode, CreateFolderOptions } from '@/canvas/types/folder';
import { apiClient } from '@/lib/api-client';

interface SidebarFileTreeProps {
  currentCanvasId?: string;
  currentDocId?: string;
  onCanvasSelect?: (canvas: Canvas) => void;
  onDocSelect?: (itemId: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  pendingCanvasId?: string | null;
  pendingDocId?: string | null;
  className?: string;
  hideHeader?: boolean;
  fullBleed?: boolean;
  flat?: boolean;
  // External data mode (workspace cache)
  externalFolderTree?: FolderTreeNode[];
  externalLoading?: boolean;
  onExternalFolderToggle?: (id: string) => void;
  onRefetch?: () => void;
  onCanvasDeleted?: (id: string) => void;
}

const SidebarFileTree: React.FC<SidebarFileTreeProps> = ({
  currentCanvasId,
  currentDocId,
  onCanvasSelect,
  onDocSelect,
  isCollapsed,
  onToggleCollapse,
  pendingCanvasId = null,
  pendingDocId = null,
  className = '',
  hideHeader = false,
  fullBleed = false,
  flat = false,
  externalFolderTree,
  externalLoading,
  onExternalFolderToggle,
  onRefetch,
  onCanvasDeleted,
}) => {
  const t = useTranslations();
  const {
    allCanvases: canvases,
    isLoading: canvasLoading,
    createCanvas,
    deleteCanvas,
    loadAllCanvases,
  } = useCanvas({ autoLoad: false });

  const {
    folderTree,
    isLoading: folderLoading,
    createFolder,
    updateFolder,
    deleteFolder,
    moveCanvas,
    moveFolder,
    toggleFolder,
    refreshFolders,
  } = useFolders({ autoLoad: !externalFolderTree });
  const {
    createCanvas: createWorkspaceCanvas,
    deleteCanvas: deleteWorkspaceCanvas,
    createFolder: createWorkspaceFolder,
    renameFolder: renameWorkspaceFolder,
    deleteFolder: deleteWorkspaceFolder,
    moveCanvas: moveWorkspaceCanvas,
    moveFolder: moveWorkspaceFolder,
  } = useWorkspaceMutations();
  const { createDoc: createWorkspaceDoc } = useDocMutations();

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [creatingCanvas, setCreatingCanvas] = useState(false);
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [openingNodeId, setOpeningNodeId] = useState<string | null>(null);
  const [deletingNodeId, setDeletingNodeId] = useState<string | null>(null);

  // Initial load of canvases
  useEffect(() => {
    if (externalFolderTree) return;
    loadAllCanvases();
  }, [externalFolderTree, loadAllCanvases]);

  // Node select handler
  const handleNodeSelect = useCallback(
    (node: FolderTreeNode) => {
      setSelectedNodeId(node.id);

      if (node.type === 'canvas' && node.canvas && onCanvasSelect) {
        const targetId = node.canvas.id;
        if (currentCanvasId && currentCanvasId === targetId) {
          return;
        }
        setOpeningNodeId(targetId);
        const canvas = canvases?.find((c) => c.id === targetId);
        if (canvas) {
          onCanvasSelect(canvas);
        } else {
          // Fallback: use minimal canvas info from node to avoid blocking UI
          onCanvasSelect(node.canvas as Canvas);
        }
        return;
      }

      if (node.type === 'doc' && onDocSelect) {
        const targetId = node.doc?.itemId || node.id;
        if (currentDocId && currentDocId === targetId) {
          return;
        }
        setOpeningNodeId(targetId);
        onDocSelect(targetId);
      }
    },
    [canvases, onCanvasSelect, currentCanvasId, onDocSelect, currentDocId],
  );

  // Folder operations
  const handleFolderCreate = useCallback(
    async (options: CreateFolderOptions) => {
      try {
        setCreatingFolder(true);
        if (externalFolderTree) {
          await createWorkspaceFolder({ name: options.name, parentId: options.parentId ?? null });
        } else {
          await createFolder(options, canvases);
          onRefetch?.();
        }
      } catch (error) {
        console.error('Failed to create folder:', error);
      } finally {
        setCreatingFolder(false);
      }
    },
    [externalFolderTree, createWorkspaceFolder, createFolder, canvases, onRefetch],
  );

  const handleFolderRename = useCallback(
    async (id: string, newName: string) => {
      try {
        if (externalFolderTree) {
          await renameWorkspaceFolder({ id, name: newName });
        } else {
          await updateFolder(id, { name: newName }, canvases);
          onRefetch?.();
        }
      } catch (error) {
        console.error('Failed to rename folder:', error);
      }
    },
    [externalFolderTree, renameWorkspaceFolder, updateFolder, canvases, onRefetch],
  );

  const handleFolderDelete = useCallback(
    async (id: string) => {
      try {
        if (externalFolderTree) {
          await deleteWorkspaceFolder({ id, moveCanvasesToParent: true });
        } else {
          await deleteFolder(id, true, canvases);
          onRefetch?.();
        }
      } catch (error) {
        console.error('Failed to delete folder:', error);
      }
    },
    [externalFolderTree, deleteWorkspaceFolder, deleteFolder, canvases, onRefetch],
  );

  const handleCanvasDelete = useCallback(
    async (id: string) => {
      try {
        setDeletingNodeId(id);
        if (externalFolderTree) {
          await deleteWorkspaceCanvas({ id });
        } else {
          await deleteCanvas(id);
          onRefetch?.();
        }
        if (currentCanvasId && currentCanvasId === id) {
          onCanvasDeleted?.(id);
        }
      } catch (error) {
        console.error('Failed to delete canvas:', error);
      } finally {
        setDeletingNodeId(null);
      }
    },
    [externalFolderTree, deleteWorkspaceCanvas, deleteCanvas, onRefetch, currentCanvasId, onCanvasDeleted],
  );

  const handleCanvasMove = useCallback(
    async (canvasId: string, fromFolderId: string | null, toFolderId: string | null) => {
      try {
        if (externalFolderTree) {
          await moveWorkspaceCanvas({ canvasId, fromFolderId, toFolderId });
        } else {
          await moveCanvas({ canvasId, fromFolderId, toFolderId }, canvases);
          onRefetch?.();
        }
      } catch (error) {
        console.error('Failed to move canvas:', error);
      }
    },
    [externalFolderTree, moveWorkspaceCanvas, moveCanvas, canvases, onRefetch],
  );

  const handleDocDelete = useCallback(
    async (id: string) => {
      try {
        setDeletingNodeId(id);
        if (!externalFolderTree) {
          return;
        }
        const response = await apiClient.delete(`/api/items/${id}`, { showErrors: false });
        if (!response.success) {
          throw response.error || new Error('Failed to delete doc');
        }
        onRefetch?.();
      } catch (error) {
        console.error('Failed to delete doc:', error);
      } finally {
        setDeletingNodeId(null);
      }
    },
    [externalFolderTree, onRefetch],
  );

  const handleDocMove = useCallback(
    async (docId: string, _fromFolderId: string | null, toFolderId: string | null) => {
      try {
        if (!externalFolderTree) {
          return;
        }
        const response = await apiClient.post(`/api/items/${docId}/move`, {
          folderId: toFolderId,
          parentItemId: null,
        }, { showErrors: false });
        if (!response.success) {
          throw response.error || new Error('Failed to move doc');
        }
        onRefetch?.();
      } catch (error) {
        console.error('Failed to move doc:', error);
      }
    },
    [externalFolderTree, onRefetch],
  );

  const handleFolderMove = useCallback(
    async (folderId: string, newParentId: string | null) => {
      try {
        if (externalFolderTree) {
          await moveWorkspaceFolder({ folderId, newParentId });
        } else {
          await moveFolder({ folderId, newParentId }, canvases);
          onRefetch?.();
        }
      } catch (error) {
        console.error('Failed to move folder:', error);
      }
    },
    [externalFolderTree, moveWorkspaceFolder, moveFolder, canvases, onRefetch],
  );

  // Create new canvas
  const handleCreateCanvas = useCallback(
    async () => {
      try {
        setCreatingCanvas(true);
        const generateFileName = () => {
          const baseName = t('canvas.untitled', { default: 'Untitled Canvas' });
          if (!canvases || canvases.length === 0) {
            return baseName;
          }

          const existingNames = canvases
            .map((canvas) => canvas.title)
            .filter((title) => title.startsWith(baseName));

          if (existingNames.length === 0) {
            return baseName;
          }

          let maxNumber = 1;
          existingNames.forEach((name) => {
            if (name === baseName) {
              maxNumber = Math.max(maxNumber, 1);
            } else {
              const match = name.match(new RegExp(`^${baseName}(\\s*(\\\d+))$`));
              if (match) {
                maxNumber = Math.max(maxNumber, parseInt(match[2] || match[1]));
              }
            }
          });

          return `${baseName} ${maxNumber + 1}`;
        };

        const newCanvas = externalFolderTree
          ? await createWorkspaceCanvas(generateFileName())
          : await createCanvas(generateFileName());
        if (onCanvasSelect) {
          onCanvasSelect(newCanvas);
        }
        setSelectedNodeId(newCanvas.id);
        if (!externalFolderTree) {
          onRefetch?.();
        }
      } catch (error) {
        console.error('Failed to create canvas:', error);
      } finally {
        setCreatingCanvas(false);
      }
    },
    [canvases, createCanvas, createWorkspaceCanvas, externalFolderTree, onCanvasSelect, onRefetch, t],
  );

  const handleCreateDoc = useCallback(
    async () => {
      if (!onDocSelect) {
        return;
      }

      try {
        setCreatingDoc(true);
        const baseName = t('workspace.doc.untitled', { default: 'Untitled Doc' });
        const existingNames = new Set<string>();

        for (const node of externalFolderTree || []) {
          if (node.type === 'doc' && typeof node.name === 'string' && node.name.trim()) {
            existingNames.add(node.name.trim());
          }
        }

        let nextName = baseName;
        let suffix = 2;
        while (existingNames.has(nextName)) {
          nextName = `${baseName} ${suffix}`;
          suffix += 1;
        }

        const created = await createWorkspaceDoc({
          title: nextName,
          contentMd: '',
        });

        onDocSelect(created.itemId);
        setSelectedNodeId(created.itemId);
        onRefetch?.();
      } catch (error) {
        console.error('Failed to create doc:', error);
      } finally {
        setCreatingDoc(false);
      }
    },
    [createWorkspaceDoc, externalFolderTree, onDocSelect, onRefetch, t],
  );

  // Clear opening spinner when target canvas finishes loading in editor
  useEffect(() => {
    const listener = () => {
      // 任意画布已打开事件触发时，清理打开中的状态，避免残留转圈
      setOpeningNodeId(null);
    };
    try {
      window.addEventListener('canvas:opened', listener as any);
    } catch { }
    return () => {
      try {
        window.removeEventListener('canvas:opened', listener as any);
      } catch { }
    };
  }, []);

  // 兜底：打开指示超过2秒自动清理，避免事件丢失导致的卡住
  useEffect(() => {
    if (!openingNodeId) return;
    const t = setTimeout(() => setOpeningNodeId(null), 2000);
    return () => clearTimeout(t);
  }, [openingNodeId]);

  // Create new root folder
  const handleCreateRootFolder = useCallback(
    async () => {
      try {
        const baseName = 'New Folder';
        const existingNames = new Set<string>();

        // Collect all folder names from flat tree
        if (folderTree) {
          for (const node of folderTree) {
            if (node.type === 'folder') {
              existingNames.add(node.name);
            }
          }
        }

        let name = baseName;
        let i = 2;
        while (existingNames.has(name)) {
          name = `${baseName}${i++}`;
        }

        await handleFolderCreate({ name, parentId: null });
      } catch (error) {
        console.error('Failed to create folder:', error);
      }
    },
    [folderTree, handleFolderCreate],
  );

  // 🔄 Folder Toggle Wrapper
  const handleFolderToggle = useCallback((id: string) => {
    if (externalFolderTree && onExternalFolderToggle) {
      onExternalFolderToggle(id);
    } else {
      toggleFolder(id, canvases);
    }
  }, [externalFolderTree, onExternalFolderToggle, toggleFolder, canvases]);

  // Sync folders when canvases load to prevent double fetch
  useEffect(() => {
    if (externalFolderTree) return;
    if (canvases && canvases.length > 0) {
      // Pass canvases to avoid fetching them again
      refreshFolders(canvases);
    }
  }, [canvases, refreshFolders, externalFolderTree]);

  const treeNodes = externalFolderTree ?? folderTree;
  const loading = externalFolderTree ? externalLoading ?? false : folderLoading || canvasLoading;
  const effectiveOpeningId = pendingCanvasId || pendingDocId || openingNodeId;

  // 当当前打开的画布或文档变化时，同步高亮对应的树节点
  useEffect(() => {
    if (!treeNodes || treeNodes.length === 0) return;
    let node: FolderTreeNode | undefined;
    if (currentCanvasId) {
      node = treeNodes.find((n) => {
        if (n.type !== 'canvas') return false;
        if (n.canvas && n.canvas.id === currentCanvasId) return true;
        return n.id === currentCanvasId;
      });
    }
    if (!node && currentDocId) {
      node = treeNodes.find((n) => {
        if (n.type !== 'doc') return false;
        if (n.doc?.itemId) return n.doc.itemId === currentDocId;
        return n.id === currentDocId;
      });
    }
    if (node && node.id !== selectedNodeId) {
      setSelectedNodeId(node.id);
    }
  }, [currentCanvasId, currentDocId, treeNodes, selectedNodeId]);

  return (
    <div className={`sidebar-file-tree ${fullBleed ? 'full-bleed' : ''} ${className}`}>
      {/* Header (optional) */}
      {!hideHeader && (
        <div className="file-tree-header">
          <div className="flex items-center gap-2">
            <button onClick={onToggleCollapse} className="nav-button" title={isCollapsed ? 'Expand file tree' : 'Collapse file tree'}>
              <ChevronsUpDownIcon size={14} />
            </button>
            <h3 className="file-tree-title">Files</h3>
          </div>

          <div className="file-tree-actions">
            <button
              onClick={handleCreateCanvas}
              className="nav-button tooltip"
              data-tooltip="New Canvas"
              title="New Canvas"
              disabled={creatingCanvas}
            >
              {creatingCanvas ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            </button>

            <button
              onClick={handleCreateDoc}
              className="nav-button tooltip"
              data-tooltip="New Doc"
              title="New Doc"
              disabled={creatingDoc || !onDocSelect}
            >
              {creatingDoc ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            </button>

            <button
              onClick={handleCreateRootFolder}
              className="nav-button tooltip"
              data-tooltip="New Folder"
              title="New Folder"
              disabled={creatingFolder}
            >
              {creatingFolder ? <Loader2 size={14} className="animate-spin" /> : <FoldersIcon size={14} />}
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {!isCollapsed && (
        <div className="file-tree-content">
          <FolderTree
            treeNodes={treeNodes}
            selectedNodeId={selectedNodeId}
            isLoading={loading}
            enableDragDrop={true}
            compactMode={true}
            openingNodeId={effectiveOpeningId || undefined}
            deletingNodeId={deletingNodeId || undefined}
            onNodeSelect={handleNodeSelect}
            onFolderToggle={handleFolderToggle}
            onFolderCreate={handleFolderCreate}
            onFolderRename={handleFolderRename}
            onFolderDelete={handleFolderDelete}
            onCanvasDelete={handleCanvasDelete}
            onDocDelete={handleDocDelete}
            onCanvasMove={handleCanvasMove}
            onDocMove={handleDocMove}
            onFolderMove={handleFolderMove}
            className="h-full"
            {...(flat ? ({ flat: true } as any) : {})}
          />
        </div>
      )}
    </div>
  );
};

export default SidebarFileTree;

