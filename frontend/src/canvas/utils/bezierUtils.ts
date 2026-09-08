// 🎨 贝塞尔曲线工具函数
// 用于处理画布中的贝塞尔曲线连接线

import type { CanvasConnection } from '../types/canvas';

// 📍 局部位置类型定义
export interface Position {
  x: number;
  y: number;
}

// 📐 计算两点之间的距离
export function calculateDistance(p1: Position, p2: Position): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

// 📏 计算两点之间的角度（弧度）
export function calculateAngle(p1: Position, p2: Position): number {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

// 🎯 生成默认的贝塞尔曲线控制点 - 基于最佳实践优化
export function generateDefaultControlPoints(
  start: Position,
  end: Position,
  curvature: number = 0.3
): Position[] {
  // 🚀 优先使用智能算法生成控制点
  const { generateSmartControlPoints, analyzeConnection } = require('./smartConnectionAlgorithm');

  try {
    const analysis = analyzeConnection(start, end);
    if (analysis.shouldUseCurve) {
      return generateSmartControlPoints(start, end, analysis);
    }
  } catch (error) {
    console.warn('智能连线算法失败，回退到优化算法:', error);
  }

  // 🔄 使用优化的控制点计算算法 - 基于画布最佳实践
  // 使用端点间距离的一半作为控制点距离，应用水平切线技术
  const controlPointDistance = Math.abs(end.x - start.x) / 2;

  // 第一个控制点：水平切线，保持y坐标相同
  const cp1: Position = {
    x: start.x + controlPointDistance,
    y: start.y // 保持水平切线
  };

  // 第二个控制点：水平切线，保持y坐标相同
  const cp2: Position = {
    x: end.x - controlPointDistance,
    y: end.y // 保持水平切线
  };

  // 🎚️ 对于短距离连线，减少控制点距离避免过度弯曲
  const distance = calculateDistance(start, end);
  if (distance < 100) {
    const shortDistanceFactor = distance / 100;
    cp1.x = start.x + (cp1.x - start.x) * shortDistanceFactor;
    cp2.x = end.x + (cp2.x - end.x) * shortDistanceFactor;
  }

  return [cp1, cp2];
}

// 📈 计算贝塞尔曲线上的点（三次贝塞尔曲线）
export function calculateBezierPoint(
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

// 🎨 生成贝塞尔曲线路径字符串（SVG格式）
export function generateBezierPath(
  start: Position,
  end: Position,
  controlPoints?: Position[]
): string {
  if (!controlPoints || controlPoints.length < 2) {
    controlPoints = generateDefaultControlPoints(start, end);
  }
  
  const [cp1, cp2] = controlPoints;
  
  return `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`;
}

// 🔧 更新连接的贝塞尔曲线属性
export function updateConnectionBezier(
  connection: CanvasConnection,
  startPos: Position,
  endPos: Position,
  customControlPoints?: Position[]
): CanvasConnection {
  const controlPoints = customControlPoints || generateDefaultControlPoints(startPos, endPos);
  
  return {
    ...connection,
    type: 'bezier',
    controlPoints
  };
}

// 📊 检查点是否在贝塞尔曲线附近（用于点击检测）
export function isPointNearBezierCurve(
  point: Position,
  start: Position,
  end: Position,
  controlPoints: Position[],
  threshold: number = 10
): boolean {
  if (controlPoints.length < 2) {
    return false;
  }
  
  const [cp1, cp2] = controlPoints;
  
  // 在曲线上采样多个点进行检测
  for (let t = 0; t <= 1; t += 0.05) {
    const curvePoint = calculateBezierPoint(t, start, cp1, cp2, end);
    const distance = calculateDistance(point, curvePoint);
    
    if (distance <= threshold) {
      return true;
    }
  }
  
  return false;
}

// 🎯 获取贝塞尔曲线的中点（用于标签定位）
export function getBezierMidpoint(
  start: Position,
  end: Position,
  controlPoints?: Position[]
): Position {
  if (!controlPoints || controlPoints.length < 2) {
    controlPoints = generateDefaultControlPoints(start, end);
  }
  
  const [cp1, cp2] = controlPoints;
  return calculateBezierPoint(0.5, start, cp1, cp2, end);
}

// 🔄 创建直线连接
export function createStraightConnection(
  id: string,
  from: string,
  to: string,
  label?: string
): CanvasConnection {
  return {
    id,
    from,
    to,
    label,
    // 不设置type，默认为straight
    createdAt: Date.now()
  };
}

// 🌊 创建贝塞尔曲线连接
export function createBezierConnection(
  id: string,
  from: string,
  to: string,
  startPos: Position,
  endPos: Position,
  label?: string,
  customControlPoints?: Position[]
): CanvasConnection {
  const controlPoints = customControlPoints || generateDefaultControlPoints(startPos, endPos);
  
  return {
    id,
    from,
    to,
    label,
    type: 'bezier',
    controlPoints,
    createdAt: Date.now()
  };
}

// 🎨 获取连接的渲染路径
export function getConnectionPath(
  connection: CanvasConnection,
  startPos: Position,
  endPos: Position
): string {
  // 只有明确设置为bezier且有控制点时才使用贝塞尔曲线
  if (connection.type === 'bezier' && connection.controlPoints) {
    return generateBezierPath(startPos, endPos, connection.controlPoints);
  }
  
  // 默认直线连接（包括type为undefined的情况）
  return `M ${startPos.x} ${startPos.y} L ${endPos.x} ${endPos.y}`;
}
