import type { NodeGeom, Rect } from './types';
import { clampScale, rectBottom, rectRight } from './geometry';

export interface NeighborIndex {
  rebuild(nodes: NodeGeom[], scale: number): void;
  query(rect: Rect, radius: number): NodeGeom[];
}

export class SimpleGridIndex implements NeighborIndex {
  private cellSize = 300;
  private grid = new Map<string, NodeGeom[]>();
  private nodes: NodeGeom[] = [];

  rebuild(nodes: NodeGeom[], scale: number): void {
    this.nodes = nodes;
    const s = clampScale(scale);
    this.cellSize = Math.max(180, 180 / s);
    this.grid.clear();
    for (const n of nodes) {
      const minX = Math.floor(n.rect.x / this.cellSize);
      const minY = Math.floor(n.rect.y / this.cellSize);
      const maxX = Math.floor(rectRight(n.rect) / this.cellSize);
      const maxY = Math.floor(rectBottom(n.rect) / this.cellSize);
      for (let gx = minX; gx <= maxX; gx += 1) {
        for (let gy = minY; gy <= maxY; gy += 1) {
          const key = `${gx},${gy}`;
          const bucket = this.grid.get(key);
          if (bucket) bucket.push(n);
          else this.grid.set(key, [n]);
        }
      }
    }
  }

  query(rect: Rect, radius: number): NodeGeom[] {
    if (!this.grid.size) return this.nodes;
    const r = Math.max(0, radius || 0);
    const minX = Math.floor((rect.x - r) / this.cellSize);
    const minY = Math.floor((rect.y - r) / this.cellSize);
    const maxX = Math.floor((rectRight(rect) + r) / this.cellSize);
    const maxY = Math.floor((rectBottom(rect) + r) / this.cellSize);
    const out = new Map<string, NodeGeom>();
    for (let gx = minX; gx <= maxX; gx += 1) {
      for (let gy = minY; gy <= maxY; gy += 1) {
        const bucket = this.grid.get(`${gx},${gy}`);
        if (!bucket) continue;
        for (const n of bucket) out.set(n.id, n);
      }
    }
    return Array.from(out.values());
  }
}
