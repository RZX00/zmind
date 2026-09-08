import type {
  AxisLock,
  CanvasSnapshot,
  DistanceHint,
  GuideLine,
  GuideOptions,
  GuideSession,
  NodeGeom,
  Rect,
  ResizePlan,
  SnapPlan,
  ResizeHandle,
} from './types';
import { clampScale, isValidRect, rectBottom, rectCenter, rectRight, snapToGrid } from './geometry';
import {
  filterEligibleNodes,
  rectOverlapRatioX,
  rectOverlapRatioY,
  scoreCandidate,
  selectionCenterX,
  selectionCenterY,
  toCanvasTolerancePx,
} from './policies';
import type { NeighborIndex } from './neighborIndex';

interface Candidate {
  axis: 'x' | 'y';
  delta: number;
  guide: GuideLine;
  score: number;
  kind: 'align' | 'spacing';
  token: string;
}

interface SpacingContext {
  left?: Rect;
  right?: Rect;
  top?: Rect;
  bottom?: Rect;
}

interface ResizeCandidate {
  delta: number;
  guide: GuideLine;
  score: number;
  token: string;
  widthDelta: number;
  heightDelta: number;
  xDelta: number;
  yDelta: number;
}

export class GuideEngineImpl {
  constructor(private index?: NeighborIndex) {}

  private lastNodesRef: NodeGeom[] | null = null;
  private lastScale: number | null = null;
  private lastSelectionKey: string | null = null;
  private lastEligible: NodeGeom[] | null = null;

