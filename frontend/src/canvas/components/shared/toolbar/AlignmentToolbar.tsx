/**
 * 🎯 节点对齐工具栏组件
 * 
 * 当用户选择2个或以上节点时自动显示的浮动工具栏
 * 提供6种标准对齐功能：左对齐、右对齐、顶部对齐、底部对齐、水平居中、垂直居中
 * 
 * @version 1.0.0
 * @author ZhenZhi Canvas Team
 */

import React, { useState, useCallback } from 'react';
import { 
  AlignStartHorizontal,
  AlignEndHorizontal,
  AlignStartVertical,
  AlignEndVertical,
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  Loader2,
  Eye,
  EyeOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Canvas, CanvasNode } from '../../../../types/canvas';
import { AlignmentType, type AlignmentOptions, type AlignmentPreview } from '../../../types/node-alignment';
import { NodeAlignmentService } from '../../../services/canvas-node-alignment.service';
import { CanvasAlignmentAnimationService } from '../../../services/canvas-alignment-animation.service';
import AlignmentPreviewComponent from '../alignment/AlignmentPreview';

// ==================== 接口定义 ====================

interface AlignmentToolbarProps {
  /** 当前选中的节点列表 */
  selectedNodes: CanvasNode[];
  /** 工具栏位置 */
  position: {
    x: number;
    y: number;
  };
  /** 是否显示工具栏 */
  visible: boolean;
  /** 对齐操作完成回调 */
  onAlignment: (alignedNodes: CanvasNode[], alignmentType: AlignmentType) => void;
  /** 工具栏主题 */
  theme?: 'light' | 'dark';
  /** 是否显示工具提示 */
  showTooltips?: boolean;
  /** 对齐选项 */
  alignmentOptions?: AlignmentOptions;
  /** 画布变换状态（用于预览） */
  canvasTransform?: {
    scale: number;
    positionX: number;
    positionY: number;
  };
  /** 是否启用预览 */
  enablePreview?: boolean;
  /** 是否启用动画 */
  enableAnimation?: boolean;
  /** 动画时长（毫秒） */
  animationDuration?: number;
}

interface AlignmentButton {
  type: AlignmentType;
  icon: React.ComponentType<any>;
  label: string;
  shortcut: string;
}

// ==================== 配置常量 ====================

/** 对齐按钮配置 */
const ALIGNMENT_BUTTONS: AlignmentButton[] = [
  {
    type: AlignmentType.LEFT,
    icon: AlignStartVertical,
    label: '左对齐',
    shortcut: 'Ctrl+L'
  },
  {
    type: AlignmentType.RIGHT,
    icon: AlignEndVertical,
    label: '右对齐',
    shortcut: 'Ctrl+R'
  },
  {
    type: AlignmentType.TOP,
    icon: AlignStartHorizontal,
    label: '顶部对齐',
    shortcut: 'Ctrl+T'
  },
  {
    type: AlignmentType.BOTTOM,
    icon: AlignEndHorizontal,
    label: '底部对齐',
    shortcut: 'Ctrl+B'
  },
  {
    type: AlignmentType.CENTER_H,
    icon: AlignHorizontalJustifyCenter,
    label: '水平居中',
    shortcut: 'Ctrl+E'
  },
  {
    type: AlignmentType.CENTER_V,
    icon: AlignVerticalJustifyCenter,
    label: '垂直居中',
    shortcut: 'Ctrl+M'
  }
];

/** 动画配置 */
const TOOLBAR_ANIMATION = {
  initial: { opacity: 0, scale: 0.8, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.8, y: 10 },
  transition: { duration: 0.2, ease: 'easeOut' as any }
};

const BUTTON_ANIMATION = {
  whileHover: { scale: 1.05 },
  whileTap: { scale: 0.95 }
};

// ==================== 主组件 ====================

