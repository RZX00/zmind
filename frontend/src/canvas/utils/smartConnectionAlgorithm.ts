// 🧠 智能连线算法 - 自动计算最优曲率和交互控制
// 根据节点位置、距离和角度智能计算连线曲率，并提供中点控制器

import { Position } from './bezierUtils';
import type { CanvasConnection, CanvasNode } from '../types/canvas';

// 🎛️ 智能连线配置参数
export interface SmartConnectionConfig {
  // 自动曲率计算参数
  minCurvature: number;        // 最小曲率 (0.1)
  maxCurvature: number;        // 最大曲率 (0.6)
  optimalDistance: number;     // 最优距离阈值 (200px)
  angleInfluenceFactor: number; // 角度影响因子 (0.8)

  // 中点控制器参数
  controlPointRadius: number;  // 控制点半径 (6px)
  controlPointTolerance: number; // 控制点点击容差 (15px)

  // 手动调整优先级
  manualAdjustmentWeight: number; // 手动调整权重 (2.0)
}

// 默认配置
export const DEFAULT_SMART_CONFIG: SmartConnectionConfig = {
  minCurvature: 0.1,
  maxCurvature: 0.6,
  optimalDistance: 200,
  angleInfluenceFactor: 0.8,
  controlPointRadius: 6,
  controlPointTolerance: 15,
  manualAdjustmentWeight: 2.0
};

// 🧮 连线智能分析结果
export interface ConnectionAnalysis {
  distance: number;           // 节点间距离
  angle: number;             // 连线角度 (弧度)
  angleDegrees: number;      // 连线角度 (度数)
  isHorizontal: boolean;     // 是否接近水平
  isVertical: boolean;       // 是否接近垂直
  isDiagonal: boolean;       // 是否对角线
  recommendedCurvature: number; // 推荐曲率
  shouldUseCurve: boolean;   // 是否应该使用曲线
  // 🎯 新增：基于坐标的真实对齐检测
  isVerticallyAligned: boolean;   // x坐标对齐（垂直线）
  isHorizontallyAligned: boolean; // y坐标对齐（水平线）
  isPerfectlyAligned: boolean;    // 任一方向完美对齐
  deltaX: number;                 // x坐标差异
  deltaY: number;                 // y坐标差异
}

// 🎯 中点控制器状态
export interface ControlPointState {
  position: Position;        // 控制点位置
  isVisible: boolean;        // 是否可见
  isDragging: boolean;       // 是否正在拖拽
  isHovered: boolean;        // 是否被悬停
}

// 📐 计算两点之间的距离
function calculateDistance(p1: Position, p2: Position): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

