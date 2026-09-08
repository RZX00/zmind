// 🕰️ Canvas历史记录服务 - 专门处理撤销重做历史数据
// 提供历史记录的保存、加载、管理功能

import type { Canvas } from '../types/canvas';
// Mock storage keys for pure canvas system
const STORAGE_KEYS = {
  CANVAS_HISTORY: 'canvas_history',
  CANVAS_VERSION_HISTORY: 'canvas_version_history'
};

// Simple localStorage wrapper to replace local-db.service
const localDbService = {
  set: (key: string, value: any) => {
    localStorage.setItem(key, JSON.stringify(value));
  },
  get: <T>(key: string): T | null => {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : null;
  },
  remove: (key: string) => {
    localStorage.removeItem(key);
  }
};

export interface CanvasHistoryData {
  canvasId: string;
  history: Canvas[];
  historyIndex: number;
  maxHistorySize: number;
  lastUpdated: number;  // 数字时间戳
}

export interface CanvasHistoryService {
  // 历史记录操作
  saveHistory(historyData: CanvasHistoryData): Promise<void>;
  loadHistory(): Promise<CanvasHistoryData | null>;
  
  // 历史记录管理
  addToHistory(canvas: Canvas, currentHistory: Canvas[], currentIndex: number): CanvasHistoryData;
  undo(historyData: CanvasHistoryData): { canvas: Canvas; newIndex: number } | null;
  redo(historyData: CanvasHistoryData): { canvas: Canvas; newIndex: number } | null;
  
  // 工具方法
  canUndo(historyData: CanvasHistoryData): boolean;
  canRedo(historyData: CanvasHistoryData): boolean;
  clearHistory(): void;
  
  // 历史记录信息
  getHistoryInfo(): HistoryInfo | null;
}

export interface HistoryInfo {
  totalEntries: number;
  currentIndex: number;
  canUndo: boolean;
  canRedo: boolean;
  lastUpdated: number;  // 数字时间戳
  memoryUsage: number; // 估算的内存使用量(KB)
}

class CanvasHistoryServiceImpl implements CanvasHistoryService {
  private readonly MAX_HISTORY_SIZE = 50;

  async saveHistory(historyData: CanvasHistoryData): Promise<void> {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return;
      }

      const writeHistory = (data: CanvasHistoryData) => {
        const dataWithTimestamp = {
          ...data,
          lastUpdated: Date.now(), // 使用数字时间戳
        };
        const payload = JSON.stringify(dataWithTimestamp);
        window.localStorage.setItem(STORAGE_KEYS.CANVAS_HISTORY, payload);
      };

