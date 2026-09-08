// 🏢 工作台文件夹状态管理Hook
// 专为横向层级展示设计的完整状态管理

import { useState, useEffect, useCallback, useReducer, useMemo } from 'react';
import type { Canvas, CanvasNode } from '../types/canvas';
import type { Folder } from '../types/folder';
import type { 
  WorkspaceFolderState,
  WorkspaceFolderAction,
  WorkspaceFolderOperations,
  LayerBuildOptions,
  LayerItem,
  DragState
} from '../types/workspace-folder';

import {
  DEFAULT_WORKSPACE_FOLDER_STATE,
  DEFAULT_LAYER_BUILD_OPTIONS
} from '../types/workspace-folder';

import { buildHorizontalLayers, debugLayerStructure } from '../utils/workspaceFolderUtils';
import { folderManager } from '../services/folder-manager.service';
import { canvasManager } from '../services/canvas-manager.service';
import { useCanvas } from './useCanvas';

/**
 * 📊 状态Reducer
 */
const workspaceFolderReducer = (
  state: WorkspaceFolderState,
  action: WorkspaceFolderAction
): WorkspaceFolderState => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    
    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };
    
    case 'SET_DATA':
      return { 
        ...state, 
        allFolders: action.payload.folders,
        allCanvases: action.payload.canvases,
        isLoading: false,
        error: null,
        // 如果payload中有expandedFolders则使用它，否则保持原有状态
        expandedFolders: action.payload.expandedFolders !== undefined 
          ? action.payload.expandedFolders 
          : state.expandedFolders
      };
    
    case 'EXPAND_FOLDER':
      {
        const expandedSet = new Set(state.expandedFolders);
        expandedSet.add(action.payload);
        return {
          ...state,
          expandedFolders: expandedSet
        };
      }
    
    case 'COLLAPSE_FOLDER':
      {
        const collapsedSet = new Set(state.expandedFolders);
        collapsedSet.delete(action.payload);
        return { ...state, expandedFolders: collapsedSet };
      }
    
    case 'SELECT_ITEM':
      return {
        ...state,
        selectedItemId: action.payload?.id || null,
        selectedItemType: action.payload?.type || null
      };
    
    case 'SET_DRAG_STATE':
      return { ...state, dragState: action.payload };
    
    case 'SET_MAX_VISIBLE_LAYERS':
      return { ...state, maxVisibleLayers: action.payload };
    
    default:
      return state;
  }
};

/**
 * 🎯 主Hook接口
 */
export interface UseWorkspaceFoldersResult {
  // 状态
  state: WorkspaceFolderState;
  
  // 操作
  operations: WorkspaceFolderOperations;
  
  // 计算属性
  visibleLayers: WorkspaceFolderState['horizontalLayers'];
  hasData: boolean;
  isEmpty: boolean;
  selectedItem: LayerItem | null;
}

/**
 * 🎮 Hook配置选项
 */
export interface UseWorkspaceFoldersOptions {
  layerBuildOptions?: Partial<LayerBuildOptions>;
  autoLoad?: boolean;
  enableDebug?: boolean;
  persistExpandedState?: boolean;
}

/**
 * 🚀 主Hook函数
 */
