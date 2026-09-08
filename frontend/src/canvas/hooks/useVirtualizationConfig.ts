// 🎯 虚拟化配置管理Hook
// 为React组件提供便捷的虚拟化配置访问和性能监控

import { useState, useEffect, useCallback } from 'react';
import {
  virtualizationConfig,
  reportFrameTime,
  type VirtualizationThresholds,
  type DevicePerformanceLevel
} from '../utils/virtualizationConfig';

// Hook返回值接口
interface UseVirtualizationConfigReturn {
  // 配置数据
  config: VirtualizationThresholds;
  deviceInfo: any;
  performanceLevel: DevicePerformanceLevel;

  // 便捷访问器
  canvasThreshold: number;
  tableThreshold: number;
  animationLimit: number;

  // 性能监控
  reportPerformance: (frameTime: number) => void;

  // 配置管理
  updateConfig: (overrides: Partial<VirtualizationThresholds>) => void;
  setPerformanceLevel: (level: DevicePerformanceLevel) => void;

  // 实用工具
  shouldVirtualizeCanvas: (nodeCount: number) => boolean;
  shouldVirtualizeTable: (cellCount: number) => boolean;
  getRecommendations: () => string[];
}

/**
 * 🎯 虚拟化配置管理Hook
 *
 * 用法示例：
 * ```tsx
 * const { config, shouldVirtualizeCanvas, reportPerformance } = useVirtualizationConfig();
 *
 * // 检查是否需要虚拟化
 * const needsVirtualization = shouldVirtualizeCanvas(nodes.length);
 *
 * // 报告性能指标
 * useEffect(() => {
 *   const frameTime = performance.now() - lastFrame;
 *   reportPerformance(frameTime);
 * });
 * ```
 */
export const useVirtualizationConfig = (): UseVirtualizationConfigReturn => {
  // 状态管理
  const [config, setConfig] = useState<VirtualizationThresholds>(
    virtualizationConfig.getConfig()
  );

  const [deviceInfo, setDeviceInfo] = useState(
    virtualizationConfig.getDeviceInfo()
  );

  const [performanceLevel, setPerformanceLevelState] = useState<DevicePerformanceLevel>(
    deviceInfo?.estimatedLevel || 'medium'
  );

  // 🔄 监听配置变化
  useEffect(() => {
    const handleLevelChange = (level: DevicePerformanceLevel) => {
      setPerformanceLevelState(level);
      setConfig(virtualizationConfig.getConfig());
      setDeviceInfo(virtualizationConfig.getDeviceInfo());
    };

    virtualizationConfig.onPerformanceLevelChange(handleLevelChange);

    // 定期同步配置（防止外部直接修改）
    const syncInterval = setInterval(() => {
      const currentConfig = virtualizationConfig.getConfig();
      setConfig(currentConfig);
    }, 5000);

    return () => {
      clearInterval(syncInterval);
    };
  }, []);

  // 🎯 性能监控函数
  const reportPerformance = useCallback((frameTime: number) => {
    reportFrameTime(frameTime);
  }, []);

  // 🎯 配置更新函数
  const updateConfig = useCallback((overrides: Partial<VirtualizationThresholds>) => {
    virtualizationConfig.updateConfig(overrides);
    setConfig(virtualizationConfig.getConfig());
  }, []);

  // 🎯 设置性能等级
  const setPerformanceLevel = useCallback((level: DevicePerformanceLevel) => {
    virtualizationConfig.setPerformanceLevel(level);
    setPerformanceLevelState(level);
    setConfig(virtualizationConfig.getConfig());
  }, []);

  // 🎯 实用工具函数
  const shouldVirtualizeCanvas = useCallback((nodeCount: number): boolean => {
    return nodeCount > config.canvasNodes;
  }, [config.canvasNodes]);

  const shouldVirtualizeTable = useCallback((cellCount: number): boolean => {
    return cellCount > config.tableCells;
  }, [config.tableCells]);

  const getRecommendations = useCallback((): string[] => {
    return virtualizationConfig.getPerformanceRecommendations();
  }, []);

  // 返回Hook接口
  return {
    // 配置数据
    config,
    deviceInfo,
    performanceLevel,

    // 便捷访问器
    canvasThreshold: config.canvasNodes,
    tableThreshold: config.tableCells,
    animationLimit: config.maxConcurrentAnimations,

    // 性能监控
    reportPerformance,

    // 配置管理
    updateConfig,
    setPerformanceLevel,

    // 实用工具
    shouldVirtualizeCanvas,
    shouldVirtualizeTable,
    getRecommendations
  };
};

export default useVirtualizationConfig;