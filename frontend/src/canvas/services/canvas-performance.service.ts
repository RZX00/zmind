// 🚀 简化的Canvas缓存服务
// 移除复杂的TTL和LRU机制，使用简单高效的缓存策略

import type { Canvas } from '../types/canvas';

/**
 * 简化的Canvas缓存服务
 *
 * 简化原则：
 * - 移除TTL：Canvas操作通常在短时间内完成，TTL意义不大
 * - 移除LRU：Canvas数量有限，简单的FIFO足够
 * - 内存压力时清理：而不是定时清理
 */
export class CanvasPerformanceService {
  private cache = new Map<string, Canvas>();
  private readonly MAX_CACHE_SIZE = 20; // 降低到20个，避免内存占用过多

  // 🔄 简化的缓存管理
  get(fileId: string): Canvas | null {
    return this.cache.get(fileId) || null;
  }

  set(fileId: string, canvas: Canvas): void {
    // 简单的FIFO策略：缓存满时删除最早的
    if (this.cache.size >= this.MAX_CACHE_SIZE && !this.cache.has(fileId)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(fileId, canvas);
  }

  has(fileId: string): boolean {
    return this.cache.has(fileId);
  }

  delete(fileId: string): boolean {
    return this.cache.delete(fileId);
  }

  clear(): void {
    this.cache.clear();
  }

  // 📊 简化的统计信息
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.MAX_CACHE_SIZE,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  // 粗略估算内存使用
  private estimateMemoryUsage(): string {
    const avgCanvasSize = 50; // KB，粗略估算
    const estimatedMB = (this.cache.size * avgCanvasSize / 1024).toFixed(1);
    return `~${estimatedMB}MB`;
  }

  // 内存压力检测（可选）
  shouldClearCache(): boolean {
    // 简单的内存压力检测
    return this.cache.size >= this.MAX_CACHE_SIZE * 0.9;
  }
}

// 导出单例
export const canvasPerformanceService = new CanvasPerformanceService();