// 🚀 动态连线渲染器 - 完全实时计算的智能连线系统
// 所有连线几何信息都在渲染时根据节点当前位置动态计算

import type { CanvasNode, CanvasConnection } from '../types/canvas';
// Note: keep renderer self-contained; avoid mixing with legacy smart algo
// import { analyzeConnection, generateSmartControlPointsWithTangents } from './smartConnectionAlgorithm';

// 📍 位置接口
export interface Position {
  x: number;
  y: number;
}

// 🔄 连线渲染结果
export interface ConnectionRenderResult {
  path: string;           // SVG路径字符串
  midPoint: Position;     // 中点位置（用于标签）
  isSmartCurve: boolean;  // 是否为智能曲线
  arrowAngle: number;     // 箭头角度（度数，指向目标节点中心）
  // 可选：三次贝塞尔控制点，供上层做路径插值动画
  cubic?: { start: Position; cp1: Position; cp2: Position; end: Position };
  guides?: { from?: string; to?: string };
}

// 📐 计算射线与矩形的交点（边缘连接算法）
function calculateRayRectIntersection(center: Position, direction: Position, size: { width: number; height: number }): Position {
  const { x: cx, y: cy } = center;
  const { x: dx, y: dy } = direction;
  const { width, height } = size;

  // 矩形边界
  const left = cx - width / 2;
  const right = cx + width / 2;
  const top = cy - height / 2;
  const bottom = cy + height / 2;

  // 计算与四条边的交点
  const intersections = [];

  // 右边 (x = right)
  if (dx > 0) {
    const t = (right - cx) / dx;
    const y = cy + t * dy;
    if (y >= top && y <= bottom) intersections.push({ x: right, y, t });
  }

  // 左边 (x = left)
  if (dx < 0) {
    const t = (left - cx) / dx;
    const y = cy + t * dy;
    if (y >= top && y <= bottom) intersections.push({ x: left, y, t });
  }

  // 下边 (y = bottom)
  if (dy > 0) {
    const t = (bottom - cy) / dy;
    const x = cx + t * dx;
    if (x >= left && x <= right) intersections.push({ x, y: bottom, t });
  }

  // 上边 (y = top)
  if (dy < 0) {
    const t = (top - cy) / dy;
    const x = cx + t * dx;
    if (x >= left && x <= right) intersections.push({ x, y: top, t });
  }

  // 返回最近的有效交点
  if (intersections.length > 0) {
    const closest = intersections.reduce((prev, curr) =>
      (curr.t < prev.t && curr.t > 0) ? curr : prev
    );
    return { x: closest.x, y: closest.y };
  }

  return center; // 回退到中心点
}

// 🎯 计算边缘到边缘的连接点
function calculateEdgeToEdgeConnection(fromNode: CanvasNode, toNode: CanvasNode): { fromPos: Position; toPos: Position } {
  // 节点中心点
  const fromCenter: Position = {
    x: fromNode.x + fromNode.width / 2,
    y: fromNode.y + fromNode.height / 2
  };
  const toCenter: Position = {
    x: toNode.x + toNode.width / 2,
    y: toNode.y + toNode.height / 2
  };

  // 计算方向向量
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length === 0) return { fromPos: fromCenter, toPos: toCenter };

  // 单位方向向量
  const unitDirection: Position = { x: dx / length, y: dy / length };
  const reverseDirection: Position = { x: -dx / length, y: -dy / length };

  // 计算边缘交点
  const fromPos = calculateRayRectIntersection(
    fromCenter,
    unitDirection,
    { width: fromNode.width, height: fromNode.height }
  );
  const toPos = calculateRayRectIntersection(
    toCenter,
    reverseDirection,
    { width: toNode.width, height: toNode.height }
  );

  return { fromPos, toPos };
}

// —— 新增：边中点与边法线方案 ——
type Side = 'left' | 'right' | 'top' | 'bottom';

// 🎛️ 出/入边选择配置（可按需调整/暴露）
export const SIDE_SELECTION_CONFIG = {
  // 只有当“净水平间距”或“净垂直间距”明显大于该阈值时，才优先切到对应轴的连线
  horizontalGapThreshold: 30, // px（统一为 30）
  verticalGapThreshold: 30,   // px（新增，统一为 30）
  // 为避免几乎等高/等宽时仍强制某方向，给微小位移阈值
  verticalMinDelta: 10,   // px（开启）
  horizontalMinDelta: 10, // px（开启）
  // 当两个方向都超过阈值时的优先轴
  preferAxis: 'vertical' as const,
} as const;

