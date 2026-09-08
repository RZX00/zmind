// 📁 文件夹树形项组件
// 支持拖拽、展开折叠、右键菜单等完整交互

import React, { useState, useCallback, useRef } from 'react';
import {
  ChevronRight,
  MoreHorizontal,
  Loader2,
  Folder,
  FolderOpen,
  FileText,
} from 'lucide-react';
import type { FolderTreeNode, DragItem, DropTarget } from '../../../types/folder';
import { UnifiedContextMenu } from '@/components/ui/context-menu';
import { useContextMenuController } from '@/hooks/useContextMenuController';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface FolderTreeItemProps {
  node: FolderTreeNode;
  level: number;
  isSelected: boolean;
  isDragOver: boolean;
  isOpening?: boolean;
  isDeleting?: boolean;
  isMovingSource?: boolean;
  isMovingTarget?: boolean;
  onSelect: (node: FolderTreeNode) => void;
  onToggle: (folderId: string) => void;
  onCreate: (parentId: string | null) => void;
  onRename: (id: string, newName: string) => void;
  onDelete: (id: string, type: 'folder' | 'canvas' | 'doc') => void;
  onDragStart: (item: DragItem) => void;
  onDragOver: (target: DropTarget, event: React.DragEvent) => void;
  onDrop: (target: DropTarget, event: React.DragEvent) => void;
  enableDragDrop?: boolean;
  compactMode?: boolean;
}

