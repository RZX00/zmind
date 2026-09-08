/**
 * 🎯 节点对齐面板组件
 * 
 * 显示在左侧样式栏中的对齐控制面板 - 弹出式设计
 * 当选中2个或更多节点时显示为一个小按钮
 * 点击后弹出完整的对齐选项子菜单
 * 
 * @version 2.0.0
 * @author ZhenZhi Canvas Team
 */

import React, { useState, useCallback, useEffect } from 'react';
import { 
  AlignStartHorizontal, 
  AlignEndHorizontal, 
  AlignStartVertical,
  AlignEndVertical,
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  ArrowRightLeft,
  ArrowUpDown,
  Loader2,
  MoreHorizontal,
  Undo,
  Redo,
  History,
  ArrowLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Canvas, CanvasNode } from '../../../../types/canvas';
import { AlignmentType, type AlignmentOptions } from '../../../types/node-alignment';
import { NodeAlignmentService } from '../../../services/canvas-node-alignment.service';
import { CanvasAlignmentAnimationService } from '../../../services/canvas-alignment-animation.service';
import { useAlignmentHistory } from '../../../hooks/useAlignmentHistory';

// ==================== 接口定义 ====================

interface AlignmentPanelProps {
  /** 选中的节点列表 */
  selectedNodes: CanvasNode[];
  /** 对齐操作回调 */
  onAlignment: (nodes: CanvasNode[], type: AlignmentType) => void;
  /** 对齐选项 */
  alignmentOptions?: AlignmentOptions;
  /** 是否启用动画 */
  enableAnimation?: boolean;
  /** 动画时长 */
  animationDuration?: number;
  /** 子面板状态变化回调 - 通知父组件是否有子面板打开 */
  onSubPanelStateChange?: (hasSubPanel: boolean) => void;
}

interface AlignmentButton {
  type: AlignmentType;
  icon: React.ComponentType<any>;
  label: string;
}

// ==================== 配置常量 ====================

const ALIGNMENT_BUTTONS: AlignmentButton[] = [
  { type: AlignmentType.LEFT, icon: AlignStartVertical, label: '左对齐' },
  { type: AlignmentType.RIGHT, icon: AlignEndVertical, label: '右对齐' },
  { type: AlignmentType.TOP, icon: AlignStartHorizontal, label: '顶部对齐' },
  { type: AlignmentType.BOTTOM, icon: AlignEndHorizontal, label: '底部对齐' },
  { type: AlignmentType.CENTER_H, icon: AlignHorizontalJustifyCenter, label: '水平居中' },
  { type: AlignmentType.CENTER_V, icon: AlignVerticalJustifyCenter, label: '垂直居中' }
];

// 分布对齐按钮（需要至少3个节点）
const DISTRIBUTION_BUTTONS: AlignmentButton[] = [
  { type: AlignmentType.DISTRIBUTE_H, icon: ArrowRightLeft, label: '水平分布' },
  { type: AlignmentType.DISTRIBUTE_V, icon: ArrowUpDown, label: '垂直分布' }
];

// ==================== 主组件 ====================