// 📏 计算两点之间的角度 (弧度)
function calculateAngle(p1: Position, p2: Position): number {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

// 🔄 弧度转度数
function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

// 🧠 智能分析连线特征 - 基于节点中心对齐的正确逻辑
export function analyzeConnection(
  startPos: Position,
  endPos: Position,
  config: SmartConnectionConfig = DEFAULT_SMART_CONFIG
): ConnectionAnalysis {
  const distance = calculateDistance(startPos, endPos);
  const angle = calculateAngle(startPos, endPos);
  const angleDegrees = radiansToDegrees(angle);

  // 📊 基于实际坐标差异的对齐检测（不依赖角度）
  const deltaX = Math.abs(endPos.x - startPos.x);
  const deltaY = Math.abs(endPos.y - startPos.y);

  // 🎯 对齐容差：根据节点大小动态调整
  const alignmentTolerance = 20; // 20px容差，可以根据需要调整

  // ✅ 真正的对齐检测
  const isVerticallyAligned = deltaX <= alignmentTolerance;    // x坐标基本相同
  const isHorizontallyAligned = deltaY <= alignmentTolerance;  // y坐标基本相同
  const isPerfectlyAligned = isVerticallyAligned || isHorizontallyAligned;

  // 📐 传统角度分类（保留用于诊断）
  const absAngleDegrees = Math.abs(angleDegrees);
  const isHorizontal = absAngleDegrees <= 15 || absAngleDegrees >= 165;
  const isVertical = Math.abs(absAngleDegrees - 90) <= 15;
  const isDiagonal = !isHorizontal && !isVertical;

  // 🎯 核心决策：对齐状态决定连线类型
  let shouldUseCurve: boolean;
  let recommendedCurvature: number;

  if (isPerfectlyAligned) {
    // ✅ 完美对齐：强制直线，无论距离多远
    shouldUseCurve = false;
    recommendedCurvature = 0;
  } else {
    // 📊 有偏差：基于偏差量计算曲率
    const offsetRatio = Math.min(deltaX, deltaY) / Math.max(deltaX, deltaY);
    const maxOffset = Math.max(deltaX, deltaY);

    // 只有在偏差足够大时才使用曲线
    const significantOffset = maxOffset > 80; // 偏差大于80px才考虑曲线
    const moderateOffsetRatio = offsetRatio > 0.3; // 偏差比例要合理

    if (significantOffset && moderateOffsetRatio && distance > 100) {
      shouldUseCurve = true;
      // 基于偏差量计算适度曲率（不过度弯曲）
      const offsetFactor = Math.min(maxOffset / 200, 1.0);
      recommendedCurvature = config.minCurvature +
        (config.maxCurvature - config.minCurvature) * offsetFactor * 0.5;
    } else {
      // 偏差不够大，或距离太近，使用直线
      shouldUseCurve = false;
      recommendedCurvature = 0;
    }
  }

  return {
    distance,
    angle,
    angleDegrees,
    isHorizontal,
    isVertical,
    isDiagonal,
    recommendedCurvature,
    shouldUseCurve,
    // 🎯 新增：真实对齐状态
    isVerticallyAligned,
    isHorizontallyAligned,
    isPerfectlyAligned,
    deltaX,
    deltaY
  };
}

// 🎨 生成智能控制点 - 基于画布连线最佳实践优化
export function generateSmartControlPoints(
  startPos: Position,
  endPos: Position,
  analysis?: ConnectionAnalysis,
  config: SmartConnectionConfig = DEFAULT_SMART_CONFIG
): Position[] {
  if (!analysis) {
    analysis = analyzeConnection(startPos, endPos, config);
  }

  if (!analysis.shouldUseCurve) {
    return []; // 直线连接，不需要控制点
  }

  const { distance } = analysis;

  // 🎯 基于最佳实践的控制点距离计算
  // 使用端点间距离的一半作为基础，确保平滑的曲线
  const controlPointDistance = Math.abs(endPos.x - startPos.x) / 2;

  // 🔄 反转弯曲方向 - 让曲线朝另一个方向弯曲
  // 通过调整控制点的y坐标来改变弯曲方向
  const deltaY = endPos.y - startPos.y;
  const curvatureDirection = deltaY > 0 ? -1 : 1; // 根据端点高度差决定弯曲方向
  const curvatureOffset = Math.min(Math.abs(deltaY) * 0.3, 50); // 弯曲偏移量

  const cp1: Position = {
    x: startPos.x + controlPointDistance,
    y: startPos.y + curvatureOffset * curvatureDirection // 添加垂直偏移来控制弯曲方向
  };

  const cp2: Position = {
    x: endPos.x - controlPointDistance,
    y: endPos.y + curvatureOffset * curvatureDirection // 保持一致的弯曲方向
  };

  // 🎚️ 根据连线特征微调控制点
  // 如果是垂直连线，增加一些水平偏移来避免过于陡峭的曲线
  if (analysis.isVertical) {
    const horizontalAdjustment = Math.min(distance * 0.3, 80);
    cp1.x = startPos.x + (endPos.x > startPos.x ? horizontalAdjustment : -horizontalAdjustment);
    cp2.x = endPos.x + (endPos.x > startPos.x ? horizontalAdjustment : -horizontalAdjustment);
  }

  // 🎨 对于短距离连线，减少控制点距离避免过度弯曲
  if (distance < 100) {
    const shortDistanceFactor = distance / 100;
    cp1.x = startPos.x + (cp1.x - startPos.x) * shortDistanceFactor;
    cp2.x = endPos.x + (cp2.x - endPos.x) * shortDistanceFactor;
  }

  return [cp1, cp2];
}

// 🎯 计算中点控制器位置
export function calculateControlPointPosition(
  startPos: Position,
  endPos: Position,
  controlPoints: Position[]
): Position {
  if (controlPoints.length < 2) {
    // 直线中点
    return {
      x: (startPos.x + endPos.x) / 2,
      y: (startPos.y + endPos.y) / 2
    };
  }

  // 贝塞尔曲线中点 (t = 0.5)
  const [cp1, cp2] = controlPoints;
  const t = 0.5;
  const u = 1 - t;

  return {
    x: u*u*u * startPos.x + 3*u*u*t * cp1.x + 3*u*t*t * cp2.x + t*t*t * endPos.x,
    y: u*u*u * startPos.y + 3*u*u*t * cp1.y + 3*u*t*t * cp2.y + t*t*t * endPos.y
  };
}

// 📍 检测点是否在控制器范围内
export function isPointInControlArea(
  point: Position,
  controlPoint: Position,
  tolerance: number = DEFAULT_SMART_CONFIG.controlPointTolerance
): boolean {
  const distance = calculateDistance(point, controlPoint);
  return distance <= tolerance;
}

// 🎚️ 根据拖拽调整控制点
export function adjustControlPointsFromDrag(
  startPos: Position,
  endPos: Position,
  originalControlPoints: Position[],
  dragVector: Position, // 拖拽向量
  config: SmartConnectionConfig = DEFAULT_SMART_CONFIG
): Position[] {
  if (originalControlPoints.length < 2) {
    // 如果原来是直线，生成新的控制点
    const newControlPoints = generateSmartControlPoints(startPos, endPos, undefined, config);
    return adjustControlPointsFromDrag(startPos, endPos, newControlPoints, dragVector, config);
  }

  const [cp1, cp2] = originalControlPoints;

  // 🎯 根据拖拽方向调整控制点
  // 拖拽会同时影响两个控制点，保持曲线的对称性
  const adjustmentFactor = config.manualAdjustmentWeight;

  const newCp1: Position = {
    x: cp1.x + dragVector.x * 0.5 * adjustmentFactor,
    y: cp1.y + dragVector.y * 0.5 * adjustmentFactor
  };

  const newCp2: Position = {
    x: cp2.x + dragVector.x * 0.5 * adjustmentFactor,
    y: cp2.y + dragVector.y * 0.5 * adjustmentFactor
  };

  return [newCp1, newCp2];
}

// 🔄 创建智能连线
export function createSmartConnection(
  id: string,
  fromNodeId: string,
  toNodeId: string,
  fromPos: Position,
  toPos: Position,
  label?: string,
  config: SmartConnectionConfig = DEFAULT_SMART_CONFIG
): CanvasConnection {
  const analysis = analyzeConnection(fromPos, toPos, config);

  if (!analysis.shouldUseCurve) {
    // 直线连接
    return {
      id,
      from: fromNodeId,
      to: toNodeId,
      label,
      createdAt: Date.now()
      // type 保持 undefined 表示直线
    };
  }

  // 曲线连接
  const controlPoints = generateSmartControlPoints(fromPos, toPos, analysis, config);

  return {
    id,
    from: fromNodeId,
    to: toNodeId,
    label,
    type: 'bezier',
    controlPoints,
    createdAt: Date.now()
  };
}

// 🎯 更新连线的智能控制点
export function updateSmartConnection(
  connection: CanvasConnection,
  fromPos: Position,
  toPos: Position,
  manualControlPoints?: Position[], // 如果提供，则优先使用手动调整
  config: SmartConnectionConfig = DEFAULT_SMART_CONFIG
): CanvasConnection {
  // 如果有手动控制点，直接使用
  if (manualControlPoints && manualControlPoints.length >= 2) {
    return {
      ...connection,
      type: 'bezier',
      controlPoints: manualControlPoints
    };
  }

  // 否则重新计算智能控制点
  const analysis = analyzeConnection(fromPos, toPos, config);

  if (!analysis.shouldUseCurve) {
    // 转换为直线
    return {
      ...connection,
      type: undefined,
      controlPoints: undefined
    };
  }

  const controlPoints = generateSmartControlPoints(fromPos, toPos, analysis, config);

  return {
    ...connection,
    type: 'bezier',
    controlPoints
  };
}

// 🎨 使用端点切线（法线）生成控制点：适合从矩形四边中点出发/进入（思维导图和动态连线用）
export function generateSmartControlPointsWithTangents(
  startPos: Position,
  endPos: Position,
  startTangent: Position, // 单位向量，指向起点外侧
  endTangent: Position,   // 单位向量，指向终点外侧
  analysis?: ConnectionAnalysis,
  config: SmartConnectionConfig = DEFAULT_SMART_CONFIG
): Position[] {
  if (!analysis) analysis = analyzeConnection(startPos, endPos, config);
  if (!analysis.shouldUseCurve) return [];

  // 单位化切线
  const norm = (v: Position) => {
    const m = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / m, y: v.y / m };
  };
  const dStart = norm(startTangent);
  const dEnd = norm(endTangent);

  const vx = endPos.x - startPos.x;
  const vy = endPos.y - startPos.y;
  const dist = Math.hypot(vx, vy);
  if (dist < 1) return [];

  // 连续曲率因子（温和）
  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
  const distanceFactor = sigmoid((dist - 200) / 120);
  const alignment = Math.min(Math.abs(vx), Math.abs(vy)) / Math.max(Math.abs(vx), Math.abs(vy) || 1);
  let f = 0.15 + 0.6 * distanceFactor + 0.25 * alignment;
  f = Math.min(1, Math.max(0, f));

  const dMin = Math.min(40, dist * 0.25);
  const dMax = Math.min(400, dist * 0.8);
  const d = dMin + (dMax - dMin) * f;

  let cp1: Position = { x: startPos.x + dStart.x * d, y: startPos.y + dStart.y * d };
  let cp2: Position = { x: endPos.x - dEnd.x * d, y: endPos.y - dEnd.y * d };

  // 若两端切线近乎平行，加入温和横向偏置，营造更优雅的S形
  const tDot = dStart.x * dEnd.x + dStart.y * dEnd.y; // [-1,1]
  if (Math.abs(tDot) > 0.85) {
    const ux = endPos.x - startPos.x;
    const uy = endPos.y - startPos.y;
    const ulen = Math.hypot(ux, uy) || 1;
    const dir = { x: ux / ulen, y: uy / ulen };
    const perp = { x: -dir.y, y: dir.x };
    const lateral = Math.min(36, ulen * 0.12) * 0.6;
    cp1 = { x: cp1.x + perp.x * lateral, y: cp1.y + perp.y * lateral };
    cp2 = { x: cp2.x - perp.x * lateral, y: cp2.y - perp.y * lateral };
  }

  return [cp1, cp2];
}
