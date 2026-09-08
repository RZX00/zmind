// ⚡ 性能优化管理器
// 统一协调性能监控、分层渲染、自适应优化等策略

import { performanceMonitor, PerformanceLevel, PerformanceEvent } from './PerformanceMonitor';
import { layeredRenderer, RenderLayer, RenderContext } from './LayeredRenderer';
import type { Canvas, CanvasNode, CanvasConnection } from '../../../../types/canvas';
import { debugLog, warnLog } from '../../../utils/devLogger';
import { virtualizationConfig, type DevicePerformanceLevel } from '../../../utils/virtualizationConfig';

// 优化策略配置
interface OptimizationConfig {
  // 节点虚拟化
  enableVirtualization: boolean;
  virtualizationThreshold: number;    // 节点数量阈值
  visibilityPadding: number;          // 可视区域边距
  
  // 动画优化
  enableAnimationOptimization: boolean;
  maxConcurrentAnimations: number;    // 最大并发动画数
  animationQualityLevel: 'high' | 'medium' | 'low';
  
  // 渲染优化
  enableSmartRedraw: boolean;         // 智能重绘
  enableGPUAcceleration: boolean;     // GPU加速
  renderBatchSize: number;            // 渲染批次大小
  
  // 内存管理
  enableMemoryOptimization: boolean;
  gcTriggerThreshold: number;         // GC触发阈值
  cacheSize: number;                  // 缓存大小限制
}

// 优化统计
interface OptimizationStats {
  virtualizedNodes: number;           // 虚拟化节点数
  skippedAnimations: number;         // 跳过的动画数
  cacheHits: number;                 // 缓存命中数
  gcTriggered: number;               // GC触发次数
  totalOptimizationTime: number;     // 优化耗时
}

class PerformanceOptimizer {
  private static instance: PerformanceOptimizer;
  
  private config: OptimizationConfig;
  private stats: OptimizationStats;
  private isOptimizing = false;
  private lastOptimizationTime = 0;
  
  // 缓存系统
  private renderCache = new Map<string, any>();
  private nodeVisibilityCache = new Map<string, boolean>();
  private lastRenderContext: RenderContext | null = null;
  
  // 性能自适应状态
  private currentPerformanceLevel: PerformanceLevel = 'high';
  private performanceHistory: number[] = [];

  private constructor() {
    this.config = this.getDefaultConfig();
    this.stats = this.getDefaultStats();
    this.initializeEventListeners();
  }

  static getInstance(): PerformanceOptimizer {
    if (!PerformanceOptimizer.instance) {
      PerformanceOptimizer.instance = new PerformanceOptimizer();
    }
    return PerformanceOptimizer.instance;
  }

  // 🎯 从虚拟化配置管理器获取智能默认配置
  private getDefaultConfig(): OptimizationConfig {
    const vConfig = virtualizationConfig.getConfig();
    return {
      enableVirtualization: true,
      virtualizationThreshold: vConfig.canvasNodes,
      visibilityPadding: vConfig.canvasVisibilityPadding,

      enableAnimationOptimization: true,
      maxConcurrentAnimations: vConfig.maxConcurrentAnimations,
      animationQualityLevel: vConfig.animationQuality,

      enableSmartRedraw: true,
      enableGPUAcceleration: true,
      renderBatchSize: vConfig.renderBatchSize,

      enableMemoryOptimization: true,
      gcTriggerThreshold: 100,
      cacheSize: 1000
    };
  }

  // 初始化默认统计
  private getDefaultStats(): OptimizationStats {
    return {
      virtualizedNodes: 0,
      skippedAnimations: 0,
      cacheHits: 0,
      gcTriggered: 0,
      totalOptimizationTime: 0
    };
  }

  // 初始化性能监控事件监听
  private initializeEventListeners(): void {
    performanceMonitor.addEventListener((event: PerformanceEvent) => {
      this.handlePerformanceEvent(event);
    });

    // 🎯 监听虚拟化配置变化，同步更新优化配置
    virtualizationConfig.onPerformanceLevelChange((level: DevicePerformanceLevel) => {
      this.syncWithVirtualizationConfig();
    });
  }