export const useWorkspaceFolders = (
  options: UseWorkspaceFoldersOptions = {}
): UseWorkspaceFoldersResult => {
  
  const {
    layerBuildOptions = {},
    autoLoad = true,
    enableDebug = process.env.NODE_ENV === 'development',
    persistExpandedState = true
  } = options;
  
  // 🔧 配置合并 - 使用useMemo避免每次都创建新对象
  const buildOptions = useMemo<LayerBuildOptions>(() => ({
    ...DEFAULT_LAYER_BUILD_OPTIONS,
    ...layerBuildOptions
  }), [layerBuildOptions]);
  
  // 📊 状态管理
  const [state, dispatch] = useReducer(workspaceFolderReducer, {
    ...DEFAULT_WORKSPACE_FOLDER_STATE,
    allFolders: [],
    allCanvases: [],
    horizontalLayers: [],
    // 从localStorage恢复展开状态
    expandedFolders: persistExpandedState ? loadExpandedState() : new Set<string>(),
  });
  
  // 🎨 集成Canvas管理Hook
  const { refreshCanvases } = useCanvas({ autoLoad: false });
  
  // 💾 持久化展开状态 - 使用useMemo优化
  const saveExpandedState = useMemo(() => {
    return (expandedFolders: Set<string>) => {
      if (!persistExpandedState) return;
      
      try {
        localStorage.setItem(
          'workspace_expanded_folders', 
          JSON.stringify(Array.from(expandedFolders))
        );
      } catch (error) {
        console.warn('⚠️ 无法保存文件夹展开状态:', error);
      }
    };
  }, [persistExpandedState]);
  
  // 📊 数据加载
  const loadData = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    
    try {
      
      // 并行加载文件夹和画布数据
      const [folders, canvases] = await Promise.all([
        folderManager.getAllFolders(),
        canvasManager.getAllCanvases()
      ]);
      
      // 🔗 为画布数据建立文件夹关联关系
      const processedCanvases = canvases.map(canvas => {
        // 查找包含此画布的文件夹
        const containingFolder = folders.find(folder => 
          folder.canvasIds.includes(canvas.id)
        );
        
        return {
          ...canvas,
          folderId: containingFolder ? containingFolder.id : null
        };
      });
      
      
      dispatch({ 
        type: 'SET_DATA', 
        payload: { folders, canvases: processedCanvases } 
      });
      
    } catch (error) {
      console.error('❌ [useWorkspaceFolders] 数据加载失败:', error);
      dispatch({ 
        type: 'SET_ERROR', 
        payload: error instanceof Error ? error.message : '加载失败' 
      });
    }
  }, []);
  
  // 🔄 刷新数据 - 稳定化依赖
  const refreshData = useCallback(async () => {
    await loadData();
    if (refreshCanvases) {
      await refreshCanvases();
    }
  }, [loadData, refreshCanvases]);
  
  // 🌳 使用useMemo计算层级数据，避免无限循环
  const computedLayers = useMemo(() => {
    if (state.allFolders.length === 0 && state.allCanvases.length === 0) {
      return [];
    }
    
    return buildHorizontalLayers(
      state.allFolders,
      state.allCanvases,
      state.expandedFolders,
      buildOptions
    );
  }, [state.allFolders, state.allCanvases, state.expandedFolders, buildOptions]);

  // 🔄 直接使用计算出的layers，避免state同步问题
  
  // 📁 文件夹操作
  const createFolder = useCallback(async (name: string, parentId?: string | null) => {
    try {
      const newFolder = await folderManager.createFolder({ name, parentId });
      await refreshData();
      return newFolder;
    } catch (error) {
      console.error('❌ 创建文件夹失败:', error);
      throw error;
    }
  }, [refreshData]);
  
  const renameFolder = useCallback(async (id: string, newName: string) => {
    try {
      await folderManager.updateFolder(id, { name: newName });
      await refreshData();
    } catch (error) {
      console.error('❌ 重命名文件夹失败:', error);
      throw error;
    }
  }, [refreshData]);
  
  const deleteFolder = useCallback(async (id: string) => {
    try {
      // 删除文件夹时，收起其展开状态
      dispatch({ type: 'COLLAPSE_FOLDER', payload: id });
      
      await folderManager.deleteFolder(id, true); // 移动内容到父级
      await refreshData();
    } catch (error) {
      console.error('❌ 删除文件夹失败:', error);
      throw error;
    }
  }, [refreshData]);
  
  // 🎨 画布操作
  const duplicateCanvas = useCallback(async (id: string) => {
    try {
      const originalCanvas = state.allCanvases.find(c => c.id === id);
      if (!originalCanvas) throw new Error('找不到要复制的画布');
      
      const duplicatedCanvas = {
        ...originalCanvas,
        id: `canvas_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        title: `${typeof originalCanvas.title === 'string' ? originalCanvas.title : '未命名画布'} 副本`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        nodes: originalCanvas.nodes ? JSON.parse(JSON.stringify(originalCanvas.nodes)) : [],
        connections: originalCanvas.connections ? JSON.parse(JSON.stringify(originalCanvas.connections)) : [],
      };
      
      await canvasManager.createCanvas(duplicatedCanvas.title, duplicatedCanvas);
      await refreshData();
    } catch (error) {
      console.error('❌ 复制画布失败:', error);
      throw error;
    }
  }, [state.allCanvases, refreshData]);
  
  const deleteCanvas = useCallback(async (id: string) => {
    try {
      await canvasManager.deleteCanvas(id);
      await refreshData();
    } catch (error) {
      console.error('❌ 删除画布失败:', error);
      throw error;
    }
  }, [refreshData]);
  
  const moveCanvas = useCallback(async (
    canvasId: string, 
    fromFolderId: string | null, 
    toFolderId: string | null
  ) => {
    try {
      await folderManager.moveCanvas({ canvasId, fromFolderId, toFolderId });
      await refreshData();
    } catch (error) {
      console.error('❌ 移动画布失败:', error);
      throw error;
    }
  }, [refreshData]);
  
  // 🎮 交互操作
  const expandFolder = useCallback((folderId: string) => {
    dispatch({ type: 'EXPAND_FOLDER', payload: folderId });
  }, []);
  
  const collapseFolder = useCallback((folderId: string) => {
    dispatch({ type: 'COLLAPSE_FOLDER', payload: folderId });
  }, []);
  
  const toggleFolder = useCallback((folderId: string) => {
    if (state.expandedFolders.has(folderId)) {
      dispatch({ type: 'COLLAPSE_FOLDER', payload: folderId });
    } else {
      dispatch({ type: 'EXPAND_FOLDER', payload: folderId });
    }
  }, [state.expandedFolders]);
  
  const selectItem = useCallback((id: string, type: 'folder' | 'canvas') => {
    dispatch({ type: 'SELECT_ITEM', payload: { id, type } });
  }, []);
  
  const clearSelection = useCallback(() => {
    dispatch({ type: 'SELECT_ITEM', payload: null });
  }, []);
  
  // 🎯 拖拽操作
  const handleDragStart = useCallback((item: LayerItem) => {
    const dragState: DragState = {
      dragItem: {
        id: item.id,
        type: item.type,
        name: item.name,
        sourceLayer: item.level,
        sourceParentId: null, // 需要从层级数据中计算
      },
      dragOverItemId: null,
      dragOverLayer: null,
      isValidDrop: false,
    };
    
    dispatch({ type: 'SET_DRAG_STATE', payload: dragState });
  }, []);
  
  const handleDragOver = useCallback((targetId: string, targetLayer: number) => {
    if (!state.dragState) return;
    
    const updatedDragState: DragState = {
      ...state.dragState,
      dragOverItemId: targetId,
      dragOverLayer: targetLayer,
      isValidDrop: true, // 简化验证逻辑
    };
    
    dispatch({ type: 'SET_DRAG_STATE', payload: updatedDragState });
  }, [state.dragState]);
  
  const handleDrop = useCallback(async (targetId: string, targetType: 'folder' | 'root') => {
    if (!state.dragState) return;
    
    const { dragItem } = state.dragState;
    const targetFolderId = targetType === 'root' ? null : targetId;
    
    try {
      if (dragItem.type === 'canvas') {
        await moveCanvas(dragItem.id, dragItem.sourceParentId, targetFolderId);
      } else if (dragItem.type === 'folder') {
        await folderManager.moveFolder({ 
          folderId: dragItem.id, 
          newParentId: targetFolderId 
        });
        await refreshData();
      }
    } catch (error) {
      console.error('❌ 拖拽移动失败:', error);
    }
    
    // 清空拖拽状态
    dispatch({ type: 'SET_DRAG_STATE', payload: null });
  }, [state.dragState, moveCanvas, refreshData]);
  
  const handleDragEnd = useCallback(() => {
    dispatch({ type: 'SET_DRAG_STATE', payload: null });
  }, []);
  
  // 🎨 视图操作
  const setMaxVisibleLayers = useCallback((count: number) => {
    dispatch({ type: 'SET_MAX_VISIBLE_LAYERS', payload: count });
  }, []);
  
  const collapseAllFolders = useCallback(() => {
    // 直接重置展开状态更加高效
    dispatch({ type: 'SET_DATA', payload: { 
      folders: state.allFolders, 
      canvases: state.allCanvases,
      expandedFolders: new Set()
    }});
  }, [state.allFolders, state.allCanvases]);
  
  const expandAllFolders = useCallback(() => {
    // 使用SET_DATA一次性设置所有文件夹为展开状态
    const allFolderIds = new Set(state.allFolders.map(folder => folder.id));
    dispatch({ type: 'SET_DATA', payload: { 
      folders: state.allFolders, 
      canvases: state.allCanvases,
      expandedFolders: allFolderIds
    }});
  }, [state.allFolders, state.allCanvases]);
  
  // 🔄 副作用：自动加载数据
  useEffect(() => {
    if (autoLoad) {
      loadData();
    }
  }, [autoLoad, loadData]);
  
  
  // 🔄 副作用：持久化展开状态
  useEffect(() => {
    if (persistExpandedState) {
      saveExpandedState(state.expandedFolders);
    }
  }, [state.expandedFolders, saveExpandedState, persistExpandedState]);
  
  // 📊 计算属性 - 直接使用computedLayers
  const visibleLayers = useMemo(() => {
    return computedLayers.slice(0, state.maxVisibleLayers);
  }, [computedLayers, state.maxVisibleLayers]);
  
  const hasData = useMemo(() => {
    return state.allFolders.length > 0 || state.allCanvases.length > 0;
  }, [state.allFolders.length, state.allCanvases.length]);
  
  const isEmpty = useMemo(() => {
    return !hasData && !state.isLoading;
  }, [hasData, state.isLoading]);
  
  const selectedItem = useMemo(() => {
    if (!state.selectedItemId) return null;
    
    for (const layer of computedLayers) {
      const item = layer.items.find(item => item.id === state.selectedItemId);
      if (item) return item;
    }
    
    return null;
  }, [state.selectedItemId, computedLayers]);
  
  // 🎯 操作对象
  const operations: WorkspaceFolderOperations = {
    loadData,
    refreshData,
    createFolder,
    renameFolder,
    deleteFolder,
    duplicateCanvas,
    deleteCanvas,
    moveCanvas,
    expandFolder,
    collapseFolder,
    toggleFolder,
    selectItem,
    clearSelection,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    setMaxVisibleLayers,
    collapseAllFolders,
    expandAllFolders,
  };
  
  return {
    state,
    operations,
    visibleLayers,
    hasData,
    isEmpty,
    selectedItem,
  };
};

// 🛠️ 工具函数：加载展开状态
function loadExpandedState(): Set<string> {
  try {
    const saved = localStorage.getItem('workspace_expanded_folders');
    if (saved) {
      const ids = JSON.parse(saved) as string[];
      return new Set<string>(ids);
    }
  } catch (error) {
    console.warn('⚠️ 无法加载文件夹展开状态:', error);
  }
  
  return new Set<string>();
}
