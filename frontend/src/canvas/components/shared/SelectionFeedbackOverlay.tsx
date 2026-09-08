import React, { useMemo } from 'react';
import type { Canvas, CanvasNode } from '../../types/canvas';
import { calculateGroupBounds } from '../core/systems/CoordinateSystem';

interface SelectionFeedbackOverlayProps {
  canvas: Canvas;
  selectedIds: string[];
  containerScale: number; // currentZoom / 100
}

// 框选反馈层：对被“完全覆盖”的组显示分层外扩的轮廓，避免边线重叠
// 父组外扩 base，子组按 depth 递增外扩 step
const SelectionFeedbackOverlay: React.FC<SelectionFeedbackOverlayProps> = ({ canvas, selectedIds, containerScale }) => {
  const overlays = useMemo(() => {
    const nodes = canvas.nodes || [];
    const nodeMap = new Map<string, CanvasNode>();
    const groupMap = new Map<string, any>();
    nodes.forEach(n => {
      nodeMap.set(n.id, n);
      if ((n as any).type === 'group') groupMap.set(n.id, n);
    });

    const selectedSet = new Set(selectedIds);

    const getDescendantLeaves = (gid: string): CanvasNode[] => {
      const g = groupMap.get(gid);
      if (!g) return [];
      const out: CanvasNode[] = [];
      const stack: string[] = [...(g.children || [])];
      while (stack.length) {
        const id = stack.pop()!;
        const cg = groupMap.get(id);
        if (cg) {
          (cg.children || []).forEach((cid: string) => stack.push(cid));
        } else {
          const leaf = nodeMap.get(id);
          if (leaf && (leaf as any).type !== 'group') out.push(leaf);
        }
      }
      return out;
    };

    // 被“完全覆盖”的组（所有后代叶子都在选中集中）
    const fullyCovered: string[] = [];
    groupMap.forEach((g, gid) => {
      const leaves = getDescendantLeaves(gid);
      if (leaves.length === 0) return;
      const covered = leaves.every(leaf => selectedSet.has(leaf.id));
      if (covered) fullyCovered.push(gid);
    });

    // 仅保留“顶层已覆盖”组，防止重复画父子同层
    const isAncestorCovered = (gid: string): boolean => {
      let p = groupMap.get(gid)?.parentGroupId;
      while (p) {
        if (fullyCovered.includes(p)) return true;
        p = groupMap.get(p)?.parentGroupId;
      }
      return false;
    };
    const coveredTop = fullyCovered.filter(gid => !isAncestorCovered(gid));

    // 递归收集“覆盖链”内的组（顶层→子层…），用于分层显示
    const coveredSet = new Set<string>(fullyCovered);
    const collectCoveredChain = (gid: string, chain: Array<{ id: string; depth: number }>, depth: number) => {
      chain.push({ id: gid, depth });
      const g = groupMap.get(gid);
      const children: string[] = g?.children || [];
      children.forEach(cid => {
        if (coveredSet.has(cid)) collectCoveredChain(cid, chain, depth + 1);
      });
    };

    const chains: Array<{ id: string; depth: number }>[] = [];
    coveredTop.forEach(gid => {
      const chain: Array<{ id: string; depth: number }> = [];
      collectCoveredChain(gid, chain, 0);
      chains.push(chain);
    });

    // 构建绘制条目（分层外扩）
    const items: Array<{ id: string; depth: number; bounds: { x: number; y: number; width: number; height: number } } > = [];
    const base = 6;
    const step = 6;
    chains.forEach(chain => {
      chain.forEach(({ id, depth }) => {
        const leaves = getDescendantLeaves(id);
        if (leaves.length === 0) return;
        const b = calculateGroupBounds(leaves);
        const ext = base + depth * step;
        items.push({
          id,
          depth,
          bounds: {
            x: b.x - ext,
            y: b.y - ext,
            width: b.width + ext * 2,
            height: b.height + ext * 2,
          }
        });
      });
    });

    // 父在下 子在上（深度小的先渲染）
    items.sort((a, b) => a.depth - b.depth);
    return items;
  }, [canvas.nodes, selectedIds]);

  if (!overlays.length) return null;

  const strokeBase = 2 / Math.max(containerScale, 0.01);

  return (
    <>
      {overlays.map((o, idx) => {
        // 交替使用虚线/点线，增强层级识别
        const isEven = o.depth % 2 === 0;
        const borderStyle = isEven ? 'dashed' : 'dotted';
        return (
          <div
            key={`${o.id}-${idx}`}
            className="absolute pointer-events-none"
            style={{
              left: o.bounds.x,
              top: o.bounds.y,
              width: o.bounds.width,
              height: o.bounds.height,
              border: `${strokeBase}px ${borderStyle} #3b82f6`,
              borderRadius: 'var(--radius-sm)',
              opacity: 0.6,
              zIndex: 9,
            }}
          />
        );
      })}
    </>
  );
};

export default SelectionFeedbackOverlay;