  computeSnapPlan(
    canvas: CanvasSnapshot,
    selection: Rect,
    selectionIds: string[],
    options: GuideOptions,
    session?: GuideSession
  ): SnapPlan {
    if (!options.enabled || options.modifierDisabled) {
      return this.identityPlan(selection);
    }
    if (!isValidRect(selection)) {
      return this.identityPlan(selection, ['invalid-selection-rect']);
    }

    const scale = clampScale(canvas.scale);
    const tolBase = toCanvasTolerancePx(options.tolerancePx, scale);
    const axisLock = session?.axisLock || { x: false, y: false };
    const tolX = axisLock.x ? tolBase * 1.5 : tolBase;
    const tolY = axisLock.y ? tolBase * 1.5 : tolBase;
    const hysteresis = toCanvasTolerancePx(session?.hysteresisPx ?? 0, scale);
    const leaveTolX = tolX + hysteresis;
    const leaveTolY = tolY + hysteresis;

    const selectionKey = [...selectionIds].sort().join('|');
    let eligible: NodeGeom[];
    const selectionIdSet = new Set(selectionIds);
    const excludeTypes = options.allowContainer ? [] : ['group'];

    if (this.index) {
      const shouldRebuild =
        this.lastNodesRef !== canvas.nodes ||
        this.lastScale !== scale ||
        this.lastSelectionKey !== selectionKey ||
        !this.lastEligible;

      if (shouldRebuild) {
        eligible = filterEligibleNodes(canvas.nodes, selectionIdSet, { excludeTypes });
        this.index.rebuild(eligible, scale);
        this.lastNodesRef = canvas.nodes;
        this.lastScale = scale;
        this.lastSelectionKey = selectionKey;
        this.lastEligible = eligible;
      } else {
        eligible = this.lastEligible!;
      }
    } else {
      eligible = filterEligibleNodes(canvas.nodes, selectionIdSet, { excludeTypes });
    }

    const neighbors = this.index
      ? this.index.query(selection, Math.max(tolX, tolY) + 2)
      : eligible;

    const selectionBaseline = this.getSelectionBaseline(canvas.nodes, selectionIds, selection, options.allowBaseline);
    const { xCandidates, yCandidates, spacingByToken } = this.computeAlignmentCandidates(
      selection,
      neighbors,
      tolX,
      tolY,
      axisLock,
      options,
      selectionBaseline
    );

    const pickedX = this.pickAxisCandidate(
      xCandidates,
      tolX,
      leaveTolX,
      session?.lastHitX,
      options.showSecondaryGuides !== false
    );
    const pickedY = this.pickAxisCandidate(
      yCandidates,
      tolY,
      leaveTolY,
      session?.lastHitY,
      options.showSecondaryGuides !== false
    );

    let deltaX = pickedX.primary ? pickedX.primary.delta : 0;
    let deltaY = pickedY.primary ? pickedY.primary.delta : 0;

    const reasonTrace: string[] = [];
    if (pickedX.primary) reasonTrace.push(`snap-x:${pickedX.primary.guide.kind}`);
    if (pickedY.primary) reasonTrace.push(`snap-y:${pickedY.primary.guide.kind}`);

    if (!pickedX.primary && !pickedY.primary && options.fallbackToGrid) {
      const gridSize = options.gridSizePx || 20;
      const snappedX = snapToGrid(selection.x, gridSize);
      const snappedY = snapToGrid(selection.y, gridSize);
      deltaX = snappedX - selection.x;
      deltaY = snappedY - selection.y;
      if (deltaX !== 0 || deltaY !== 0) {
        reasonTrace.push('grid-fallback');
      }
    }

    const appliedRect: Rect = {
      x: selection.x + deltaX,
      y: selection.y + deltaY,
      width: selection.width,
      height: selection.height,
    };

    const distances: DistanceHint[] = [];
    if (options.showDistance) {
      const ctxX = pickedX.primary ? spacingByToken.get(pickedX.primary.token) : null;
      const ctxY = pickedY.primary ? spacingByToken.get(pickedY.primary.token) : null;
      const merged: SpacingContext = {};
      if (ctxX?.left) merged.left = ctxX.left;
      if (ctxX?.right) merged.right = ctxX.right;
      if (ctxY?.top) merged.top = ctxY.top;
      if (ctxY?.bottom) merged.bottom = ctxY.bottom;
      if (merged.left || merged.right || merged.top || merged.bottom) {
        distances.push(...this.buildSpacingDistances(merged, appliedRect, scale));
      }
    }

    const guideLines: GuideLine[] = [];
    const pushGuide = (candidate: Candidate | null, role: 'primary' | 'secondary') => {
      if (!candidate) return;
      guideLines.push({
        ...candidate.guide,
        role,
        priority: role === 'primary' ? 0 : 1,
      });
    };
    pushGuide(pickedX.primary, 'primary');
    pushGuide(pickedY.primary, 'primary');
    if (options.showSecondaryGuides !== false) {
      pushGuide(pickedX.secondary, 'secondary');
      pushGuide(pickedY.secondary, 'secondary');
    }

    if (session) {
      if (!session.axisLock) session.axisLock = { x: false, y: false } as AxisLock;
      session.axisLock.x = !!pickedX.primary;
      session.axisLock.y = !!pickedY.primary;
      session.lastHitX = pickedX.primary
        ? { token: pickedX.primary.token, guide: pickedX.primary.guide, delta: pickedX.primary.delta }
        : undefined;
      session.lastHitY = pickedY.primary
        ? { token: pickedY.primary.token, guide: pickedY.primary.guide, delta: pickedY.primary.delta }
        : undefined;
      session.lastPlan = { delta: { x: deltaX, y: deltaY }, appliedRect, guideLines, distances, reasonTrace };
    }

    return {
      delta: { x: deltaX, y: deltaY },
      appliedRect,
      guideLines,
      distances,
      reasonTrace,
    };
  }

