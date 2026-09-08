// 🎨 Canvas管理服务 - 高级业务逻辑层
// 提供画布操作的高级API，整合Repository、版本管理、状态同步等功能

import type { Canvas } from '../types/canvas';
import { debugLog } from '../utils/devLogger';
import type {
  CanvasVersion,
  CreateCanvasData,
  UpdateCanvasData,
  CanvasStats
} from '../types/canvas-repository';
import { CanvasRepositoryError } from '../types/canvas-repository';
import { getCurrentCanvasRepository } from './canvas-repository-factory.service';
import { createEmptyCanvas } from '../utils/canvasUtils';
import { hasCanvasChanged } from '../utils/canvasChangeDetection';
import { debounce } from 'lodash-es';

// 🔔 事件类型定义
export type CanvasManagerEvent = 
  | 'canvas-created'
  | 'canvas-updated'
  | 'canvas-deleted'
  | 'version-saved'
  | 'version-restored'
  | 'auto-save-triggered'
  | 'file-opened'
  | 'file-saved'
  | 'file-modified';

export interface CanvasManagerEventData {
  type: CanvasManagerEvent;
  canvasId?: string;
  versionId?: string;
  data?: any;
  timestamp: number;
}

export type CanvasManagerEventListener = (event: CanvasManagerEventData) => void;

// 🗑️ REMOVED: CurrentFileState - 文件状态管理已从此服务移除
// 📝 Canvas状态管理现在通过useCanvas Hook + Zustand store处理
// 🔄 这里专注于Repository层的业务逻辑

// ⚙️ 配置选项
export interface CanvasManagerConfig {
  autoSave?: boolean;
  autoSaveInterval?: number;  // 毫秒
  maxVersions?: number;
  enableEventLogging?: boolean;
  // 🗑️ REMOVED: enableFileStateManagement - 不再需要
}

/**
 * Canvas管理器 - 提供画布操作的统一API
 * 整合数据存储、版本管理、自动保存、事件通知等功能
 * 
 * 🎯 专注核心职责：
 * - Canvas CRUD操作和Repository抽象
 * - 版本管理和历史记录
 * - 自动保存机制（基于Canvas变更检测）
 * - 事件系统和状态通知
 */
export class CanvasManager {
  private repository = getCurrentCanvasRepository();
  private config: Required<CanvasManagerConfig>;
  private eventListeners: CanvasManagerEventListener[] = [];
  
  // 🗑️ REMOVED: 文件状态管理已移除，由useCanvas Hook + Zustand处理
  
  // 防抖自动保存（参考Figma的300ms延迟）
  private debouncedAutoSave!: ReturnType<typeof debounce>;
  private autoSaveTimers = new Map<string, number>(); // canvasId -> timerId
  private lastCanvasStates = new Map<string, Canvas>(); // 用于变更检测
  
  constructor(config?: CanvasManagerConfig) {
    this.config = {
      autoSave: true,
      autoSaveInterval: 3000, // 3秒
      maxVersions: 50,
      enableEventLogging: true,
      // 🗑️ REMOVED: enableFileStateManagement
      ...config,
    };
    
    // 初始化防抖自动保存
    this.debouncedAutoSave = debounce((canvasId: string, canvas: Canvas) => {
      this.performAutoSave(canvasId, canvas);
    }, 300);
    
    // 🗑️ REMOVED: 文件状态管理初始化已移除
  }

  // ================== 事件管理 ==================

  /**
   * 添加事件监听器
   */
  addEventListener(listener: CanvasManagerEventListener): void {
    this.eventListeners.push(listener);
  }