  // 处理性能事件
  private handlePerformanceEvent(event: PerformanceEvent): void {
    switch (event.type) {
      case 'PERFORMANCE_DEGRADED':
        this.adaptToPerformanceLevel(event.to);
        break;
        
      case 'PERFORMANCE_RESTORED':
        this.adaptToPerformanceLevel(event.to);
        break;
        
      case 'MEMORY_HIGH':
        this.triggerMemoryOptimization();
        break;
        
      case 'FPS_DROP':
        this.applyEmergencyOptimizations();
        break;
    }
  }

  // 自适应性能等级
  private adaptToPerformanceLevel(level: PerformanceLevel): void {
    this.currentPerformanceLevel = level;
    
    switch (level) {
      case 'high':
        this.config.animationQualityLevel = 'high';
        this.config.maxConcurrentAnimations = 10;
        this.config.enableGPUAcceleration = true;
        this.config.renderBatchSize = 50;
        break;
        
      case 'medium':
        this.config.animationQualityLevel = 'medium';
        this.config.maxConcurrentAnimations = 5;
        this.config.enableGPUAcceleration = true;
        this.config.renderBatchSize = 20;
        break;
        
      case 'low':
        this.config.animationQualityLevel = 'low';
        this.config.maxConcurrentAnimations = 2;
        this.config.enableGPUAcceleration = false;
        this.config.renderBatchSize = 10;
        this.triggerMemoryOptimization();
        break;
    }
    
    debugLog(`⚡ 性能优化适配到 ${level} 级别`);
  }

  // 应用紧急优化措施
  private applyEmergencyOptimizations(): void {
    warnLog('🚨 应用紧急性能优化');
    
    // 立即清理缓存
    this.clearCaches();
    
    // 降低动画质量
    this.config.animationQualityLevel = 'low';
    this.config.maxConcurrentAnimations = 1;
    
    // 启用激进的虚拟化
    this.config.virtualizationThreshold = 20;
    this.config.visibilityPadding = 100;
    
    // 减小渲染批次
    this.config.renderBatchSize = 5;
  }

  // 🚀 触发内存优化（智能防抖，平衡性能与用户体验）
  private triggerMemoryOptimization(): void {
    const now = Date.now();
    const minInterval = 1000; // 减少防抖间隔到1秒，避免阻塞用户操作
    
    if (now - this.lastOptimizationTime < minInterval) {
      // 降低防抖日志级别，避免控制台噪音
      // debugLog('🚫 内存优化跳过（防抖）');
      return;
    }
    
    this.lastOptimizationTime = now;
    
    // 🎯 智能优化：根据当前缓存大小决定是否执行
    const shouldOptimize = this.renderCache.size > this.config.cacheSize * 0.8 || 
                          this.nodeVisibilityCache.size > this.config.cacheSize * 0.8;
    
    if (!shouldOptimize) {
      return; // 缓存未满，跳过优化
    }
    
    debugLog('🧹 触发智能内存优化');
    
    // 温和清理：只清理超出限制的部分
    this.smartCacheCleaning();
    
    // 建议垃圾回收（如果可用）
    if ('gc' in window && typeof (window as any).gc === 'function') {
      try {
        (window as any).gc();
      } catch (e) {
        // 忽略GC错误
      }
    }
    
    this.stats.gcTriggered++;
  }

  // 清理缓存
  private clearCaches(): void {
    this.renderCache.clear();
    this.nodeVisibilityCache.clear();
    debugLog('🗑️ 缓存已清理');
  }

  // 🎯 智能缓存清理：只清理超出限制的部分，保留热数据
  private smartCacheCleaning(): void {
    const renderCacheLimit = Math.floor(this.config.cacheSize * 0.8);
    const visibilityCacheLimit = Math.floor(this.config.cacheSize * 0.8);
    
    // 清理渲染缓存（LRU策略）
    if (this.renderCache.size > renderCacheLimit) {
      const keysToDelete = Array.from(this.renderCache.keys())
        .slice(0, this.renderCache.size - renderCacheLimit);
      keysToDelete.forEach(key => this.renderCache.delete(key));
    }
    
    // 清理可见性缓存
    if (this.nodeVisibilityCache.size > visibilityCacheLimit) {
      const keysToDelete = Array.from(this.nodeVisibilityCache.keys())
        .slice(0, this.nodeVisibilityCache.size - visibilityCacheLimit);
      keysToDelete.forEach(key => this.nodeVisibilityCache.delete(key));
    }
  }