function getCenter(n: CanvasNode): Position {
  return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
}

function getSideMidpoint(n: CanvasNode, side: Side): Position {
  const c = getCenter(n);
  switch (side) {
    case 'left': return { x: c.x - n.width / 2, y: c.y };
    case 'right': return { x: c.x + n.width / 2, y: c.y };
    case 'top': return { x: c.x, y: c.y - n.height / 2 };
    case 'bottom': return { x: c.x, y: c.y + n.height / 2 };
  }
}

function getOutwardNormal(side: Side): Position {
  switch (side) {
    case 'left': return { x: -1, y: 0 };
    case 'right': return { x: 1, y: 0 };
    case 'top': return { x: 0, y: -1 };
    case 'bottom': return { x: 0, y: 1 };
  }
}

function chooseSidesByCenters(fromNode: CanvasNode, toNode: CanvasNode): { fromSide: Side; toSide: Side } {
  // 🎯 简化的边选择逻辑：基于水平净间距决定连线方向
  const fromCenter = getCenter(fromNode);
  const toCenter = getCenter(toNode);

  // 计算节点边界
  const fromLeft = fromNode.x;
  const fromRight = fromNode.x + fromNode.width;
  const toLeft = toNode.x;
  const toRight = toNode.x + toNode.width;

  // 计算水平净间距
  let gapX = 0;
  if (toCenter.x >= fromCenter.x) {
    // toNode 在 fromNode 的右侧
    gapX = Math.max(0, toLeft - fromRight);
  } else {
    // toNode 在 fromNode 的左侧
    gapX = Math.max(0, fromLeft - toRight);
  }

  const HORIZONTAL_TOLERANCE = 10; // 10px容差

  if (gapX > HORIZONTAL_TOLERANCE) {
    // 🎯 水平有净间距 → 强制左右连线（无视垂直距离）
    const dx = toCenter.x - fromCenter.x;
    return dx >= 0
      ? { fromSide: 'right', toSide: 'left' }   // toNode在右侧
      : { fromSide: 'left', toSide: 'right' };  // toNode在左侧
  } else {
    // 🎯 水平重叠 → 上下连线
    const dy = toCenter.y - fromCenter.y;
    return dy >= 0
      ? { fromSide: 'bottom', toSide: 'top' }   // toNode在下方
      : { fromSide: 'top', toSide: 'bottom' };  // toNode在上方
  }
}

import { getConnectionSettings } from '../stores/settings.store';

function getEndpointsByStrategy(fromNode: CanvasNode, toNode: CanvasNode):
  | { kind: 'center-ray'; fromPos: Position; toPos: Position; fromCenter: Position; toCenter: Position }
  | { kind: 'side-midpoints'; fromPos: Position; toPos: Position; fromSide: Side; toSide: Side; fromCenter: Position; toCenter: Position } {
  const fromCenter = getCenter(fromNode);
  const toCenter = getCenter(toNode);
  const strategy = getConnectionSettings().endpointStrategy || 'center-ray';
  if (strategy === 'side-midpoints') {
    const { fromPos, toPos, fromSide, toSide } = getEdgeMidpointConnection(fromNode, toNode);
    return { kind: 'side-midpoints', fromPos, toPos, fromSide, toSide, fromCenter, toCenter };
  }
  const { fromPos, toPos } = calculateEdgeToEdgeConnection(fromNode, toNode);
  return { kind: 'center-ray', fromPos, toPos, fromCenter, toCenter };
}

