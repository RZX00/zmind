/**
 * 🎯 对齐预览组件
 * 
 * 显示对齐操作的预览效果，包括：
 * - 对齐基准线（虚线）
 * - 节点移动路径（箭头）
 * - 节点目标位置（虚线框）
 * 
 * @version 1.0.0
 * @author ZhenZhi Canvas Team
 */

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Canvas, CanvasNode } from '../../../../types/canvas';
import type { AlignmentPreview as AlignmentPreviewModel, PreviewLineStyle } from '../../../types/node-alignment';
import { AlignmentType } from '../../../types/node-alignment';

// ==================== 接口定义 ====================

interface AlignmentPreviewProps {
  /** 预览数据 */
  preview: AlignmentPreviewModel;
  /** 原始节点列表 */
  originalNodes: CanvasNode[];
  /** 画布缩放变换状态 */
  transform?: {
    scale: number;
    positionX: number;
    positionY: number;
  };
  /** 预览线样式 */
  lineStyle?: PreviewLineStyle;
  /** 是否显示移动路径 */
  showMovementPaths?: boolean;
  /** 是否显示距离标签 */
  showDistanceLabels?: boolean;
}

// ==================== 配置常量 ====================

/** 默认预览线样式 */
const DEFAULT_LINE_STYLE: PreviewLineStyle = {
  color: '#3b82f6',
  width: 2,
  dashArray: '8,4',
  opacity: 0.8
};

/** 动画配置 */
const ANIMATION_CONFIG = {
  duration: 0.3,
  ease: 'easeOut' as any
};

/** SVG箭头标记ID */
const ARROW_MARKER_ID = 'alignment-arrow-marker';

// ==================== 工具函数 ====================

/**
 * 将画布坐标转换为SVG坐标
 */
function canvasToSVG(
  canvasPoint: { x: number; y: number }, 
  transform?: { scale: number; positionX: number; positionY: number }
): { x: number; y: number } {
  if (!transform) return canvasPoint;
  
  return {
    x: canvasPoint.x * transform.scale + transform.positionX,
    y: canvasPoint.y * transform.scale + transform.positionY
  };
}

/**
 * 计算移动距离
 */
