// 🎯 性能指示器组件
// 可视化显示虚拟化配置效果和性能监控信息

import React, { useState, useEffect, memo } from 'react';
import { Monitor, Settings, Zap, AlertTriangle, CheckCircle } from 'lucide-react';
import { useVirtualizationConfig } from '../../hooks/useVirtualizationConfig';

interface PerformanceIndicatorProps {
  // 当前性能数据
  totalNodes?: number;
  visibleNodes?: number;
  totalConnections?: number;
  frameTime?: number;

  // 显示控制
  show?: boolean;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  compact?: boolean;
}

// 性能等级颜色映射
const PERFORMANCE_COLORS = {
  high: 'text-green-600 bg-green-50 border-green-200 dark:text-green-200 dark:bg-green-900/25 dark:border-green-800/50',
  medium: 'text-yellow-600 bg-yellow-50 border-yellow-200 dark:text-yellow-200 dark:bg-yellow-900/25 dark:border-yellow-800/50',
  low: 'text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-200 dark:bg-orange-900/25 dark:border-orange-800/50',
  potato: 'text-red-600 bg-red-50 border-red-200 dark:text-red-200 dark:bg-red-900/25 dark:border-red-800/50'
};

// 性能等级图标
const PERFORMANCE_ICONS = {
  high: CheckCircle,
  medium: Monitor,
  low: AlertTriangle,
  potato: AlertTriangle
};

const PERFORMANCE_ICON_COLORS = {
  high: 'text-green-600 dark:text-green-200',
  medium: 'text-yellow-600 dark:text-yellow-200',
  low: 'text-orange-600 dark:text-orange-200',
  potato: 'text-red-600 dark:text-red-200'
};

export const PerformanceIndicator = memo<PerformanceIndicatorProps>(({
  totalNodes = 0,
  visibleNodes = 0,
  totalConnections = 0,
  frameTime = 16,
  show = true,
  position = 'top-right',
  compact = false
}) => {
  const {
    config,
    performanceLevel,
    deviceInfo,
    shouldVirtualizeCanvas,
    getRecommendations
  } = useVirtualizationConfig();

  const [showDetails, setShowDetails] = useState(false);
  const [avgFrameTime, setAvgFrameTime] = useState(16);
  const [frameHistory, setFrameHistory] = useState<number[]>([]);

  // 🎯 性能指标计算
  useEffect(() => {
    if (frameTime > 0) {
      setFrameHistory(prev => {
        const newHistory = [...prev, frameTime].slice(-20); // 保留最近20帧
        const avg = newHistory.reduce((a, b) => a + b, 0) / newHistory.length;
        setAvgFrameTime(avg);
        return newHistory;
      });
    }
  }, [frameTime]);

  if (!show) return null;

  // 虚拟化状态
  const isVirtualized = shouldVirtualizeCanvas(totalNodes);
  const virtualizationRatio = totalNodes > 0 ? (visibleNodes / totalNodes) * 100 : 100;

  // 性能状态
  const fps = Math.round(1000 / avgFrameTime);
  const isGoodPerformance = avgFrameTime < 20; // 50fps+
  const recommendations = getRecommendations();

  // 位置样式
  const positionClasses = {
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4'
  };

  const PerformanceIcon = PERFORMANCE_ICONS[performanceLevel];
  const performanceColor = PERFORMANCE_COLORS[performanceLevel];
  const performanceIconColor = PERFORMANCE_ICON_COLORS[performanceLevel];

  if (compact) {
    return (
      <div className={`fixed ${positionClasses[position]} z-50`}>
        <div
          className={`${performanceColor} backdrop-blur-sm rounded-lg px-3 py-2 border shadow-sm cursor-pointer transition-all hover:shadow-md`}
          onClick={() => setShowDetails(!showDetails)}
        >
          <div className="flex items-center gap-2 text-sm">
            <PerformanceIcon size={16} />
            <span className="font-medium">{fps}fps</span>
            {isVirtualized && (
              <span className="text-xs">
                🎯 {visibleNodes}/{totalNodes}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`fixed ${positionClasses[position]} z-50`}>
      <div className="bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm rounded-lg border border-gray-200 dark:border-zinc-700 shadow-lg p-3 max-w-sm text-gray-900 dark:text-zinc-100">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Monitor size={16} className="text-gray-600 dark:text-zinc-300" />
            <span className="font-medium text-gray-800 dark:text-zinc-100 text-sm">Performance Monitor</span>
          </div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="p-1 hover:bg-accent/60 rounded transition-colors"
          >
            <Settings size={14} className="text-gray-600 dark:text-zinc-300" />
          </button>
        </div>

        {/* 性能指标 */}
        <div className="space-y-2">
          {/* 帧率和性能等级 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PerformanceIcon size={14} className={performanceIconColor} />
              <span className="text-sm">{performanceLevel.toUpperCase()}</span>
            </div>
            <div className={`text-sm font-mono ${isGoodPerformance ? 'text-green-600 dark:text-green-300' : 'text-orange-600 dark:text-orange-300'}`}>
              {fps}fps
            </div>
          </div>

          {/* 虚拟化状态 */}
          {totalNodes > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-zinc-300">Node rendering</span>
              <div className="flex items-center gap-2">
                {isVirtualized && <Zap size={12} className="text-blue-500" />}
                <span className="text-sm font-mono">
                  {visibleNodes}/{totalNodes}
                </span>
                {isVirtualized && (
                  <span className="text-xs text-blue-600 dark:text-blue-300">
                    ({virtualizationRatio.toFixed(0)}%)
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 连接线数量 */}
          {totalConnections > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-zinc-300">Connections</span>
              <span className="text-sm font-mono">{totalConnections}</span>
            </div>
          )}
        </div>

        {/* 详细信息 */}
        {showDetails && (
          <>
            <div className="border-t border-gray-200 dark:border-zinc-700 mt-3 pt-3">
              <div className="text-xs text-gray-600 dark:text-zinc-300 space-y-1">
                <div>Device: {deviceInfo?.cpuCores || 'Unknown'} cores • {deviceInfo?.memoryGB || 'Unknown'} GB</div>
                <div>Canvas threshold: {config.canvasNodes} nodes</div>
                <div>Animation limit: {config.maxConcurrentAnimations}</div>
                <div>Buffer: {config.canvasVisibilityPadding}px</div>
              </div>
            </div>

            {/* 性能建议 */}
            {recommendations.length > 0 && (
              <div className="border-t border-gray-200 dark:border-zinc-700 mt-3 pt-3">
                <div className="text-xs font-medium text-gray-700 dark:text-zinc-200 mb-1">Performance tips:</div>
                <div className="text-xs text-gray-600 dark:text-zinc-300 space-y-1">
                  {recommendations.slice(0, 2).map((rec, index) => (
                    <div key={index}>• {rec}</div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

PerformanceIndicator.displayName = 'PerformanceIndicator';

export default PerformanceIndicator;