const FolderTreeItem: React.FC<FolderTreeItemProps> = ({
  node,
  level,
  isSelected,
  isDragOver,
  isOpening = false,
  isDeleting = false,
  isMovingSource = false,
  isMovingTarget = false,
  onSelect,
  onToggle,
  onCreate,
  onRename,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  enableDragDrop = true,
  compactMode = false
}) => {
  // 状态管理
  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState('');
  const menuCtrl = useContextMenuController();
  const [isDragging, setIsDragging] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  
  const itemRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // 判断是否为文件夹
  const isFolder = node.type === 'folder';
  const isDoc = node.type === 'doc';
  const isExpanded = isFolder && node.isExpanded;
  const hasChildren = isFolder && node.childFolderIds && node.childFolderIds.length > 0;
  const canvasCount = isFolder ? (node.canvasIds?.length || 0) : 0;
  const docCount = isFolder ? (node.docIds?.length || 0) : 0;
  const itemCount = canvasCount + docCount;
  
  // 计算缩进（更接近 VS Code 的 14px 层级步进）
  const indentPx = level * 14;
  
  // 🎨 样式计算
  const itemHeight = compactMode ? 'calc(1em + 12px)' : 'calc(1em + 20px)';
  const itemPadding = compactMode ? '6px 8px' : '10px 10px';
  // 统一字体大小：与侧边栏保持一致的14px
  const fontSizePx = 14;
  
  // 📱 开始重命名
  const startRename = useCallback(() => {
    setEditingName(node.name);
    setIsEditing(true);
    // 关闭右键菜单（统一控制器）
    menuCtrl.close();
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [node.name, menuCtrl]);
  
  // ✅ 确认重命名
  const confirmRename = useCallback(() => {
    const trimmedName = editingName.trim();
    if (trimmedName && trimmedName !== node.name) {
      onRename(node.id, trimmedName);
    }
    setIsEditing(false);
  }, [editingName, node.id, node.name, onRename]);
  
  // ❌ 取消重命名
  const cancelRename = useCallback(() => {
    setIsEditing(false);
    setEditingName('');
  }, []);
  
  // ⌨️ 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }, [confirmRename, cancelRename]);
  
  // 🖱️ 处理点击事件
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (isEditing) return;
    
    // 选中当前项
    onSelect(node);
    
    // 如果是文件夹，处理展开折叠
    if (isFolder && (hasChildren || itemCount > 0)) {
      onToggle(node.id);
    }
  }, [isEditing, onSelect, node, isFolder, hasChildren, itemCount, onToggle]);
  
  // 🎯 拖拽事件处理
  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (!enableDragDrop || isEditing) {
      e.preventDefault();
      return;
    }
    
    setIsDragging(true);
    
    const dragItem: DragItem = {
      type: node.type,
      id: node.id,
      name: node.name,
      sourceParentId: node.parentId,
    };
    
    // 设置拖拽数据
    e.dataTransfer.setData('application/json', JSON.stringify(dragItem));
    e.dataTransfer.effectAllowed = 'move';
    
    onDragStart(dragItem);
  }, [enableDragDrop, isEditing, node, onDragStart]);
  
  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);
  
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!enableDragDrop || !isFolder) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const dropTarget: DropTarget = {
      type: 'folder',
      id: node.id,
      accept: ['canvas', 'folder', 'doc'],
      level: node.level,
    };
    
    onDragOver(dropTarget, e);
  }, [enableDragDrop, isFolder, node, onDragOver]);
  
  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!enableDragDrop || !isFolder) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const dropTarget: DropTarget = {
      type: 'folder',
      id: node.id,
      accept: ['canvas', 'folder', 'doc'],
      level: node.level,
    };
    
    onDrop(dropTarget, e);
  }, [enableDragDrop, isFolder, node, onDrop]);
  
  const iconEl = isFolder ? (
    <span className="relative inline-block w-4 h-4 align-middle">
      <Folder
        size={16}
        className={`absolute top-0 left-0 w-4 h-4 transition-opacity duration-150 ${isExpanded ? 'opacity-0' : 'opacity-100'}`}
      />
      <FolderOpen
        size={16}
        className={`absolute top-0 left-0 w-4 h-4 transition-opacity duration-150 ${isExpanded ? 'opacity-100' : 'opacity-0'}`}
      />
    </span>
  ) : isDoc ? (
    <FileText size={15} className="text-muted-foreground" />
  ) : null;

  const handleArrowClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isFolder && (hasChildren || itemCount > 0)) {
      onToggle(node.id);
    }
  }, [isFolder, hasChildren, itemCount, onToggle, node.id]);
  
  // 删除确认
  const handleConfirmDelete = useCallback(() => {
    onDelete(node.id, node.type);
    setConfirmOpen(false);
  }, [node.id, node.type, onDelete]);
  
  // 计算“父级折叠箭头”的中心X，用于绘制本行左侧竖线
  // 规则：对齐到 (左内边距) + ((level - 1) * 缩进) + (箭头宽度/2)
  const leftPadding = compactMode ? 8 : 10;
  const arrowHalf = 8; // 16px 箭头的一半
  const guideLeft = level > 0 ? leftPadding + (level - 1) * 14 + arrowHalf : 0;

  return (
    <div
      ref={itemRef}
      className={`relative group w-full select-none ${isDragging ? 'opacity-50' : ''}`}
      style={{
        height: itemHeight
      }}
      draggable={enableDragDrop && !isEditing}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* 展开后出现的引导竖线：仅在有父级（level>0）时渲染 */}
      {level > 0 && (
        <span
          className="tree-guide"
          style={{ left: guideLeft }}
        />
      )}

      <div
        className={`
          flex items-center h-full w-full transition-all duration-200 cursor-pointer text-foreground
          ${isSelected 
            ? 'bg-blue-50 border border-blue-200 dark:bg-zinc-800 dark:border-zinc-700' 
            : 'hover:bg-accent/60'}
          ${isDragOver ? 'bg-blue-100 border border-blue-300 dark:bg-zinc-700 dark:border-zinc-500 border-dashed' : ''}
          ${isFolder ? 'font-medium' : 'font-normal'}
        `}
        style={{ 
          padding: itemPadding,
          borderRadius: 'var(--radius-sm)',
          fontSize: `${fontSizePx}px`
        }}
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          menuCtrl.openAtMouseEvent(e, [
            { id: 'delete', label: 'Delete', danger: true, action: () => setConfirmOpen(true) },
          ], { id: node.id, type: node.type });
        }}
      >
        {/* 缩进空间 + 折叠箭头 + 文件/文件夹图标 */}
        <div
          className="flex-shrink-0 flex items-center"
          style={{
            marginLeft: `${indentPx}px`,
            minWidth: iconEl ? 'auto' : '0px'
          }}
        >
          {/* Disclosure arrow (rotates when expanded) */}
          <div className="mr-1 w-4 h-4 flex items-center justify-center text-muted-foreground">
            {isFolder && (hasChildren || canvasCount > 0) ? (
              <button
                type="button"
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                aria-expanded={!!isExpanded}
                className="size-4 flex items-center justify-center transition-transform duration-200 hover:opacity-80"
                onClick={handleArrowClick}
              >
                <ChevronRight
                  size={16}
                  className={`${isExpanded ? 'rotate-90' : 'rotate-0'} transition-transform duration-200`}
                />
              </button>
            ) : (
              <span className="inline-block w-4 h-4" />
            )}
          </div>
          {iconEl && (
            <div
              className={`mr-2 ${isFolder ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {iconEl}
            </div>
          )}
        </div>
        
        {/* 名称区域 */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={confirmRename}
              className="w-full bg-white dark:bg-zinc-900 border border-blue-300 dark:border-zinc-600 rounded px-2 py-1 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ fontSize: '14px' }}
              maxLength={50}
            />
          ) : (
            <div className="truncate" title={typeof node.name === 'string' ? node.name : 'Untitled item'}>
              <span className="truncate">
                {typeof node.name === 'string' ? node.name : 'Untitled item'}
              </span>
              {isFolder && itemCount > 0 && !compactMode && (
                <span className="ml-2 text-xs text-gray-400 dark:text-zinc-500 flex-shrink-0">
                  ({itemCount})
                </span>
              )}
            </div>
          )}
        </div>
        
        {/* 操作按钮 + 右键菜单（与对话历史相同的 DropdownMenu 行为） */}
        {!isEditing && (
          <div className="flex-shrink-0 ml-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const x = rect.left + rect.width;
                const y = rect.top + rect.height;
                menuCtrl.openAtPoint(x, y, [
                  { id: 'delete', label: 'Delete', danger: true, action: () => setConfirmOpen(true) },
                ], { id: node.id, type: node.type });
              }}
              className={`transition-opacity duration-200 p-1 rounded w-6 h-6 flex items-center justify-center ${ (isOpening || isDeleting || isMovingSource || isMovingTarget) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} ${ (isOpening || isDeleting || isMovingSource || isMovingTarget) ? '' : 'hover:bg-accent/60'}`}
              title="More options"
              >
              {(isOpening || isDeleting || isMovingSource || isMovingTarget) ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={14} />}
            </button>
          </div>
        )}
      </div>

      <UnifiedContextMenu state={menuCtrl.state as any} onClose={menuCtrl.close} />
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete item?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default FolderTreeItem;
