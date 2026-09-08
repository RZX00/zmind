import type { Point, Rect } from './types';

export function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function isValidRect(r: Rect): boolean {
  return (
    isFiniteNumber(r.x) &&
    isFiniteNumber(r.y) &&
    isFiniteNumber(r.width) &&
    isFiniteNumber(r.height) &&
    r.width > 0 &&
    r.height > 0
  );
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function rectRight(r: Rect): number {
  return r.x + r.width;
}

export function rectBottom(r: Rect): number {
  return r.y + r.height;
}

export function rectFromBounds(minX: number, minY: number, maxX: number, maxY: number): Rect {
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function rectUnion(a: Rect, b: Rect): Rect {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(rectRight(a), rectRight(b));
  const maxY = Math.max(rectBottom(a), rectBottom(b));
  return rectFromBounds(minX, minY, maxX, maxY);
}

export function rectIntersectsY(a: Rect, y: number): boolean {
  return y >= a.y && y <= rectBottom(a);
}

export function rectIntersectsX(a: Rect, x: number): boolean {
  return x >= a.x && x <= rectRight(a);
}

export function snapToGrid(value: number, gridSize: number): number {
  if (!isFiniteNumber(value) || !isFiniteNumber(gridSize) || gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

export function clampScale(scale: number): number {
  if (!isFiniteNumber(scale) || scale <= 0) return 1;
  return Math.max(0.01, scale);
}