  /**
   * 移除事件监听器
   */
  removeEventListener(listener: CanvasManagerEventListener): void {
    const index = this.eventListeners.indexOf(listener);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * 触发事件
   */
  private emitEvent(type: CanvasManagerEvent, data?: any): void {
    const event: CanvasManagerEventData = {
      type,
      timestamp: Date.now(),
      ...data,
    };

    if (this.config.enableEventLogging) {
      debugLog(`[CanvasManager] Event: ${type}`, event, 'CanvasManager');
    }

    this.eventListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[CanvasManager] 事件监听器执行失败:', error);
      }
    });
  }

  // ================== 画布CRUD操作 ==================

  /**
   * 创建新画布
   */
  async createCanvas(
    title: string,
    initialData?: Canvas,
    options?: { clientRequestId?: string },
  ): Promise<Canvas> {
    // 🆔 确保使用传入的数据，而不是重新生成
    const canvasData = initialData || createEmptyCanvas(title);
    
    // 🛠️ 如果传入了initialData但没有title，使用参数中的title
    if (initialData && canvasData.title !== title) {
      canvasData.title = title;
    }
    
    debugLog('📝 [CanvasManager] 创建Canvas，传递数据', {
      title,
      id: canvasData.id,
      nodes: canvasData.nodes?.length || 0,
    });
    
    const entity = await this.repository.create({
      title,
      nodes: canvasData.nodes,
      connections: canvasData.connections,
      clientRequestId: options?.clientRequestId,
    });

    // 启动自动保存
    if (this.config.autoSave) {
      this.startAutoSave(entity.id, canvasData);
    }

    this.emitEvent('canvas-created', { canvasId: entity.id });
    return entity;
  }

  /**
   * 获取画布
   */
  async getCanvas(id: string): Promise<Canvas | null> {
    return await this.repository.findById(id);
  }

  /**
   * 获取所有画布
   */
  async getAllCanvases(options?: {
    limit?: number;
    offset?: number;
    orderBy?: 'created_at' | 'updated_at' | 'title';
    orderDirection?: 'asc' | 'desc';
  }): Promise<Canvas[]> {
    return await this.repository.findAll({
      limit: options?.limit,
      offset: options?.offset,
      order_by: options?.orderBy === 'updated_at' ? 'updatedAt' : 
                 options?.orderBy === 'created_at' ? 'createdAt' : 
                 options?.orderBy,
      order_direction: options?.orderDirection,
    });
  }

  /**
   * 更新画布
   */
  async updateCanvas(id: string, updates: {
    title?: string;
    nodes?: any[];
    connections?: any[];
    version?: string;
  }): Promise<Canvas> {
    // 获取当前版本进行冲突检测
    const current = await this.repository.findById(id);
    if (!current) {
      throw new Error('画布不存在');
    }

    const entity = await this.repository.update(id, {
      title: updates.title,
      nodes: updates.nodes,
      connections: updates.connections,
      version: updates.version || current.version,
      serverVersion: typeof (current as any).serverVersion === 'number' ? (current as any).serverVersion : undefined,
    });

    // 更新自动保存状态
    if (this.config.autoSave && (updates.nodes || updates.connections)) {
      this.updateAutoSave(id, entity);
    }

    this.emitEvent('canvas-updated', { canvasId: id });
    return entity;
  }

  /**
   * 使用操作集（ops）进行原子更新，统一并发控制（If‑Match）并内置单次冲突重试。
   */
  async applyOps(id: string, operations: any[]): Promise<Canvas> {
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new CanvasRepositoryError('operations 必须是非空数组', 'INVALID_DATA')
    }
    const latest = await this.repository.findById(id)
    if (!latest) throw new CanvasRepositoryError('画布不存在', 'NOT_FOUND')

    const attempt = async (ver: number) => {
      const res = await (this.repository as any).applyOps(id, operations, ver)
      return (res && res.canvas) ? res.canvas as Canvas : res as Canvas
    }

    try {
      const baseVersion = (latest as any).serverVersion
      if (typeof baseVersion !== 'number') {
        throw new CanvasRepositoryError('serverVersion missing for applyOps', 'INVALID_DATA')
      }
      const entity = await attempt(baseVersion)
      if (this.config.autoSave) this.updateAutoSave(id, entity)
      this.emitEvent('canvas-updated', { canvasId: id })
      return entity
    } catch (err: any) {
      if (err instanceof CanvasRepositoryError && err.code === 'VERSION_CONFLICT') {
        const again = await this.repository.findById(id)
        if (!again) throw err
        const retryVersion = (again as any).serverVersion
        if (typeof retryVersion !== 'number') {
          throw new CanvasRepositoryError('serverVersion missing for applyOps retry', 'INVALID_DATA')
        }
        const entity2 = await attempt(retryVersion)
        if (this.config.autoSave) this.updateAutoSave(id, entity2)
        this.emitEvent('canvas-updated', { canvasId: id })
        return entity2
      }
      throw err
    }
  }

  /**
   * 删除画布
   */
  async deleteCanvas(id: string): Promise<void> {
    // 停止自动保存
    this.stopAutoSave(id);
    
    await this.repository.delete(id);
    
    // 清理状态
    this.lastCanvasStates.delete(id);
    
    this.emitEvent('canvas-deleted', { canvasId: id });
  }

  /**
   * 检查画布是否存在
   */
  async canvasExists(id: string): Promise<boolean> {
    return await this.repository.exists(id);
  }

  // ================== 版本管理 ==================

  /**
   * 手动保存版本
   */
  async saveVersion(canvasId: string, canvas: Canvas, description?: string): Promise<CanvasVersion> {
    const version = await this.repository.saveVersion(canvasId, canvas, false);
    
    this.emitEvent('version-saved', { 
      canvasId, 
      versionId: version.id,
      isAutoSave: false 
    });
    
    return version;
  }

  /**
   * 获取版本历史
   */
  async getVersionHistory(canvasId: string, limit = 20): Promise<CanvasVersion[]> {
    return await this.repository.getVersions(canvasId, {
      limit,
      order_direction: 'desc',
    });
  }

  /**
   * 获取手动保存的版本
   */
  async getManualVersions(canvasId: string, limit = 10): Promise<CanvasVersion[]> {
    return await this.repository.getVersions(canvasId, {
      limit,
      is_auto_save: false,
      order_direction: 'desc',
    });
  }

  /**
   * 恢复到指定版本
   */
  async restoreVersion(versionId: string): Promise<Canvas> {
    const entity = await this.repository.restoreVersion(versionId);
    
    // 更新自动保存状态
    if (this.config.autoSave) {
      this.updateAutoSave(entity.id, entity);
    }
    
    this.emitEvent('version-restored', { 
      canvasId: entity.id, 
      versionId 
    });
    
    return entity;
  }

  /**
   * 删除版本
   */
  async deleteVersion(versionId: string): Promise<void> {
    await this.repository.deleteVersion(versionId);
  }

  // ================== 自动保存机制 ==================

  /**
   * 启动自动保存
   */
  private startAutoSave(canvasId: string, canvas: Canvas): void {
    this.lastCanvasStates.set(canvasId, JSON.parse(JSON.stringify(canvas)));
    this.scheduleAutoSave(canvasId, canvas);
  }

  /**
   * 更新自动保存
   */
  private updateAutoSave(canvasId: string, canvas: Canvas): void {
    this.lastCanvasStates.set(canvasId, JSON.parse(JSON.stringify(canvas)));
    this.scheduleAutoSave(canvasId, canvas);
  }

  /**
   * 安排自动保存
   */
  private scheduleAutoSave(canvasId: string, canvas: Canvas): void {
    // 清除之前的定时器
    const existingTimer = this.autoSaveTimers.get(canvasId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // 设置新的定时器
    const timerId = window.setTimeout(async () => {
      await this.performAutoSave(canvasId, canvas);
      this.autoSaveTimers.delete(canvasId);
    }, this.config.autoSaveInterval);

    this.autoSaveTimers.set(canvasId, timerId);
  }

  /**
   * 执行自动保存
   */
  private async performAutoSave(canvasId: string, canvas: Canvas): Promise<void> {
    try {
      // 检查是否真的有变化
      const lastState = this.lastCanvasStates.get(canvasId);
      if (lastState && !hasCanvasChanged(lastState, canvas)) {
        return; // 没有变化，跳过保存
      }

      // 执行自动保存
      await this.repository.saveVersion(canvasId, canvas, true);
      
      this.emitEvent('auto-save-triggered', { 
        canvasId,
        isAutoSave: true 
      });

    } catch (error) {
      console.error('[CanvasManager] 自动保存失败:', error);
    }
  }

  /**
   * 停止自动保存
   */
  private stopAutoSave(canvasId: string): void {
    const timerId = this.autoSaveTimers.get(canvasId);
    if (timerId) {
      clearTimeout(timerId);
      this.autoSaveTimers.delete(canvasId);
    }
    this.lastCanvasStates.delete(canvasId);
  }

  /**
   * 立即执行自动保存（手动触发）
   */
  async triggerAutoSave(canvasId: string): Promise<void> {
    const canvas = await this.getCanvas(canvasId);
    if (canvas) {
      await this.performAutoSave(canvasId, canvas);
    }
  }

  // 🗑️ REMOVED: 文件状态管理方法已全部移除
  // 📝 会话状态现在由useCanvas Hook管理

  // ================== 统计和工具方法 ==================

  /**
   * 获取存储统计信息
   */
  async getStats(): Promise<CanvasStats> {
    return await this.repository.getStats();
  }

  /**
   * 清空所有数据（危险操作）
   */
  async clearAll(): Promise<void> {
      // 停止所有自动保存
    const canvasIds = Array.from(this.autoSaveTimers.keys());
    for (const canvasId of canvasIds) {
      this.stopAutoSave(canvasId);
    }

    await this.repository.clearAll();
  }

  /**
   * 导出所有数据
   */
  async exportAllData(): Promise<{
    canvases: Canvas[];
    versions: CanvasVersion[];
    exportedAt: string;
  }> {
    const data = await this.repository.exportData();
    return {
      ...data,
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * 导入数据
   */
  async importData(data: {
    canvases: Canvas[];
    versions: CanvasVersion[];
  }): Promise<void> {
    await this.repository.importData(data);
  }

  /**
   * 获取配置
   */
  getConfig(): Required<CanvasManagerConfig> {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<CanvasManagerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 销毁管理器（清理资源）
   */
  destroy(): void {
      // 停止所有自动保存
    const canvasIds = Array.from(this.autoSaveTimers.keys());
    for (const canvasId of canvasIds) {
      this.stopAutoSave(canvasId);
    }
    
    // 清空监听器
    this.eventListeners.length = 0;
  }
}

// 🎯 导出默认实例
export const canvasManager = new CanvasManager();

// 🎯 便捷方法
export const createCanvas = (title: string, data?: Canvas) => canvasManager.createCanvas(title, data);
export const getCanvas = (id: string) => canvasManager.getCanvas(id);
export const updateCanvas = (id: string, updates: any) => canvasManager.updateCanvas(id, updates);
export const deleteCanvas = (id: string) => canvasManager.deleteCanvas(id);
export const saveCanvasVersion = (canvasId: string, canvas: Canvas) => canvasManager.saveVersion(canvasId, canvas);
export const getCanvasVersions = (canvasId: string) => canvasManager.getVersionHistory(canvasId);
export const restoreCanvasVersion = (versionId: string) => canvasManager.restoreVersion(versionId);
