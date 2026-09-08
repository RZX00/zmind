export interface Point2D {
  x: number;
  y: number;
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * 根据阈值自动将自由线端点吸附到水平或垂直方向。
 * @param from 固定端点
 * @param to 待吸附端点
 * @param thresholdDeg 允许的角度偏差（度）
 */
export function snapFreeLineToAxis(
  from: Point2D,
  to: Point2D,
  thresholdDeg = 1
): { point: Point2D; snapped: boolean; axis: 'horizontal' | 'vertical' | null } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!isFinite(length) || length < 1e-3) {
    return { point: to, snapped: false, axis: null };
  }

  const angle = Math.atan2(dy, dx);
  const threshold = thresholdDeg * DEG_TO_RAD;
  const absAngle = Math.abs(angle);
  const distToHorizontal = Math.min(absAngle, Math.abs(Math.PI - absAngle));
  const distToVertical = Math.abs(absAngle - Math.PI / 2);

  if (distToHorizontal <= threshold) {
    return {
      point: { x: from.x + dx, y: from.y },
      snapped: true,
      axis: 'horizontal',
    };
  }

  if (distToVertical <= threshold) {
    return {
      point: { x: from.x, y: from.y + dy },
      snapped: true,
      axis: 'vertical',
    };
  }

  return { point: to, snapped: false, axis: null };
}
