// 📁 文件夹树形容器组件
// 处理拖拽逻辑和树形结构渲染

import React, { useState, useCallback, useRef } from 'react';
import { canvasLog } from '../../../utils/devLogger';
import FolderTreeItem from './FolderTreeItem';
import type { 
  FolderTreeNode, 
  DragItem, 
  DropTarget,
  CreateFolderOptions 
} from '../../../types/folder';

interface FolderTreeProps {
  treeNodes: FolderTreeNode[];
  selectedNodeId: string | null;
  isLoading: boolean;
  enableDragDrop?: boolean;
  compactMode?: boolean;
  flat?: boolean;
  openingNodeId?: string;
  deletingNodeId?: string;
  onNodeSelect: (node: FolderTreeNode) => void;
  onFolderToggle: (folderId: string) => void;
  onFolderCreate: (options: CreateFolderOptions) => Promise<void>;
  onFolderRename: (id: string, newName: string) => Promise<void>;
  onFolderDelete: (id: string) => Promise<void>;
  onCanvasDelete: (id: string) => Promise<void>;
  onDocDelete?: (id: string) => Promise<void>;
  onCanvasMove: (canvasId: string, fromFolderId: string | null, toFolderId: string | null) => Promise<void>;
  onDocMove?: (docId: string, fromFolderId: string | null, toFolderId: string | null) => Promise<void>;
  onFolderMove: (folderId: string, newParentId: string | null) => Promise<void>;
  className?: string;
}

