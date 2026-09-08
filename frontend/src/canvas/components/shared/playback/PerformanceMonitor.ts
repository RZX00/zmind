// 🚀 Canvas播放性能监控系统
import { debugLog, warnLog } from '../../../utils/devLogger';
// 高性能FPS监控 + 内存监控 + 自适应降级策略

export interface PerformanceMetrics {
  fps: number;                    // 当前帧率
  averageFps: number;            // 平均帧率  
  memoryUsage: number;           // 内存使用量(MB)
  renderTime: number;            // 渲染耗时(ms)
  animationLatency: number;      // 动画延迟(ms)
  nodeCount: number;             // 节点数量
  timestamp: number;             // 时间戳
}

export interface PerformanceTargets {
  fps: {
    target: number;              // 理想帧率
    acceptable: number;          // 可接受帧率  
    fallback: number;           // 降级帧率
  };
  memory: {
    maxUsage: number;           // 最大内存使用(MB)
    gcTrigger: number;          // GC触发阈值(MB) 
  };
  latency: {
    animationDelay: number;     // 动画延迟限制(ms)
    userResponse: number;       // 用户响应延迟(ms)
  };
}

export type PerformanceLevel = 'high' | 'medium' | 'low';

export interface PerformanceConfig {
  level: PerformanceLevel;
  enabledFeatures: {
    particleEffects: boolean;
    shadowEffects: boolean;
    smoothAnimations: boolean;
    connectionAnimations: boolean;
  };
  animationSettings: {
    duration: number;
    easing: string;
    fps: number;
  };
}

// 性能监控事件
export type PerformanceEvent = 
  | { type: 'FPS_DROP'; fps: number; threshold: number }
  | { type: 'MEMORY_HIGH'; usage: number; limit: number }
  | { type: 'LATENCY_HIGH'; latency: number; limit: number }
  | { type: 'PERFORMANCE_DEGRADED'; from: PerformanceLevel; to: PerformanceLevel }
  | { type: 'PERFORMANCE_RESTORED'; from: PerformanceLevel; to: PerformanceLevel };

export type PerformanceEventHandler = (event: PerformanceEvent) => void;

class PerformanceMonitor {
  private static instance: PerformanceMonitor | null = null;
  
  // 性能目标配置
  private readonly targets: PerformanceTargets = {
    fps: { target: 60, acceptable: 45, fallback: 30 },
    memory: { maxUsage: 150, gcTrigger: 120 },
    latency: { animationDelay: 100, userResponse: 50 }
  };

  // 监控状态
  private isMonitoring = false;
  private frameCount = 0;
  private lastTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  private fpsHistory: number[] = [];
  private currentMetrics: PerformanceMetrics;
  private eventHandlers: PerformanceEventHandler[] = [];
  private hasDetectedDevicePerformance = false;
  
  // 性能配置
  private currentLevel: PerformanceLevel = 'high';
  private configs: Record<PerformanceLevel, PerformanceConfig> = {
    high: {
      level: 'high',
      enabledFeatures: {
        particleEffects: true,
        shadowEffects: true,
        smoothAnimations: true,
        connectionAnimations: true
      },
      animationSettings: {
        duration: 800,
        easing: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
        fps: 60
      }
    },
    medium: {
      level: 'medium',
      enabledFeatures: {
        particleEffects: false,
        shadowEffects: true,
        smoothAnimations: true,
        connectionAnimations: true
      },
      animationSettings: {
        duration: 600,
        easing: 'ease-out',
        fps: 45
      }
    },
    low: {
      level: 'low',
      enabledFeatures: {
        particleEffects: false,
        shadowEffects: false,
        smoothAnimations: false,
        connectionAnimations: false
      },
      animationSettings: {
        duration: 300,
        easing: 'ease',
        fps: 30
      }
    }
  };