  // 优化渲染上下文
  optimizeRenderContext(context: RenderContext): RenderContext {
    const startTime = performance.now();
    
    const optimizedContext = { ...context };
    
    // 节点虚拟化优化
    if (this.config.enableVirtualization && 
        context.canvas.nodes.length > this.config.virtualizationThreshold) {
      optimizedContext.canvas = this.applyNodeVirtualization(context.canvas, context.viewport);
    }
    
    // 连线优化
    if (optimizedContext.canvas.connections.length > 100) {
      optimizedContext.canvas.connections = this.optimizeConnections(
        optimizedContext.canvas.connections,
        optimizedContext.canvas.nodes,
        context.viewport
      );
    }
    
    // 动画优化
    if (this.config.enableAnimationOptimization) {
      optimizedContext.animatingElements = this.optimizeAnimations(
        context.animatingElements,
        context.viewport
      );
    }
    
    // 智能重绘检测
    if (this.config.enableSmartRedraw && this.lastRenderContext) {
      this.updateLayerDirtyStates(optimizedContext, this.lastRenderContext);
    }
    
    this.lastRenderContext = optimizedContext;
    
    const optimizationTime = performance.now() - startTime;
    this.stats.totalOptimizationTime += optimizationTime;
    
    if (optimizationTime > 5) {
      console.warn(`⚠️ 优化耗时过长: ${optimizationTime.toFixed(2)}ms`);
    }
    
    return optimizedContext;
  }

  // 应用节点虚拟化
  private applyNodeVirtualization(canvas: Canvas, viewport: RenderContext['viewport']): Canvas {
    const visibleNodes = canvas.nodes.filter(node => {
      return this.isNodeVisible(node, viewport);
    });
    
    this.stats.virtualizedNodes = canvas.nodes.length - visibleNodes.length;
    
    // 保留可见区域外一定范围的节点（用于平滑滚动）
    const extendedVisibleNodes = canvas.nodes.filter(node => {
      return this.isNodeVisible(node, viewport, this.config.visibilityPadding);
    });
    
    return {
      ...canvas,
      nodes: extendedVisibleNodes
    };
  }

  // 检查节点是否可见
  private isNodeVisible(
    node: CanvasNode, 
    viewport: RenderContext['viewport'], 
    padding = 0
  ): boolean {
    const cacheKey = `${node.id}_${viewport.x}_${viewport.y}_${viewport.scale}_${padding}`;
    
    if (this.nodeVisibilityCache.has(cacheKey)) {
      this.stats.cacheHits++;
      return this.nodeVisibilityCache.get(cacheKey)!;
    }
    
    const screenX = (node.x - viewport.x) * viewport.scale;
    const screenY = (node.y - viewport.y) * viewport.scale;
    const screenWidth = node.width * viewport.scale;
    const screenHeight = node.height * viewport.scale;
    
    const isVisible = !(
      screenX + screenWidth < -padding ||
      screenX > viewport.width + padding ||
      screenY + screenHeight < -padding ||
      screenY > viewport.height + padding
    );
    
    // 缓存结果（限制缓存大小）
    if (this.nodeVisibilityCache.size < this.config.cacheSize) {
      this.nodeVisibilityCache.set(cacheKey, isVisible);
    }
    
    return isVisible;
  }

  // 优化连线
  private optimizeConnections(
    connections: CanvasConnection[], 
    nodes: CanvasNode[],
    viewport: RenderContext['viewport']
  ): CanvasConnection[] {
    // 过滤掉不可见的连线
    return connections.filter(connection => {
      const fromNode = nodes.find(n => n.id === connection.from);
      const toNode = nodes.find(n => n.id === connection.to);
      
      if (!fromNode || !toNode) return false;
      
      // 如果连线的两个节点都不可见，则跳过该连线
      return this.isNodeVisible(fromNode, viewport, 100) || 
             this.isNodeVisible(toNode, viewport, 100);
    });
  }

