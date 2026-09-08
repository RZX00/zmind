// 🎯 虚拟化阈值配置管理器
// 统一管理所有虚拟化阈值，支持设备性能自适应和动态调整

import { debugLog, warnLog } from './devLogger';

// 设备性能等级
export type DevicePerformanceLevel = 'high' | 'medium' | 'low' | 'potato';

// 虚拟化配置接口
export interface VirtualizationThresholds {
  // 画布节点虚拟化
  canvasNodes: number;              // 画布节点数量阈值
  canvasVisibilityPadding: number;  // 可见区域缓冲距离

  // 表格虚拟化
  tableCells: number;               // 表格单元格数量阈值
  tableBufferSize: number;          // 表格缓冲区大小（行/列数）

  // 连接线虚拟化
  connections: number;              // 连接线数量阈值
  connectionComplexity: number;     // 复杂连接线阈值

  // 动画虚拟化
  maxConcurrentAnimations: number;  // 最大并发动画数
  animationQuality: 'high' | 'medium' | 'low'; // 动画质量等级

  // 渲染优化
  renderBatchSize: number;          // 渲染批次大小
  debounceDelay: number;           // 防抖延迟（毫秒）
}

// 设备性能检测结果
interface DeviceCapabilities {
  cpuCores: number;
  memoryGB: number;
  isHighDPR: boolean;      // 高分辨率屏幕
  supportsGPU: boolean;    // GPU加速支持
  isMobile: boolean;       // 移动设备
  estimatedLevel: DevicePerformanceLevel;
}

// 性能级别对应的阈值配置
const PERFORMANCE_CONFIGS: Record<DevicePerformanceLevel, VirtualizationThresholds> = {
  high: {
    canvasNodes: 120,
    canvasVisibilityPadding: 300,
    tableCells: 2000,
    tableBufferSize: 5,
    connections: 300,
    connectionComplexity: 50,
    maxConcurrentAnimations: 15,
    animationQuality: 'high',
    renderBatchSize: 50,
    debounceDelay: 8
  },

  medium: {
    canvasNodes: 80,
    canvasVisibilityPadding: 200,
    tableCells: 1200,
    tableBufferSize: 3,
    connections: 200,
    connectionComplexity: 30,
    maxConcurrentAnimations: 8,
    animationQuality: 'medium',
    renderBatchSize: 30,
    debounceDelay: 16
  },

  low: {
    canvasNodes: 50,
    canvasVisibilityPadding: 150,
    tableCells: 600,
    tableBufferSize: 2,
    connections: 100,
    connectionComplexity: 20,
    maxConcurrentAnimations: 4,
    animationQuality: 'low',
    renderBatchSize: 20,
    debounceDelay: 32
  },

  potato: {
    canvasNodes: 25,
    canvasVisibilityPadding: 100,
    tableCells: 300,
    tableBufferSize: 1,
    connections: 50,
    connectionComplexity: 10,
    maxConcurrentAnimations: 2,
    animationQuality: 'low',
    renderBatchSize: 10,
    debounceDelay: 50
  }
};

class VirtualizationConfigManager {
  private static instance: VirtualizationConfigManager;

  private currentConfig: VirtualizationThresholds;
  private deviceCapabilities: DeviceCapabilities | null = null;
  private performanceHistory: number[] = [];
  private lastDetectionTime = 0;

  // 性能监控回调
  private performanceCallbacks: Array<(level: DevicePerformanceLevel) => void> = [];