  computeResizePlan(
    canvas: CanvasSnapshot,
    rect: Rect,
    selectionIds: string[],
    options: GuideOptions,
    session?: GuideSession
  ): ResizePlan {
    if (!options.enabled || options.modifierDisabled) {
      return { widthDelta: 0, heightDelta: 0, xDelta: 0, yDelta: 0, guideLines: [], reasonTrace: ['disabled'] };
    }
    if (!isValidRect(rect)) {
      return { widthDelta: 0, heightDelta: 0, xDelta: 0, yDelta: 0, guideLines: [], reasonTrace: ['invalid-selection-rect'] };
    }
    const scale = clampScale(canvas.scale);
    const tol = toCanvasTolerancePx(options.tolerancePx, scale);
    const selectionIdSet = new Set(selectionIds);
    const excludeTypes = options.allowContainer ? [] : ['group'];
    const eligible = filterEligibleNodes(canvas.nodes, selectionIdSet, { excludeTypes });
    const hysteresis = toCanvasTolerancePx(session?.hysteresisPx ?? 0, scale);
    const leaveTol = tol + hysteresis;

    const handle = options.resizeHandle;
    const handleX = this.resolveResizeHandleAxis(handle, 'x');
    const handleY = this.resolveResizeHandleAxis(handle, 'y');

    const left = rect.x;
    const right = rectRight(rect);
    const top = rect.y;
    const bottom = rectBottom(rect);

    const xCandidates: ResizeCandidate[] = [];
    const yCandidates: ResizeCandidate[] = [];

    for (const n of eligible) {
      const nr = rectRight(n.rect);
      const nl = n.rect.x;
      const nt = n.rect.y;
      const nb = rectBottom(n.rect);
      const kind = options.allowContainer && n.type === 'group' ? 'container' : 'edge';

      if (handleX) {
        const currentEdge = handleX === 'right' ? right : left;
        const targets = [nl, nr];
        for (const t of targets) {
          const delta = t - currentEdge;
          if (Math.abs(delta) <= tol) {
            const widthDelta = handleX === 'right' ? delta : -delta;
            const xDelta = handleX === 'left' ? delta : 0;
            xCandidates.push({
              delta,
              guide: { orientation: 'vertical', pos: t, kind, targetId: n.id },
              score: scoreCandidate(kind, delta, false),
              token: `resize-x:${handleX}:${kind}:${n.id}:${t}`,
              widthDelta,
              heightDelta: 0,
              xDelta,
              yDelta: 0,
            });
          }
        }
      }

      if (handleY) {
        const currentEdge = handleY === 'bottom' ? bottom : top;
        const targets = [nt, nb];
        for (const t of targets) {
          const delta = t - currentEdge;
          if (Math.abs(delta) <= tol) {
            const heightDelta = handleY === 'bottom' ? delta : -delta;
            const yDelta = handleY === 'top' ? delta : 0;
            yCandidates.push({
              delta,
              guide: { orientation: 'horizontal', pos: t, kind, targetId: n.id },
              score: scoreCandidate(kind, delta, false),
              token: `resize-y:${handleY}:${kind}:${n.id}:${t}`,
              widthDelta: 0,
              heightDelta,
              xDelta: 0,
              yDelta,
            });
          }
        }
      }
    }

    const bestX = this.pickResizeCandidate(xCandidates, leaveTol, session?.lastHitX);
    const bestY = this.pickResizeCandidate(yCandidates, leaveTol, session?.lastHitY);

    const guideLines: GuideLine[] = [];
    if (bestX) guideLines.push(bestX.guide);
    if (bestY) guideLines.push(bestY.guide);

    const reasonTrace: string[] = [];
    if (bestX) reasonTrace.push('resize-x');
    if (bestY) reasonTrace.push('resize-y');

    if (session) {
      if (!session.axisLock) session.axisLock = { x: false, y: false } as AxisLock;
      session.axisLock.x = !!bestX;
      session.axisLock.y = !!bestY;
      session.lastHitX = bestX ? { token: bestX.token, guide: bestX.guide, delta: bestX.delta } : undefined;
      session.lastHitY = bestY ? { token: bestY.token, guide: bestY.guide, delta: bestY.delta } : undefined;
    }

    return {
      widthDelta: bestX ? bestX.widthDelta : 0,
      heightDelta: bestY ? bestY.heightDelta : 0,
      xDelta: bestX ? bestX.xDelta : 0,
      yDelta: bestY ? bestY.yDelta : 0,
      guideLines,
      reasonTrace,
    };
  }