function getEdgeMidpointConnection(fromNode: CanvasNode, toNode: CanvasNode): { fromPos: Position; toPos: Position; fromSide: Side; toSide: Side } {
  const mode = getConnectionSettings().mode;
  let fromSide: Side;
  let toSide: Side;
  if (mode === 'horizontal-only') {
    const bC = getCenter(fromNode); const aC = getCenter(toNode);
    const dx = aC.x - bC.x;
    fromSide = dx >= 0 ? 'right' : 'left';
    toSide = dx >= 0 ? 'left' : 'right';
  } else if (mode === 'vertical-only') {
    const bC = getCenter(fromNode); const aC = getCenter(toNode);
    const dy = aC.y - bC.y;
    fromSide = dy >= 0 ? 'bottom' : 'top';
    toSide = dy >= 0 ? 'top' : 'bottom';
  } else {
    const res = chooseSidesByCenters(fromNode, toNode);
    fromSide = res.fromSide; toSide = res.toSide;
  }
  return {
    fromPos: getSideMidpoint(fromNode, fromSide),
    toPos: getSideMidpoint(toNode, toSide),
    fromSide,
    toSide
  };
}

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

function makeControlPointsWithNormals(start: Position, end: Position, fromSide: Side, toSide: Side): Position[] {
  const dxAbs = Math.abs(end.x - start.x);
  const dyAbs = Math.abs(end.y - start.y);
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  const align = Math.min(dxAbs, dyAbs) / Math.max(dxAbs, dyAbs || 1);
  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
  let f = 0.15 + 0.6 * sigmoid((dist - 160) / 90) + 0.25 * align; // 0..1 连续
  f = clamp01(f);

  const nFrom = getOutwardNormal(fromSide);
  const nTo = getOutwardNormal(toSide);
  const fromIsH = Math.abs(nFrom.x) > Math.abs(nFrom.y);
  const toIsH = Math.abs(nTo.x) > Math.abs(nTo.y);
  const majorFrom = fromIsH ? dxAbs : dyAbs;
  const majorTo = toIsH ? dxAbs : dyAbs;
  const minorFrom = fromIsH ? dyAbs : dxAbs;
  const minorTo = toIsH ? dyAbs : dxAbs;

  const dMin = 12;
  const dMaxFrom = Math.max(24, majorFrom * 0.9);
  const dMaxTo = Math.max(24, majorTo * 0.9);
  const d1Base = 0.55 * majorFrom + 0.15 * minorFrom;
  const d2Base = 0.55 * majorTo + 0.15 * minorTo;
  const d1 = Math.min(dMaxFrom, dMin + (d1Base - dMin) * f);
  const d2 = Math.min(dMaxTo, dMin + (d2Base - dMin) * f);

  // 起点控制点：沿“出边”外法线，确保出角垂直于出射边
  const cp1 = { x: start.x + nFrom.x * d1, y: start.y + nFrom.y * d1 };

  // 终点控制点：严格保证入角垂直于“入射边”
  // 令 t=1 处切线方向 ∝ (end - cp2) 与目标边法线（指向节点内部）完全一致
  // 目标内部法线为 -nTo，因此直接设置：cp2 = end - (-nTo) * d2 = end + nTo * d2
  const cp2 = { x: end.x + nTo.x * d2, y: end.y + nTo.y * d2 };

  return [cp1, cp2];
}

// 📈 计算贝塞尔曲线上的点
function calculateBezierPoint(
  t: number,
  p0: Position,
  p1: Position,
  p2: Position,
  p3: Position
): Position {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;

  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
  };
}

// ====== 基于“中心 → 中心”的曲线裁剪到节点边缘 ======
type Rect = { left: number; right: number; top: number; bottom: number };

function nodeRect(n: CanvasNode): Rect {
  return { left: n.x, right: n.x + n.width, top: n.y, bottom: n.y + n.height };
}

function isInsideRect(p: Position, r: Rect): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

