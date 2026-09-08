// 🎨 统一Canvas Hook - 替代所有分散的Canvas相关Hook
// 提供完整的Canvas数据访问和状态管理功能

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Canvas, CanvasNode } from '../../types/canvas';
import type { CanvasVersion, CreateCanvasData, UpdateCanvasData } from '../types/canvas-repository';
import { canvasManager } from '../services/canvas-manager.service';
import type { CanvasManagerEventData } from '../services/canvas-manager.service';
import { CanvasIdManager } from '../utils/canvasIdUtils';
import { useWorkspace } from '@/contexts/workspace-context';
import { useAuth } from '@/components/AuthProvider';
import { useWorkspaceWs } from '@/canvas/hooks/useWorkspaceWs';
import { CanvasRepositoryError } from '../types/canvas-repository';

// 🎯 Hook配置选项
export interface UseCanvasConfig {
  autoLoad?: boolean;           // 是否自动加载所有画布
  enableAutoSave?: boolean;     // 是否启用自动保存
  autoSaveInterval?: number;    // 自动保存间隔（毫秒）
  enableEventLogging?: boolean; // 是否启用事件日志
}

// 📊 Hook状态接口
export interface UseCanvasState {
  // 数据状态
  currentCanvas: Canvas | null;
  allCanvases: Canvas[];
  isLoading: boolean;
  error: string | null;
  isRepositoryHealthy: boolean;
  
  // 操作状态
  isSaving: boolean;
  isCreating: boolean;
  isDeleting: boolean;
  lastSavedAt: Date | null;
  
  // 版本相关
  versions: CanvasVersion[];
  isLoadingVersions: boolean;
}

// 🔧 Hook操作接口
export interface UseCanvasActions {
  // 基础Canvas操作
  createCanvas: (title: string, initialData?: Partial<Canvas>) => Promise<Canvas>;
  loadCanvas: (id: string) => Promise<Canvas>;
  updateCanvas: (id: string, updates: Partial<Canvas>) => Promise<Canvas>;
  deleteCanvas: (id: string) => Promise<void>;
  
  // 批量操作
  loadAllCanvases: (options?: { force?: boolean }) => Promise<void>;
  refreshCanvases: () => Promise<void>;
  
  // 版本管理
  saveVersion: (id: string, description?: string) => Promise<CanvasVersion>;
  loadVersions: (canvasId: string) => Promise<void>;
  restoreVersion: (versionId: string) => Promise<Canvas>;
  
  // 导入导出
  exportData: () => Promise<{ canvases: Canvas[]; versions: CanvasVersion[] }>;
  importData: (data: { canvases: Canvas[]; versions: CanvasVersion[] }) => Promise<void>;
  
  // 状态管理
  clearError: () => void;
  setCurrentCanvas: (canvas: Canvas | null) => void;
}

// 🎯 完整Hook返回接口
export interface UseCanvasResult extends UseCanvasState, UseCanvasActions {}

/**
 * useCanvas - 统一Canvas数据访问Hook
 * 
 * 替代所有现有的Canvas相关Hook：
 * - useCanvasDatabase -> useCanvas
 * - useCanvasFileManager -> useCanvas  
 * - 其他Canvas相关Hook -> useCanvas
 * 
 * 提供统一的数据访问、状态管理、错误处理
 */
