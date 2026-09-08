// 🎛️ 连线曲率控制器组件
// 提供可视化的中点控制器，支持拖拽调整连线曲率

import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { CanvasConnection } from '../../types/canvas';
import type { Position } from '../../utils/bezierUtils';
import {
  calculateControlPointPosition,
  isPointInControlArea,
  adjustControlPointsFromDrag,
  DEFAULT_SMART_CONFIG,
  type SmartConnectionConfig
} from '../../utils/smartConnectionAlgorithm';

interface ConnectionCurveControllerProps {
  connection: CanvasConnection;
  startPos: Position;
  endPos: Position;
  canvasBounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  scale: number;
  isSelected: boolean;
  onControlPointUpdate: (connectionId: string, newControlPoints: Position[]) => void;
  config?: SmartConnectionConfig;
}

const ConnectionCurveController: React.FC<ConnectionCurveControllerProps> = ({
  connection,
  startPos,
  endPos,
  canvasBounds,
  scale,
  isSelected,
  onControlPointUpdate,
  config = DEFAULT_SMART_CONFIG
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [dragStartPos, setDragStartPos] = useState<Position | null>(null);
  const [initialControlPoints, setInitialControlPoints] = useState<Position[]>([]);

  const controllerRef = useRef<SVGGElement>(null);

  // 🎯 计算控制器位置
  const controllerPosition = calculateControlPointPosition(
    startPos,
    endPos,
    connection.controlPoints || []
  );

  // 📐 转换为屏幕坐标
  const screenPos = {
    x: (controllerPosition.x - canvasBounds.minX) * scale,
    y: (controllerPosition.y - canvasBounds.minY) * scale
  };

  // 🎨 控制器样式计算
  const controllerRadius = config.controlPointRadius;
  const controllerStyle = {
    cursor: isDragging ? 'grabbing' : 'grab',
    opacity: isSelected ? (isHovered || isDragging ? 1.0 : 0.8) : 0.0,
    transition: isDragging ? 'none' : 'opacity 0.2s ease-out',
    transform: `scale(${isHovered || isDragging ? 1.2 : 1.0})`,
    transformOrigin: 'center'
  };

  // 🖱️ 鼠标按下事件
  

  // 🖱️ 全局鼠标移动处理
  const handleGlobalMouseMove = useCallback((event: MouseEvent) => {
    if (!isDragging || !dragStartPos) return;

    const deltaX = event.clientX - dragStartPos.x;
    const deltaY = event.clientY - dragStartPos.y;

    // 转换为画布坐标系的拖拽向量
    const dragVector: Position = {
      x: deltaX / scale,
      y: deltaY / scale
    };

    // 🎯 根据拖拽调整控制点
    const newControlPoints = adjustControlPointsFromDrag(
      startPos,
      endPos,
      initialControlPoints,
      dragVector,
      config
    );

    // 通知父组件更新控制点
    onControlPointUpdate(connection.id, newControlPoints);
  }, [isDragging, dragStartPos, scale, startPos, endPos, initialControlPoints, connection.id, onControlPointUpdate, config]);

  // 🖱️ 全局鼠标抬起处理
  const handleGlobalMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragStartPos(null);
    setInitialControlPoints([]);

    // 移除全局监听
    document.removeEventListener('mousemove', handleGlobalMouseMove);
    document.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [handleGlobalMouseMove]);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const canvasRect = (event.target as Element).closest('svg')?.getBoundingClientRect();
    if (!canvasRect) return;

    setIsDragging(true);
    setDragStartPos({
      x: event.clientX,
      y: event.clientY
    });

    // 保存初始控制点
    setInitialControlPoints(connection.controlPoints || []);

    // 添加全局鼠标监听
    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);
  }, [connection.controlPoints, handleGlobalMouseMove, handleGlobalMouseUp]);

  // 🧹 组件卸载时清理事件监听
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [handleGlobalMouseMove, handleGlobalMouseUp]);

  // 🔍 鼠标悬停处理
  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!isDragging) {
      setIsHovered(false);
    }
  }, [isDragging]);

  // 📋 只在连线被选中且有控制点时显示控制器
  const shouldRenderController = isSelected && connection.type === 'bezier' && connection.controlPoints;

  if (!shouldRenderController) {
    return null;
  }

  return (
    <g
      ref={controllerRef}
      className="connection-curve-controller"
      style={controllerStyle}
      transform={`translate(${screenPos.x}, ${screenPos.y})`}
    >
      {/* 外圈 - 点击区域扩大 */}
      <circle
        r={config.controlPointTolerance}
        fill="transparent"
        onMouseDown={handleMouseDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: controllerStyle.cursor }}
      />

      {/* 背景圆 - 白色背景 */}
      <circle
        r={controllerRadius + 2}
        fill="white"
        stroke="rgba(0, 0, 0, 0.1)"
        strokeWidth="1"
        style={{ pointerEvents: 'none' }}
      />

      {/* 主控制点 - 蓝色 */}
      <circle
        r={controllerRadius}
        fill={isDragging ? "#2563eb" : "#3b82f6"}
        stroke="white"
        strokeWidth="2"
        style={{ pointerEvents: 'none' }}
      />

      {/* 中心点 - 白色点缀 */}
      <circle
        r={2}
        fill="white"
        style={{ pointerEvents: 'none' }}
      />

      {/* 拖拽状态的发光效果 */}
      {isDragging && (
        <circle
          r={controllerRadius + 4}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
          opacity="0.5"
          style={{ pointerEvents: 'none' }}
        >
          <animate
            attributeName="stroke-opacity"
            values="0.5;0.8;0.5"
            dur="1s"
            repeatCount="indefinite"
          />
        </circle>
      )}

      {/* 工具提示背景 */}
      {(isHovered || isDragging) && (
        <g transform="translate(0, -30)">
          <rect
            x="-25"
            y="-12"
            width="50"
            height="20"
            rx="4"
            fill="rgba(0, 0, 0, 0.8)"
            style={{ pointerEvents: 'none' }}
          />
          <text
            x="0"
            y="-2"
            textAnchor="middle"
            fill="white"
            fontSize="11"
            fontFamily="sans-serif"
            style={{ pointerEvents: 'none' }}
          >
            拖拽调整
          </text>
        </g>
      )}
    </g>
  );
};

export default ConnectionCurveController;