  private computeAlignmentCandidates(
    selection: Rect,
    neighbors: NodeGeom[],
    tolX: number,
    tolY: number,
    axisLock: AxisLock,
    options: GuideOptions,
    selectionBaseline: number | null
  ): { xCandidates: Candidate[]; yCandidates: Candidate[]; spacingByToken: Map<string, SpacingContext> } {
    const xCandidates: Candidate[] = [];
    const yCandidates: Candidate[] = [];
    const spacingByToken = new Map<string, SpacingContext>();

    const cLeft = selection.x;
    const cRight = rectRight(selection);
    const cTop = selection.y;
    const cBottom = rectBottom(selection);
    const cCx = selectionCenterX(selection);
    const cCy = selectionCenterY(selection);

    const pushCandidate = (
      axis: 'x' | 'y',
      delta: number,
      guide: GuideLine,
      kind: GuideLine['kind'],
      token: string,
      axisLocked: boolean,
      tol: number
    ) => {
      if (Math.abs(delta) > tol) return;
      const candidate: Candidate = {
        axis,
        delta,
        guide,
        score: scoreCandidate(kind, delta, axisLocked),
        kind: 'align',
        token,
      };
      if (axis === 'x') xCandidates.push(candidate);
      else yCandidates.push(candidate);
    };

    for (const n of neighbors) {
      const r = n.rect;
      const nLeft = r.x;
      const nRight = rectRight(r);
      const nTop = r.y;
      const nBottom = rectBottom(r);
      const nCx = rectCenter(r).x;
      const nCy = rectCenter(r).y;
      const isContainer = options.allowContainer && n.type === 'group';

      const xPairs: Array<{ cand: number; target: number; kind: 'edge' | 'center'; token: string }> = isContainer
        ? [
            { cand: cLeft, target: nLeft, kind: 'edge', token: `edge:x:left-left:${n.id}` },
            { cand: cRight, target: nRight, kind: 'edge', token: `edge:x:right-right:${n.id}` },
          ]
        : [
            { cand: cLeft, target: nLeft, kind: 'edge', token: `edge:x:left-left:${n.id}` },
            { cand: cLeft, target: nRight, kind: 'edge', token: `edge:x:left-right:${n.id}` },
            { cand: cCx, target: nCx, kind: 'center', token: `center:x:${n.id}` },
            { cand: cRight, target: nLeft, kind: 'edge', token: `edge:x:right-left:${n.id}` },
            { cand: cRight, target: nRight, kind: 'edge', token: `edge:x:right-right:${n.id}` },
          ];
      for (const p of xPairs) {
        if (isContainer && p.kind === 'center') continue;
        const kind = isContainer ? 'container' : p.kind;
        const delta = p.target - p.cand;
        pushCandidate(
          'x',
          delta,
          { orientation: 'vertical', pos: p.target, kind, targetId: n.id },
          kind,
          isContainer ? `container:x:${p.token}:${n.id}` : p.token,
          axisLock.x,
          tolX
        );
      }

      const yPairs: Array<{ cand: number; target: number; kind: 'edge' | 'center'; token: string }> = isContainer
        ? [
            { cand: cTop, target: nTop, kind: 'edge', token: `edge:y:top-top:${n.id}` },
            { cand: cBottom, target: nBottom, kind: 'edge', token: `edge:y:bottom-bottom:${n.id}` },
          ]
        : [
            { cand: cTop, target: nTop, kind: 'edge', token: `edge:y:top-top:${n.id}` },
            { cand: cTop, target: nBottom, kind: 'edge', token: `edge:y:top-bottom:${n.id}` },
            { cand: cCy, target: nCy, kind: 'center', token: `center:y:${n.id}` },
            { cand: cBottom, target: nTop, kind: 'edge', token: `edge:y:bottom-top:${n.id}` },
            { cand: cBottom, target: nBottom, kind: 'edge', token: `edge:y:bottom-bottom:${n.id}` },
          ];
      for (const p of yPairs) {
        if (isContainer && p.kind === 'center') continue;
        const kind = isContainer ? 'container' : p.kind;
        const delta = p.target - p.cand;
        pushCandidate(
          'y',
          delta,
          { orientation: 'horizontal', pos: p.target, kind, targetId: n.id },
          kind,
          isContainer ? `container:y:${p.token}:${n.id}` : p.token,
          axisLock.y,
          tolY
        );
      }

      if (options.allowBaseline && selectionBaseline != null && typeof n.baseline === 'number') {
        const delta = n.baseline - selectionBaseline;
        pushCandidate(
          'y',
          delta,
          { orientation: 'horizontal', pos: n.baseline, kind: 'baseline', targetId: n.id },
          'baseline',
          `baseline:${n.id}`,
          axisLock.y,
          tolY
        );
      }
    }

    if (options.equalSpacing) {
      const spacingX = this.computeSpacingX(selection, neighbors, tolX, axisLock.x);
      if (spacingX) {
        xCandidates.push(spacingX.candidate);
        spacingByToken.set(spacingX.candidate.token, { left: spacingX.left, right: spacingX.right });
      }
      const spacingY = this.computeSpacingY(selection, neighbors, tolY, axisLock.y);
      if (spacingY) {
        yCandidates.push(spacingY.candidate);
        spacingByToken.set(spacingY.candidate.token, { top: spacingY.top, bottom: spacingY.bottom });
      }
    }

    return { xCandidates, yCandidates, spacingByToken };
  }

