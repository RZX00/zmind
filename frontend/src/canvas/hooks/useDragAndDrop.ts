// 🎯 拖拽管理Hook
// 统一管理画布和文件夹的拖拽操作

import { useState, useCallback } from 'react';
import type { Canvas, CanvasNode } from '../../types/canvas';
import type { Folder } from '../types/folder';

// 🎯 拖拽项目类型
export interface DragItem {
  type: 'canvas' | 'folder';
  id: string;
  data: Canvas | Folder;
  sourceParentId: string | null; // 原始父级ID
}

// 🎯 拖拽状态
export interface DragState {
  isDragging: boolean;
  dragItem: DragItem | null;
  dragOverTarget: string | null; // 当前悬停的目标ID
  dragOverType: 'folder' | 'root' | null; // 目标类型
  showCreateFolderZone: boolean; // 是否显示创建文件夹区域
}

// 🎯 初始状态
const initialDragState: DragState = {
  isDragging: false,
  dragItem: null,
  dragOverTarget: null,
  dragOverType: null,
  showCreateFolderZone: false,
};

// 🎯 拖拽操作接口
export interface DragOperations {
  startDrag: (item: DragItem) => void;
  endDrag: () => void;
  setDragOver: (targetId: string, targetType: 'folder' | 'root') => void;
  clearDragOver: () => void;
  showCreateFolder: () => void;
  hideCreateFolder: () => void;
}

// 🎯 Hook结果接口
export interface UseDragAndDropResult {
  dragState: DragState;
  operations: DragOperations;
}

/**
 * 🎮 拖拽管理Hook
 */
export const useDragAndDrop = (): UseDragAndDropResult => {
  const [dragState, setDragState] = useState<DragState>(initialDragState);

  // 🚀 开始拖拽
  const startDrag = useCallback((item: DragItem) => {
    setDragState(prev => ({
      ...prev,
      isDragging: true,
      dragItem: item,
      showCreateFolderZone: true, // 拖拽开始时显示创建文件夹区域
    }));
  }, []);

  // 🛑 结束拖拽
  const endDrag = useCallback(() => {
    setDragState(initialDragState);
  }, []);

  // 🎯 设置拖拽悬停目标
  const setDragOver = useCallback((targetId: string, targetType: 'folder' | 'root') => {
    setDragState(prev => ({
      ...prev,
      dragOverTarget: targetId,
      dragOverType: targetType,
    }));
  }, []);

  // 🧹 清除拖拽悬停
  const clearDragOver = useCallback(() => {
    setDragState(prev => ({
      ...prev,
      dragOverTarget: null,
      dragOverType: null,
    }));
  }, []);

  // 📁 显示创建文件夹区域
  const showCreateFolder = useCallback(() => {
    setDragState(prev => ({
      ...prev,
      showCreateFolderZone: true,
    }));
  }, []);

  // 🔒 隐藏创建文件夹区域
  const hideCreateFolder = useCallback(() => {
    setDragState(prev => ({
      ...prev,
      showCreateFolderZone: false,
    }));
  }, []);

  // 🎯 操作对象
  const operations: DragOperations = {
    startDrag,
    endDrag,
    setDragOver,
    clearDragOver,
    showCreateFolder,
    hideCreateFolder,
  };

  return {
    dragState,
    operations,
  };
};

// 🛠️ 工具函数：判断拖拽是否有效
export const isValidDrop = (
  dragItem: DragItem,
  targetId: string,
  targetType: 'folder' | 'root'
): boolean => {
  // 不能拖拽到自己
  if (dragItem.id === targetId) {
    return false;
  }
  
  // 不能拖拽文件夹到自己的子文件夹中（避免循环）
  if (dragItem.type === 'folder' && targetType === 'folder') {
    // 这里需要更复杂的逻辑来检查父子关系
    // 暂时允许文件夹拖拽到其他文件夹
    return true;
  }
  
  // 其他情况都允许
  return true;
};

// 🎨 工具函数：获取拖拽预览样式
export const getDragPreviewStyle = (isDragging: boolean) => ({
  opacity: isDragging ? 0.5 : 1,
  cursor: isDragging ? 'grabbing' : 'grab',
  transition: 'opacity 0.2s ease',
});

// 🎯 工具函数：获取拖拽目标样式
export const getDropTargetStyle = (isOver: boolean, isValid: boolean) => ({
  backgroundColor: isOver ? (isValid ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)') : 'transparent',
  borderColor: isOver ? (isValid ? '#3B82F6' : '#EF4444') : 'transparent',
  borderWidth: isOver ? '2px' : '1px',
  borderStyle: 'dashed',
  transition: 'all 0.2s ease',
});