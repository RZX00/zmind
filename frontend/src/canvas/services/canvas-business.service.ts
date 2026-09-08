// 🎨 Canvas业务逻辑层 - 架构重构版本
// 作为UI和Manager之间的中间层，处理业务逻辑和状态同步

import type { Canvas } from '../types/canvas';
import { canvasManager } from './canvas-manager.service';
import { useCanvasStore } from '../stores/canvas.store';

/**
 * Canvas业务逻辑服务
 * 职责：
 * 1. 处理复杂的业务逻辑
 * 2. 协调Manager和Store之间的数据同步
 * 3. 提供高级业务API给UI层使用
 * 4. 处理业务层面的错误和异常
 */
export class CanvasBusinessService {
  private eventListeners: Array<(event: any) => void> = [];
  
  constructor() {
    this.initializeEventHandlers();
  }
  
  // ================== 事件系统 ==================
  
  private initializeEventHandlers() {
    // 监听Manager事件，同步到Store
    canvasManager.addEventListener((event) => {
      this.handleManagerEvent(event);
      
      // 通知UI层监听器
      this.eventListeners.forEach(listener => {
        try {
          listener(event);
        } catch (error) {
          console.error('[CanvasBusinessService] 事件监听器错误:', error);
        }
      });
    });
  }
  
  private handleManagerEvent(event: any) {
    const store = useCanvasStore.getState();
    
    switch (event.type) {
      case 'canvas-created':
        // 刷新文件列表
        this.refreshCanvasList();
        break;
        
      case 'canvas-updated':
        // 更新当前画布状态
        if (event.canvasId === store.currentFileId) {
          this.loadCanvas(event.canvasId);
        }
        break;
        
      case 'canvas-deleted':
        // 处理删除后的状态
        this.handleCanvasDeleted(event.canvasId);
        break;
    }
  }
  
  addEventListener(listener: (event: any) => void) {
    this.eventListeners.push(listener);
  }
  
