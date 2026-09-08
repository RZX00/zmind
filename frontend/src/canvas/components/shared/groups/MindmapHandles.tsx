import React, { useMemo } from 'react';
import { useTheme } from 'next-themes';
import type { Canvas, CanvasNode } from '../../../../types/canvas';
import { findMindmapGroupForNode, addMindmapChild, toggleMindmapCollapse, countMindmapDescendants } from '../../../utils/mindmapLayout';
import { safeExecute, createErrorBoundary } from '../../../utils/errorHandling';
import { isGroupNode, isMindmapGroup, safeStringArray } from '../../../utils/groupUtils';
import { HANDLE_FREEZE_THRESHOLD } from '../../../constants/motion';

interface MindmapHandlesProps {
  canvas: Canvas;
  containerScale: number; // currentZoom / 100
  hoveredNodeId: string | null;
  isEditMode?: boolean;
  onKeepHover?: (nodeId: string | null) => void;
}

const MindmapHandles: React.FC<MindmapHandlesProps> = ({ canvas, containerScale, hoveredNodeId, isEditMode = false, onKeepHover }) => {
  // 🛡️ 创建错误边界
  const errorBoundary = createErrorBoundary('MindmapHandles', null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const branchLineColor = isDark ? '#D1D5DB' : '#9CA3AF';
  const handleBg = isDark ? '#111827' : '#FFFFFF';
  const handleBorder = isDark ? '#D1D5DB' : '#9CA3AF';
  const handleGlyph = isDark ? '#F8FAFC' : '#111827';

  const hoverNode: CanvasNode | null = useMemo(() => {
    return errorBoundary(() => {
      if (!hoveredNodeId) return null;

      // 🛡️ 安全的节点查找
      const nodes = canvas?.nodes || [];
      return nodes.find(n => n?.id === hoveredNodeId) || null;
    });
  }, [canvas, hoveredNodeId, errorBoundary]);

  // 收集所有思维导图组中处于折叠状态的节点，用于"始终显示"的数量徽标
  const collapsedBadges = useMemo(() => {
    return errorBoundary(() => {
      const items: Array<{ node: CanvasNode; groupId: string; anchor: { x: number; y: number }; count: number; onLeftSide: boolean } > = [];

      // 🛡️ 安全的群组过滤
      const nodes = canvas?.nodes || [];
      const groups = nodes.filter(n => isGroupNode(n) && isMindmapGroup(n));
      for (const group of groups) {
        // 🛡️ 安全的子节点访问
        const members = new Set<string>(safeStringArray(group.children));

        // 🛡️ 安全的连接过滤
        const connections = canvas?.connections || [];
        const edges = connections.filter(e =>
          e?.from && e?.to && members.has(e.from) && members.has(e.to)
        );

        // 🛡️ 安全的根节点ID获取
        const rootId = group.mindmap?.rootId;
        if (!rootId) {
          console.warn('MindmapHandles: 群组缺少根节点ID', group.id);
          continue;
        }
        // 🛡️ 构建父映射
        const parentMap = new Map<string, string>();
        const queue: string[] = [rootId];
        const seen = new Set<string>([rootId]);

        while (queue.length > 0) {
          const currentId = queue.shift();
          if (!currentId) continue;

          for (const edge of edges) {
            if (edge.from === currentId && !parentMap.has(edge.to)) {
              parentMap.set(edge.to, currentId);
              if (!seen.has(edge.to)) {
                seen.add(edge.to);
                queue.push(edge.to);
              }
            }
          }
        }

        // 🛡️ 安全的折叠状态获取
        const collapsed = group.mindmap?.collapsed || {};
        const collapsedIds = Object.keys(collapsed).filter(id => collapsed[id] === true);

        // 🛡️ 仅保留"无折叠祖先"的折叠节点（分支最外层）
        const topLevelCollapsed = collapsedIds.filter(id => {
          let currentParent = parentMap.get(id);
          while (currentParent) {
            if (collapsed[currentParent]) return false; // 有折叠祖先，则不在此层显示
            currentParent = parentMap.get(currentParent);
          }
          return true;
        });

        // 🛡️ 安全处理折叠节点
        for (const nodeId of topLevelCollapsed) {
          const node = nodes.find(n => n?.id === nodeId);
          if (!node) {
            console.warn('MindmapHandles: 找不到折叠节点', nodeId);
            continue;
          }

          // 🛡️ 安全的锚点计算
          const nodeWidth = node.width || 0;
          const nodeHeight = node.height || 60;
          // 根据双向布局判断左右：左侧节点的徽标应显示在左边缘
          const root = nodes.find(n => n?.id === group.mindmap?.rootId);
          const rootCenterX = root ? (root.x + (root.width || 0) / 2) : 0;
          const nodeCenterX = node.x + nodeWidth / 2;
          const onLeftSide = Boolean(group.mindmap && group.mindmap.orientation === 'both' && nodeCenterX < rootCenterX);
          const anchor = {
            x: onLeftSide ? node.x : (node.x + nodeWidth),
            y: node.y + nodeHeight / 2
          };

          // 🛡️ 安全的计数
          const count = safeExecute(
            () => countMindmapDescendants(canvas, group.id, nodeId),
            { fallbackValue: 0, logLevel: 'warn' }
          ) || 0;

          items.push({ node, groupId: group.id, anchor, count, onLeftSide });
        }
      }

      return items;
    }) || [];
  }, [canvas, errorBoundary]);

  // 悬停节点的上下文，仅用于显示 + / -（非折叠态）
  const hoverCtx = useMemo(() => {
    return errorBoundary(() => {
      if (!hoverNode) return null;

      // 🛡️ 安全的群组查找
      const group = safeExecute(
        () => findMindmapGroupForNode(canvas, hoverNode.id),
        { fallbackValue: null, logLevel: 'warn' }
      );

      if (!group) return null;

      // 🛡️ 安全的成员集合构建
      const members = new Set<string>(safeStringArray(group.children));

      // 🛡️ 安全的子节点计数
      const connections = canvas?.connections || [];
      const childCount = connections.filter(e =>
        e?.from === hoverNode.id && e?.to && members.has(e.to)
      ).length;

      // 🛡️ 安全的折叠状态获取
      const collapsed = Boolean(group.mindmap?.collapsed?.[hoverNode.id]);

      // 🛡️ 安全的锚点计算
      const nodeWidth = hoverNode.width || 0;
      const nodeHeight = hoverNode.height || 60;
      // 根据双向布局判断左右：左侧节点的控制柄应显示在左边缘
      const root = (canvas?.nodes || []).find(n => n?.id === group.mindmap?.rootId);
      const rootCenterX = root ? (root.x + (root.width || 0) / 2) : 0;
      const nodeCenterX = hoverNode.x + nodeWidth / 2;
      const onLeftSide = Boolean(group.mindmap && group.mindmap.orientation === 'both' && nodeCenterX < rootCenterX);
      const anchor = {
        x: onLeftSide ? hoverNode.x : (hoverNode.x + nodeWidth),
        y: hoverNode.y + nodeHeight / 2
      };

      // 🛡️ 安全的隐藏计数
      const hiddenCount = collapsed ? safeExecute(
        () => countMindmapDescendants(canvas, group.id, hoverNode.id),
        { fallbackValue: 0, logLevel: 'warn' }
      ) || 0 : 0;

      return { group, childCount, collapsed, anchor, hiddenCount };
    });
  }, [canvas, hoverNode, errorBoundary]);

  // Chat 模式也允许显示思维导图句柄（添加/收起），因此不再基于 isEditMode 隐藏

  // 当缩放低于阈值时，停止反向自适应（与节点一起缩放）
  const useInverseScale = containerScale >= HANDLE_FREEZE_THRESHOLD;
  const effectiveScale = useInverseScale ? Math.max(containerScale, 0.01) : 1;
  const lineLen = 16 / effectiveScale; // 稍加长些
  const dotSize = 18 / effectiveScale; // 稍微放大原点
  const badgeH = 20 / effectiveScale;  // 徽标稍微加大

  // 始终渲染：所有折叠节点的数量徽标
  const badges = collapsedBadges.map(({ node, anchor, count, onLeftSide }) => {
    const style: React.CSSProperties = {
      position: 'absolute', left: onLeftSide ? (anchor.x - badgeH) : anchor.x, top: anchor.y, transform: 'translate(0,-50%)', pointerEvents: 'auto', zIndex: 2000
    };
    return (
      <div key={`badge-${node.id}`} style={style}>
        <div
          className={`flex items-center justify-center text-xs rounded-full shadow ${
            isDark ? 'text-zinc-100 bg-zinc-600' : 'text-white bg-gray-700'
          }`}
          style={{ width: badgeH, height: badgeH, minWidth: badgeH, lineHeight: `${badgeH}px`, textAlign: 'center', cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); toggleMindmapCollapse(node.id, false); }}
          title={`展开 ${count} 个节点`}
        >
          {count}
        </div>
      </div>
    );
  });

  // 仅在 hover 且未折叠时渲染：加号或减号
  const controls = (() => {
    if (!hoverNode || !hoverCtx) return null;
    const keepHover = () => onKeepHover?.(hoverNode.id);
    const common: React.CSSProperties = {
      position: 'absolute', left: hoverCtx.anchor.x, top: hoverCtx.anchor.y, transform: 'translate(0,-50%)', pointerEvents: 'auto', zIndex: 2000
    };
    // 判断当前节点是否在左侧
    const group = hoverCtx.group as any;
    const root = (canvas?.nodes || []).find(n => n?.id === group?.mindmap?.rootId);
    const rootCenterX = root ? (root.x + (root.width || 0) / 2) : 0;
    const nodeWidth = hoverNode.width || 0;
    const nodeCenterX = hoverNode.x + nodeWidth / 2;
    const onLeftSide = Boolean(group?.mindmap && group.mindmap.orientation === 'both' && nodeCenterX < rootCenterX);
    const dir = onLeftSide ? -1 : 1; // -1: 左侧，向左延伸；1: 右侧，向右延伸
    if (hoverCtx.collapsed) return null; // 已折叠的显示徽标即可
    if (hoverCtx.childCount === 0) {
      return (
        <div key={`ctrl-plus-${hoverNode.id}`} style={common} onMouseEnter={keepHover}>
          <div
            className="absolute"
            style={{ left: dir === 1 ? 0 : -(lineLen + dotSize + 12/effectiveScale), top: '50%', width: lineLen + dotSize + 12/effectiveScale, height: Math.max(dotSize, 24/effectiveScale), transform: 'translateY(-50%)', cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); addMindmapChild(hoverNode.id); }}
          />
          <div className="absolute" style={{ left: dir === 1 ? 0 : -lineLen, top: '50%', width: lineLen, height: 2/effectiveScale, background: branchLineColor, transform: 'translateY(-50%)' }} />
          <div
            className="absolute flex items-center justify-center rounded-full hover:bg-accent/60 shadow"
            style={{
              left: dir === 1 ? (lineLen + 6/effectiveScale) : (-(lineLen + 6/effectiveScale + dotSize)),
              top: '50%',
              width: dotSize,
              height: dotSize,
              transform: 'translateY(-50%)',
              cursor: 'pointer',
              backgroundColor: handleBg,
              border: `1px solid ${handleBorder}`
            }}
            onClick={(e) => { e.stopPropagation(); addMindmapChild(hoverNode.id); }}
            title="添加子节点"
          >
            <div style={{ width: dotSize*0.5, height: 2/effectiveScale, background: handleGlyph }} />
            <div style={{ width: 2/effectiveScale, height: dotSize*0.5, background: handleGlyph, position: 'absolute' as const }} />
          </div>
        </div>
      );
    }
    // 子数>=1：显示减号
    if (hoverCtx.childCount >= 1) {
      return (
        <div key={`ctrl-minus-${hoverNode.id}`} style={common} onMouseEnter={keepHover}>
          <div
            className="absolute"
            style={{ left: dir === 1 ? (-4/effectiveScale) : (-(dotSize + 12/effectiveScale) + 4/effectiveScale), top: '50%', width: dotSize + 12/effectiveScale, height: Math.max(dotSize, 24/effectiveScale), transform: 'translateY(-50%)', cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); toggleMindmapCollapse(hoverNode.id, true); }}
          />
          <div
            className="flex items-center justify-center rounded-full hover:bg-accent/60 shadow"
            style={{
              width: dotSize,
              height: dotSize,
              cursor: 'pointer',
              left: dir === 1 ? 0 : -dotSize,
              position: 'absolute' as const,
              top: '50%',
              transform: 'translateY(-50%)',
              backgroundColor: handleBg,
              border: `1px solid ${handleBorder}`
            }}
            onClick={(e) => { e.stopPropagation(); toggleMindmapCollapse(hoverNode.id, true); }}
            title="收起子节点"
          >
            <div style={{ width: dotSize*0.5, height: 2/effectiveScale, background: handleGlyph }} />
          </div>
        </div>
      );
    }
    return null;
  })();

  return (
    <>
      {badges}
      {controls}
    </>
  );
};

export default MindmapHandles;
