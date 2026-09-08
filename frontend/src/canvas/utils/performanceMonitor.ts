// 🚀 Canvas性能监控工具
// 监控大节点数量模板的渲染性能

interface PerformanceMetrics {
  nodeCount: number;
  connectionCount: number;
  renderTime: number;
  memoryUsage?: number;
}

class CanvasPerformanceMonitor {
  private static instance: CanvasPerformanceMonitor;
  private metrics: PerformanceMetrics[] = [];
  private maxMetrics = 5; // 只保留最近5次测量，大幅简化
  private mode: 'performance' | 'battery' = 'performance'; // 简单的二元模式

  static getInstance(): CanvasPerformanceMonitor {
    if (!CanvasPerformanceMonitor.instance) {
      CanvasPerformanceMonitor.instance = new CanvasPerformanceMonitor();
    }
    return CanvasPerformanceMonitor.instance;
  }

  // 设置性能模式
  setMode(mode: 'performance' | 'battery'): void {
    this.mode = mode;
  }

  getMode(): 'performance' | 'battery' {
    return this.mode;
  }

  // 开始性能测量
  startMeasure(label: string): void {
    if (process.env.NODE_ENV === 'development') {
      performance.mark(`${label}-start`);
    }
  }

  // 结束性能测量并记录
  endMeasure(label: string, nodeCount: number, connectionCount: number): void {
    if (process.env.NODE_ENV === 'development') {
      performance.mark(`${label}-end`);
      performance.measure(label, `${label}-start`, `${label}-end`);
      
      const measure = performance.getEntriesByName(label)[0];
      if (measure) {
        const metrics: PerformanceMetrics = {
          nodeCount,
          connectionCount,
          renderTime: measure.duration,
          memoryUsage: this.getMemoryUsage()
        };

        this.addMetric(metrics);
        
        // 如果渲染时间过长，发出警告
        if (measure.duration > 16) { // 超过一帧（60fps）
          console.warn(`⚠️ 画布渲染性能警告:`, {
            renderTime: `${measure.duration.toFixed(2)}ms`,
            nodeCount,
            connectionCount,
            fps: Math.round(1000 / measure.duration)
          });
        }
      }

      // 清理性能标记
      performance.clearMarks(`${label}-start`);
      performance.clearMarks(`${label}-end`);
      performance.clearMeasures(label);
    }
  }

  // 添加性能指标
  private addMetric(metric: PerformanceMetrics): void {
    this.metrics.push(metric);
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }
  }

  // 获取内存使用情况（如果支持）
  private getMemoryUsage(): number | undefined {
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      return memory.usedJSHeapSize;
    }
    return undefined;
  }

  // 获取性能统计
  getStats(): {
    averageRenderTime: number;
    maxRenderTime: number;
    averageNodeCount: number;
    maxNodeCount: number;
    totalMeasurements: number;
  } {
    if (this.metrics.length === 0) {
      return {
        averageRenderTime: 0,
        maxRenderTime: 0,
        averageNodeCount: 0,
        maxNodeCount: 0,
        totalMeasurements: 0
      };
    }

    const totalRenderTime = this.metrics.reduce((sum, m) => sum + m.renderTime, 0);
    const totalNodeCount = this.metrics.reduce((sum, m) => sum + m.nodeCount, 0);

    return {
      averageRenderTime: totalRenderTime / this.metrics.length,
      maxRenderTime: Math.max(...this.metrics.map(m => m.renderTime)),
      averageNodeCount: totalNodeCount / this.metrics.length,
      maxNodeCount: Math.max(...this.metrics.map(m => m.nodeCount)),
      totalMeasurements: this.metrics.length
    };
  }

  // 简化的优化检查
  shouldOptimize(): boolean {
    const stats = this.getStats();
    const threshold = this.mode === 'performance' ? 80 : 50; // 根据模式调整阈值
    return stats.maxNodeCount > threshold || stats.averageRenderTime > 32; // 简化条件
  }

  // 是否应该虚拟化
  shouldVirtualize(nodeCount: number): boolean {
    const threshold = this.mode === 'performance' ? 80 : 50;
    return nodeCount > threshold;
  }

  // 获取性能建议
  getOptimizationSuggestions(): string[] {
    const stats = this.getStats();
    const suggestions: string[] = [];

    if (stats.maxNodeCount > 100) {
      suggestions.push('考虑实施虚拟化渲染，只显示视窗内的节点');
    }

    if (stats.averageRenderTime > 16) {
      suggestions.push('优化节点渲染性能，使用React.memo缓存组件');
    }

    if (stats.maxRenderTime > 100) {
      suggestions.push('考虑分层渲染，将静态和动态内容分离');
    }

    if (stats.maxNodeCount > 50) {
      suggestions.push('启用节点懒加载，优先显示重要内容');
    }

    return suggestions;
  }

  // 输出性能报告（已简化）
  logPerformanceReport(): void {
    if (process.env.NODE_ENV === 'development') {
      const stats = this.getStats();
      console.log(`📊 Canvas性能: 平均${stats.averageRenderTime.toFixed(1)}ms, 最大${stats.maxRenderTime.toFixed(1)}ms (${stats.maxNodeCount}节点)`);

      if (this.shouldOptimize()) {
        console.warn('⚠️ 建议启用性能优化');
      }
    }
  }

  // 清除所有指标
  clear(): void {
    this.metrics = [];
  }
}

// 导出单例实例
export const performanceMonitor = CanvasPerformanceMonitor.getInstance();

// 便捷的性能装饰器Hook
export function useCanvasPerformance(componentName: string) {
  return {
    startMeasure: () => performanceMonitor.startMeasure(componentName),
    endMeasure: (nodeCount: number, connectionCount: number) => 
      performanceMonitor.endMeasure(componentName, nodeCount, connectionCount)
  };
}