function lerp(a: Position, b: Position, t: number): Position {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function splitCubic(p0: Position, p1: Position, p2: Position, p3: Position, t: number): { left: [Position, Position, Position, Position]; right: [Position, Position, Position, Position] } {
  const p01 = lerp(p0, p1, t);
  const p12 = lerp(p1, p2, t);
  const p23 = lerp(p2, p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const p = lerp(p012, p123, t);
  return { left: [p0, p01, p012, p], right: [p, p123, p23, p3] };
}

function trimCubic(p0: Position, p1: Position, p2: Position, p3: Position, t0: number, t1: number): { start: Position; cp1: Position; cp2: Position; end: Position } {
  if (t0 <= 0 && t1 >= 1) return { start: p0, cp1: p1, cp2: p2, end: p3 };
  const s1 = splitCubic(p0, p1, p2, p3, t1);
  const t0n = t0 / Math.max(t1, 1e-6);
  const s0 = splitCubic(s1.left[0], s1.left[1], s1.left[2], s1.left[3], Math.max(0, Math.min(1, t0n)));
  const seg = s0.right;
  return { start: seg[0], cp1: seg[1], cp2: seg[2], end: seg[3] };
}

function reverseCubicSegment(seg: { start: Position; cp1: Position; cp2: Position; end: Position }): { start: Position; cp1: Position; cp2: Position; end: Position } {
  return { start: seg.end, cp1: seg.cp2, cp2: seg.cp1, end: seg.start };
}

function findExitTFromStart(p0: Position, p1: Position, p2: Position, p3: Position, startRect: Rect): number {
  if (!isInsideRect(p0, startRect)) return 0;
  let prevT = 0; let prevInside = true;
  const STEPS = 80;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const pt = calculateBezierPoint(t, p0, p1, p2, p3);
    const inside = isInsideRect(pt, startRect);
    if (prevInside && !inside) {
      let lo = prevT, hi = t;
      for (let k = 0; k < 24 && hi - lo > 1e-4; k++) {
        const mid = (lo + hi) / 2;
        const pm = calculateBezierPoint(mid, p0, p1, p2, p3);
        if (isInsideRect(pm, startRect)) lo = mid; else hi = mid;
      }
      return hi;
    }
    prevInside = inside; prevT = t;
  }
  return 0.0001;
}

function findEnterTToEnd(p0: Position, p1: Position, p2: Position, p3: Position, endRect: Rect): number {
  if (!isInsideRect(p3, endRect)) return 1;
  let prevT = 1; let prevInside = true;
  const STEPS = 80;
  for (let i = 1; i <= STEPS; i++) {
    const t = 1 - i / STEPS;
    const pt = calculateBezierPoint(t, p0, p1, p2, p3);
    const inside = isInsideRect(pt, endRect);
    if (prevInside && !inside) {
      let lo = t, hi = prevT;
      for (let k = 0; k < 24 && hi - lo > 1e-4; k++) {
        const mid = (lo + hi) / 2;
        const pm = calculateBezierPoint(mid, p0, p1, p2, p3);
        if (isInsideRect(pm, endRect)) hi = mid; else lo = mid;
      }
      return lo;
    }
    prevInside = inside; prevT = t;
  }
  return 0.9999;
}

// 🎨 生成贝塞尔曲线路径
function generateBezierPath(start: Position, end: Position, controlPoints: Position[]): string {
  if (controlPoints.length < 2) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }

  const [cp1, cp2] = controlPoints;
  return `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`;
}

// 🎯 获取曲线中点位置
function getBezierMidpoint(start: Position, end: Position, controlPoints?: Position[]): Position {
  if (!controlPoints || controlPoints.length < 2) {
    // 直线中点
    return {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2
    };
  }

  const [cp1, cp2] = controlPoints;
  return calculateBezierPoint(0.5, start, cp1, cp2, end);
}

// 🎯 计算箭头应该指向目标节点中心的角度
function calculateArrowAngle(edgePoint: Position, nodeCenter: Position): number {
  const dx = nodeCenter.x - edgePoint.x;
  const dy = nodeCenter.y - edgePoint.y;

  // 计算角度（以度为单位），这样箭头指向节点中心
  const angleRadians = Math.atan2(dy, dx);
  const angleDegrees = (angleRadians * 180) / Math.PI;

  return angleDegrees;
}

// ===== Shared helpers (exported) for anchor param conversions =====
/**
 * Convert relative anchor params (u along chord, v along perpendicular) to absolute anchor position.
 * from/to are endpoint positions (either centers or chosen side-midpoints depending on strategy).
 */
export function anchorFromParams(from: Position, to: Position, ap: { u: number; v: number }): Position {
  const dx = to.x - from.x, dy = to.y - from.y;
  const L = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / L, y: dy / L };
  const perp = { x: -dir.y, y: dir.x };
  return {
    x: from.x + ap.u * dx + ap.v * L * perp.x,
    y: from.y + ap.u * dy + ap.v * L * perp.y,
  };
}

/**
 * Compute relative anchor params {u, v} from absolute anchor and endpoints.
 * from/to are endpoint positions (either centers or chosen side-midpoints depending on strategy).
 */
