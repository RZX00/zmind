import type { CanvasNode, CanvasConnection } from '../types/canvas';

export interface SimplifiedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  id?: string;
}

export interface SimplifiedLine {
  x1: number; y1: number; x2: number; y2: number;
}

export interface MinimapGeometry {
  rects: SimplifiedRect[];
  lines: SimplifiedLine[];
}

/**
 * 简化几何生成（MVP版）
 * - 直接使用AABB
 * - 连线用中心点直线
 */
export function buildMinimapGeometry(nodes: CanvasNode[], connections: CanvasConnection[]): MinimapGeometry {
  const rects: SimplifiedRect[] = nodes.map(n => ({ x: n.x, y: n.y, width: n.width, height: n.height, id: n.id }));
  const nodeMap = new Map(nodes.map(n => [n.id, n] as const));
  const lines: SimplifiedLine[] = [];
  for (const c of connections) {
    const a = nodeMap.get(c.from);
    const b = nodeMap.get(c.to);
    if (!a || !b) continue;
    lines.push({
      x1: a.x + a.width / 2,
      y1: a.y + a.height / 2,
      x2: b.x + b.width / 2,
      y2: b.y + b.height / 2,
    });
  }
  return { rects, lines };
}