  private computeSpacingX(
    selection: Rect,
    neighbors: NodeGeom[],
    tolX: number,
    axisLocked: boolean
  ): { candidate: Candidate; left: Rect; right: Rect } | null {
    const threshold = 0.4;
    const sameRow = neighbors
      .filter((n) => rectOverlapRatioY(selection, n.rect) >= threshold)
      .sort((a, b) => rectCenter(a.rect).x - rectCenter(b.rect).x);

    if (sameRow.length < 2) return null;

    const gaps: number[] = [];
    for (let i = 0; i < sameRow.length - 1; i += 1) {
      const gap = sameRow[i + 1].rect.x - rectRight(sameRow[i].rect);
      if (gap > 0) gaps.push(gap);
    }
    if (gaps.length < 2) return null;

    const targetGap = this.median(gaps);
    const cCx = selectionCenterX(selection);
    let left: NodeGeom | null = null;
    let right: NodeGeom | null = null;

    for (const n of sameRow) {
      const cx = rectCenter(n.rect).x;
      if (cx < cCx) left = n;
      else {
        right = n;
        break;
      }
    }

    if (!left || !right) return null;

    const targetX = rectRight(left.rect) + targetGap;
    const delta = targetX - selection.x;
    const rightGap = right.rect.x - (targetX + selection.width);
    if (Math.abs(delta) > tolX) return null;
    if (Math.abs(rightGap - targetGap) > tolX) return null;

    const candidate: Candidate = {
      axis: 'x',
      delta,
      guide: {
        orientation: 'vertical',
        pos: targetX + selection.width / 2,
        kind: 'spacing',
        targetId: right.id,
      },
      score: scoreCandidate('spacing', delta, axisLocked),
      kind: 'spacing',
      token: `spacing-x:${left.id}:${right.id}`,
    };

    return { candidate, left: left.rect, right: right.rect };
  }

  private computeSpacingY(
    selection: Rect,
    neighbors: NodeGeom[],
    tolY: number,
    axisLocked: boolean
  ): { candidate: Candidate; top: Rect; bottom: Rect } | null {
    const threshold = 0.4;
    const sameCol = neighbors
      .filter((n) => rectOverlapRatioX(selection, n.rect) >= threshold)
      .sort((a, b) => rectCenter(a.rect).y - rectCenter(b.rect).y);

    if (sameCol.length < 2) return null;

    const gaps: number[] = [];
    for (let i = 0; i < sameCol.length - 1; i += 1) {
      const gap = sameCol[i + 1].rect.y - rectBottom(sameCol[i].rect);
      if (gap > 0) gaps.push(gap);
    }
    if (gaps.length < 2) return null;

    const targetGap = this.median(gaps);
    const cCy = selectionCenterY(selection);
    let top: NodeGeom | null = null;
    let bottom: NodeGeom | null = null;

    for (const n of sameCol) {
      const cy = rectCenter(n.rect).y;
      if (cy < cCy) top = n;
      else {
        bottom = n;
        break;
      }
    }

    if (!top || !bottom) return null;

    const targetY = rectBottom(top.rect) + targetGap;
    const delta = targetY - selection.y;
    const bottomGap = bottom.rect.y - (targetY + selection.height);
    if (Math.abs(delta) > tolY) return null;
    if (Math.abs(bottomGap - targetGap) > tolY) return null;

    const candidate: Candidate = {
      axis: 'y',
      delta,
      guide: {
        orientation: 'horizontal',
        pos: targetY + selection.height / 2,
        kind: 'spacing',
        targetId: bottom.id,
      },
      score: scoreCandidate('spacing', delta, axisLocked),
      kind: 'spacing',
      token: `spacing-y:${top.id}:${bottom.id}`,
    };

    return { candidate, top: top.rect, bottom: bottom.rect };
  }