export function useCanvas(config: UseCanvasConfig = {}): UseCanvasResult {
  // 📊 状态管理
  const [state, setState] = useState<UseCanvasState>({
    currentCanvas: null,
    allCanvases: [],
    isLoading: false,
    error: null,
    isRepositoryHealthy: true,
    isSaving: false,
    isCreating: false,
    isDeleting: false,
    lastSavedAt: null,
    versions: [],
    isLoadingVersions: false,
  });
  const { workspaceId, isReady: isWorkspaceReady } = useWorkspace();
  const { user } = useAuth();
  const repositoryHealthyRef = useRef(true);
  
  // 🎯 配置处理
  const hookConfig = {
    autoLoad: true,
    enableAutoSave: true,
    autoSaveInterval: 3000,
    enableEventLogging: false,
    ...config,
  };
  
  // 📝 内部状态引用
  const stateRef = useRef(state);
  stateRef.current = state;
  
  // 🔄 状态更新辅助函数
  const updateState = useCallback((updates: Partial<UseCanvasState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  const setRepositoryHealth = useCallback((healthy: boolean) => {
    if (repositoryHealthyRef.current === healthy) {
      if (!healthy) {
        updateState({ isRepositoryHealthy: healthy });
      }
      return;
    }
    repositoryHealthyRef.current = healthy;
    updateState({ isRepositoryHealthy: healthy });
  }, [updateState]);
  
  // ⚠️ 错误处理
  const handleError = useCallback((error: any, operation: string) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[useCanvas] ${operation} 失败:`, error);
    if (error instanceof CanvasRepositoryError && error.code === 'NETWORK_ERROR') {
      setRepositoryHealth(false);
    }
    
    updateState({
      error: errorMessage,
      isLoading: false,
      isSaving: false,
      isCreating: false,
      isDeleting: false,
      isLoadingVersions: false,
      isRepositoryHealthy: repositoryHealthyRef.current,
    });
  }, [setRepositoryHealth, updateState]);

  const markRepositoryHealthy = useCallback(() => {
    setRepositoryHealth(true);
  }, [setRepositoryHealth]);
  
  // 🆔 使用统一ID生成工具
  const generateId = useCallback(() => {
    return CanvasIdManager.generate();
  }, []);
  
  // ================== 基础Canvas操作 ==================
  
  /**
   * 创建新画布
   */
  const createCanvas = useCallback(async (
    title: string, 
    initialData?: Partial<Canvas>
  ): Promise<Canvas> => {
    if (!workspaceId) {
      const error = new Error('工作区尚未初始化，请稍候重试');
      updateState({ isCreating: false, error: error.message });
      throw error;
    }
    updateState({ isCreating: true, error: null });
    
    try {
      // 🆔 只生成一次ID，确保整个流程使用同一个ID
      const canvasId = generateId();
      console.log('🆔 [useCanvas] 创建Canvas，使用ID:', canvasId);
      
      const canvasData: Canvas = {
        id: canvasId,
        title,
        nodes: initialData?.nodes || [],
        connections: initialData?.connections || [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: '1.0.0',
        ...initialData,
      };
      
      const newCanvas = await canvasManager.createCanvas(title, canvasData);
      
      updateState({
        currentCanvas: newCanvas,
        allCanvases: [...stateRef.current.allCanvases, newCanvas],
        isCreating: false,
      });
      markRepositoryHealthy();
      
      return newCanvas;
    } catch (error) {
      handleError(error, '创建画布');
      throw error;
    }
  }, [generateId, handleError, markRepositoryHealthy, updateState, workspaceId]);
  
  /**
   * 加载画布
   */
  const loadCanvas = useCallback(async (id: string): Promise<Canvas> => {
    updateState({ isLoading: true, error: null });

    try {
      const canvas = await canvasManager.getCanvas(id);
      
      if (!canvas) {
        throw new Error('画布不存在');
      }
      
      updateState({
        currentCanvas: canvas,
        isLoading: false,
      });
      markRepositoryHealthy();
      
      return canvas;
    } catch (error) {
      handleError(error, '加载画布');
      throw error;
    }
  }, [handleError, markRepositoryHealthy, updateState]);


  /**
   * 更新画布
   */
  const updateCanvas = useCallback(async (
    id: string, 
    updates: Partial<Canvas>
  ): Promise<Canvas> => {
    updateState({ isSaving: true, error: null });
    
    try {
      const updated = await canvasManager.updateCanvas(id, {
        title: updates.title,
        nodes: updates.nodes,
        connections: updates.connections,
        version: updates.version,
      });
      
      // 更新本地状态
      const updatedCanvases = stateRef.current.allCanvases.map(c => 
        c.id === id ? updated : c
      );
      
      updateState({
        currentCanvas: stateRef.current.currentCanvas?.id === id ? updated : stateRef.current.currentCanvas,
        allCanvases: updatedCanvases,
        isSaving: false,
        lastSavedAt: new Date(),
      });
      markRepositoryHealthy();
      
      return updated;
    } catch (error) {
      handleError(error, '更新画布');
      throw error;
    }
  }, [handleError, markRepositoryHealthy, updateState]);
  
  /**
   * 删除画布
   */
  const deleteCanvas = useCallback(async (id: string): Promise<void> => {
    updateState({ isDeleting: true, error: null });
    
    try {
      await canvasManager.deleteCanvas(id);
      
      const filteredCanvases = stateRef.current.allCanvases.filter(c => c.id !== id);
      const newCurrentCanvas = stateRef.current.currentCanvas?.id === id ? null : stateRef.current.currentCanvas;
      
      updateState({
        currentCanvas: newCurrentCanvas,
        allCanvases: filteredCanvases,
        isDeleting: false,
      });
      markRepositoryHealthy();
    } catch (error) {
      handleError(error, '删除画布');
      throw error;
    }
  }, [handleError, markRepositoryHealthy, updateState]);
  
  // ================== 批量操作 ==================
  
  /**
   * 加载所有画布
   */
  const loadAllCanvases = useCallback(async (options?: { force?: boolean }): Promise<void> => {
    const force = options?.force ?? false;
    if (!workspaceId || !isWorkspaceReady) {
      updateState({ isLoading: false });
      return;
    }
    if (!force && !repositoryHealthyRef.current) {
      return;
    }
    updateState({ isLoading: true, error: null });
    
    try {
      const canvases = await canvasManager.getAllCanvases({
        orderBy: 'updated_at',
        orderDirection: 'desc',
      });
      
      updateState({
        allCanvases: canvases,
        isLoading: false,
      });
      markRepositoryHealthy();
    } catch (error) {
      handleError(error, '加载画布列表');
    }
  }, [handleError, isWorkspaceReady, markRepositoryHealthy, updateState, workspaceId]);

  const applyWorkspaceCanvasPatch = useCallback((changes: any[]): boolean => {
    if (!Array.isArray(changes) || changes.length === 0) return false;

    const prev = stateRef.current.allCanvases;
    let next = prev;
    let changed = false;

    const current = stateRef.current.currentCanvas;
    let nextCurrent = current;
    let currentChanged = false;

    const ensureCopy = () => {
      if (next === prev) next = [...prev];
    };

    const normalizeCanvas = (data: any): Canvas => ({
      id: data.id,
      title: typeof data.title === 'string' ? data.title : 'Untitled Canvas',
      nodes: [],
      connections: [],
      nodeCount: typeof data.nodeCount === 'number' ? data.nodeCount : undefined,
      createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
      version: typeof data.version === 'string' ? data.version : '1.0.0',
      folderId: data.folderId ?? null,
    });

    const mergeCanvas = (existing: Canvas, data: any): Canvas => {
      const merged: Canvas = { ...existing, ...data };
      if (!Array.isArray(merged.nodes)) merged.nodes = existing.nodes || [];
      if (!Array.isArray(merged.connections)) merged.connections = existing.connections || [];
      if (typeof merged.title !== 'string') merged.title = existing.title;
      if (typeof merged.createdAt !== 'number') merged.createdAt = existing.createdAt;
      if (typeof merged.updatedAt !== 'number') merged.updatedAt = existing.updatedAt;
      if (typeof merged.version !== 'string') merged.version = existing.version;
      return merged;
    };

    const updateCurrent = (data: any) => {
      if (!nextCurrent || !data?.id || nextCurrent.id !== data.id) return;
      nextCurrent = mergeCanvas(nextCurrent, data);
      currentChanged = true;
    };

    for (const change of changes) {
      if (!change || change.entity !== 'canvas') continue;
      const data = change.data || {};
      if (!data.id) continue;

      if (change.action === 'create') {
        const idx = next.findIndex((c) => c.id === data.id);
        if (idx >= 0) {
          ensureCopy();
          next[idx] = mergeCanvas(next[idx], data);
        } else {
          ensureCopy();
          next = [normalizeCanvas(data), ...next];
        }
        changed = true;
        updateCurrent(data);
      } else if (change.action === 'update') {
        const idx = next.findIndex((c) => c.id === data.id);
        if (idx >= 0) {
          ensureCopy();
          next[idx] = mergeCanvas(next[idx], data);
        } else {
          ensureCopy();
          next = [normalizeCanvas(data), ...next];
        }
        changed = true;
        updateCurrent(data);
      } else if (change.action === 'move') {
        const idx = next.findIndex((c) => c.id === data.id);
        if (idx >= 0) {
          ensureCopy();
          next[idx] = { ...next[idx], folderId: data.toFolderId ?? null };
          changed = true;
        }
        updateCurrent({ id: data.id, folderId: data.toFolderId ?? null });
      } else if (change.action === 'delete') {
        const filtered = next.filter((c) => c.id !== data.id);
        if (filtered.length !== next.length) {
          next = filtered;
          changed = true;
        }
        if (current && current.id === data.id) {
          nextCurrent = null;
          currentChanged = true;
        }
      }
    }

    if (changed || currentChanged) {
      updateState({
        allCanvases: changed ? next : prev,
        currentCanvas: currentChanged ? nextCurrent : current,
      });
      return true;
    }
    return false;
  }, [updateState]);

  const handleWorkspaceMessage = useCallback((message: any) => {
    if (!message) return;
    if (!repositoryHealthyRef.current) return;
    if (message.type === 'canvas_updated') {
      if (message.workspaceId && workspaceId && message.workspaceId !== workspaceId) return;
      const activeCanvas = stateRef.current.currentCanvas;
      if (!activeCanvas || message.canvasId !== activeCanvas.id) return;
      if (message.updatedBy && user?.id && message.updatedBy === user.id) {
        return;
      }
      loadCanvas(message.canvasId).catch(() => {});
    } else if (message.type === 'workspace_patch') {
      if (message.workspaceId && workspaceId && message.workspaceId !== workspaceId) return;
      applyWorkspaceCanvasPatch(message.changes || []);
    } else if (message.type === 'workspace_updated') {
      if (stateRef.current.allCanvases.length === 0) {
        loadAllCanvases().catch(() => {});
      }
    }
  }, [workspaceId, loadCanvas, loadAllCanvases, user?.id, applyWorkspaceCanvasPatch]);

  useWorkspaceWs(handleWorkspaceMessage, workspaceId, hookConfig.autoLoad);
  
  /**
   * 刷新画布列表
   */
  const refreshCanvases = useCallback(async (): Promise<void> => {
    await loadAllCanvases({ force: true });
  }, [loadAllCanvases]);
  
  // ================== 版本管理 ==================
  
  /**
   * 保存版本
   */
  const saveVersion = useCallback(async (
    id: string, 
    description?: string
  ): Promise<CanvasVersion> => {
    updateState({ isSaving: true, error: null });
    
    try {
      const canvas = await canvasManager.getCanvas(id);
      if (!canvas) {
        throw new Error('画布不存在');
      }
      
      const version = await canvasManager.saveVersion(id, canvas, description);
      
      updateState({
        isSaving: false,
        lastSavedAt: new Date(),
      });
      markRepositoryHealthy();
      
      return version;
    } catch (error) {
      handleError(error, '保存版本');
      throw error;
    }
  }, [handleError, markRepositoryHealthy, updateState]);
  
  /**
   * 加载版本历史
   */
  const loadVersions = useCallback(async (canvasId: string): Promise<void> => {
    updateState({ isLoadingVersions: true, error: null });
    
    try {
      const versions = await canvasManager.getVersionHistory(canvasId);
      
      updateState({
        versions,
        isLoadingVersions: false,
      });
      markRepositoryHealthy();
    } catch (error) {
      handleError(error, '加载版本历史');
    }
  }, [handleError, markRepositoryHealthy, updateState]);
  
  /**
   * 恢复版本
   */
  const restoreVersion = useCallback(async (versionId: string): Promise<Canvas> => {
    updateState({ isLoading: true, error: null });
    
    try {
      const restored = await canvasManager.restoreVersion(versionId);
      
      // 更新本地状态
      const updatedCanvases = stateRef.current.allCanvases.map(c => 
        c.id === restored.id ? restored : c
      );
      
      updateState({
        currentCanvas: restored,
        allCanvases: updatedCanvases,
        isLoading: false,
      });
      markRepositoryHealthy();
      
      return restored;
    } catch (error) {
      handleError(error, '恢复版本');
      throw error;
    }
  }, [handleError, markRepositoryHealthy, updateState]);
  
  // ================== 导入导出 ==================
  
  /**
   * 导出数据
   */
  const exportData = useCallback(async (): Promise<{
    canvases: Canvas[];
    versions: CanvasVersion[];
  }> => {
    try {
      const data = await canvasManager.exportAllData();
      markRepositoryHealthy();
      return data;
    } catch (error) {
      handleError(error, '导出数据');
      throw error;
    }
  }, [handleError, markRepositoryHealthy]);
  
  /**
   * 导入数据
   */
  const importData = useCallback(async (data: {
    canvases: Canvas[];
    versions: CanvasVersion[];
  }): Promise<void> => {
    updateState({ isLoading: true, error: null });
    
    try {
      await canvasManager.importData(data);
      
      // 重新加载数据
      await loadAllCanvases({ force: true });
      markRepositoryHealthy();
    } catch (error) {
      handleError(error, '导入数据');
      throw error;
    }
  }, [updateState, handleError, loadAllCanvases, markRepositoryHealthy]);
  
  // ================== 状态管理 ==================
  
  /**
   * 清除错误
   */
  const clearError = useCallback(() => {
    updateState({ error: null });
  }, [updateState]);
  
  /**
   * 设置当前画布
   */
  const setCurrentCanvas = useCallback((canvas: Canvas | null) => {
    updateState({ currentCanvas: canvas });
  }, [updateState]);
  
  // ================== 生命周期和事件管理 ==================
  
  useEffect(() => {
    // 自动加载画布列表
    if (hookConfig.autoLoad && workspaceId && isWorkspaceReady) {
      loadAllCanvases();
    }
    
    // 事件监听器 - 优化API调用频率
    const handleCanvasManagerEvent = (event: CanvasManagerEventData) => {
      if (hookConfig.enableEventLogging) {
        console.log('[useCanvas] Canvas事件:', event);
      }
      
      // 根据事件类型更新状态
      switch (event.type) {
        case 'canvas-created':
        case 'canvas-deleted':
          // 只有创建/删除时才需要刷新整个列表
          if (workspaceId) {
            loadAllCanvases();
          }
          break;
          
        case 'canvas-updated':
          // 更新事件不需要重新获取列表，只更新最后保存时间
          updateState({ lastSavedAt: new Date() });
          if (hookConfig.enableEventLogging) {
            console.log('[useCanvas] Canvas更新事件 - 跳过列表刷新');
          }
          break;
        
        case 'auto-save-triggered':
          updateState({ lastSavedAt: new Date() });
          break;
      }
    };
    
    canvasManager.addEventListener(handleCanvasManagerEvent);
    
    return () => {
      canvasManager.removeEventListener(handleCanvasManagerEvent);
    };
  }, [hookConfig.autoLoad, hookConfig.enableEventLogging, isWorkspaceReady, loadAllCanvases, updateState, workspaceId]);
  
  // 🎯 返回完整接口
  return {
    // 状态
    ...state,
    
    // 操作方法
    createCanvas,
    loadCanvas,
    updateCanvas,
    deleteCanvas,
    loadAllCanvases,
    refreshCanvases,
    saveVersion,
    loadVersions,
    restoreVersion,
    exportData,
    importData,
    clearError,
    setCurrentCanvas,
  };
}

// 🎯 导出默认Hook
export default useCanvas;