export function computeAnchorParams(from: Position, to: Position, anchor: Position): { u: number; v: number } {
  const dx = to.x - from.x, dy = to.y - from.y;
  const L = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / L, y: dy / L };
  const perp = { x: -dir.y, y: dir.x };
  const rx = anchor.x - from.x, ry = anchor.y - from.y;
  const u = (rx * dir.x + ry * dir.y) / (L || 1);
  const v = (rx * perp.x + ry * perp.y) / (L || 1);
  return { u, v };
}

// 🚀 主要函数：动态渲染连线
export function renderConnectionDynamically(
  connection: CanvasConnection,
  fromNode: CanvasNode,
  toNode: CanvasNode,
  opts?: { endpointOverride?: 'center-ray' | 'side-midpoints' }
): ConnectionRenderResult {
  const strategy = opts?.endpointOverride || (getConnectionSettings().endpointStrategy || 'center-ray');
  const fromCenter = getCenter(fromNode);
  const toCenter = getCenter(toNode);

  // 仅用于数据；实际箭头方向由 path 切线决定
  const arrowAngle = calculateArrowAngle(toCenter, toCenter);

  const anchorAbs = (connection as any)?.curveAnchor as Position | undefined;
  const ap = (connection as any)?.anchorParams as { u: number; v: number } | undefined;
  const suppressReanchor = Boolean((connection as any)?._suppressReanchor);
  const hasManual = (connection as any).curveMode === 'manual' && Array.isArray((connection as any).controlPoints) && (connection as any).controlPoints.length >= 2;

  // 当用户显式选择 legacy 侧边中点策略（思维导图内部），恢复“边缘中点出入 + 法线曲线”
  if (strategy === 'side-midpoints') {
    const e = getEdgeMidpointConnection(fromNode, toNode);
    const fromPos: Position = e.fromPos; const toPos: Position = e.toPos;
    let controlPoints: Position[] = [];
    // Resolve anchor: prefer anchorParams if present
    let useAnchor = anchorAbs;
    if (ap && !suppressReanchor) {
      const dx = toPos.x - fromPos.x, dy = toPos.y - fromPos.y;
      const L = Math.hypot(dx, dy) || 1;
      const dir = { x: dx / L, y: dy / L };
      const perp = { x: -dir.y, y: dir.x };
      useAnchor = { x: fromPos.x + ap.u * dx + ap.v * L * perp.x, y: fromPos.y + ap.u * dy + ap.v * L * perp.y };
    }
    if (useAnchor) {
      // 支持锚点编辑：以边缘中点为端点，按锚点整段求解
      controlPoints = makeControlPointsByAnchor(fromPos, toPos, useAnchor);
    } else if (hasManual) {
      controlPoints = ((connection as any).controlPoints as any[]).slice(0, 2) as Position[];
    } else {
      // 自动曲率：沿两侧外法线生成控制点，恢复旧视觉
      controlPoints = makeControlPointsWithNormals(fromPos, toPos, e.fromSide, e.toSide);
    }
    const path = generateBezierPath(fromPos, toPos, controlPoints);
    const midPoint = getBezierMidpoint(fromPos, toPos, controlPoints);
    const cubic = controlPoints.length >= 2
      ? { start: fromPos, cp1: controlPoints[0], cp2: controlPoints[1], end: toPos }
      : { start: fromPos, cp1: fromPos, cp2: toPos, end: toPos };
    return { path, midPoint, isSmartCurve: controlPoints.length >= 2, arrowAngle, cubic };
  }

  // 中心到中心的曲线（锚点/手动）并裁剪到矩形边缘
  let baseCp: Position[] = [];
  // Resolve anchor on center-chord: prefer anchorParams if present
  let useAnchor = anchorAbs;
  if (ap && !suppressReanchor) {
    const dx = toCenter.x - fromCenter.x, dy = toCenter.y - fromCenter.y;
    const L = Math.hypot(dx, dy) || 1;
    const dir = { x: dx / L, y: dy / L };
    const perp = { x: -dir.y, y: dir.x };
    useAnchor = { x: fromCenter.x + ap.u * dx + ap.v * L * perp.x, y: fromCenter.y + ap.u * dy + ap.v * L * perp.y };
  }
  if (useAnchor) {
    baseCp = makeControlPointsByAnchor(fromCenter, toCenter, useAnchor);
  } else if (hasManual) {
    baseCp = ((connection as any).controlPoints as any[]).slice(0, 2) as Position[];
  }

  if (baseCp.length < 2) {
    // 退化为直线：中心射线裁剪即可
    const { fromPos, toPos } = calculateEdgeToEdgeConnection(fromNode, toNode);
    const path = `M ${fromPos.x} ${fromPos.y} L ${toPos.x} ${toPos.y}`;
    const midPoint = { x: (fromPos.x + toPos.x) / 2, y: (fromPos.y + toPos.y) / 2 };
    const cubic = { start: fromPos, cp1: fromPos, cp2: toPos, end: toPos };
    return {
      path,
      midPoint,
      isSmartCurve: false,
      arrowAngle,
      cubic,
      guides: {
        from: `M ${fromCenter.x} ${fromCenter.y} L ${fromPos.x} ${fromPos.y}`,
        to: `M ${toCenter.x} ${toCenter.y} L ${toPos.x} ${toPos.y}`,
      },
    };
  }

  const sr = nodeRect(fromNode); const tr = nodeRect(toNode);
  const t0 = findExitTFromStart(fromCenter, baseCp[0], baseCp[1], toCenter, sr);
  const t1 = findEnterTToEnd(fromCenter, baseCp[0], baseCp[1], toCenter, tr);
  const t0c = Math.max(0, Math.min(t1 - 1e-4, t0));
  const t1c = Math.max(t0c + 1e-4, Math.min(1, t1));

  const seg = trimCubic(fromCenter, baseCp[0], baseCp[1], toCenter, t0c, t1c);
  const fromPos = seg.start; const toPos = seg.end;
  const controlPoints = [seg.cp1, seg.cp2];
  const path = generateBezierPath(fromPos, toPos, controlPoints);
  const midPoint = getBezierMidpoint(fromPos, toPos, controlPoints);
  const cubic = { start: fromPos, cp1: controlPoints[0], cp2: controlPoints[1], end: toPos };
  let guides: { from?: string; to?: string } | undefined;
  if (t0c > 0 || t1c < 1) {
    const before = trimCubic(fromCenter, baseCp[0], baseCp[1], toCenter, 0, t0c);
    const after = reverseCubicSegment(trimCubic(fromCenter, baseCp[0], baseCp[1], toCenter, t1c, 1));
    guides = {
      from: generateBezierPath(before.start, before.end, [before.cp1, before.cp2]),
      to: generateBezierPath(after.start, after.end, [after.cp1, after.cp2]),
    };
  }
  return { path, midPoint, isSmartCurve: true, arrowAngle, cubic, guides };
}