  removeEventListener(listener: (event: any) => void) {
    const index = this.eventListeners.indexOf(listener);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
    }
  }
  
  // ================== 文件管理业务逻辑 ==================
  
  /**
   * 创建新画布（业务层）
   */
  async createCanvas(title: string, templateData?: Partial<Canvas>): Promise<Canvas> {
    const store = useCanvasStore.getState();
    
    try {
      // 设置加载状态
      store.setLoading(true);
      store.setError(null);
      
      // 业务逻辑：智能文件名处理
      const finalTitle = await this.generateUniqueTitle(title);
      
      // 调用Manager层创建
      const newCanvas = await canvasManager.createCanvas(finalTitle, templateData as Canvas);
      
      // 同步到Store
      store.setCanvas(newCanvas, newCanvas.id);
      
      return newCanvas;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '创建失败';
      store.setError(errorMessage);
      throw error;
    } finally {
      store.setLoading(false);
    }
  }
  
  /**
   * 打开画布文件
   */
  async openCanvas(fileId: string): Promise<Canvas> {
    const store = useCanvasStore.getState();
    
    try {
      store.setLoading(true);
      store.setError(null);
      
      // 从Manager获取数据
      const canvas = await canvasManager.getCanvas(fileId);
      if (!canvas) {
        throw new Error('文件不存在');
      }
      
      // 同步到Store
      store.setCanvas(canvas, fileId);
      
      return canvas;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '打开失败';
      store.setError(errorMessage);
      throw error;
    } finally {
      store.setLoading(false);
    }
  }
  
  /**
   * 重命名画布
   */
  async renameCanvas(fileId: string, newTitle: string): Promise<Canvas> {
    const store = useCanvasStore.getState();
    
    try {
      store.setLoading(true);
      store.setError(null);
      
      // 业务逻辑：标题验证
      if (!newTitle.trim()) {
        throw new Error('文件名不能为空');
      }
      
      // 检查重名
      const finalTitle = await this.generateUniqueTitle(newTitle, fileId);
      
      // 更新Manager
      const updatedCanvas = await canvasManager.updateCanvas(fileId, {
        title: finalTitle,
      });
      
      // 同步到Store（如果是当前文件）
      if (fileId === store.currentFileId) {
        store.updateCanvas({ title: finalTitle });
      }
      
      return updatedCanvas;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '重命名失败';
      store.setError(errorMessage);
      throw error;
    } finally {
      store.setLoading(false);
    }
  }
  
  /**
   * 删除画布
   */
  async deleteCanvas(fileId: string): Promise<void> {
    const store = useCanvasStore.getState();
    
    try {
      store.setLoading(true);
      store.setError(null);
      
      // 删除文件
      await canvasManager.deleteCanvas(fileId);
      
      // 业务逻辑：处理当前文件被删除的情况
      if (fileId === store.currentFileId) {
        await this.handleCurrentFileDeleted();
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '删除失败';
      store.setError(errorMessage);
      throw error;
    } finally {
      store.setLoading(false);
    }
  }
  
  // ================== 辅助方法 ==================
  
  /**
   * 生成唯一文件名
   */
  private async generateUniqueTitle(baseTitle: string, excludeId?: string): Promise<string> {
    const allCanvases = await canvasManager.getAllCanvases();
    const existingTitles = allCanvases
      .filter(canvas => canvas.id !== excludeId)
      .map(canvas => canvas.title);
    
    if (!existingTitles.includes(baseTitle)) {
      return baseTitle;
    }
    
    let counter = 2;
    let uniqueTitle = `${baseTitle}${counter}`;
    
    while (existingTitles.includes(uniqueTitle)) {
      counter++;
      uniqueTitle = `${baseTitle}${counter}`;
    }
    
    return uniqueTitle;
  }
  
  /**
   * 刷新画布列表
   */
  private async refreshCanvasList() {
    try {
      const canvases = await canvasManager.getAllCanvases({
        orderBy: 'updated_at',
        orderDirection: 'desc',
      });
      
      // 这里可以通知UI层更新，但不直接操作Store
      // Store的更新应该由UI层的hook处理
      
    } catch (error) {
      console.error('[CanvasBusinessService] 刷新列表失败:', error);
    }
  }
  
  /**
   * 加载指定画布
   */
  private async loadCanvas(fileId: string) {
    try {
      const canvas = await canvasManager.getCanvas(fileId);
      if (canvas) {
        const store = useCanvasStore.getState();
        store.setCanvas(canvas, fileId);
      }
    } catch (error) {
      console.error('[CanvasBusinessService] 加载画布失败:', error);
    }
  }
  
  /**
   * 处理画布删除事件
   */
  private async handleCanvasDeleted(deletedId: string) {
    const store = useCanvasStore.getState();
    
    if (deletedId === store.currentFileId) {
      await this.handleCurrentFileDeleted();
    }
  }
  
  /**
   * 处理当前文件被删除
   */
  private async handleCurrentFileDeleted() {
    try {
      // 获取其他可用文件
      const availableCanvases = await canvasManager.getAllCanvases();
      
      if (availableCanvases.length > 0) {
        // 打开第一个可用文件
        await this.openCanvas(availableCanvases[0].id);
      } else {
        // 没有其他文件，创建新文件
        await this.createCanvas('未命名画布');
      }
    } catch (error) {
      console.error('[CanvasBusinessService] 处理文件删除失败:', error);
      // 回退到默认状态
      const store = useCanvasStore.getState();
      store.resetCanvas();
    }
  }
  
  /**
   * 获取所有画布（用于UI层）
   */
  async getAllCanvases(): Promise<Canvas[]> {
    try {
      return await canvasManager.getAllCanvases({
        orderBy: 'updated_at',
        orderDirection: 'desc',
      });
    } catch (error) {
      console.error('[CanvasBusinessService] 获取画布列表失败:', error);
      return [];
    }
  }
}

// 导出单例
export const canvasBusinessService = new CanvasBusinessService();