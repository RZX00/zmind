// 📁 文件夹管理Hook
// 提供完整的文件夹操作和状态管理

import { useState, useEffect, useCallback } from 'react';
import type {
  Folder,
  FolderTreeNode,
  CreateFolderOptions,
  UpdateFolderOptions,
  MoveCanvasOptions,
  MoveFolderOptions,
  FolderStats
} from '../types/folder';

import { folderManager } from '../services/folder-manager.service';

// 📊 Hook状态接口
export interface UseFoldersState {
  folders: Folder[];
  folderTree: FolderTreeNode[];
  isLoading: boolean;
  error: string | null;
  stats: FolderStats | null;

  // 操作状态
  isCreating: boolean;
  isUpdating: boolean;
  isDeleting: boolean;
  isMoving: boolean;
}

// 🔧 Hook操作接口
export interface UseFoldersActions {
  // 基础CRUD
  createFolder: (options: CreateFolderOptions, canvases?: any[]) => Promise<Folder>;
  updateFolder: (id: string, options: UpdateFolderOptions, canvases?: any[]) => Promise<Folder>;
  deleteFolder: (id: string, moveCanvasesToParent?: boolean, canvases?: any[]) => Promise<void>;

  // 文件夹树操作
  refreshFolders: (canvases?: any[]) => Promise<void>;
  toggleFolder: (id: string, canvases?: any[]) => Promise<void>;
  expandAllFolders: () => Promise<void>;
  collapseAllFolders: () => Promise<void>;

  // 移动操作
  moveCanvas: (options: MoveCanvasOptions, canvases?: any[]) => Promise<void>;
  moveFolder: (options: MoveFolderOptions, canvases?: any[]) => Promise<void>;

  // 工具方法
  findFolderByCanvas: (canvasId: string) => Folder | null;
  getFolderPath: (folderId: string) => Promise<string[]>;
  searchFolders: (query: string) => Promise<Folder[]>;

  // 状态清理
  clearError: () => void;
}

// 🎯 完整Hook返回接口
export interface UseFoldersResult extends UseFoldersState, UseFoldersActions { }

/**
 * useFolders - 文件夹管理Hook
 */
