import type { CanvasConnection, CanvasNode } from '../types/canvas';
import type { Position } from './dynamicConnectionRenderer';
import { renderConnectionDynamically, renderConnectionFromPoints } from './dynamicConnectionRenderer';

export interface ConnectionGeometry {
  start: Position;
  end: Position;
  clipStartRect?: { left: number; right: number; top: number; bottom: number };
  clipEndRect?: { left: number; right: number; top: number; bottom: number };
}

export function hasFreeEndpoint(connection: CanvasConnection): boolean {
  return Boolean((connection as any).fromPoint || (connection as any).toPoint);
}

export function resolveConnectionGeometry(
  connection: CanvasConnection,
  nodesById: Map<string, CanvasNode>
): ConnectionGeometry | null {
  const anyConn = connection as any;
  const hasFromPoint = Boolean(anyConn.fromPoint);
  const hasToPoint = Boolean(anyConn.toPoint);
  if (!hasFromPoint && !hasToPoint) return null;
  const fromNode = hasFromPoint ? null : (anyConn.from ? nodesById.get(anyConn.from) || null : null);
  const toNode = hasToPoint ? null : (anyConn.to ? nodesById.get(anyConn.to) || null : null);
  if (!hasFromPoint && !fromNode) return null;
  if (!hasToPoint && !toNode) return null;
  const start = hasFromPoint
    ? { x: anyConn.fromPoint.x, y: anyConn.fromPoint.y }
    : { x: fromNode!.x + fromNode!.width / 2, y: fromNode!.y + fromNode!.height / 2 };
  const end = hasToPoint
    ? { x: anyConn.toPoint.x, y: anyConn.toPoint.y }
    : { x: toNode!.x + toNode!.width / 2, y: toNode!.y + toNode!.height / 2 };
  const clipStartRect = hasFromPoint
    ? undefined
    : { left: fromNode!.x, right: fromNode!.x + fromNode!.width, top: fromNode!.y, bottom: fromNode!.y + fromNode!.height };
  const clipEndRect = hasToPoint
    ? undefined
    : { left: toNode!.x, right: toNode!.x + toNode!.width, top: toNode!.y, bottom: toNode!.y + toNode!.height };
  return { start, end, clipStartRect, clipEndRect };
}

export function getEndpointPoint(
  connection: CanvasConnection,
  endpoint: 'from' | 'to',
  nodesById: Map<string, CanvasNode>
): Position | null {
  const anyConn = connection as any;
  const key = endpoint === 'from' ? 'fromPoint' : 'toPoint';
  if (anyConn[key]) {
    return { x: anyConn[key].x, y: anyConn[key].y };
  }
  const nodeKey = endpoint === 'from' ? 'from' : 'to';
  const nodeId = anyConn[nodeKey];
  if (!nodeId) return null;
  const node = nodesById.get(nodeId);
  if (!node) return null;
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

export function sampleConnectionPoints(
  connection: CanvasConnection,
  nodesById: Map<string, CanvasNode>,
  samples = 48
): Position[] {
  try {
    const anyConn = connection as any;
    if (hasFreeEndpoint(connection)) {
      const geom = resolveConnectionGeometry(connection, nodesById);
      if (!geom) return [];
      const { cubic } = renderConnectionFromPoints(geom.start, geom.end, connection, {
        clipStartRect: geom.clipStartRect,
        clipEndRect: geom.clipEndRect,
      });
      return sampleCubic(cubic, samples);
    }
    const fromNode = anyConn.from ? nodesById.get(anyConn.from) : null;
    const toNode = anyConn.to ? nodesById.get(anyConn.to) : null;
    if (!fromNode || !toNode) return [];
    const { cubic } = renderConnectionDynamically(connection as any, fromNode, toNode);
    return sampleCubic(cubic, samples);
  } catch {
    return [];
  }
}

function sampleCubic(
  cubic: { start: Position; cp1: Position; cp2: Position; end: Position } | undefined,
  samples: number
): Position[] {
  if (!cubic) return [];
  const pts: Position[] = [];
  let prev = cubic.start;
  pts.push(prev);
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    const uuu = uu * u;
    const ttt = tt * t;
    const curr = {
      x: uuu * cubic.start.x + 3 * uu * t * cubic.cp1.x + 3 * u * tt * cubic.cp2.x + ttt * cubic.end.x,
      y: uuu * cubic.start.y + 3 * uu * t * cubic.cp1.y + 3 * u * tt * cubic.cp2.y + ttt * cubic.end.y,
    };
    pts.push(curr);
    prev = curr;
  }
  return pts;
}
