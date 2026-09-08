// 轻量级空间索引（网格哈希）——用于命中/框选加速
// 非侵入式：仅在调用方使用，数据结构简单，零依赖

import type { Canvas, CanvasNode } from '../types/canvas';

export interface SpatialIndex {
  cellSize: number;
  grid: Map<string, CanvasNode[]>;
}

function key(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

function floorDiv(n: number, d: number): number {
  // 适配负坐标
  const q = Math.floor(n / d);
  return q;
}

export function buildSpatialIndex(nodes: CanvasNode[], cellSize: number = 300): SpatialIndex {
  const grid = new Map<string, CanvasNode[]>();
  for (const n of nodes) {
    const minX = n.x;
    const minY = n.y;
    const maxX = n.x + n.width;
    const maxY = n.y + n.height;
    const cx0 = floorDiv(minX, cellSize);
    const cy0 = floorDiv(minY, cellSize);
    const cx1 = floorDiv(maxX, cellSize);
    const cy1 = floorDiv(maxY, cellSize);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = key(cx, cy);
        let arr = grid.get(k);
        if (!arr) {
          arr = [];
          grid.set(k, arr);
        }
        arr.push(n);
      }
    }
  }
  return { cellSize, grid };
}

export function queryRect(index: SpatialIndex | null, minX: number, minY: number, maxX: number, maxY: number): CanvasNode[] {
  if (!index) return [];
  const { cellSize, grid } = index;
  const cx0 = floorDiv(minX, cellSize);
  const cy0 = floorDiv(minY, cellSize);
  const cx1 = floorDiv(maxX, cellSize);
  const cy1 = floorDiv(maxY, cellSize);
  const result: CanvasNode[] = [];
  const seen = new Set<string>();
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const k = key(cx, cy);
      const arr = grid.get(k);
      if (!arr) continue;
      for (const n of arr) {
        if (seen.has(n.id)) continue;
        // 粗过滤：AABB 相交
        const nMinX = n.x;
        const nMinY = n.y;
        const nMaxX = n.x + n.width;
        const nMaxY = n.y + n.height;
        const intersects = !(nMaxX < minX || nMinX > maxX || nMaxY < minY || nMinY > maxY);
        if (intersects) {
          seen.add(n.id);
          result.push(n);
        }
      }
    }
  }
  return result;
}

export function queryPoint(index: SpatialIndex | null, x: number, y: number): CanvasNode[] {
  if (!index) return [];
  const { cellSize, grid } = index;
  const cx = floorDiv(x, cellSize);
  const cy = floorDiv(y, cellSize);
  const arr = grid.get(key(cx, cy));
  if (!arr) return [];
  // 返回候选，最终命中由调用方精确判断
  return arr;
}