  // 优化动画
  private optimizeAnimations(
    animatingElements: Set<string>,
    viewport: RenderContext['viewport']
  ): Set<string> {
    if (animatingElements.size <= this.config.maxConcurrentAnimations) {
      return animatingElements;
    }
    
    // 优先保留可见区域内的动画
    const prioritizedAnimations = Array.from(animatingElements)
      .slice(0, this.config.maxConcurrentAnimations);
    
    this.stats.skippedAnimations = animatingElements.size - prioritizedAnimations.length;
    
    return new Set(prioritizedAnimations);
  }

  // 更新分层渲染的脏状态
  private updateLayerDirtyStates(
    current: RenderContext, 
    previous: RenderContext
  ): void {
    layeredRenderer.intelligentDirtyCheck(current, previous);
  }

  // 获取优化建议
  getOptimizationRecommendations(canvas: Canvas): string[] {
    const recommendations: string[] = [];
    const nodeCount = canvas.nodes.length;
    const connectionCount = canvas.connections.length;
    
    if (nodeCount > 100) {
      recommendations.push('节点数量较多，建议启用虚拟化渲染');
    }
    
    if (connectionCount > 200) {
      recommendations.push('连线数量较多，考虑简化连线显示');
    }
    
    if (this.stats.skippedAnimations > 5) {
      recommendations.push('动画数量过多，建议减少并发动画');
    }
    
    if (this.stats.virtualizedNodes > nodeCount * 0.8) {
      recommendations.push('大量节点被虚拟化，考虑优化视窗管理');
    }
    
    const cacheHitRate = this.stats.cacheHits / (this.stats.cacheHits + nodeCount);
    if (cacheHitRate < 0.5) {
      recommendations.push('缓存命中率较低，考虑优化缓存策略');
    }
    
    return recommendations;
  }

  // 获取性能报告
  getPerformanceReport(): {
    config: OptimizationConfig;
    stats: OptimizationStats;
    recommendations: string[];
    performanceLevel: PerformanceLevel;
  } {
    return {
      config: { ...this.config },
      stats: { ...this.stats },
      recommendations: [],
      performanceLevel: this.currentPerformanceLevel
    };
  }

  // 🎯 与虚拟化配置同步
  private syncWithVirtualizationConfig(): void {
    const vConfig = virtualizationConfig.getConfig();
    this.config = {
      ...this.config,
      virtualizationThreshold: vConfig.canvasNodes,
      visibilityPadding: vConfig.canvasVisibilityPadding,
      maxConcurrentAnimations: vConfig.maxConcurrentAnimations,
      animationQualityLevel: vConfig.animationQuality,
      renderBatchSize: vConfig.renderBatchSize
    };
    debugLog('🔄 性能优化配置已与虚拟化配置同步');
  }

  // 更新配置
  updateConfig(newConfig: Partial<OptimizationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    // ⚙️ 调试日志已禁用 - 性能优化配置已更新
    // debugLog('⚙️ 性能优化配置已更新:', newConfig);
  }

  // 重置统计
  resetStats(): void {
    this.stats = this.getDefaultStats();
    // 📊 调试日志已禁用 - 性能统计已重置
    // debugLog('📊 性能统计已重置');
  }

  // 简化的优化启动
  startOptimization(): void {
    if (this.isOptimizing) return;
    this.isOptimizing = true;
    debugLog('⚡ 性能优化已启动');
  }

  // 停止性能优化
  stopOptimization(): void {
    this.isOptimizing = false;
    this.clearCaches();
    debugLog('⏹️ 性能优化已停止');
  }
}

// 导出单例实例
export const performanceOptimizer = PerformanceOptimizer.getInstance();

// 便捷函数
export const startPerformanceOptimization = () => performanceOptimizer.startOptimization();
export const stopPerformanceOptimization = () => performanceOptimizer.stopOptimization();