// 🔍 检查点是否在连线附近（用于点击检测）
export function isPointNearConnection(
  point: Position,
  connection: CanvasConnection,
  fromNode: CanvasNode,
  toNode: CanvasNode,
  threshold: number = 10
): boolean {
  const strategy = getConnectionSettings().endpointStrategy || 'center-ray';
  const anchorAbs = (connection as any)?.curveAnchor as Position | undefined;
  const ap = (connection as any)?.anchorParams as { u: number; v: number } | undefined;
  const hasManual = (connection as any).curveMode === 'manual' && Array.isArray((connection as any).controlPoints) && (connection as any).controlPoints.length >= 2;

  let fromPos: Position; let toPos: Position; let cp1: Position | null = null; let cp2: Position | null = null;
  if (((anchorAbs || ap) || hasManual) && strategy !== 'side-midpoints') {
    const fromCenter = getCenter(fromNode); const toCenter = getCenter(toNode);
    let useAnchor = anchorAbs;
    if (ap) {
      const dx = toCenter.x - fromCenter.x, dy = toCenter.y - fromCenter.y;
      const L = Math.hypot(dx, dy) || 1;
      const dir = { x: dx / L, y: dy / L };
      const perp = { x: -dir.y, y: dir.x };
      useAnchor = { x: fromCenter.x + ap.u * dx + ap.v * L * perp.x, y: fromCenter.y + ap.u * dy + ap.v * L * perp.y };
    }
    const baseCp = useAnchor ? makeControlPointsByAnchor(fromCenter, toCenter, useAnchor) : ((connection as any).controlPoints as any[]).slice(0, 2) as Position[];
    if (baseCp.length >= 2) {
      const sr = nodeRect(fromNode); const tr = nodeRect(toNode);
      const t0 = findExitTFromStart(fromCenter, baseCp[0], baseCp[1], toCenter, sr);
      const t1 = findEnterTToEnd(fromCenter, baseCp[0], baseCp[1], toCenter, tr);
      const t0c = Math.max(0, Math.min(t1 - 1e-4, t0));
      const t1c = Math.max(t0c + 1e-4, Math.min(1, t1));
      const seg = trimCubic(fromCenter, baseCp[0], baseCp[1], toCenter, t0c, t1c);
      fromPos = seg.start; toPos = seg.end; cp1 = seg.cp1; cp2 = seg.cp2;
    } else {
      const e = calculateEdgeToEdgeConnection(fromNode, toNode);
      fromPos = e.fromPos; toPos = e.toPos;
    }
  } else {
    if (strategy === 'side-midpoints') {
      const e = getEdgeMidpointConnection(fromNode, toNode);
      fromPos = e.fromPos; toPos = e.toPos;
      let useAnchor = anchorAbs;
      if (ap) {
        const dx = toPos.x - fromPos.x, dy = toPos.y - fromPos.y;
        const L = Math.hypot(dx, dy) || 1;
        const dir = { x: dx / L, y: dy / L };
        const perp = { x: -dir.y, y: dir.x };
        useAnchor = { x: fromPos.x + ap.u * dx + ap.v * L * perp.x, y: fromPos.y + ap.u * dy + ap.v * L * perp.y };
      }
      if (useAnchor) {
        const base = makeControlPointsByAnchor(fromPos, toPos, useAnchor);
        if (base.length >= 2) { cp1 = base[0]; cp2 = base[1]; }
      } else {
        const base = makeControlPointsWithNormals(fromPos, toPos, e.fromSide, e.toSide);
        if (base.length >= 2) { cp1 = base[0]; cp2 = base[1]; }
      }
    } else {
      const e = getEndpointsByStrategy(fromNode, toNode);
      fromPos = e.fromPos; toPos = e.toPos;
      let useAnchor = anchorAbs;
      if (ap) {
        const dx = e.toCenter.x - e.fromCenter.x, dy = e.toCenter.y - e.fromCenter.y;
        const L = Math.hypot(dx, dy) || 1;
        const dir = { x: dx / L, y: dy / L };
        const perp = { x: -dir.y, y: dir.x };
        useAnchor = { x: e.fromCenter.x + ap.u * dx + ap.v * L * perp.x, y: e.fromCenter.y + ap.u * dy + ap.v * L * perp.y };
      }
      if (useAnchor) {
        const base = makeControlPointsByAnchor(e.fromCenter, e.toCenter, useAnchor);
        if (base.length >= 2) { cp1 = base[0]; cp2 = base[1]; }
      }
    }
  }

  if (cp1 && cp2) {
    let prev = fromPos; const segments = 48;
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const curr = calculateBezierPoint(t, fromPos, cp1, cp2, toPos);
      const A = curr.y - prev.y; const B = prev.x - curr.x; const C = curr.x * prev.y - prev.x * curr.y;
      const distance = Math.abs(A * point.x + B * point.y + C) / Math.sqrt(A * A + B * B);
      if (distance <= threshold) return true;
      prev = curr;
    }
  } else {
    const A = toPos.y - fromPos.y; const B = fromPos.x - toPos.x; const C = toPos.x * fromPos.y - fromPos.x * toPos.y;
    const distance = Math.abs(A * point.x + B * point.y + C) / Math.sqrt(A * A + B * B);
    if (distance <= threshold) return true;
  }

  return false;
}

