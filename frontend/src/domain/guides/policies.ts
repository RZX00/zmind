import type { GuideKind, GuideOptions, NodeGeom, Rect } from './types';
import { clampScale, isValidRect, rectBottom, rectRight, rectCenter } from './geometry';

export interface CandidateScore {
  score: number;
  kind: GuideKind;
}

export interface EligibilityOptions {
  excludeTypes?: string[];
}

export function filterEligibleNodes(
  nodes: NodeGeom[],
  selectionIds: Set<string>,
  options: EligibilityOptions = {}
): NodeGeom[] {
  const exclude = new Set(options.excludeTypes || []);
  return nodes.filter((n) => {
    if (!n || selectionIds.has(n.id)) return false;
    if (exclude.has(n.type || '')) return false;
    if (n.visible === false) return false;
    if (n.locked === true) return false;
    return isValidRect(n.rect);
  });
}

export function toCanvasTolerancePx(tolerancePx: number, scale: number): number {
  const s = clampScale(scale);
  if (!Number.isFinite(tolerancePx)) return 8 / s;
  return tolerancePx / s;
}

export function scoreCandidate(kind: GuideKind, delta: number, axisLocked: boolean): number {
  const abs = Math.abs(delta);
  const kindPenalty =
    kind === 'container'
      ? 0
      : kind === 'edge'
        ? 0.1
        : kind === 'baseline'
          ? 0.15
          : kind === 'center'
            ? 0.3
            : kind === 'spacing'
              ? 0.4
              : 0.3;
  const axisBonus = axisLocked ? -0.18 : 0;
  return abs + kindPenalty + axisBonus;
}

export function overlapRatio1D(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const left = Math.max(aStart, bStart);
  const right = Math.min(aEnd, bEnd);
  const overlap = Math.max(0, right - left);
  const lenA = Math.max(0, aEnd - aStart);
  const lenB = Math.max(0, bEnd - bStart);
  const denom = Math.min(lenA, lenB);
  if (denom <= 0) return 0;
  return overlap / denom;
}

export function rectOverlapRatioY(a: Rect, b: Rect): number {
  return overlapRatio1D(a.y, rectBottom(a), b.y, rectBottom(b));
}

export function rectOverlapRatioX(a: Rect, b: Rect): number {
  return overlapRatio1D(a.x, rectRight(a), b.x, rectRight(b));
}

export function computeSpacingXTarget(selection: Rect, left: Rect, right: Rect): number {
  const leftRight = rectRight(left);
  const rightLeft = right.x;
  return (rightLeft + leftRight - selection.width) / 2;
}

export function computeSpacingYTarget(selection: Rect, top: Rect, bottom: Rect): number {
  const topBottom = rectBottom(top);
  const bottomTop = bottom.y;
  return (bottomTop + topBottom - selection.height) / 2;
}

export function selectionCenterX(r: Rect): number {
  return rectCenter(r).x;
}

export function selectionCenterY(r: Rect): number {
  return rectCenter(r).y;
}