function calculateDistance(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 格式化距离显示
 */
function formatDistance(distance: number): string {
  return distance < 1 ? `${Math.round(distance * 10) / 10}px` : `${Math.round(distance)}px`;
}

// ==================== 主组件 ====================

export const AlignmentPreview: React.FC<AlignmentPreviewProps> = ({
  preview,
  originalNodes,
  transform,
  lineStyle = DEFAULT_LINE_STYLE,
  showMovementPaths = true,
  showDistanceLabels = false
}) => {
  // ==================== 计算预览数据 ====================
  
  const previewData = useMemo(() => {
    if (!preview.showPreview) return null;

    const { positions, alignmentLine, alignmentType } = preview;
    
    // 获取移动的节点
    const movingNodes = originalNodes.filter(node => {
      const newPos = positions.get(node.id);
      return newPos && (newPos.x !== node.x || newPos.y !== node.y);
    });

    // 计算基准线的起点和终点
    let lineStart: { x: number; y: number };
    let lineEnd: { x: number; y: number };
    
    if ([AlignmentType.LEFT, AlignmentType.RIGHT, AlignmentType.CENTER_H].includes(alignmentType)) {
      // 垂直基准线
      const minY = Math.min(...originalNodes.map(node => node.y));
      const maxY = Math.max(...originalNodes.map(node => node.y + node.height));
      lineStart = { x: alignmentLine, y: minY - 20 };
      lineEnd = { x: alignmentLine, y: maxY + 20 };
    } else {
      // 水平基准线
      const minX = Math.min(...originalNodes.map(node => node.x));
      const maxX = Math.max(...originalNodes.map(node => node.x + node.width));
      lineStart = { x: minX - 20, y: alignmentLine };
      lineEnd = { x: maxX + 20, y: alignmentLine };
    }

    return {
      movingNodes,
      lineStart: canvasToSVG(lineStart, transform),
      lineEnd: canvasToSVG(lineEnd, transform),
      alignmentType
    };
  }, [preview, originalNodes, transform]);

  // ==================== 渲染 ====================
  
  if (!previewData) return null;

  const { movingNodes, lineStart, lineEnd, alignmentType } = previewData;

  return (
    <AnimatePresence>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          pointerEvents: 'none',
          zIndex: 999
        }}
      >
        <motion.svg
          style={{
            width: '100vw',
            height: '100vh',
            position: 'absolute',
            top: 0,
            left: 0
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: ANIMATION_CONFIG.duration }}
        >
          {/* 定义箭头标记 */}
          <defs>
            <marker
              id={ARROW_MARKER_ID}
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <polygon
                points="0 0, 10 3.5, 0 7"
                fill={lineStyle.color}
                opacity={lineStyle.opacity}
              />
            </marker>
          </defs>

          {/* 对齐基准线 */}
          <motion.line
            x1={lineStart.x}
            y1={lineStart.y}
            x2={lineEnd.x}
            y2={lineEnd.y}
            stroke={lineStyle.color}
            strokeWidth={lineStyle.width}
            strokeDasharray={lineStyle.dashArray}
            opacity={lineStyle.opacity}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ 
              duration: ANIMATION_CONFIG.duration,
              ease: ANIMATION_CONFIG.ease
            }}
          />

          {/* 移动路径和目标位置 */}
          {showMovementPaths && movingNodes.map(node => {
            const newPos = preview.positions.get(node.id);
            if (!newPos) return null;

            const currentPos = canvasToSVG({ x: node.x, y: node.y }, transform);
            const targetPos = canvasToSVG(newPos, transform);
            const distance = calculateDistance(currentPos, targetPos);

            // 如果距离太小，不显示移动路径
            if (distance < 5) return null;

            const pathMidX = (currentPos.x + targetPos.x) / 2;
            const pathMidY = (currentPos.y + targetPos.y) / 2;

            return (
              <g key={`movement-${node.id}`}>
                {/* 移动路径箭头 */}
                <motion.line
                  x1={currentPos.x}
                  y1={currentPos.y}
                  x2={targetPos.x}
                  y2={targetPos.y}
                  stroke={lineStyle.color}
                  strokeWidth={Math.max(1, lineStyle.width - 1)}
                  opacity={lineStyle.opacity * 0.6}
                  markerEnd={`url(#${ARROW_MARKER_ID})`}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: lineStyle.opacity * 0.6 }}
                  transition={{ 
                    duration: ANIMATION_CONFIG.duration,
                    delay: 0.1,
                    ease: ANIMATION_CONFIG.ease
                  }}
                />

                {/* 目标位置虚线框 */}
                <motion.rect
                  x={targetPos.x}
                  y={targetPos.y}
                  width={node.width * (transform?.scale || 1)}
                  height={node.height * (transform?.scale || 1)}
                  fill="none"
                  stroke={lineStyle.color}
                  strokeWidth={1}
                  strokeDasharray="4,2"
                  opacity={lineStyle.opacity * 0.5}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: lineStyle.opacity * 0.5, scale: 1 }}
                  transition={{ 
                    duration: ANIMATION_CONFIG.duration,
                    delay: 0.2,
                    ease: ANIMATION_CONFIG.ease
                  }}
                />

                {/* 距离标签 */}
                {showDistanceLabels && (
                  <motion.g
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ 
                      duration: ANIMATION_CONFIG.duration,
                      delay: 0.3,
                      ease: ANIMATION_CONFIG.ease
                    }}
                  >
                    {/* 标签背景 */}
                    <rect
                      x={pathMidX - 20}
                      y={pathMidY - 10}
                      width={40}
                      height={20}
                      fill="white"
                      stroke={lineStyle.color}
                      strokeWidth={1}
                      rx={4}
                      opacity={0.9}
                    />
                    {/* 距离文本 */}
                    <text
                      x={pathMidX}
                      y={pathMidY + 4}
                      textAnchor="middle"
                      fontSize={10}
                      fill={lineStyle.color}
                      fontWeight="500"
                    >
                      {formatDistance(distance)}
                    </text>
                  </motion.g>
                )}
              </g>
            );
          })}

          {/* 对齐类型标签 */}
          <motion.g
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ 
              duration: ANIMATION_CONFIG.duration,
              delay: 0.1,
              ease: ANIMATION_CONFIG.ease
            }}
          >
            <rect
              x={lineStart.x - 30}
              y={lineStart.y - 35}
              width={60}
              height={24}
              fill={lineStyle.color}
              rx={4}
              opacity={0.9}
            />
            <text
              x={lineStart.x}
              y={lineStart.y - 18}
              textAnchor="middle"
              fontSize={11}
              fill="white"
              fontWeight="600"
            >
              {getAlignmentLabel(alignmentType)}
            </text>
          </motion.g>
        </motion.svg>
      </div>
    </AnimatePresence>
  );
};

// ==================== 工具函数 ====================

function getAlignmentLabel(type: AlignmentType): string {
  switch (type) {
    case AlignmentType.LEFT: return '左对齐';
    case AlignmentType.RIGHT: return '右对齐';
    case AlignmentType.TOP: return '顶对齐';
    case AlignmentType.BOTTOM: return '底对齐';
    case AlignmentType.CENTER_H: return '水平居中';
    case AlignmentType.CENTER_V: return '垂直居中';
    default: return '对齐';
  }
}

// ==================== 导出 ====================

export default AlignmentPreview;

/**
 * 🎯 使用示例：
 * 
 * ```tsx
 * <AlignmentPreview
 *   preview={alignmentPreview}
 *   originalNodes={selectedNodes}
 *   transform={canvasTransform}
 *   showMovementPaths={true}
 *   showDistanceLabels={true}
 *   lineStyle={{
 *     color: '#3b82f6',
 *     width: 2,
 *     dashArray: '8,4',
 *     opacity: 0.8
 *   }}
 * />
 * ```
 */