  private pickAxisCandidate(
    candidates: Candidate[],
    enterTol: number,
    leaveTol: number,
    lastHit?: { token: string },
    allowSecondary: boolean = true
  ): { primary: Candidate | null; secondary: Candidate | null } {
    if (!candidates.length) return { primary: null, secondary: null };
    const sorted = [...candidates].sort((a, b) => a.score - b.score);
    let primary = sorted[0];
    if (lastHit) {
      const sticky = sorted.find((c) => c.token === lastHit.token);
      if (sticky && Math.abs(sticky.delta) <= leaveTol) primary = sticky;
    }

    let secondary: Candidate | null = null;
    if (allowSecondary) {
      const secondaryTol = enterTol * 1.25;
      for (const c of sorted) {
        if (c.token === primary.token) continue;
        if (Math.abs(c.delta) > secondaryTol) continue;
        secondary = c;
        break;
      }
    }

    return { primary, secondary };
  }

  private pickResizeCandidate(
    candidates: ResizeCandidate[],
    leaveTol: number,
    lastHit?: { token: string }
  ): ResizeCandidate | null {
    if (!candidates.length) return null;
    const sorted = [...candidates].sort((a, b) => a.score - b.score);
    if (lastHit) {
      const sticky = sorted.find((c) => c.token === lastHit.token);
      if (sticky && Math.abs(sticky.delta) <= leaveTol) return sticky;
    }
    return sorted[0];
  }

  private resolveResizeHandleAxis(
    handle: ResizeHandle | undefined,
    axis: 'x' | 'y'
  ): 'left' | 'right' | 'top' | 'bottom' | null {
    if (!handle) return axis === 'x' ? 'right' : 'bottom';
    if (axis === 'x') {
      if (handle.includes('left')) return 'left';
      if (handle.includes('right')) return 'right';
      return null;
    }
    if (handle.includes('top')) return 'top';
    if (handle.includes('bottom')) return 'bottom';
    return null;
  }

  private getSelectionBaseline(
    nodes: NodeGeom[],
    selectionIds: string[],
    selection: Rect,
    allowBaseline?: boolean
  ): number | null {
    if (!allowBaseline || selectionIds.length !== 1) return null;
    const node = nodes.find((n) => n.id === selectionIds[0]);
    if (!node || typeof node.baseline !== 'number') return null;
    const deltaY = selection.y - node.rect.y;
    return node.baseline + deltaY;
  }

  private median(values: number[]): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private buildSpacingDistances(context: SpacingContext, applied: Rect, scale: number): DistanceHint[] {
    const hints: DistanceHint[] = [];
    const s = clampScale(scale);
    const midX = rectCenter(applied).x;
    const midY = rectCenter(applied).y;
    const xOff = Math.min(20 / s, Math.max(6, applied.width * 0.05));
    const yOff = Math.min(20 / s, Math.max(6, applied.height * 0.05));

    if (context.left && context.right) {
      const leftRight = rectRight(context.left);
      const rightLeft = context.right.x;
      const g1 = Math.max(0, applied.x - leftRight);
      const g2 = Math.max(0, rightLeft - rectRight(applied));
      hints.push({
        orientation: 'horizontal',
        x1: leftRight,
        y1: midY - yOff,
        x2: applied.x,
        y2: midY - yOff,
        value: g1,
      });
      hints.push({
        orientation: 'horizontal',
        x1: rectRight(applied),
        y1: midY + yOff,
        x2: rightLeft,
        y2: midY + yOff,
        value: g2,
      });
    }

    if (context.top && context.bottom) {
      const topBottom = rectBottom(context.top);
      const bottomTop = context.bottom.y;
      const g1 = Math.max(0, applied.y - topBottom);
      const g2 = Math.max(0, bottomTop - rectBottom(applied));
      hints.push({
        orientation: 'vertical',
        x1: midX - xOff,
        y1: topBottom,
        x2: midX - xOff,
        y2: applied.y,
        value: g1,
      });
      hints.push({
        orientation: 'vertical',
        x1: midX + xOff,
        y1: rectBottom(applied),
        x2: midX + xOff,
        y2: bottomTop,
        value: g2,
      });
    }

    return hints;
  }

  private identityPlan(selection: Rect, trace: string[] = ['identity']): SnapPlan {
    return {
      delta: { x: 0, y: 0 },
      appliedRect: { ...selection },
      guideLines: [],
      distances: [],
      reasonTrace: trace,
    };
  }
}
