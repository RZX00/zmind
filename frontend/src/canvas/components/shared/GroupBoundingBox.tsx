// 🎯 群组边界框组件
// 显示选中群组的统一边界框和拖拽手柄，提供群组的视觉反馈

import React, { useMemo } from 'react';
import type { Canvas, CanvasNode, CanvasConnection, TemporaryGroup } from '../../types/canvas';
import { calculateGroupBounds } from '../core/systems/CoordinateSystem';

interface GroupBoundingBoxProps {
  group: TemporaryGroup | null;
  isVisible: boolean;
  nodes?: CanvasNode[]; // 🎯 新增：节点数组，用于实时计算边界
  connections?: CanvasConnection[]; // 🎯 新增：连接数组，用于合并自由连线的包围盒
  selectedConnectionIds?: Set<string> | string[]; // 选中的连接ID（用于仅纳入选中的自由连线）
  onDeleteNodes?: (nodeIds: string[]) => void; // 删除节点回调
  onCreateGroup?: (nodeIds: string[], connectionIds?: string[]) => void; // 创建组合回调  
  containerScale?: number; // 画布缩放比例
  onGroupDragStart?: (e: React.MouseEvent) => void; // 新增：允许从边界框直接启动群组拖拽
  onGroupScaleStart?: (e: React.MouseEvent) => void; // 新增：整体缩放启动回调
}

/**
 * 🎯 群组边界框组件
 * 
 * 设计理念：
 * - 独立的覆盖层，不影响节点内容布局
 * - 提供拖拽交互区域
 * - 视觉反馈清晰，与系统风格一致
 * - 性能优化：条件渲染和最小重绘
 */