// 🚀 自由连线：基于坐标端点的路径渲染（用于独立线条）
export function renderConnectionFromPoints(
  start: Position,
  end: Position,
  connection?: CanvasConnection,
  opts?: { clipStartRect?: Rect; clipEndRect?: Rect }
): ConnectionRenderResult {
  const anchor = (connection as any)?.curveAnchor as Position | undefined;
  let cps: Position[] = [];
  if (anchor) {
    cps = makeControlPointsByAnchor(start, end, anchor!);
  } else if ((connection as any)?.curveMode === 'manual' && Array.isArray((connection as any)?.controlPoints) && (connection as any)?.controlPoints?.length >= 2) {
    cps = ((connection as any).controlPoints as any[]).slice(0, 2) as Position[];
  } else {
    cps = [];
  }

  const cubicRaw = cps.length >= 2
    ? { start, cp1: cps[0], cp2: cps[1], end }
    : { start, cp1: start, cp2: end, end };
  let cubic = cubicRaw;
  let guides: { from?: string; to?: string } | undefined;

  if (opts?.clipStartRect || opts?.clipEndRect) {
    let t0 = 0;
    let t1 = 1;
    if (opts.clipStartRect) {
      t0 = findExitTFromStart(cubic.start, cubic.cp1, cubic.cp2, cubic.end, opts.clipStartRect) || 0;
    }
    if (opts.clipEndRect) {
      t1 = findEnterTToEnd(cubic.start, cubic.cp1, cubic.cp2, cubic.end, opts.clipEndRect) || 1;
    }
    if (t1 <= t0) {
      t1 = Math.min(1, t0 + 1e-4);
    }
    if (t0 > 0 && opts.clipStartRect) {
      const before = trimCubic(cubicRaw.start, cubicRaw.cp1, cubicRaw.cp2, cubicRaw.end, 0, Math.max(0, Math.min(1, t0)));
      guides = {
        ...(guides || {}),
        from: generateBezierPath(before.start, before.end, [before.cp1, before.cp2]),
      };
    }
    if (t1 < 1 && opts.clipEndRect) {
      const afterRaw = trimCubic(cubicRaw.start, cubicRaw.cp1, cubicRaw.cp2, cubicRaw.end, Math.max(0, Math.min(1, t1)), 1);
      const after = reverseCubicSegment(afterRaw);
      guides = {
        ...(guides || {}),
        to: generateBezierPath(after.start, after.end, [after.cp1, after.cp2]),
      };
    }
    cubic = trimCubic(cubic.start, cubic.cp1, cubic.cp2, cubic.end, t0, t1);
  }

  const path = generateBezierPath(cubic.start, cubic.end, [cubic.cp1, cubic.cp2]);
  const midPoint = getBezierMidpoint(cubic.start, cubic.end, [cubic.cp1, cubic.cp2]);
  const arrowAngle = calculateArrowAngle(cubic.end, cubic.end);
  return { path, midPoint, isSmartCurve: cps.length >= 2, arrowAngle, cubic, guides };
}