      try {
        // 优先尝试完整历史写入
        writeHistory(historyData);
      } catch (error: any) {
        const name = error?.name as string | undefined;
        const isQuotaError =
          name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';

        if (!isQuotaError) {
          console.error('保存历史记录失败:', error);
          return;
        }

        console.warn(
          '[CanvasHistoryService] localStorage quota exceeded when saving history, optimizing history size',
        );

        try {
          window.localStorage.removeItem(STORAGE_KEYS.CANVAS_HISTORY);
        } catch {
          // ignore
        }

        try {
          const length = historyData.history.length;
          const keepCount = Math.max(5, Math.min(20, length));
          const optimized = this.optimizeHistory(historyData, keepCount);
          writeHistory(optimized);
        } catch (error2) {
          console.warn(
            '[CanvasHistoryService] Failed to save optimized history, clearing history instead',
            error2,
          );
          try {
            window.localStorage.removeItem(STORAGE_KEYS.CANVAS_HISTORY);
          } catch {
            // ignore
          }
        }
      }
    } catch (error) {
      console.error('保存历史记录失败:', error);
      // 历史记录属于增强功能，异常时不再向上抛出，避免影响核心画布操作
    }
  }

  async loadHistory(): Promise<CanvasHistoryData | null> {
    try {
      const historyDataStr = localStorage.getItem(STORAGE_KEYS.CANVAS_HISTORY);
      const historyData = historyDataStr ? JSON.parse(historyDataStr) : null;
      
      if (!historyData) {
        return null;
      }

      // 尝试迁移旧格式数据
      const migratedData = this.migrateHistoryData(historyData);
      if (migratedData && this.validateHistoryData(migratedData)) {
        return migratedData;
      }

      // 验证历史数据有效性
      if (!this.validateHistoryData(historyData)) {
        // 数据无效时清理并返回null
        console.warn('历史数据格式无效，清理历史记录');
        this.clearHistory();
        return null;
      }

      return historyData;
    } catch (error) {
      console.error('加载历史记录失败:', error);
      return null;
    }
  }

  addToHistory(canvas: Canvas, currentHistory: Canvas[], currentIndex: number): CanvasHistoryData {
    // 克隆Canvas以避免引用问题
    const clonedCanvas = this.cloneCanvas(canvas);
    
    // 截取当前索引之前的历史，添加新条目
    const newHistory = [...currentHistory.slice(0, currentIndex + 1), clonedCanvas];
    
    // 限制历史记录大小
    let finalHistory = newHistory;
    let finalIndex = currentIndex + 1;
    
    if (newHistory.length > this.MAX_HISTORY_SIZE) {
      finalHistory = newHistory.slice(-this.MAX_HISTORY_SIZE);
      finalIndex = finalHistory.length - 1;
    }

    return {
      canvasId: canvas.id,
      history: finalHistory,
      historyIndex: finalIndex,
      maxHistorySize: this.MAX_HISTORY_SIZE,
      lastUpdated: Date.now(),  // 使用数字时间戳
    };
  }

  undo(historyData: CanvasHistoryData): { canvas: Canvas; newIndex: number } | null {
    const { history, historyIndex } = historyData;
    
    if (historyIndex <= 0) {
      return null;
    }

    const newIndex = historyIndex - 1;
    const canvas = this.cloneCanvas(history[newIndex]);
    
    return { canvas, newIndex };
  }

  redo(historyData: CanvasHistoryData): { canvas: Canvas; newIndex: number } | null {
    const { history, historyIndex } = historyData;
    
    if (historyIndex >= history.length - 1) {
      return null;
    }

    const newIndex = historyIndex + 1;
    const canvas = this.cloneCanvas(history[newIndex]);
    
    return { canvas, newIndex };
  }

  canUndo(historyData: CanvasHistoryData): boolean {
    return historyData.historyIndex > 0;
  }

  canRedo(historyData: CanvasHistoryData): boolean {
    return historyData.historyIndex < historyData.history.length - 1;
  }

  clearHistory(): void {
    localStorage.removeItem(STORAGE_KEYS.CANVAS_HISTORY);
  }

  getHistoryInfo(): HistoryInfo | null {
    try {
      const historyDataStr = localStorage.getItem(STORAGE_KEYS.CANVAS_HISTORY);
      const historyData = historyDataStr ? JSON.parse(historyDataStr) as CanvasHistoryData : null;
      
      if (!historyData) {
        return null;
      }

      // 估算内存使用量
      const memoryUsage = this.calculateMemoryUsage(historyData);

      return {
        totalEntries: historyData.history.length,
        currentIndex: historyData.historyIndex,
        canUndo: this.canUndo(historyData),
        canRedo: this.canRedo(historyData),
        lastUpdated: historyData.lastUpdated,
        memoryUsage,
      };
    } catch (error) {
      console.error('获取历史信息失败:', error);
      return null;
    }
  }

  private validateHistoryData(data: any): data is CanvasHistoryData {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const requiredFields = ['canvasId', 'history', 'historyIndex', 'maxHistorySize'];
    for (const field of requiredFields) {
      if (!(field in data)) {
        return false;
      }
    }

    if (!Array.isArray(data.history)) {
      return false;
    }

    if (typeof data.historyIndex !== 'number' || data.historyIndex < -1) {
      return false;
    }

    if (data.historyIndex >= data.history.length) {
      return false;
    }

    return true;
  }

  private cloneCanvas(canvas: Canvas): Canvas {
    return JSON.parse(JSON.stringify(canvas));
  }

  private calculateMemoryUsage(historyData: CanvasHistoryData): number {
    try {
      const jsonString = JSON.stringify(historyData);
      return Math.round(jsonString.length / 1024); // 转换为KB
    } catch (error) {
      return 0;
    }
  }

  // 数据迁移：将旧格式转换为新格式
  private migrateHistoryData(data: any): CanvasHistoryData | null {
    try {
      if (!data) return null;

      // 检查是否已经是新格式
      if (typeof data.lastUpdated === 'number') {
        return data;
      }

      const now = Date.now();
      const migratedData = {
        ...data,
        lastUpdated: data.lastUpdated ? new Date(data.lastUpdated).getTime() : now
      };

      // 迁移历史记录中的Canvas数据
      if (data.history && Array.isArray(data.history)) {
        migratedData.history = data.history.map((canvas: any) => this.migrateCanvasInHistory(canvas)).filter(Boolean);
      }

      return migratedData;
    } catch (error) {
      console.error('历史数据迁移失败:', error);
      return null;
    }
  }

  // 迁移历史记录中的Canvas对象
  private migrateCanvasInHistory(canvas: any): Canvas | null {
    try {
      if (!canvas) return null;

      const now = Date.now();
      const migratedCanvas = {
        ...canvas,
        createdAt: canvas.created ? new Date(canvas.created).getTime() : (canvas.createdAt || now),
        updatedAt: canvas.updated ? new Date(canvas.updated).getTime() : (canvas.updatedAt || now)
      };

      // 删除旧字段
      delete migratedCanvas.created;
      delete migratedCanvas.updated;

      // 迁移节点数据
      if (canvas.nodes) {
        migratedCanvas.nodes = canvas.nodes.map((node: any) => this.migrateNodeInHistory(node)).filter(Boolean);
      }

      // 迁移连线数据
      if (canvas.connections) {
        migratedCanvas.connections = canvas.connections.map((conn: any) => ({
          ...conn,
          createdAt: conn.created ? new Date(conn.created).getTime() : now
        }));
      }

      return migratedCanvas;
    } catch (error) {
      console.error('历史Canvas迁移失败:', error);
      return null;
    }
  }

  // 迁移历史记录中的节点
  private migrateNodeInHistory(node: any): any | null {
    try {
      if (!node) return null;

      const now = Date.now();
      const migratedNode = {
        ...node,
        createdAt: node.created ? new Date(node.created).getTime() : (node.createdAt || now),
        updatedAt: node.updated ? new Date(node.updated).getTime() : (node.updatedAt || now)
      };

      // 迁移位置和尺寸
      if (node.position) {
        migratedNode.x = node.position.x;
        migratedNode.y = node.position.y;
        delete migratedNode.position;
      }

      if (node.size) {
        migratedNode.width = node.size.width;
        migratedNode.height = node.size.height;
        delete migratedNode.size;
      }

      // 删除旧字段
      delete migratedNode.created;
      delete migratedNode.updated;

      return migratedNode;
    } catch (error) {
      console.error('历史节点迁移失败:', error);
      return null;
    }
  }

  // 历史记录优化：清理过旧的历史记录
  optimizeHistory(historyData: CanvasHistoryData, keepCount: number = 20): CanvasHistoryData {
    if (historyData.history.length <= keepCount) {
      return historyData;
    }

    const currentIndex = historyData.historyIndex;
    const startIndex = Math.max(0, currentIndex - Math.floor(keepCount / 2));
    const endIndex = Math.min(historyData.history.length, startIndex + keepCount);
    
    const optimizedHistory = historyData.history.slice(startIndex, endIndex);
    const newIndex = currentIndex - startIndex;

    return {
      ...historyData,
      history: optimizedHistory,
      historyIndex: newIndex,
      lastUpdated: Date.now(),  // 使用数字时间戳
    };
  }
}

// 单例导出
export const canvasHistoryService: CanvasHistoryService = new CanvasHistoryServiceImpl();