export const GroupBoundingBox: React.FC<GroupBoundingBoxProps> = ({
  group,
  isVisible,
  nodes,
  connections,
  selectedConnectionIds,
  onDeleteNodes,
  onCreateGroup,
  containerScale = 1,
  onGroupDragStart,
  onGroupScaleStart,
}) => {
  // 🎯 实时计算群组边界，确保与节点位置完全同步
  const realTimeBounds = useMemo(() => {
    if (!group) return null;
    
    // 如果提供了nodes参数，优先使用实时计算
    if (nodes && nodes.length > 0) {
      const groupNodes = nodes.filter(node => group.nodeIds.has(node.id));
      if (groupNodes.length > 0) {
        const calculatedBounds = calculateGroupBounds(groupNodes);
        // 合并选中自由/半自由连线的简单包围盒（端点 + 控制点）
        if (connections && selectedConnectionIds) {
          const idSet = Array.isArray(selectedConnectionIds) ? new Set(selectedConnectionIds) : selectedConnectionIds;
          let minX = calculatedBounds.x;
          let minY = calculatedBounds.y;
          let maxX = calculatedBounds.x + calculatedBounds.width;
          let maxY = calculatedBounds.y + calculatedBounds.height;
          for (const c of connections) {
            if (!idSet.has(c.id)) continue;
            const pts: Array<{ x: number; y: number }> = [];
            const anyC: any = c as any;
            if (anyC.fromPoint || anyC.toPoint) {
              if (anyC.fromPoint) pts.push(anyC.fromPoint);
              if (anyC.toPoint) pts.push(anyC.toPoint);
              if (!anyC.fromPoint && anyC.from) {
                const node = nodes?.find((n) => n.id === anyC.from);
                if (node) pts.push({ x: node.x + node.width / 2, y: node.y + node.height / 2 });
              }
              if (!anyC.toPoint && anyC.to) {
                const node = nodes?.find((n) => n.id === anyC.to);
                if (node) pts.push({ x: node.x + node.width / 2, y: node.y + node.height / 2 });
              }
              if (anyC.curveAnchor) pts.push(anyC.curveAnchor);
              if (Array.isArray(anyC.controlPoints)) pts.push(...anyC.controlPoints);
            }
            if (pts.length) {
              for (const p of pts) {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
              }
            }
          }
          return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
        }
        return calculatedBounds;
      }
    }
    
    return group.bounds;
  }, [group, nodes, connections, selectedConnectionIds]);

  // 🚫 不可见或无群组或无有效边界时不渲染
  if (!isVisible || !group || !realTimeBounds) {
    return null;
  }

  // 🎯 计算边界框样式参数
  const strokeWidth = 2 / containerScale; // 根据缩放调整线条宽度
  const offset = 4; // 边界框外扩像素
  // 右下角缩放弧线尺寸：与边框圆角曲率接近的小弧线（屏幕上约10px边长、2px线宽）
  const arcSize = 10 / containerScale;

  // 🎨 动态样式配置
  const borderColor = '#8c8273'; // 选中群组边框颜色与节点一致
  
  // 🎯 使用实时计算的边界，确保与节点位置完全同步
  const bounds = {
    x: realTimeBounds.x,
    y: realTimeBounds.y,
    width: realTimeBounds.width,
    height: realTimeBounds.height
  };

  return (
    <div
      className="absolute select-none"
      style={{
        left: bounds.x - offset,
        top: bounds.y - offset,
        width: bounds.width + (offset * 2),
        height: bounds.height + (offset * 2),
        zIndex: 10 // 适中的层级，不阻挡节点交互
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return; // 左键拖拽
        if (!onGroupDragStart) return;
        // 避免点击顶部工具按钮触发拖拽（按钮会stopPropagation）
        onGroupDragStart(e);
      }}
    >
      {/* 🎨 边界框实线边框（无背景） */}
      <div
        className="absolute inset-0 transition-all duration-200 ease-out"
        style={{
          border: `${strokeWidth}px solid ${borderColor}`,
          borderRadius: 'var(--radius-xs)',
          opacity: 0.8,
          pointerEvents: 'none' // 边框本身不响应点击
        }}
      />


      {/* 🎯 右上角操作组件栏 */}
      <div
        className="absolute flex items-center gap-1 px-2 py-1 text-neutral-900 dark:text-neutral-100 bg-white/90 dark:bg-neutral-900/90 rounded shadow-lg shadow-black/10 dark:shadow-black/40 border border-neutral-200 dark:border-neutral-700 transition-all duration-200 backdrop-blur"
        style={{
          right: -4,
          top: -36, // 位于边界框上方
          pointerEvents: 'auto', // 启用交互
          opacity: 1
        }}
      >
        {/* 🗑️ Delete button */}
        <button
          className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors duration-150 group"
          title="Delete selected nodes"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const nodeIds = Array.from(group.nodeIds);
            onDeleteNodes?.(nodeIds);
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="transition-colors"
          >
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" />
          </svg>
        </button>

        {/* 📦 Group button (placeholder) */}
        <button
          className="p-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors duration-150 group"
          title="Group selection"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const nodeIds = Array.from(group.nodeIds);
            const connIds = selectedConnectionIds
              ? Array.from(selectedConnectionIds instanceof Set ? selectedConnectionIds : new Set(selectedConnectionIds))
              : [];
            onCreateGroup?.(nodeIds, connIds);
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="transition-colors"
          >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
      </div>

      {/* 🎯 右下角整体缩放控制手柄 - 仅一小段圆弧，圆角/线宽与边框一致，贴合边框圆角 */}
      {group.nodeIds && group.nodeIds.size > 0 && onGroupScaleStart && (
        <div
          className="absolute cursor-se-resize"
          style={{
            // 使用固定视觉尺寸的小弧线，并将圆心放在边框右下角外侧，形成自然延伸的效果
            width: arcSize,
            height: arcSize,
            bottom: -arcSize / 2,
            right: -arcSize / 2,
            borderTopLeftRadius: 0,
            borderTopRightRadius: 0,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: arcSize,
            backgroundColor: 'transparent',
            borderStyle: 'solid',
            borderColor: 'transparent',
            borderRightColor: borderColor,
            borderBottomColor: borderColor,
            borderRightWidth: strokeWidth,
            borderBottomWidth: strokeWidth,
            borderLeftWidth: 0,
            borderTopWidth: 0,
            pointerEvents: 'auto',
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onGroupScaleStart(e);
          }}
          title="整体缩放"
        />
      )}
    </div>
  );
};

export default GroupBoundingBox;