// 🎛️ 根据 tension 生成控制点（端点切线提供方向；tension 控制距离）
function makeControlPointsByTension(start: Position, end: Position, startTangent: Position, endTangent: Position, tension: number): Position[] {
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  if (dist < 1) return [];
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const t = clamp01(tension);
  const dMin = Math.min(24, dist * 0.2);
  const dMax = Math.min(0.85 * dist, 420);
  const d = dMin + (dMax - dMin) * t;
  const norm = (v: Position) => { const m = Math.hypot(v.x, v.y) || 1; return { x: v.x / m, y: v.y / m }; };
  const s = norm(startTangent);
  const e = norm(endTangent);
  const cp1 = { x: start.x + s.x * d, y: start.y + s.y * d };
  const cp2 = { x: end.x - e.x * d, y: end.y - e.y * d };
  return [cp1, cp2];
}

// 🎯 由锚点驱动的整段控制点求解（避免V形，峰位随锚点移动）
// 稳定的锚点求解：把锚点视作二次贝塞尔的单一控制点，并转换到三次贝塞尔
// 该方法保持凹凸朝向始终指向锚点，避免数值抖动/翻转
function makeControlPointsByAnchor(P0: Position, P3: Position, A: Position): Position[] {
  const dx = P3.x - P0.x, dy = P3.y - P0.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-3) return [];
  // Quadratic -> Cubic conversion: cp1 = P0 + 2/3*(A - P0); cp2 = P3 + 2/3*(A - P3)
  const cp1 = { x: P0.x + (2 / 3) * (A.x - P0.x), y: P0.y + (2 / 3) * (A.y - P0.y) };
  const cp2 = { x: P3.x + (2 / 3) * (A.x - P3.x), y: P3.y + (2 / 3) * (A.y - P3.y) };
  return [cp1, cp2];
}