export const AlignmentPanel: React.FC<AlignmentPanelProps> = ({
  selectedNodes,
  onAlignment,
  alignmentOptions = {},
  enableAnimation = true,
  animationDuration = 400,
  onSubPanelStateChange
}) => {
  // ==================== 状态管理 ====================
  
  const [isSubMenuOpen, setIsSubMenuOpen] = useState(false); // 默认收起，由useEffect控制
  const [isAligning, setIsAligning] = useState(false);
  const [activeAlignmentType, setActiveAlignmentType] = useState<AlignmentType | null>(null);

  // ==================== 历史记录 ====================
  
  const {
    canUndo,
    canRedo,
    nextUndoDescription,
    nextRedoDescription,
    recordAlignment,
    undo,
    redo,
    totalEntries
  } = useAlignmentHistory({
    enableKeyboardShortcuts: true,
    onUndo: (result) => {
      if (result.success && result.nodes) {
        onAlignment(result.nodes, result.entry?.alignmentType || AlignmentType.LEFT);
      }
    },
    onRedo: (result) => {
      if (result.success && result.nodes) {
        onAlignment(result.nodes, result.entry?.alignmentType || AlignmentType.LEFT);
      }
    }
  });

  // ==================== 计算属性 ====================
  
  const nodeCount = selectedNodes.length;
  const isValidSelection = nodeCount >= 2;
  const isValidDistributionSelection = nodeCount >= 3;

  // ==================== 事件处理 ====================
  
  const handleAlignment = useCallback(async (alignmentType: AlignmentType) => {
    // 边界检查：避免重复执行和无效操作
    if (!isValidSelection || isAligning || selectedNodes.length === 0) return;

    setIsAligning(true);
    setActiveAlignmentType(alignmentType);

    try {
      // 记录操作前的节点状态
      const beforeNodes = selectedNodes.map(node => ({ ...node }));
      
      // 调用对齐服务
      const result = NodeAlignmentService.align(selectedNodes, alignmentType, alignmentOptions);
      
      // 记录到历史
      recordAlignment(beforeNodes, result.alignedNodes, alignmentType, alignmentOptions);
      
      if (enableAnimation && result.movedCount > 0) {
        // 设置原始节点缓存用于动画
        CanvasAlignmentAnimationService.setOriginalNodesCache(selectedNodes);
        
        // 计算动态时长（基于移动距离）- 大幅提升速度！
        const ANIMATION_SPEED = 4000; // px/s (提升4倍速度)
        const dynamicDuration = CanvasAlignmentAnimationService.calculateDynamicDuration(
          selectedNodes, 
          result.alignedNodes, 
          ANIMATION_SPEED
        );
        
        // 使用快速流畅动画
        await CanvasAlignmentAnimationService.animateAlignment(
          selectedNodes,
          result.alignedNodes,
          {
            enabled: true,
            duration: Math.min(150, dynamicDuration), // 减少最大时长到150ms
            easing: 'ease-in-out', // 更流畅的缓动
            showPath: false // 取消路径显示，提升性能
          },
          {
            onUpdate: (animatingNodes) => {
              // 实时更新节点位置
              onAlignment(animatingNodes, alignmentType);
            },
            onComplete: () => {
              // 动画完成，确保最终位置正确
              onAlignment(result.alignedNodes, alignmentType);
            }
          }
        );
      } else {
        // 直接对齐，无动画
        onAlignment(result.alignedNodes, alignmentType);
      }
      
      // 对齐完成后，关闭展开面板
      setIsSubMenuOpen(false);
      
    } catch (error) {
      // TODO: 添加用户友好的错误提示
    } finally {
      setIsAligning(false);
      setActiveAlignmentType(null);
    }
  }, [selectedNodes, isValidSelection, isAligning, alignmentOptions, onAlignment, enableAnimation, recordAlignment]);


  // 统一显示策略：所有情况下都默认收起，需要手动点击
  useEffect(() => {
    // 当选中节点发生变化时，重置为收起状态
    setIsSubMenuOpen(false);
  }, [selectedNodes.length]);

  // 当选中节点发生变化时，重置对齐状态
  useEffect(() => {
    setActiveAlignmentType(null);
    setIsAligning(false);
  }, [selectedNodes.length]);

  // 子面板状态通知
  useEffect(() => {
    onSubPanelStateChange?.(isSubMenuOpen);
  }, [isSubMenuOpen, onSubPanelStateChange]);

  // ==================== 渲染 ====================
  
  // 如果选中节点数量不足，不显示面板
  if (!isValidSelection) return null;


  return (
    <AnimatePresence mode="popLayout">
      {!isSubMenuOpen ? (
        // 🎯 对齐触发按钮 - 超快动画减少空白
        <motion.button
          key="trigger"
          initial={{ opacity: 1, scale: 1 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.08, ease: [0.4, 0, 0.2, 1] }}
          onClick={() => setIsSubMenuOpen(true)}
          className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md relative text-gray-600 dark:text-zinc-300"
          title={`节点对齐 (${nodeCount} 个节点)`}
        >
          <MoreHorizontal size={16} />
          {/* 节点数量指示器 */}
          <div className="absolute -bottom-1 -right-1 text-xs text-gray-400 dark:text-zinc-500 bg-white dark:bg-zinc-800 rounded px-1 text-[10px] leading-tight">
            {nodeCount}
          </div>
        </motion.button>
      ) : (
        // 🎨 对齐子菜单 - 超快进入，减少空白时间
        <motion.div
          key="submenu"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.08, ease: [0.4, 0, 0.2, 1] }}
          className="flex flex-col gap-2"
        >
          {/* 返回按钮和标题 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSubMenuOpen(false)}
              className="w-6 h-6 rounded flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 text-gray-500 dark:text-zinc-400"
              title="返回主面板"
            >
              <ArrowLeft size={12} />
            </button>
            <span className="text-xs text-gray-600 dark:text-zinc-300">对齐选项</span>
          </div>

          {/* 基础对齐按钮 - 3列网格 */}
          <div className="grid grid-cols-3 gap-1">
            {ALIGNMENT_BUTTONS.map((button) => {
              const Icon = button.icon;
              const isActive = activeAlignmentType === button.type;
              const isDisabled = !isValidSelection || isAligning;
              
              return (
                <motion.button
                  key={button.type}
                  className={`
                    w-8 h-8 rounded flex items-center justify-center transition-all duration-200 text-xs
                    ${isActive 
                      ? 'bg-blue-100/80 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' 
                      : 'text-gray-600 dark:text-zinc-300 hover:bg-accent/60'
                    }
                    ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                  onClick={() => handleAlignment(button.type)}
                  disabled={isDisabled}
                  whileHover={!isDisabled ? { scale: 1.05 } : {}}
                  whileTap={!isDisabled ? { scale: 0.95 } : {}}
                  title={button.label}
                >
                  {isActive && isAligning ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Icon size={14} />
                  )}
                </motion.button>
              );
            })}
          </div>

          {/* 分布对齐按钮（需要3个及以上节点）*/}
          {isValidDistributionSelection && (
            <>
              <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 my-1" />
              <div className="grid grid-cols-2 gap-1">
                {DISTRIBUTION_BUTTONS.map((button) => {
                  const Icon = button.icon;
                  const isActive = activeAlignmentType === button.type;
                  const isDisabled = !isValidDistributionSelection || isAligning;
                  
                  return (
                    <motion.button
                      key={button.type}
                    className={`
                        w-8 h-8 rounded flex items-center justify-center transition-all duration-200 text-xs
                        ${isActive 
                          ? 'bg-green-100/80 text-green-700' 
                          : 'text-gray-600 dark:text-zinc-300 hover:bg-accent/60'
                        }
                        ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                      `}
                      onClick={() => handleAlignment(button.type)}
                      disabled={isDisabled}
                      whileHover={!isDisabled ? { scale: 1.05 } : {}}
                      whileTap={!isDisabled ? { scale: 0.95 } : {}}
                      title={button.label}
                    >
                      {isActive && isAligning ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Icon size={14} />
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </>
          )}

          {/* 历史控制按钮区域 */}
          {totalEntries > 0 && (
            <>
              <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 my-1" />
              <div className="grid grid-cols-2 gap-1">
                <motion.button
                  className={`
                    w-8 h-8 rounded flex items-center justify-center transition-all duration-200 text-xs
                    ${canUndo 
                      ? 'text-gray-600 dark:text-zinc-300 hover:bg-accent/60' 
                      : 'text-gray-300 dark:text-zinc-600 cursor-not-allowed'
                    }
                  `}
                  onClick={undo}
                  disabled={!canUndo}
                  whileHover={canUndo ? { scale: 1.05 } : {}}
                  whileTap={canUndo ? { scale: 0.95 } : {}}
                  title={canUndo ? `撤销：${nextUndoDescription}` : '无法撤销'}
                >
                  <Undo size={14} />
                </motion.button>
                <motion.button
                  className={`
                    w-8 h-8 rounded flex items-center justify-center transition-all duration-200 text-xs
                    ${canRedo 
                      ? 'text-gray-600 dark:text-zinc-300 hover:bg-accent/60' 
                      : 'text-gray-300 dark:text-zinc-600 cursor-not-allowed'
                    }
                  `}
                  onClick={redo}
                  disabled={!canRedo}
                  whileHover={canRedo ? { scale: 1.05 } : {}}
                  whileTap={canRedo ? { scale: 0.95 } : {}}
                  title={canRedo ? `重做：${nextRedoDescription}` : '无法重做'}
                >
                  <Redo size={14} />
                </motion.button>
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ==================== 导出 ====================

export default AlignmentPanel;

/**
 * 🎯 使用示例：
 * 
 * ```tsx
 * <AlignmentPanel
 *   selectedNodes={selectedNodes}
 *   onAlignment={(alignedNodes, type) => {
 *     // 处理对齐结果
 *     updateCanvasNodes(alignedNodes);
 *   }}
 *   alignmentOptions={{
 *     preserveZIndex: true,
 *     alignTo: 'selection',
 *     boundaryCheck: true
 *   }}
 *   enableAnimation={true}
 *   animationDuration={400}
 *   onSubPanelStateChange={(hasSubPanel) => {
 *     // 通知父组件子面板状态变化
 *   }}
 * />
 * ```
 * 
 * ✨ 新特性：统一的弹出式设计
 * - 所有情况下都显示一个小按钮（节点对齐按钮）
 * - 点击后进入独立子菜单，替换其他工具栏按钮
 * - 对齐完成后自动关闭子菜单
 * - 与其他样式按钮保持一致的交互层级
 */