const FolderTree: React.FC<FolderTreeProps> = ({
  treeNodes,
  selectedNodeId,
  isLoading,
  enableDragDrop = true,
  compactMode = false,
  flat = false,
  openingNodeId,
  deletingNodeId,
  onNodeSelect,
  onFolderToggle,
  onFolderCreate,
  onFolderRename,
  onFolderDelete,
  onCanvasDelete,
  onDocDelete,
  onCanvasMove,
  onDocMove,
  onFolderMove,
  className = ''
}) => {
  // 拖拽状态
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const [movingSourceId, setMovingSourceId] = useState<string | null>(null);
  const [movingTargetId, setMovingTargetId] = useState<string | null>(null);
  
  // 📁 Create root folder (moved to outer header; no button here)
  // const handleCreateRootFolder = useCallback(async () => {
  //   setIsCreatingFolder(true);
  //   try {
  //     await onFolderCreate({
  //       name: '新建文件夹',
  //       parentId: null,
  //     });
  //   } catch (error) {
  //     console.error('创建文件夹失败:', error);
  //   }
  //   setIsCreatingFolder(false);
  // }, [onFolderCreate]);
  
  // 📁 创建子文件夹
  const handleCreateSubFolder = useCallback(async (parentId: string | null) => {
    try {
      await onFolderCreate({
        name: 'New Folder',
        parentId,
      });
    } catch (error) {
      console.error('Failed to create subfolder:', error);
    }
  }, [onFolderCreate]);
  
  // ✏️ 重命名节点
  const handleNodeRename = useCallback(async (id: string, newName: string) => {
    try {
      // 根据节点类型调用不同的重命名方法
      const node = treeNodes.find(n => n.id === id);
      if (node?.type === 'folder') {
        await onFolderRename(id, newName);
      }
      // Canvas重命名需要通过Canvas服务处理，这里暂时跳过
    } catch (error) {
      console.error('重命名失败:', error);
    }
  }, [treeNodes, onFolderRename]);
  
  // 🗑️ 删除节点 - 确认逻辑在行内AlertDialog中实现，这里直接执行
  const handleNodeDelete = useCallback(async (id: string, type: 'folder' | 'canvas' | 'doc') => {
    try {
      if (type === 'folder') {
        await onFolderDelete(id);
      } else if (type === 'doc') {
        await onDocDelete?.(id);
      } else {
        await onCanvasDelete(id);
      }
    } catch (error) {
      console.error('删除失败:', error);
    }
  }, [onFolderDelete, onCanvasDelete, onDocDelete]);
  
  // 🎯 拖拽开始
  const handleDragStart = useCallback((item: DragItem) => {
    setDragItem(item);
    console.log('🎯 开始拖拽:', item);
  }, []);
  
  // 🎯 拖拽悬停
  const handleDragOver = useCallback((target: DropTarget, event: React.DragEvent) => {
    event.preventDefault();
    
    if (!dragItem) return;

    // 检查是否可以放置
    const canDrop = target.accept.includes(dragItem.type);
    if (!canDrop) return;

    // 防止拖拽到自己
    if (dragItem.id === target.id) return;

    // 如果是文件夹，检查是否拖拽到子文件夹
    if (dragItem.type === 'folder' && target.type === 'folder') {
      // 这里需要检查层级关系，暂时简单处理
    }

    setDragOverNodeId(target.id);
  }, [dragItem]);
  
  // 🎯 拖拽放置
  const handleDrop = useCallback(async (target: DropTarget, event: React.DragEvent) => {
    event.preventDefault();
    setDragOverNodeId(null);

    if (!dragItem) return;

    // 检查是否可以放置
    const canDrop = target.accept.includes(dragItem.type);
    if (!canDrop) return;

    // 防止拖拽到自己
    if (dragItem.id === target.id) return;

    try {
      setMovingSourceId(dragItem.id);
      setMovingTargetId(target.id);
      if (dragItem.type === 'canvas') {
        // 移动Canvas文件
        await onCanvasMove(
          dragItem.id,
          dragItem.sourceParentId,
          target.id
        );
      } else if (dragItem.type === 'doc') {
        await onDocMove?.(
          dragItem.id,
          dragItem.sourceParentId,
          target.id,
        );
      } else if (dragItem.type === 'folder') {
        // 移动文件夹
        await onFolderMove(
          dragItem.id,
          target.id
        );
      }

      canvasLog.debug('🎯 拖拽完成:', { dragItem, target });
    } catch (error) {
      console.error('拖拽移动失败:', error);
    } finally { setMovingSourceId(null); setMovingTargetId(null); }

    setDragItem(null);
  }, [dragItem, onCanvasMove, onDocMove, onFolderMove]);
  
  // 🎯 处理拖拽到根目录
  const handleDropToRoot = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    setDragOverNodeId(null);

    if (!dragItem) return;

    try {
      setMovingSourceId(dragItem.id);
      setMovingTargetId(null);
      if (dragItem.type === 'canvas') {
        await onCanvasMove(
          dragItem.id,
          dragItem.sourceParentId,
          null // 根目录
        );
      } else if (dragItem.type === 'doc') {
        await onDocMove?.(
          dragItem.id,
          dragItem.sourceParentId,
          null // 根目录
        );
      } else if (dragItem.type === 'folder') {
        await onFolderMove(
          dragItem.id,
          null // 根目录
        );
      }

      canvasLog.debug('🎯 拖拽到根目录:', dragItem);
    } catch (error) {
      console.error('拖拽到根目录失败:', error);
    } finally { setMovingSourceId(null); setMovingTargetId(null); }

    setDragItem(null);
  }, [dragItem, onCanvasMove, onDocMove, onFolderMove]);
  
  // 🎯 拖拽结束清理
  const handleDragEnd = useCallback(() => {
    setDragItem(null);
    setDragOverNodeId(null);
  }, []);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center py-8 ${className}`}>
        <div className="text-sm text-gray-500 dark:text-zinc-400">Loading folders...</div>
      </div>
    );
  }

  return (
    <div
      ref={treeRef}
      className={`relative ${className}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (dragItem) {
          setDragOverNodeId(null); // 根目录高亮
        }
      }}
      onDrop={handleDropToRoot}
      onDragEnd={handleDragEnd}
    >
      {/* 移除顶部工具栏：不显示“文件管理”标题，也不在此处放置按钮 */}

      {/* 文件夹树 */}
      <div
        className={`${dragOverNodeId === null && dragItem ? 'bg-blue-50 dark:bg-zinc-800 border-2 border-dashed border-blue-200 dark:border-zinc-600 rounded-lg' : ''}`}
      >
        {treeNodes.map((node) => (
          <FolderTreeItem
            key={node.id}
            node={node}
            level={flat ? 0 : (node.level ?? 0)}
            isSelected={selectedNodeId === node.id}
            isDragOver={dragOverNodeId === node.id}
            isOpening={openingNodeId === node.id}
            isDeleting={deletingNodeId === node.id}
            isMovingSource={movingSourceId === node.id && movingTargetId === null}
            isMovingTarget={movingTargetId === node.id}
            onSelect={onNodeSelect}
            onToggle={onFolderToggle}
            onCreate={handleCreateSubFolder}
            onRename={handleNodeRename}
            onDelete={handleNodeDelete}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            enableDragDrop={enableDragDrop}
            compactMode={compactMode}
          />
        ))}
      </div>
    </div>
  );
};

export default FolderTree;
