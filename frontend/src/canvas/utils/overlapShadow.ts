// Lightweight occlusion detection to decide whether a node should render a stronger shadow.

import type { CanvasNode } from '../types/canvas';
import type { SpatialIndex } from './spatialIndex';
import { queryRect } from './spatialIndex';

interface RectLike { x: number; y: number; width: number; height: number }

function rectsOverlap(a: RectLike, b: RectLike): boolean {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > left && bottom > top;
}

export interface OverlapShadowOptions {
  spatialIndex: SpatialIndex | null;
  stackLevel: (n: CanvasNode) => number;
  nodeOpacity: (n: CanvasNode) => number;
  renderIndex: Map<string, number>;
  visibleNodes: CanvasNode[];
  isFullyOpaque?: (n: CanvasNode) => boolean;
}

export function computeOverlapShadowMap(opts: OverlapShadowOptions): Record<string, boolean> {
  const { spatialIndex, stackLevel, nodeOpacity, renderIndex, visibleNodes } = opts;

  const isFullyOpaque = opts.isFullyOpaque ?? ((n: CanvasNode): boolean => {
    try {
      if ((n as any).type === 'media') return false;
      if ((n as any).type === 'code' && (n as any).codeType === 'svg') {
        return (n as any).svgBgMode === 'auto';
      }
      if ((n as any).type === 'group') {
        const bg = (n as any).groupStyles?.bgOpacity;
        if (typeof bg === 'number') return bg >= 0.999;
        return false;
      }
      const op = nodeOpacity(n);
      return isFinite(op) && op >= 0.999;
    } catch { return false; }
  });

  const shadowMap: Record<string, boolean> = {};

  const nodes = visibleNodes.slice();
  for (const top of nodes) {
    if (!isFullyOpaque(top)) continue;
    if (!isFinite(top.x) || !isFinite(top.y) || !isFinite(top.width) || !isFinite(top.height)) continue;
    const minX = top.x;
    const minY = top.y;
    const maxX = top.x + top.width;
    const maxY = top.y + top.height;

    let candidates: CanvasNode[];
    if (spatialIndex) {
      candidates = queryRect(spatialIndex, minX - 1, minY - 1, maxX + 1, maxY + 1);
    } else {
      candidates = visibleNodes.filter((n) => {
        if (n.id === top.id) return false;
        return !(n.x + n.width < minX || n.x > maxX || n.y + n.height < minY || n.y > maxY);
      });
    }
    if (!candidates.length) continue;

    const topLevel = stackLevel(top);
    const below = candidates.filter((candidate) => {
      if (candidate.id === top.id) return false;
      const candidateLevel = stackLevel(candidate);
      if (candidateLevel < topLevel) return true;
      if (candidateLevel > topLevel) return false;
      const topIdx = renderIndex.get(top.id) ?? 0;
      const candidateIdx = renderIndex.get(candidate.id) ?? 0;
      return candidateIdx < topIdx;
    });
    if (!below.length) continue;

    const topRect = { x: top.x, y: top.y, width: top.width, height: top.height };
    for (const lower of below) {
      if (!isFullyOpaque(lower)) continue;
      if (rectsOverlap(topRect, { x: lower.x, y: lower.y, width: lower.width, height: lower.height })) {
        shadowMap[top.id] = true;
        break;
      }
    }
  }

  return shadowMap;
}

export type { OverlapShadowOptions as OverlapShadowOptionsType };