  private constructor() {
    this.currentConfig = PERFORMANCE_CONFIGS.medium; // 默认中等配置
    // 在浏览器中检测设备能力；在SSR中保持默认配置，避免不必要的警告
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && typeof document !== 'undefined') {
      this.detectDeviceCapabilities();
    }
  }

  static getInstance(): VirtualizationConfigManager {
    if (!VirtualizationConfigManager.instance) {
      VirtualizationConfigManager.instance = new VirtualizationConfigManager();
    }
    return VirtualizationConfigManager.instance;
  }

  // 🔍 设备能力检测
  private detectDeviceCapabilities(): void {
    try {
      const capabilities: DeviceCapabilities = {
        cpuCores: (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) || 4,
        memoryGB: this.estimateMemory(),
        isHighDPR: typeof window !== 'undefined' ? window.devicePixelRatio > 1.5 : false,
        supportsGPU: this.checkGPUSupport(),
        isMobile: typeof navigator !== 'undefined' ? /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) : false,
        estimatedLevel: 'medium'
      };

      // 综合评估性能等级
      capabilities.estimatedLevel = this.calculatePerformanceLevel(capabilities);

      this.deviceCapabilities = capabilities;
      this.currentConfig = PERFORMANCE_CONFIGS[capabilities.estimatedLevel];

      debugLog('🎯 设备性能检测完成:', {
        level: capabilities.estimatedLevel,
        cores: capabilities.cpuCores,
        memory: capabilities.memoryGB,
        mobile: capabilities.isMobile
      });

    } catch (error) {
      warnLog('⚠️ 设备能力检测失败，使用默认配置:', error);
      this.currentConfig = PERFORMANCE_CONFIGS.medium;
    }
  }

  // 内存估算
  private estimateMemory(): number {
    // 尝试获取内存信息（Chrome支持）
    if (typeof performance !== 'undefined' && 'memory' in performance && (performance as any).memory) {
      const memInfo = (performance as any).memory;
      return Math.round(memInfo.jsHeapSizeLimit / (1024 * 1024 * 1024));
    }

    // 基于其他指标推测
    const cores = (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) || 4;
    if (cores >= 8) return 8;
    if (cores >= 4) return 4;
    return 2;
  }

  // GPU支持检测
  private checkGPUSupport(): boolean {
    try {
      if (typeof document === 'undefined') return false;
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      return !!gl;
    } catch {
      return false;
    }
  }

  // 性能等级计算
  private calculatePerformanceLevel(capabilities: DeviceCapabilities): DevicePerformanceLevel {
    let score = 0;

    // CPU评分 (40%)
    if (capabilities.cpuCores >= 8) score += 40;
    else if (capabilities.cpuCores >= 4) score += 30;
    else if (capabilities.cpuCores >= 2) score += 20;
    else score += 10;

    // 内存评分 (30%)
    if (capabilities.memoryGB >= 8) score += 30;
    else if (capabilities.memoryGB >= 4) score += 20;
    else if (capabilities.memoryGB >= 2) score += 10;
    else score += 5;

    // GPU评分 (20%)
    if (capabilities.supportsGPU) score += 20;

    // 设备类型评分 (10%)
    if (!capabilities.isMobile) score += 10;
    else score += 5;

    // 高分辨率屏幕惩罚
    if (capabilities.isHighDPR) score -= 10;

    // 等级判定
    if (score >= 80) return 'high';
    if (score >= 60) return 'medium';
    if (score >= 40) return 'low';
    return 'potato';
  }

  // 🎯 获取当前配置
  getConfig(): VirtualizationThresholds {
    return { ...this.currentConfig };
  }

  // 🎯 获取特定类型的阈值
  getCanvasNodesThreshold(): number {
    return this.currentConfig.canvasNodes;
  }

  getTableCellsThreshold(): number {
    return this.currentConfig.tableCells;
  }

  getConnectionsThreshold(): number {
    return this.currentConfig.connections;
  }

  getMaxConcurrentAnimations(): number {
    return this.currentConfig.maxConcurrentAnimations;
  }

  // 🔄 动态性能调整
  reportPerformanceMetric(frameTime: number): void {
    this.performanceHistory.push(frameTime);

    // 保留最近20帧的性能数据
    if (this.performanceHistory.length > 20) {
      this.performanceHistory.shift();
    }

    // 每2秒检查一次性能趋势
    const now = Date.now();
    if (now - this.lastDetectionTime > 2000) {
      this.adaptToPerformanceTrend();
      this.lastDetectionTime = now;
    }
  }

  // 性能趋势自适应
  private adaptToPerformanceTrend(): void {
    if (this.performanceHistory.length < 10) return;

    const avgFrameTime = this.performanceHistory.reduce((a, b) => a + b, 0) / this.performanceHistory.length;
    const targetFrameTime = 16.67; // 60fps目标

    const currentLevel = this.deviceCapabilities?.estimatedLevel || 'medium';

    // 性能劣化检测
    if (avgFrameTime > targetFrameTime * 1.5) {
      const downgradedLevel = this.downgradePerformanceLevel(currentLevel);
      if (downgradedLevel !== currentLevel) {
        this.applyPerformanceLevel(downgradedLevel);
        debugLog(`⬇️ 性能自适应降级: ${currentLevel} → ${downgradedLevel}`);
      }
    }
    // 性能恢复检测
    else if (avgFrameTime < targetFrameTime * 0.8) {
      const upgradedLevel = this.upgradePerformanceLevel(currentLevel);
      if (upgradedLevel !== currentLevel) {
        this.applyPerformanceLevel(upgradedLevel);
        debugLog(`⬆️ 性能自适应升级: ${currentLevel} → ${upgradedLevel}`);
      }
    }
  }

  // 降级性能等级
  private downgradePerformanceLevel(current: DevicePerformanceLevel): DevicePerformanceLevel {
    const levels: DevicePerformanceLevel[] = ['high', 'medium', 'low', 'potato'];
    const index = levels.indexOf(current);
    return levels[Math.min(index + 1, levels.length - 1)];
  }

  // 升级性能等级
  private upgradePerformanceLevel(current: DevicePerformanceLevel): DevicePerformanceLevel {
    const levels: DevicePerformanceLevel[] = ['high', 'medium', 'low', 'potato'];
    const index = levels.indexOf(current);
    return levels[Math.max(index - 1, 0)];
  }

  // 应用性能等级
  private applyPerformanceLevel(level: DevicePerformanceLevel): void {
    this.currentConfig = PERFORMANCE_CONFIGS[level];
    if (this.deviceCapabilities) {
      this.deviceCapabilities.estimatedLevel = level;
    }

    // 通知所有监听器
    this.performanceCallbacks.forEach(callback => callback(level));
  }

  // 🎯 手动设置性能等级
  setPerformanceLevel(level: DevicePerformanceLevel): void {
    this.applyPerformanceLevel(level);
    debugLog(`🎛️ 手动设置性能等级: ${level}`);
  }

  // 🎯 自定义配置覆盖
  updateConfig(overrides: Partial<VirtualizationThresholds>): void {
    this.currentConfig = { ...this.currentConfig, ...overrides };
    debugLog('⚙️ 虚拟化配置已更新:', overrides);
  }

  // 监听性能等级变化
  onPerformanceLevelChange(callback: (level: DevicePerformanceLevel) => void): void {
    this.performanceCallbacks.push(callback);
  }

  // 🎯 获取设备信息
  getDeviceInfo(): DeviceCapabilities | null {
    return this.deviceCapabilities ? { ...this.deviceCapabilities } : null;
  }

  // 🎯 获取性能建议
  getPerformanceRecommendations(): string[] {
    const recommendations: string[] = [];
    const device = this.deviceCapabilities;

    if (!device) return recommendations;

    if (device.estimatedLevel === 'potato') {
      recommendations.push('设备性能较低，建议关闭动画效果');
      recommendations.push('减少同时显示的节点数量');
    }

    if (device.isMobile) {
      recommendations.push('移动设备建议使用简化交互模式');
      recommendations.push('避免长时间的缩放和拖拽操作');
    }

    if (device.isHighDPR && device.estimatedLevel !== 'high') {
      recommendations.push('高分辨率屏幕可能影响性能，考虑降低显示精度');
    }

    if (!device.supportsGPU) {
      recommendations.push('设备不支持GPU加速，避免复杂的视觉效果');
    }

    return recommendations;
  }

  // 🎯 重置为默认配置
  reset(): void {
    this.detectDeviceCapabilities();
    this.performanceHistory = [];
    debugLog('🔄 虚拟化配置已重置');
  }
}

// 导出单例实例
export const virtualizationConfig = VirtualizationConfigManager.getInstance();

// 便捷函数
export const getCanvasThreshold = () => virtualizationConfig.getCanvasNodesThreshold();
export const getTableThreshold = () => virtualizationConfig.getTableCellsThreshold();
export const getConnectionsThreshold = () => virtualizationConfig.getConnectionsThreshold();
export const getAnimationLimit = () => virtualizationConfig.getMaxConcurrentAnimations();

// 性能监控钩子
export const reportFrameTime = (frameTime: number) => virtualizationConfig.reportPerformanceMetric(frameTime);

export default virtualizationConfig;
