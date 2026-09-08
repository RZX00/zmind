// 🆘 画布帮助和引导系统
// 为大型模板使用提供上下文帮助和操作指导

import React, { useState, useRef, useEffect } from 'react';
import { 
  HelpCircle, 
  BookOpen, 
  Lightbulb, 
  Zap, 
  Navigation, 
  Eye,
  MousePointer2,
  Smartphone,
  Monitor,
  X,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause
} from 'lucide-react';
import type { Canvas, CanvasNode } from '../../../../types/canvas';

interface HelpSystemProps {
  canvas: Canvas;
  isVisible?: boolean;
  onClose?: () => void;
  currentStep?: number;
  onStepChange?: (step: number) => void;
}

interface HelpStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  tips: string[];
  target?: string; // CSS selector for highlighting
  position?: 'top' | 'bottom' | 'left' | 'right';
}

const HelpSystem: React.FC<HelpSystemProps> = ({
  canvas,
  isVisible = false,
  onClose,
  currentStep = 0,
  onStepChange
}) => {
  const [activeTab, setActiveTab] = useState<'guide' | 'tips' | 'performance'>('guide');
  const [isAutoPlay, setIsAutoPlay] = useState(false);
  const [highlightTarget, setHighlightTarget] = useState<string | null>(null);
  const autoPlayRef = useRef<NodeJS.Timeout | null>(null);

  // 根据模板复杂度生成帮助步骤
  const generateHelpSteps = (canvas: Canvas): HelpStep[] => {
    const nodeCount = canvas.nodes.length;
    const hasComplexNodes = canvas.nodes.some(node => 
      node.content && node.content.length > 500
    );

    const baseSteps: HelpStep[] = [
      {
        id: 'overview',
        title: '画布概览',
        description: `当前模板包含 ${nodeCount} 个节点。这是一个${nodeCount > 30 ? '大型' : '中等'}复杂度的模板。`,
        icon: <Eye className="w-5 h-5" />,
        tips: [
          '使用鼠标滚轮或双指捏合进行缩放',
          '拖拽画布进行平移浏览',
          '双击节点进入编辑模式'
        ]
      },
      {
        id: 'navigation',
        title: '导航技巧',
        description: '在大型画布中高效导航的方法',
        icon: <Navigation className="w-5 h-5" />,
        tips: [
          '使用右下角的缩放控件',
          '点击"回到原点"按钮重置视图',
          '使用小地图功能快速定位'
        ],
        target: '.zoom-controls'
      },
      {
        id: 'performance',
        title: '性能优化',
        description: '确保流畅的编辑体验',
        icon: <Zap className="w-5 h-5" />,
        tips: [
          '大型模板会自动启用虚拟化渲染',
          '只有可见区域的节点会被渲染',
          '可以切换到列表视图以减轻渲染压力'
        ]
      }
    ];

    if (nodeCount > 30) {
      baseSteps.push({
        id: 'large-template',
        title: '大型模板处理',
        description: '专门针对大型模板的优化建议',
        icon: <Monitor className="w-5 h-5" />,
        tips: [
          '建议使用缩放功能聚焦感兴趣的区域',
          '可以使用搜索功能快速找到特定节点',
          '定期保存工作以避免数据丢失'
        ]
      });
    }

    if (hasComplexNodes) {
      baseSteps.push({
        id: 'content-handling',
        title: '内容处理',
        description: '处理复杂内容节点的技巧',
        icon: <BookOpen className="w-5 h-5" />,
        tips: [
          '长文本会自动折叠，点击展开查看完整内容',
          '支持HTML和表格格式的智能渲染',
          '使用增强渲染器获得更好的阅读体验'
        ]
      });
    }

    // 移动端特定步骤
    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      baseSteps.push({
        id: 'mobile',
        title: '移动端使用',
        description: '移动设备上的专门优化',
        icon: <Smartphone className="w-5 h-5" />,
        tips: [
          '长按显示工具菜单',
          '双击重置视图',
          '使用列表视图浏览所有节点',
          '紧凑模式可以提升性能'
        ]
      });
    }

    return baseSteps;
  };

  const helpSteps = generateHelpSteps(canvas);

  // 自动播放控制
  useEffect(() => {
    if (isAutoPlay && isVisible) {
      autoPlayRef.current = setInterval(() => {
        onStepChange?.((currentStep + 1) % helpSteps.length);
      }, 4000);
    } else if (autoPlayRef.current) {
      clearInterval(autoPlayRef.current);
      autoPlayRef.current = null;
    }

    return () => {
      if (autoPlayRef.current) {
        clearInterval(autoPlayRef.current);
      }
    };
  }, [isAutoPlay, isVisible, currentStep, helpSteps.length, onStepChange]);

  // 高亮目标元素
  useEffect(() => {
    const step = helpSteps[currentStep];
    if (step?.target) {
      setHighlightTarget(step.target);
    } else {
      setHighlightTarget(null);
    }
  }, [currentStep, helpSteps]);

  if (!isVisible) return null;

  const currentStepData = helpSteps[currentStep];

  return (
    <>
      {/* 背景遮罩 */}
      <div className="fixed inset-0 bg-black/20 dark:bg-black/60 backdrop-blur-sm z-40" onClick={onClose} />
      
      {/* 高亮覆盖层 */}
      {highlightTarget && (
        <div className="fixed inset-0 z-45 pointer-events-none">
          {/* 这里可以添加高亮逻辑，根据target选择器高亮特定元素 */}
        </div>
      )}

      {/* Help panel */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg mx-4">
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
          {/* Header */}
          <div className="bg-blue-600 dark:bg-blue-700 text-white p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <HelpCircle className="w-6 h-6" />
                <div>
                  <h2 className="font-semibold">Canvas Guide</h2>
                  <p className="text-sm text-blue-100 dark:text-blue-200">
                    {canvas.title || 'Canvas Help'}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-white hover:bg-accent/20 p-1 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mt-3">
              {(['guide', 'tips', 'performance'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1 rounded text-sm transition-colors ${
                    activeTab === tab
                      ? 'bg-white dark:bg-zinc-100 text-blue-600 dark:text-blue-700'
                      : 'text-blue-100 dark:text-blue-200 hover:bg-accent/20'
                  }`}
                >
                  {tab === 'guide' ? 'Guide' : tab === 'tips' ? 'Tips' : 'Performance'}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="p-4">
            {activeTab === 'guide' && (
              <div className="space-y-4">
                {/* 当前步骤 */}
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-10 h-10 bg-blue-100 dark:bg-blue-900/35 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-200">
                    {currentStepData.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 dark:text-zinc-100 mb-1">
                      {currentStepData.title}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-zinc-300 mb-3">
                      {currentStepData.description}
                    </p>
                    
                    {/* 提示列表 */}
                    <ul className="space-y-1">
                      {currentStepData.tips.map((tip, index) => (
                        <li key={index} className="flex items-start gap-2 text-xs text-gray-700 dark:text-zinc-300">
                          <div className="w-1 h-1 bg-blue-500 rounded-full mt-1.5 flex-shrink-0" />
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Step navigation */}
                <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-zinc-700">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onStepChange?.(Math.max(0, currentStep - 1))}
                      disabled={currentStep === 0}
                      className="p-2 text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    
                    <span className="text-sm text-gray-600 dark:text-zinc-300">
                      {currentStep + 1} / {helpSteps.length}
                    </span>
                    
                    <button
                      onClick={() => onStepChange?.(Math.min(helpSteps.length - 1, currentStep + 1))}
                      disabled={currentStep === helpSteps.length - 1}
                      className="p-2 text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Auto play toggle */}
                  <button
                    onClick={() => setIsAutoPlay(!isAutoPlay)}
                    className="flex items-center gap-1 px-3 py-1 text-sm text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/25 rounded"
                  >
                    {isAutoPlay ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    {isAutoPlay ? 'Pause' : 'Auto'}
                  </button>
                </div>

                {/* 步骤指示器 */}
                <div className="flex gap-1 justify-center pt-2">
                  {helpSteps.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => onStepChange?.(index)}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        index === currentStep ? 'bg-blue-500 dark:bg-blue-400' : 'bg-gray-300 dark:bg-zinc-600'
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'tips' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb className="w-5 h-5 text-yellow-500 dark:text-yellow-300" />
                  <h3 className="font-medium text-gray-900 dark:text-zinc-100">Tips</h3>
                </div>

                <div className="space-y-3">
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 rounded-lg">
                    <h4 className="font-medium text-blue-900 dark:text-blue-200 text-sm mb-1">Keyboard Shortcuts</h4>
                    <ul className="text-xs text-blue-700 dark:text-blue-200/90 space-y-1">
                      <li>• Ctrl/Cmd + Scroll: Zoom</li>
                      <li>• Space + Drag: Pan</li>
                      <li>• Esc: Exit edit mode</li>
                    </ul>
                  </div>

                  <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800/40 rounded-lg">
                    <h4 className="font-medium text-green-900 dark:text-green-200 text-sm mb-1">Performance Tips</h4>
                    <ul className="text-xs text-green-700 dark:text-green-200/90 space-y-1">
                      <li>• Close unnecessary browser tabs</li>
                      <li>• Clear browser cache periodically</li>
                      <li>• Use a modern browser for best performance</li>
                    </ul>
                  </div>

                  <div className="p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800/40 rounded-lg">
                    <h4 className="font-medium text-purple-900 dark:text-purple-200 text-sm mb-1">Editing Tips</h4>
                    <ul className="text-xs text-purple-700 dark:text-purple-200/90 space-y-1">
                      <li>• Double‑click a node to edit quickly</li>
                      <li>• Markdown formatting is supported</li>
                      <li>• Auto‑save prevents data loss</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'performance' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-5 h-5 text-green-500 dark:text-green-300" />
                  <h3 className="font-medium text-gray-900 dark:text-zinc-100">Performance</h3>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-gray-50 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-700 rounded-lg">
                    <div className="text-lg font-semibold text-gray-900 dark:text-zinc-100">
                      {canvas.nodes.length}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-zinc-300">Total nodes</div>
                  </div>

                  <div className="p-3 bg-gray-50 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-700 rounded-lg">
                    <div className="text-lg font-semibold text-gray-900 dark:text-zinc-100">
                      {canvas.nodes.length > 30 ? 'Large' : 'Medium'}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-zinc-300">Complexity</div>
                  </div>
                </div>

                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800/40 rounded-lg">
                  <h4 className="font-medium text-yellow-800 dark:text-yellow-200 text-sm mb-2">Optimization</h4>
                  <ul className="text-xs text-yellow-700 dark:text-yellow-100/90 space-y-1">
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full" />
                      Virtualization: enabled
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full" />
                      Lazy loading: enabled
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-blue-500 rounded-full" />
                      Content caching: auto‑managed
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default HelpSystem;