export function useFolders(options: { autoLoad?: boolean } = {}): UseFoldersResult {
  // 📊 状态管理
  const [state, setState] = useState<UseFoldersState>({
    folders: [],
    folderTree: [],
    isLoading: false,
    error: null,
    stats: null,
    isCreating: false,
    isUpdating: false,
    isDeleting: false,
    isMoving: false,
  });

  // 🔄 状态更新辅助函数
  const updateState = useCallback((updates: Partial<UseFoldersState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  // ⚠️ 错误处理
  const handleError = useCallback((error: any, operation: string) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[useFolders] ${operation} 失败:`, error);

    updateState({
      error: errorMessage,
      isLoading: false,
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
      isMoving: false,
    });
  }, [updateState]);

  // 📋 刷新文件夹列表
  const refreshFolders = useCallback(async (canvases?: any[]): Promise<void> => {
    updateState({ isLoading: true, error: null });

    try {
      // 获取所有文件夹 (this is now fast if cached in manager)
      const folders = await folderManager.getAllFolders();

      // 构建文件夹树（包含Canvas文件）
      // 🚀 Optimization: Pass existing canvases if available to avoid refetching
      const folderTree = await folderManager.buildFolderTree(true, canvases);

      // 获取统计信息
      const stats = await folderManager.getStats();

      updateState({
        folders,
        folderTree,
        stats,
        isLoading: false,
      });

    } catch (error) {
      handleError(error, '刷新文件夹列表');
    }
  }, [updateState, handleError]);

  // 📁 创建文件夹
  const createFolder = useCallback(async (
    options: CreateFolderOptions,
    canvases?: any[]
  ): Promise<Folder> => {
    updateState({ isCreating: true, error: null });

    try {
      const newFolder = await folderManager.createFolder(options);

      // 刷新列表
      await refreshFolders(canvases);

      updateState({ isCreating: false });
      return newFolder;
    } catch (error) {
      handleError(error, '创建文件夹');
      throw error;
    }
  }, [updateState, handleError, refreshFolders]);

  // ✏️ 更新文件夹
  const updateFolder = useCallback(async (
    id: string,
    options: UpdateFolderOptions,
    canvases?: any[]
  ): Promise<Folder> => {
    updateState({ isUpdating: true, error: null });

    try {
      const updatedFolder = await folderManager.updateFolder(id, options);

      // 刷新列表
      await refreshFolders(canvases);

      updateState({ isUpdating: false });
      return updatedFolder;
    } catch (error) {
      handleError(error, '更新文件夹');
      throw error;
    }
  }, [updateState, handleError, refreshFolders]);

  // 🗑️ 删除文件夹
  const deleteFolder = useCallback(async (
    id: string,
    moveCanvasesToParent = true,
    canvases?: any[]
  ): Promise<void> => {
    updateState({ isDeleting: true, error: null });

    try {
      await folderManager.deleteFolder(id, moveCanvasesToParent);

      // 刷新列表
      await refreshFolders(canvases);

      updateState({ isDeleting: false });
    } catch (error) {
      handleError(error, '删除文件夹');
      throw error;
    }
  }, [updateState, handleError, refreshFolders]);

  // 🔄 切换文件夹展开状态
  const toggleFolder = useCallback(async (id: string, canvases?: any[]): Promise<void> => {
    try {
      await folderManager.toggleFolder(id);
      // 与工作台渲染保持一致：刷新完整数据（folders + folderTree + stats）
      await refreshFolders(canvases);
    } catch (error) {
      handleError(error, '切换文件夹状态');
    }
  }, [refreshFolders, handleError]);

  // 📊 展开所有文件夹
  const expandAllFolders = useCallback(async (): Promise<void> => {
    try {
      await folderManager.expandAllFolders();
      // 刷新完整数据，确保folders中的isExpanded同步
      await refreshFolders();
    } catch (error) {
      handleError(error, '展开所有文件夹');
    }
  }, [refreshFolders, handleError]);

  // 📊 折叠所有文件夹
  const collapseAllFolders = useCallback(async (): Promise<void> => {
    try {
      await folderManager.collapseAllFolders();
      // 刷新完整数据，确保folders中的isExpanded同步
      await refreshFolders();
    } catch (error) {
      handleError(error, '折叠所有文件夹');
    }
  }, [refreshFolders, handleError]);

  // 🚚 移动Canvas文件
  const moveCanvas = useCallback(async (
    options: MoveCanvasOptions,
    canvases?: any[]
  ): Promise<void> => {
    updateState({ isMoving: true, error: null });

    try {
      await folderManager.moveCanvas(options);

      // 刷新文件夹树
      const folderTree = await folderManager.buildFolderTree(true, canvases);
      updateState({ folderTree, isMoving: false });

      // console.log('📁 [useFolders] Canvas文件已移动');
    } catch (error) {
      handleError(error, '移动Canvas文件');
      throw error;
    }
  }, [updateState, handleError]);

  // 🚚 移动文件夹
  const moveFolder = useCallback(async (
    options: MoveFolderOptions,
    canvases?: any[]
  ): Promise<void> => {
    updateState({ isMoving: true, error: null });

    try {
      await folderManager.moveFolder(options);

      // 刷新列表
      await refreshFolders(canvases);

      updateState({ isMoving: false });
      // console.log('📁 [useFolders] 文件夹已移动');
    } catch (error) {
      handleError(error, '移动文件夹');
      throw error;
    }
  }, [updateState, handleError, refreshFolders]);

  // 🔍 根据Canvas查找文件夹
  const findFolderByCanvas = useCallback((canvasId: string): Folder | null => {
    for (const folder of state.folders) {
      if (folder.canvasIds.includes(canvasId)) {
        return folder;
      }
    }
    return null;
  }, [state.folders]);

  // 📍 获取文件夹路径
  const getFolderPath = useCallback(async (folderId: string): Promise<string[]> => {
    return await folderManager.getFolderPath(folderId);
  }, []);

  // 🔍 搜索文件夹
  const searchFolders = useCallback(async (query: string): Promise<Folder[]> => {
    return await folderManager.searchFolders(query);
  }, []);

  // 🧹 清除错误
  const clearError = useCallback(() => {
    updateState({ error: null });
  }, [updateState]);

  // 🚀 初始化
  useEffect(() => {
    if (options.autoLoad === false) return;
    refreshFolders();
  }, [refreshFolders, options.autoLoad]);

  // 📤 返回Hook结果
  return {
    // 状态
    folders: state.folders,
    folderTree: state.folderTree,
    isLoading: state.isLoading,
    error: state.error,
    stats: state.stats,
    isCreating: state.isCreating,
    isUpdating: state.isUpdating,
    isDeleting: state.isDeleting,
    isMoving: state.isMoving,

    // 操作
    createFolder,
    updateFolder,
    deleteFolder,
    refreshFolders,
    toggleFolder,
    expandAllFolders,
    collapseAllFolders,
    moveCanvas,
    moveFolder,
    findFolderByCanvas,
    getFolderPath,
    searchFolders,
    clearError,
  };
}
