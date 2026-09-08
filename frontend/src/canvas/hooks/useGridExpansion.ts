// 🎯 网格展开状态管理Hook
// 管理文件夹在网格视图中的展开/收起状态

import { useState, useCallback, useMemo, useEffect } from 'react';
import type { GridExpandState, GridItem, GridBuildOptions } from '../types/grid-item';
import type { Canvas, CanvasNode } from '../../types/canvas';
import type { Folder } from '../types/folder';
import { buildGridItems, toggleFolderExpansion } from '../utils/gridItemUtils';

// 🎯 Hook选项接口
interface UseGridExpansionOptions {
  folders: Folder[];
  canvases: Canvas[];
  buildOptions?: GridBuildOptions;
  persistKey?: string; // localStorage持久化键名
}

// 🎯 Hook返回接口
interface UseGridExpansionResult {
  // 状态
  expandState: GridExpandState;
  gridItems: GridItem[];
  
  // 操作方法
  toggleFolder: (folderId: string) => void;
  expandFolder: (folderId: string) => void;
  collapseFolder: (folderId: string) => void;
  collapseAll: () => void;
  expandAll: () => void;
  
  // 查询方法
  isExpanded: (folderId: string) => boolean;
  getExpandedFolders: () => string[];
  getExpandedCount: () => number;
}

// 🎯 默认展开状态
const DEFAULT_EXPAND_STATE: GridExpandState = {
  expandedFolders: new Set<string>(),
  expandedLevels: new Map<string, number>(),
};

export const useGridExpansion = (options: UseGridExpansionOptions): UseGridExpansionResult => {
  const { folders, canvases, buildOptions, persistKey } = options;
  
  // 🎯 从localStorage恢复展开状态
  const [expandState, setExpandState] = useState<GridExpandState>(() => {
    if (!persistKey) return DEFAULT_EXPAND_STATE;
    
    try {
      const saved = localStorage.getItem(persistKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          expandedFolders: new Set(parsed.expandedFolders || []),
          expandedLevels: new Map(parsed.expandedLevels || []),
        };
      }
    } catch (error) {
      console.warn('⚠️ 无法恢复网格展开状态:', error);
    }
    
    return DEFAULT_EXPAND_STATE;
  });
  
  // 🎯 持久化展开状态到localStorage
  useEffect(() => {
    if (!persistKey) return;
    
    try {
      const toSave = {
        expandedFolders: Array.from(expandState.expandedFolders),
        expandedLevels: Array.from(expandState.expandedLevels.entries()),
      };
      localStorage.setItem(persistKey, JSON.stringify(toSave));
    } catch (error) {
      console.warn('⚠️ 无法保存网格展开状态:', error);
    }
  }, [expandState, persistKey]);
  
  // 🎯 构建网格项目
  const gridItems = useMemo(() => {
    return buildGridItems(folders, canvases, expandState, buildOptions);
  }, [folders, canvases, expandState, buildOptions]);
  
  // 🎯 切换文件夹展开状态
  const toggleFolder = useCallback((folderId: string) => {
    setExpandState(prevState => toggleFolderExpansion(folderId, prevState));
  }, []);
  
  // 🎯 展开文件夹
  const expandFolder = useCallback((folderId: string) => {
    setExpandState(prevState => {
      if (prevState.expandedFolders.has(folderId)) {
        return prevState; // 已展开，无需操作
      }
      return toggleFolderExpansion(folderId, prevState);
    });
  }, []);
  
  // 🎯 收起文件夹
  const collapseFolder = useCallback((folderId: string) => {
    setExpandState(prevState => {
      if (!prevState.expandedFolders.has(folderId)) {
        return prevState; // 已收起，无需操作
      }
      return toggleFolderExpansion(folderId, prevState);
    });
  }, []);
  
  // 🎯 收起所有文件夹
  const collapseAll = useCallback(() => {
    setExpandState(DEFAULT_EXPAND_STATE);
  }, []);
  
  // 🎯 展开所有文件夹
  const expandAll = useCallback(() => {
    const safeFolders = folders || [];
    const allFolderIds = safeFolders.map(f => f.id);
    const expandedLevels = new Map<string, number>();
    const timestamp = Date.now();
    
    allFolderIds.forEach(id => {
      expandedLevels.set(id, timestamp);
    });
    
    setExpandState({
      expandedFolders: new Set(allFolderIds),
      expandedLevels,
    });
  }, [folders]);
  
  // 🎯 检查文件夹是否展开
  const isExpanded = useCallback((folderId: string) => {
    return expandState.expandedFolders.has(folderId);
  }, [expandState.expandedFolders]);
  
  // 🎯 获取展开的文件夹列表
  const getExpandedFolders = useCallback(() => {
    return Array.from(expandState.expandedFolders);
  }, [expandState.expandedFolders]);
  
  // 🎯 获取展开的文件夹数量
  const getExpandedCount = useCallback(() => {
    return expandState.expandedFolders.size;
  }, [expandState.expandedFolders]);
  
  return {
    expandState,
    gridItems,
    toggleFolder,
    expandFolder,
    collapseFolder,
    collapseAll,
    expandAll,
    isExpanded,
    getExpandedFolders,
    getExpandedCount,
  };
};