export const AlignmentToolbar: React.FC<AlignmentToolbarProps> = ({
  selectedNodes,
  position,
  visible,
  onAlignment,
  theme = 'light',
  showTooltips = true,
  alignmentOptions = {},
  canvasTransform,
  enablePreview = true,
  enableAnimation = true,
  animationDuration = 400
}) => {
  // ==================== 状态管理 ====================
  
  const [isAligning, setIsAligning] = useState(false);
  const [activeAlignmentType, setActiveAlignmentType] = useState<AlignmentType | null>(null);
  const [previewData, setPreviewData] = useState<AlignmentPreview | null>(null);
  const [isPreviewEnabled, setIsPreviewEnabled] = useState(enablePreview);

  // ==================== 样式计算 ====================
  
  const isDark = theme === 'dark';
  const nodeCount = selectedNodes.length;
  const isValidSelection = nodeCount >= 2;

  const toolbarClasses = `
    fixed z-50 flex items-center gap-1 p-2 rounded-lg shadow-lg border backdrop-blur-sm
    ${isDark 
      ? 'bg-gray-800/90 border-gray-600 text-white' 
      : 'bg-white/90 border-gray-200 text-gray-800'
    }
    ${!isValidSelection ? 'opacity-50 pointer-events-none' : ''}
  `.trim();

  const buttonBaseClasses = `
    p-2 rounded-md transition-all duration-200 flex items-center justify-center
    hover:bg-accent/60 active:bg-accent/80
  `.trim();

  // ==================== 事件处理 ====================
  
  // 预览功能
  const generatePreview = useCallback((alignmentType: AlignmentType) => {
    if (!isPreviewEnabled || !isValidSelection) return;

    try {
      const result = NodeAlignmentService.align(selectedNodes, alignmentType, alignmentOptions);
      const positions = new Map(
        result.alignedNodes.map(node => [node.id, { x: node.x, y: node.y }])
      );

      setPreviewData({
        positions,
        alignmentLine: result.alignmentLine,
        alignmentType,
        showPreview: true
      });
    } catch (error) {
      console.error('生成预览失败:', error);
    }
  }, [selectedNodes, alignmentOptions, isValidSelection, isPreviewEnabled]);

  const clearPreview = useCallback(() => {
    setPreviewData(null);
  }, []);

  const handleAlignment = useCallback(async (alignmentType: AlignmentType) => {
    if (!isValidSelection || isAligning) return;

    setIsAligning(true);
    setActiveAlignmentType(alignmentType);
    clearPreview(); // 清除预览

    try {
      // 调用对齐服务
      const result = NodeAlignmentService.align(selectedNodes, alignmentType, alignmentOptions);
      
      if (enableAnimation && result.movedCount > 0) {
        // 设置原始节点缓存用于动画
        CanvasAlignmentAnimationService.setOriginalNodesCache(selectedNodes);
        
        // 计算动态时长
        const dynamicDuration = CanvasAlignmentAnimationService.calculateDynamicDuration(
          selectedNodes, 
          result.alignedNodes, 
          1000 // 1000px/s
        );
        
        // 使用动画
        await CanvasAlignmentAnimationService.animateAlignment(
          selectedNodes,
          result.alignedNodes,
          {
            enabled: true,
            duration: Math.min(animationDuration, dynamicDuration),
            easing: 'ease-out',
            showPath: true
          },
          {
            onUpdate: (animatingNodes) => {
              // 实时更新节点位置
              onAlignment(animatingNodes, alignmentType);
            },
            onComplete: () => {
              // 动画完成，确保最终位置正确
              onAlignment(result.alignedNodes, alignmentType);
              console.log(`✅ 对齐动画完成: ${alignmentType}, 移动了 ${result.movedCount} 个节点`);
            }
          }
        );
      } else {
        // 直接对齐，无动画
        onAlignment(result.alignedNodes, alignmentType);
        console.log(`✅ 对齐完成: ${alignmentType}, 移动了 ${result.movedCount} 个节点`);
      }
      
    } catch (error) {
      console.error('❌ 对齐操作失败:', error);
    } finally {
      setIsAligning(false);
      setActiveAlignmentType(null);
    }
  }, [selectedNodes, isValidSelection, isAligning, alignmentOptions, onAlignment, clearPreview, enableAnimation, animationDuration]);

  // ==================== 工具提示组件 ====================
  
  const Tooltip: React.FC<{ label: string; shortcut: string; children: React.ReactNode }> = ({ 
    label, 
    shortcut, 
    children 
  }) => (
    <div className="relative group">
      {children}
      {showTooltips && (
        <div className={`
          absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 rounded text-xs whitespace-nowrap
          opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-60
          ${isDark ? 'bg-gray-900 text-white' : 'bg-black text-white'}
        `}>
          {label}
          <span className="ml-2 opacity-70">{shortcut}</span>
          <div className={`
            absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-2 border-r-2 border-b-0 border-l-transparent border-r-transparent
            ${isDark ? 'border-t-gray-900' : 'border-t-black'}
          `} />
        </div>
      )}
    </div>
  );

  // ==================== 渲染 ====================
  
  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        className={toolbarClasses}
        style={{
          left: position.x,
          top: position.y - 60, // 工具栏显示在选择区域上方
        }}
        {...TOOLBAR_ANIMATION}
      >
        {/* 节点数量显示 */}
        <div className={`
          text-xs px-2 py-1 rounded mr-1 font-medium
          ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}
        `}>
          {nodeCount} 个节点
        </div>

        {/* 分隔线 */}
        <div className={`
          w-px h-6 mx-1
          ${isDark ? 'bg-gray-600' : 'bg-gray-300'}
        `} />

        {/* 预览切换按钮 */}
        {enablePreview && (
          <>
            <Tooltip label={isPreviewEnabled ? '关闭预览' : '开启预览'} shortcut="">
              <motion.button
                className={`
                  ${buttonBaseClasses}
                  ${isPreviewEnabled ? (isDark ? 'bg-blue-600' : 'bg-blue-500 text-white') : ''}
                `}
                onClick={() => {
                  setIsPreviewEnabled(!isPreviewEnabled);
                  if (!isPreviewEnabled) {
                    clearPreview();
                  }
                }}
                {...BUTTON_ANIMATION}
              >
                {isPreviewEnabled ? <Eye size={16} /> : <EyeOff size={16} />}
              </motion.button>
            </Tooltip>

            <div className={`
              w-px h-6 mx-1
              ${isDark ? 'bg-gray-600' : 'bg-gray-300'}
            `} />
          </>
        )}

        {/* 对齐按钮组 */}
        {ALIGNMENT_BUTTONS.map((button) => {
          const Icon = button.icon;
          const isActive = activeAlignmentType === button.type;
          const isDisabled = !isValidSelection;
          
          return (
            <Tooltip key={button.type} label={button.label} shortcut={button.shortcut}>
              <motion.button
                className={`
                  ${buttonBaseClasses}
                  ${isActive ? (isDark ? 'bg-blue-600' : 'bg-blue-500 text-white') : ''}
                  ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}
                onClick={() => handleAlignment(button.type)}
                onMouseEnter={() => isPreviewEnabled && generatePreview(button.type)}
                onMouseLeave={clearPreview}
                disabled={isDisabled || isAligning}
                {...BUTTON_ANIMATION}
              >
                {isActive && isAligning ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Icon size={16} />
                )}
              </motion.button>
            </Tooltip>
          );
        })}

        {/* 加载指示器（如果正在对齐） */}
        {isAligning && (
          <div className={`
            ml-2 text-xs flex items-center gap-1
            ${isDark ? 'text-gray-400' : 'text-gray-500'}
          `}>
            <Loader2 size={12} className="animate-spin" />
            正在对齐...
          </div>
        )}

        {/* 预览组件 */}
        {isPreviewEnabled && previewData && canvasTransform && (
          <AlignmentPreviewComponent
            preview={previewData}
            originalNodes={selectedNodes}
            transform={canvasTransform}
            showMovementPaths={true}
            showDistanceLabels={false}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
};

// ==================== 导出 ====================

export default AlignmentToolbar;

/**
 * 🎯 使用示例：
 * 
 * ```tsx
 * <AlignmentToolbar
 *   selectedNodes={selectedNodes}
 *   position={{ x: 100, y: 200 }}
 *   visible={selectedNodes.length >= 2}
 *   onAlignment={(alignedNodes, type) => {
 *     // 更新canvas中的节点
 *     updateCanvasNodes(alignedNodes);
 *   }}
 *   theme="light"
 *   showTooltips={true}
 *   alignmentOptions={{
 *     preserveZIndex: true,
 *     alignTo: 'selection',
 *     boundaryCheck: true
 *   }}
 * />
 * ```
 */