  private constructor() {
    this.currentMetrics = {
      fps: 0,
      averageFps: 0,
      memoryUsage: 0,
      renderTime: 0,
      animationLatency: 0,
      nodeCount: 0,
      timestamp: performance.now()
    };
    
  }

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  // 开始性能监控
  startMonitoring(): void {
    if (this.isMonitoring) return;
    
    if (!this.hasDetectedDevicePerformance) {
      this.detectDevicePerformance();
    }
    this.isMonitoring = true;
    this.frameCount = 0;
    this.lastTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    this.fpsHistory = [];
    
    this.monitoringLoop();
    debugLog('🚀 性能监控已启动');
  }

  // 停止性能监控
  stopMonitoring(): void {
    this.isMonitoring = false;
    debugLog('⏹️ 性能监控已停止');
  }

  // 监控主循环
  private monitoringLoop = (): void => {
    if (!this.isMonitoring) return;

    const currentTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const deltaTime = currentTime - this.lastTime;
    
    if (deltaTime >= 1000) { // 每秒更新一次
      const fps = Math.round((this.frameCount * 1000) / deltaTime);
      
      // 更新FPS历史
      this.fpsHistory.push(fps);
      if (this.fpsHistory.length > 10) {
        this.fpsHistory.shift(); // 只保留最近10秒的数据
      }
      
      // 计算平均FPS
      const averageFps = Math.round(
        this.fpsHistory.reduce((sum, f) => sum + f, 0) / this.fpsHistory.length
      );
      
      // 获取内存使用情况
      const memoryUsage = this.getMemoryUsage();
      
      // 更新指标
      this.currentMetrics = {
        fps,
        averageFps,
        memoryUsage,
        renderTime: this.measureRenderTime(),
        animationLatency: this.measureAnimationLatency(),
        nodeCount: this.getNodeCount(),
        timestamp: currentTime
      };
      
      // 检查性能问题
      this.checkPerformanceIssues();
      
      // 重置计数器
      this.frameCount = 0;
      this.lastTime = currentTime;
    }
    
    this.frameCount++;
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(this.monitoringLoop);
    } else {
      // Fallback for non-browser contexts to avoid ReferenceError
      setTimeout(() => this.monitoringLoop(), 16);
    }
  };

  // 获取内存使用情况
  private getMemoryUsage(): number {
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      return Math.round(memory.usedJSHeapSize / 1024 / 1024); // 转换为MB
    }
    return 0;
  }

  // 测量渲染时间
  private measureRenderTime(): number {
    // 简单的渲染时间估算
    return Math.random() * 16.67; // 模拟0-16.67ms的渲染时间
  }

  // 测量动画延迟
  private measureAnimationLatency(): number {
    // 简单的动画延迟估算
    return Math.random() * 50; // 模拟0-50ms的延迟
  }

  // 获取节点数量
  private getNodeCount(): number {
    // SSR/Node 环境没有 document
    if (typeof document === 'undefined') return 0;
    try {
      return document.querySelectorAll('[data-node-container]').length;
    } catch {
      return 0;
    }
  }

  // 检查性能问题
  private checkPerformanceIssues(): void {
    const metrics = this.currentMetrics;
    
    // FPS检查
    if (metrics.fps < this.targets.fps.acceptable) {
      this.emitEvent({
        type: 'FPS_DROP',
        fps: metrics.fps,
        threshold: this.targets.fps.acceptable
      });
      
      // 自动降级
      if (this.currentLevel === 'high' && metrics.fps < this.targets.fps.acceptable) {
        this.degradeToLevel('medium');
      } else if (this.currentLevel === 'medium' && metrics.fps < this.targets.fps.fallback) {
        this.degradeToLevel('low');
      }
    }
    
    // 内存检查
    if (metrics.memoryUsage > this.targets.memory.maxUsage) {
      this.emitEvent({
        type: 'MEMORY_HIGH',
        usage: metrics.memoryUsage,
        limit: this.targets.memory.maxUsage
      });
    }
    
    // 动画延迟检查  
    if (metrics.animationLatency > this.targets.latency.animationDelay) {
      this.emitEvent({
        type: 'LATENCY_HIGH',
        latency: metrics.animationLatency,
        limit: this.targets.latency.animationDelay
      });
    }

    // 性能恢复检查
    if (metrics.averageFps > this.targets.fps.target && this.currentLevel !== 'high') {
      this.restoreToLevel('high');
    } else if (metrics.averageFps > this.targets.fps.acceptable && this.currentLevel === 'low') {
      this.restoreToLevel('medium');
    }
  }

  // 降级性能等级
  private degradeToLevel(level: PerformanceLevel): void {
    const oldLevel = this.currentLevel;
    this.currentLevel = level;
    
    this.emitEvent({
      type: 'PERFORMANCE_DEGRADED',
      from: oldLevel,
      to: level
    });
    
    warnLog(`📉 性能降级: ${oldLevel} → ${level}`, '', 'PerformanceMonitor');
  }

  // 恢复性能等级
  private restoreToLevel(level: PerformanceLevel): void {
    const oldLevel = this.currentLevel;
    this.currentLevel = level;
    
    this.emitEvent({
      type: 'PERFORMANCE_RESTORED', 
      from: oldLevel,
      to: level
    });
    
    debugLog(`📈 性能恢复: ${oldLevel} → ${level}`);
  }

  // 检测设备性能
  private detectDevicePerformance(): void {
    // SSR/Node 环境无 navigator
    if (typeof navigator === 'undefined') {
      this.currentLevel = 'medium';
      this.hasDetectedDevicePerformance = true;
      return;
    }
    // 基于硬件核心数和内存估算性能等级
    const cores = navigator.hardwareConcurrency || 2;
    const memory = (navigator as any).deviceMemory || 4; // GB
    
    if (cores >= 8 && memory >= 8) {
      this.currentLevel = 'high';
    } else if (cores >= 4 && memory >= 4) {
      this.currentLevel = 'medium'; 
    } else {
      this.currentLevel = 'low';
    }
    
    debugLog(`🔍 检测到设备性能等级: ${this.currentLevel} (${cores}核心, ${memory}GB内存)`);
    this.hasDetectedDevicePerformance = true;
  }

  // 事件处理
  private emitEvent(event: PerformanceEvent): void {
    this.eventHandlers.forEach(handler => {
      try {
        handler(event);
      } catch (error) {
        console.error('性能监控事件处理错误:', error);
      }
    });
  }

  // 公共API
  addEventListener(handler: PerformanceEventHandler): void {
    this.eventHandlers.push(handler);
  }

  removeEventListener(handler: PerformanceEventHandler): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index > -1) {
      this.eventHandlers.splice(index, 1);
    }
  }

  getCurrentMetrics(): PerformanceMetrics {
    return { ...this.currentMetrics };
  }

  getPerformanceConfig(): PerformanceConfig {
    return { ...this.configs[this.currentLevel] };
  }

  setPerformanceLevel(level: PerformanceLevel): void {
    const oldLevel = this.currentLevel;
    this.currentLevel = level;
    debugLog(`⚙️ 手动设置性能等级: ${oldLevel} → ${level}`);
  }

  // 性能报告
  generateReport(): {
    summary: string;
    metrics: PerformanceMetrics;
    config: PerformanceConfig;
    recommendations: string[];
  } {
    const metrics = this.currentMetrics;
    const config = this.getPerformanceConfig();
    const recommendations: string[] = [];
    
    // 生成建议
    if (metrics.fps < this.targets.fps.target) {
      recommendations.push('考虑减少节点数量或简化动画效果');
    }
    if (metrics.memoryUsage > this.targets.memory.gcTrigger) {
      recommendations.push('内存使用较高，建议定期清理不必要的数据');
    }
    if (metrics.nodeCount > 50) {
      recommendations.push('节点数量较多，考虑使用虚拟化渲染');
    }
    
    return {
      summary: `当前FPS: ${metrics.fps}, 内存: ${metrics.memoryUsage}MB, 性能等级: ${this.currentLevel}`,
      metrics,
      config,
      recommendations
    };
  }
}

// 导出单例实例
export const performanceMonitor = PerformanceMonitor.getInstance();
