// ⏳ 画布全局加载状态覆盖组件 - Linear 风格
// 用于长时间操作时显示

import React, { useEffect, useState } from 'react';
import { Loader2, Sparkles, Brain, Zap } from 'lucide-react';

interface LoadingOverlayProps {
  isVisible: boolean;
  title?: string;
  description?: string;
  progress?: number; // 0-100，如果提供则显示进度条
  type?: 'smart-layout' | 'general';
}

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  isVisible,
  title = '智能处理中',
  description = 'AI正在分析画布内容...',
  progress,
  type = 'smart-layout'
}) => {
  const [dots, setDots] = useState('');
  const [tipIndex, setTipIndex] = useState(0);

  // 动态点点点效果
  useEffect(() => {
    if (!isVisible) return;
    
    const interval = setInterval(() => {
      setDots(prev => {
        if (prev === '...') return '';
        return prev + '.';
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isVisible]);

  // 循环显示提示信息
  const tips = [
    'AI正在分析节点间的语义关系',
    '计算最优的空间布局策略',
    '生成美观且实用的排列方案',
    '应用平滑的动画过渡效果'
  ];

  useEffect(() => {
    if (!isVisible) return;
    
    const interval = setInterval(() => {
      setTipIndex(prev => (prev + 1) % tips.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [isVisible, tips.length]);

  if (!isVisible) return null;

  const getIcon = () => {
    switch (type) {
      case 'smart-layout':
        return <Sparkles className="w-8 h-8 text-blue-500" />;
      default:
        return <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />;
    }
  };

  return (
    <div className="
      fixed inset-0 z-[9999]
      bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm
      flex items-center justify-center
      transition-opacity duration-300
    ">
      <div className="
        bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-gray-200 dark:border-zinc-700
        p-8 max-w-md w-full mx-4
        text-center text-gray-900 dark:text-zinc-100
      ">
        {/* 主图标 */}
        <div className="
          w-16 h-16 mx-auto mb-4
          bg-blue-50 dark:bg-blue-900/30 rounded-full
          flex items-center justify-center
          relative overflow-hidden
        ">
          {/* 脉冲动画背景 */}
          <div className="
            absolute inset-0 
            bg-gradient-to-r from-blue-400 to-indigo-400
            rounded-full animate-pulse opacity-20
          " />
          
          {/* 旋转光圈 */}
          <div className="
            absolute inset-0
            border-2 border-transparent border-t-blue-400
            rounded-full animate-spin
          " />
          
          {getIcon()}
        </div>

        {/* 标题 */}
        <h3 className="text-lg font-semibold text-gray-800 dark:text-zinc-100 mb-2">
          {title}{dots}
        </h3>

        {/* 描述 */}
        <p className="text-sm text-gray-600 dark:text-zinc-300 mb-6">
          {description}
        </p>

        {/* 进度条（如果提供了进度） */}
        {progress !== undefined && (
          <div className="mb-6">
            <div className="w-full bg-gray-200 dark:bg-zinc-700 rounded-full h-2 mb-2">
              <div 
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 dark:text-zinc-400">
              {Math.round(progress)}% 完成
            </div>
          </div>
        )}

        {/* 动态提示信息 */}
        <div className="space-y-3">
          <div className="
            bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/25 dark:to-indigo-900/25 
            rounded-lg p-3 border border-blue-100 dark:border-blue-800/40
          ">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Brain className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-medium text-blue-800 dark:text-blue-200">
                智能分析
              </span>
            </div>
            <p className="text-xs text-blue-700 dark:text-blue-200 transition-opacity duration-300">
              {tips[tipIndex]}
            </p>
          </div>

          {/* 预计时间提示 */}
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
            <Zap className="w-3 h-3" />
            <span>预计需要 5-15 秒，请稍候...</span>
          </div>
        </div>

        {/* 取消按钮（可选，未来可以添加） */}
        {/* 
        <button className="
          mt-4 px-4 py-2 text-sm text-gray-500 
          hover:text-gray-700 transition-colors
          border border-gray-200 rounded-lg
        ">
          取消处理
        </button>
        */}
      </div>
    </div>
  );
};

export default LoadingOverlay;
