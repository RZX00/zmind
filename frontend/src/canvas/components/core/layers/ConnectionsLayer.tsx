'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {useTranslations} from 'next-intl';
import { useTheme } from 'next-themes';
import type { Canvas, CanvasNode, CanvasConnection } from '../../../../types/canvas';
import { renderConnectionDynamically, renderConnectionFromPoints, computeAnchorParams } from '../../../utils/dynamicConnectionRenderer';
import type { ConnectionRenderResult } from '../../../utils/dynamicConnectionRenderer';
import { snapFreeLineToAxis } from '../../../utils/freeLineSnap';
import type { Position } from '../../../utils/dynamicConnectionRenderer';
// no motion: remove all smooth transitions for connections
import type { MindmapDragPreview } from '../../../utils/mindmapLayout';
import { useCanvasStore } from '../../../stores/canvas.store';
import { getConnectionSettings } from '../../../stores/settings.store';

export interface ConnectionsLayerProps {
  canvas: Canvas;
  canvasBounds: { minX: number; minY: number; width: number; height: number };
  selectedConnectionIds: Set<string>;
  hiddenMindmapNodeIds: Set<string>;
  transientPositionsRef?: React.MutableRefObject<Record<string, { x: number; y: number }>>;
  transientVersion?: number;
  dragPreview: MindmapDragPreview | null;
  draggingNodeId: string | null;
  viewportRect: { x: number; y: number; w: number; h: number } | null;
  cullThreshold: number;
  editMode: 'none' | 'node' | 'connection';
  editingEntityId: string | null;
  connectionLabelInput: string;
  connectionInputRef: React.RefObject<HTMLInputElement>;
  onConnectionClick: (connectionId: string, e: React.MouseEvent) => void;
  onLabelEdit: (connectionId: string) => void;
  onLabelSave: () => void;
  onLabelCancel: () => void;
  onLabelKeyDown: (event: React.KeyboardEvent) => void;
  onLabelInputChange: (value: string) => void;
  onConnectionContextMenu: (e: React.MouseEvent, connectionId: string) => void;
  screenToCanvas: (screenX: number, screenY: number) => { x: number; y: number };
  containerScale: number; // current zoom / 100, for constant-size handles
}

const ConnectionsLayer: React.FC<ConnectionsLayerProps> = (props) => {
  const t = useTranslations();
  const {
    canvas, canvasBounds, selectedConnectionIds, hiddenMindmapNodeIds,
    transientPositionsRef, transientVersion,
    dragPreview, draggingNodeId, viewportRect, cullThreshold,
    editMode, editingEntityId, connectionLabelInput, connectionInputRef,
    onConnectionClick, onLabelEdit, onLabelSave, onLabelKeyDown, onLabelInputChange,
    onConnectionContextMenu,
    screenToCanvas,
  } = props;

  const { resolvedTheme } = useTheme();
  const [snapIndicator, setSnapIndicator] = useState<{ endpoint: 'from' | 'to'; nodeId: string; snapPoint: { x: number; y: number } } | null>(null);
  // Unique, collision-safe marker IDs per component instance
  const rawId = (React as any).useId ? (React as any).useId() as string : `rid-${Math.random().toString(36).slice(2,8)}`;
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
  const base = sanitize(rawId);
  const markerId = `${base}_arrow`;
  const markerSelectedId = `${base}_arrow_sel`;
  const markerPreviewId = `${base}_arrow_prev`;
  const isDark = resolvedTheme === 'dark';
  const accent = isDark ? '#8c8273' : '#3b82f6';
  // Line/arrow color: dark -> white, light -> dark gray
  const strokeMain = isDark ? '#FFFFFF' : '#555555';
  const strokeSelected = isDark ? accent : '#000000';
  const labelBg = isDark ? '#2B2E31' : '#FFFFFF';
  const labelFg = isDark ? '#EAECEF' : '#000000';
  const selectedGuideStroke = isDark ? 'rgba(248, 250, 252, 0.5)' : '#c7cdd5';
  // no-op placeholders removed: no connection motion or interpolation

  // ===== Dynamic arrow marker cache (per component instance) =====
  const markerDefsRef = useRef(new Map<string, React.ReactNode>());
  const colorKey = (c: string) => (c || '').replace(/[^a-zA-Z0-9]/g, '_');
  const getMarkerId = (opts: { shape: string; size: number; filled: boolean; color: string; prefix?: string }) => {
    const { shape, size, filled, color, prefix } = opts;
    return `${prefix || base}_m_${shape}_${filled ? 'f' : 'o'}_${size}_${colorKey(color)}`;
  };
  const markerTailX = useCallback((shape: string, markerWidth: number): number => {
    if (shape === 'triangle') return 3;
    if (shape === 'vee') return 2;
    return markerWidth;
  }, []);
  const markerTipAdvancePx = useCallback((shape: string, size: number): number => {
    const w = Math.max(6, Math.round(size));
    const tailX = markerTailX(shape, w);
    return Math.max(0, w - tailX);
  }, [markerTailX]);
  // Keep arrow tips slightly outside node bounds to avoid anti-aliased “swallow” when nodes sit above lines.
  const markerOutsetPx = useCallback((lineWidth: number): number => {
    return Math.max(1.2, Math.min(2.6, 0.7 + lineWidth * 0.55));
  }, []);
  const markerTrimPx = useCallback((shape: string, size: number, lineWidth: number): number => {
    const advance = markerTipAdvancePx(shape, size);
    if (advance <= 0) return 0;
    return advance + markerOutsetPx(lineWidth);
  }, [markerOutsetPx, markerTipAdvancePx]);
  const ensureMarker = (id: string, shape: string, size: number, filled: boolean, color: string, start?: boolean) => {
    if (markerDefsRef.current.has(id)) return id;
    // Build marker body by shape
    // Using symmetric viewBox; ensure ref aligns to geometric center vertically
    const w = Math.max(6, Math.round(size));
    const h = w; // square viewBox for better centering
    let refX = w;
    const refY = h / 2;
    let node: React.ReactNode;
    // 避免填充+描边叠加导致的边缘锯齿/缺角视觉：
    // - 填充形状时不描边；空心时仅描边不填充
    const common = { fill: filled ? color : 'none', stroke: filled ? 'none' : color, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', shapeRendering: 'geometricPrecision' } as any;
    switch (shape) {
      case 'vee':
        refX = markerTailX('vee', w);
        node = <polyline points={`${refX},${refY} ${w - 2},${2} ${w},${refY} ${w - 2},${h - 2}`} {...common} fill="none"/>; break;
      case 'circle':
        node = <circle cx={w - 4} cy={refY} r={Math.max(2, Math.round(w/4))} {...common}/>; break;
      case 'bar':
        node = <rect x={w - 3} y={refY - Math.max(1, Math.round(h/6))} width={2} height={Math.max(2, Math.round(h/3))} {...common}/>; break;
      case 'diamond':
        node = <polygon points={`${w-3},${refY} ${w-7},${refY-4} ${w-11},${refY} ${w-7},${refY+4}`} {...common}/>; break;
      case 'triangle':
      default:
        refX = markerTailX('triangle', w);
        // Tip anchored at path end; tail inset avoids visual seam with stroke.
        node = <polygon points={`${refX},1 ${w},${refY} ${refX},${h - 1}`} {...common}/>; break;
    }
    const markerEl = (
      <marker id={id} markerWidth={w} markerHeight={h} refX={refX} refY={refY} orient="auto-start-reverse" markerUnits="userSpaceOnUse" viewBox={`0 0 ${w} ${h}`}>
        {node}
      </marker>
    );
    markerDefsRef.current.set(id, markerEl);
    return id;
  };

  // Render dynamic markers with stable keys to satisfy React list requirements
  const renderDynamicMarkers = () => {
    return Array.from(markerDefsRef.current.entries()).map(([id, node]) => {
      return React.isValidElement(node) ? React.cloneElement(node, { key: id }) : <g key={id}>{node}</g>;
    });
  };

  const cubicPointAt = useCallback((t: number, p0: Position, p1: Position, p2: Position, p3: Position): Position => {
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    const uuu = uu * u;
    const ttt = tt * t;
    return {
      x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
      y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
    };
  }, []);

  const splitCubicAt = useCallback((p0: Position, p1: Position, p2: Position, p3: Position, t: number) => {
    const lerp = (a: Position, b: Position, k: number): Position => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    const p01 = lerp(p0, p1, t);
    const p12 = lerp(p1, p2, t);
    const p23 = lerp(p2, p3, t);
    const p012 = lerp(p01, p12, t);
    const p123 = lerp(p12, p23, t);
    const p = lerp(p012, p123, t);
    return {
      left: [p0, p01, p012, p] as [Position, Position, Position, Position],
      right: [p, p123, p23, p3] as [Position, Position, Position, Position],
    };
  }, []);

  const approximateCubicLength = useCallback((seg: { start: Position; cp1: Position; cp2: Position; end: Position }, steps = 32): number => {
    let len = 0;
    let prev = seg.start;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const cur = cubicPointAt(t, seg.start, seg.cp1, seg.cp2, seg.end);
      len += Math.hypot(cur.x - prev.x, cur.y - prev.y);
      prev = cur;
    }
    return len;
  }, [cubicPointAt]);

  const trimCubicByDistance = useCallback((
    seg: { start: Position; cp1: Position; cp2: Position; end: Position },
    trimStartPx: number,
    trimEndPx: number,
  ): { start: Position; cp1: Position; cp2: Position; end: Position } | null => {
    const total = approximateCubicLength(seg);
    if (!Number.isFinite(total) || total <= 0.01) return null;
    const maxTrim = Math.max(0, total - 0.5);
    const safeStart = Math.max(0, Math.min(trimStartPx, maxTrim));
    const safeEnd = Math.max(0, Math.min(trimEndPx, maxTrim - safeStart));
    if (safeStart <= 0 && safeEnd <= 0) return seg;
    if (safeStart + safeEnd >= total - 0.2) return null;

    const lengthAt = (t: number): number => {
      const steps = 24;
      let len = 0;
      let prev = seg.start;
      for (let i = 1; i <= steps; i += 1) {
        const k = (t * i) / steps;
        const cur = cubicPointAt(k, seg.start, seg.cp1, seg.cp2, seg.end);
        len += Math.hypot(cur.x - prev.x, cur.y - prev.y);
        prev = cur;
      }
      return len;
    };

    const solveTByLength = (target: number): number => {
      if (target <= 0) return 0;
      if (target >= total) return 1;
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 18; i += 1) {
        const mid = (lo + hi) / 2;
        const len = lengthAt(mid);
        if (len < target) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };

    const t0 = solveTByLength(safeStart);
    const t1 = solveTByLength(total - safeEnd);
    if (!(t1 > t0 + 1e-4)) return null;

    const s1 = splitCubicAt(seg.start, seg.cp1, seg.cp2, seg.end, t1);
    const t0Norm = t0 / Math.max(t1, 1e-6);
    const s0 = splitCubicAt(s1.left[0], s1.left[1], s1.left[2], s1.left[3], Math.max(0, Math.min(1, t0Norm)));
    const out = s0.right;
    return { start: out[0], cp1: out[1], cp2: out[2], end: out[3] };
  }, [approximateCubicLength, cubicPointAt, splitCubicAt]);

  // ===== Free-connection drag state =====
  const updateCanvas = useCanvasStore((s) => s.updateCanvas);
  const isDraggingRef = useRef(false);
  const dragConnIdRef = useRef<string | null>(null);
  const dragModeRef = useRef<'line' | 'from' | 'to' | null>(null);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragSnapRef = useRef<{ endpoint: 'from' | 'to'; nodeId: string; snapPoint: { x: number; y: number } } | null>(null);
  const dragEndpointOverridesRef = useRef<{ from?: Position | null; to?: Position | null } | null>(null);
  const detachEndpointRef = useRef<'from' | 'to' | null>(null);
  const SNAP_RADIUS = 24; // px, snapping radius for endpoints (screen space)

  const projectToRect = useCallback((pt: { x: number; y: number }, node: CanvasNode) => {
    const x1 = node.x;
    const y1 = node.y;
    const x2 = node.x + node.width;
    const y2 = node.y + node.height;
    return {
      x: Math.max(x1, Math.min(pt.x, x2)),
      y: Math.max(y1, Math.min(pt.y, y2)),
    };
  }, []);

  const findSnapCandidate = useCallback((pt: { x: number; y: number }, endpoint: 'from' | 'to', nodes: CanvasNode[]) => {
    const effectiveRadius = SNAP_RADIUS / Math.max(props.containerScale || 1, 0.01);
    let best: { nodeId: string; snapPoint: { x: number; y: number }; dist: number } | null = null;
    for (const n of nodes) {
      if ((n as any).type === 'group') continue;
      const snapPoint = projectToRect(pt, n);
      const dx = snapPoint.x - pt.x;
      const dy = snapPoint.y - pt.y;
      const d = Math.hypot(dx, dy);
      if (d <= effectiveRadius && (!best || d < best.dist)) {
        best = { nodeId: n.id, snapPoint, dist: d };
      }
    }
    return best ? { endpoint, nodeId: best.nodeId, snapPoint: best.snapPoint } : null;
  }, [projectToRect, props.containerScale]);
  const originalEndpointsRef = useRef<{ from: { x: number; y: number } | null; to: { x: number; y: number } | null } | null>(null);
  const originalAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartedRef = useRef(false);
  const dragStartScreenRef = useRef<{ x: number; y: number } | null>(null);
  const DRAG_THRESHOLD = 6; // px
const FREE_LINE_SNAP_THRESHOLD_DEG = 1;

const buildGuidePath = (start: Position, end: Position): string => {
  return `M${start.x},${start.y} L${end.x},${end.y}`;
};

  // ===== Mid-curve single handle drag (for both node and free connections) =====
  const midDraggingRef = useRef(false);
  const midConnIdRef = useRef<string | null>(null);
  const midDragStartedRef = useRef(false);
  const midStartScreenRef = useRef<{ x: number; y: number } | null>(null);
  const midBaselineRef = useRef<{ start: { x: number; y: number }; end: { x: number; y: number }; dir: { x: number; y: number }; d0: number } | null>(null);
  const midLastAnchorRef = useRef<{ x: number; y: number } | null>(null);

  const attachGlobalMidDrag = useCallback(() => {
    const onMove = (e: MouseEvent) => {
      if (!midDraggingRef.current || !midConnIdRef.current || !midBaselineRef.current) return;
      if (!midDragStartedRef.current) {
        if (!midStartScreenRef.current) return;
        const dxs = e.clientX - midStartScreenRef.current.x;
        const dys = e.clientY - midStartScreenRef.current.y;
        const dist = Math.hypot(dxs, dys);
        if (dist < DRAG_THRESHOLD) return;
        midDragStartedRef.current = true;
      }
      const M = screenToCanvas(e.clientX, e.clientY);
      midLastAnchorRef.current = { x: M.x, y: M.y };
      const eid = midConnIdRef.current;
      // 简化：拖拽时只更新锚点，渲染器按锚点解曲线（避免闪烁）
      const st = useCanvasStore.getState();
      const current = st.canvas;
      const updatedConnections = (current.connections || []).map((c) => {
        if (c.id !== eid) return c;
        // 自由连线：将鼠标点 M 视为曲线中点，反解二次控制点 Q
        if ((c as any).fromPoint && (c as any).toPoint) {
          const P0 = (c as any).fromPoint as { x: number; y: number };
          const P3 = (c as any).toPoint as { x: number; y: number };
          const Q = { x: 2 * M.x - 0.5 * (P0.x + P3.x), y: 2 * M.y - 0.5 * (P0.y + P3.y) };
          return { ...(c as any), curveAnchor: Q } as any;
        }
        // 节点连线：锚点直接跟随拖拽位置，并实时写入 anchorParams（增强稳态与实时渲染的健壮性）
        try {
          const fromNode = current.nodes.find(n => n.id === (c as any).from);
          const toNode = current.nodes.find(n => n.id === (c as any).to);
          if (fromNode && toNode) {
            const getCenter = (n: any) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
            const sameGroup = fromNode.parentGroupId && toNode.parentGroupId && fromNode.parentGroupId === toNode.parentGroupId;
            const groupNode = sameGroup ? current.nodes.find(n => n.id === fromNode.parentGroupId && (n as any).type === 'group') : null;
            const forceSide = Boolean(groupNode && (groupNode as any).groupMode === 'mindmap');
            const override = ((c as any).appearance?.endpointStrategy as 'center-ray' | 'side-midpoints' | undefined);
            const globalStrategy = getConnectionSettings().endpointStrategy || 'center-ray';
            const preferSide = forceSide || override === 'side-midpoints' || (!override && globalStrategy === 'side-midpoints');
            let P0 = getCenter(fromNode as any);
            let P3 = getCenter(toNode as any);
            if (preferSide) {
              const cA = getCenter(fromNode as any);
              const cB = getCenter(toNode as any);
              const fromLeft = (fromNode as any).x;
              const fromRight = (fromNode as any).x + (fromNode as any).width;
              const toLeft = (toNode as any).x;
              const toRight = (toNode as any).x + (toNode as any).width;
              let gapX = 0;
              if (cB.x >= cA.x) gapX = Math.max(0, toLeft - fromRight); else gapX = Math.max(0, fromLeft - toRight);
              const H_TOL = 10;
              let fromSide: 'left' | 'right' | 'top' | 'bottom';
              let toSide: 'left' | 'right' | 'top' | 'bottom';
              if (gapX > H_TOL) {
                const dx = cB.x - cA.x; fromSide = dx >= 0 ? 'right' : 'left'; toSide = dx >= 0 ? 'left' : 'right';
              } else {
                const dy = cB.y - cA.y; fromSide = dy >= 0 ? 'bottom' : 'top'; toSide = dy >= 0 ? 'top' : 'bottom';
              }
              const sidePoint = (n: any, side: any) => {
                const cx = n.x + n.width / 2, cy = n.y + n.height / 2;
                if (side === 'left') return { x: cx - n.width / 2, y: cy };
                if (side === 'right') return { x: cx + n.width / 2, y: cy };
                if (side === 'top') return { x: cx, y: cy - n.height / 2 };
                return { x: cx, y: cy + n.height / 2 };
              };
              P0 = sidePoint(fromNode, fromSide);
              P3 = sidePoint(toNode, toSide);
            }
            const dx = P3.x - P0.x, dy = P3.y - P0.y;
            const L = Math.hypot(dx, dy) || 1;
            const dir = { x: dx / L, y: dy / L };
            const perp = { x: -dir.y, y: dir.x };
            const rx = M.x - P0.x, ry = M.y - P0.y;
            const u = (rx * dir.x + ry * dir.y) / L;
            const v = (rx * perp.x + ry * perp.y) / L;
            return { ...(c as any), curveAnchor: { x: M.x, y: M.y }, anchorParams: { u, v } } as any;
          }
        } catch {}
        return { ...(c as any), curveAnchor: { x: M.x, y: M.y } } as any;
      });
      const prevMeta = current.metadata || {} as any;
      const prevAnchors = { ...(prevMeta.connectionAnchors || {}) } as Record<string, { x: number; y: number }>;
      // 仅对自由连线实时冗余保存锚点（节点连线最终以 anchorParams 为准）
      const connNow = (current.connections || []).find(c => c.id === eid) as any;
      if (connNow && connNow.fromPoint && connNow.toPoint) {
        prevAnchors[eid] = { x: updatedConnections.find(c => c.id === eid) ? (updatedConnections.find(c => c.id === eid) as any).curveAnchor.x : M.x, y: updatedConnections.find(c => c.id === eid) ? (updatedConnections.find(c => c.id === eid) as any).curveAnchor.y : M.y };
      }
      updateCanvas({
        connections: updatedConnections,
        metadata: { ...prevMeta, connectionAnchors: prevAnchors }
      });
    };
    const onUp = () => {
      const eid = midConnIdRef.current;
      const didDrag = midDragStartedRef.current;
      // Compute and persist anchorParams for node connections on drag end
      if (didDrag && eid) {
        try {
          const st = useCanvasStore.getState();
          const current = st.canvas;
          const conn = (current.connections || []).find(c => c.id === eid) as any;
          const A = midLastAnchorRef.current;
          if (conn && A && !(conn.fromPoint && conn.toPoint)) {
            const fromNode = current.nodes.find(n => n.id === conn.from);
            const toNode = current.nodes.find(n => n.id === conn.to);
            if (fromNode && toNode) {
              const getCenter = (n: any) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
              // Endpoint strategy selection: use global endpointStrategy; mindmap group forces side-midpoints
              const sameGroup = fromNode.parentGroupId && toNode.parentGroupId && fromNode.parentGroupId === toNode.parentGroupId;
              const groupNode = sameGroup ? current.nodes.find(n => n.id === fromNode.parentGroupId && (n as any).type === 'group') : null;
              const forceSide = Boolean(groupNode && (groupNode as any).groupMode === 'mindmap');
              const override = ((conn as any).appearance?.endpointStrategy as 'center-ray' | 'side-midpoints' | undefined);
              const globalStrategy = getConnectionSettings().endpointStrategy || 'center-ray';
              const preferSide = forceSide || override === 'side-midpoints' || (!override && globalStrategy === 'side-midpoints');

              let P0 = getCenter(fromNode as any);
              let P3 = getCenter(toNode as any);
              if (preferSide) {
                // choose sides similar to renderer (simplified horizontal gap heuristic)
                const cA = getCenter(fromNode as any);
                const cB = getCenter(toNode as any);
                const fromLeft = (fromNode as any).x;
                const fromRight = (fromNode as any).x + (fromNode as any).width;
                const toLeft = (toNode as any).x;
                const toRight = (toNode as any).x + (toNode as any).width;
                let gapX = 0;
                if (cB.x >= cA.x) gapX = Math.max(0, toLeft - fromRight); else gapX = Math.max(0, fromLeft - toRight);
                const H_TOL = 10;
                let fromSide: 'left' | 'right' | 'top' | 'bottom';
                let toSide: 'left' | 'right' | 'top' | 'bottom';
                if (gapX > H_TOL) {
                  const dx = cB.x - cA.x; fromSide = dx >= 0 ? 'right' : 'left'; toSide = dx >= 0 ? 'left' : 'right';
                } else {
                  const dy = cB.y - cA.y; fromSide = dy >= 0 ? 'bottom' : 'top'; toSide = dy >= 0 ? 'top' : 'bottom';
                }
                const sidePoint = (n: any, side: any) => {
                  const cx = n.x + n.width / 2, cy = n.y + n.height / 2;
                  if (side === 'left') return { x: cx - n.width / 2, y: cy };
                  if (side === 'right') return { x: cx + n.width / 2, y: cy };
                  if (side === 'top') return { x: cx, y: cy - n.height / 2 };
                  return { x: cx, y: cy + n.height / 2 };
                };
                P0 = sidePoint(fromNode, fromSide);
                P3 = sidePoint(toNode, toSide);
              }
              const dx = P3.x - P0.x, dy = P3.y - P0.y;
              const L = Math.hypot(dx, dy) || 1;
              const dir = { x: dx / L, y: dy / L };
              const perp = { x: -dir.y, y: dir.x };
              const rx = A.x - P0.x, ry = A.y - P0.y;
              const u = (rx * dir.x + ry * dir.y) / (L || 1);
              const v = (rx * perp.x + ry * perp.y) / (L || 1);

              const updatedConnections = (current.connections || []).map((c) => (
                c.id === eid ? ({ ...(c as any), anchorParams: { u, v } } as any) : c
              ));
              updateCanvas({ connections: updatedConnections });
              // 关键：立即保存，确保刷新后 anchorParams 不丢失
              try { useCanvasStore.getState().saveCanvas(); } catch {}
            }
          }
        } catch {}
      }

      midDraggingRef.current = false;
      midConnIdRef.current = null;
      midDragStartedRef.current = false;
      midStartScreenRef.current = null;
      midBaselineRef.current = null;
      midLastAnchorRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // click fallback: select connection if not dragged
      if (!didDrag && eid) {
        try {
          const st = useCanvasStore.getState();
          st.selectConnections([eid]);
          st.selectNodes([]);
        } catch {}
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [screenToCanvas, updateCanvas]);

  const beginDragMidHandle = useCallback((connectionId: string, _cubic: { start: { x: number; y: number }; cp1: { x: number; y: number }; cp2: { x: number; y: number }; end: { x: number; y: number } }, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // baseline not used in anchor mode
    const start = _cubic.start;
    const end = _cubic.end;
    const vx = end.x - start.x, vy = end.y - start.y; const dist = Math.hypot(vx, vy) || 1;
    const dir = { x: vx / dist, y: vy / dist };
    midDraggingRef.current = true;
    midConnIdRef.current = connectionId;
    midDragStartedRef.current = false;
    midStartScreenRef.current = { x: e.clientX, y: e.clientY };
    midBaselineRef.current = { start, end, dir, d0: dist * 0.35 };
    attachGlobalMidDrag();
  }, [attachGlobalMidDrag]);

  const attachGlobalDrag = useCallback(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !dragConnIdRef.current || !dragModeRef.current) return;
      const p = screenToCanvas(e.clientX, e.clientY);
      const updateSnapState = (candidate: { endpoint: 'from' | 'to'; nodeId: string; snapPoint: { x: number; y: number } } | null) => {
        dragSnapRef.current = candidate;
        setSnapIndicator((prev) => {
          if (!candidate && !prev) return prev;
          if (
            candidate &&
            prev &&
            candidate.nodeId === prev.nodeId &&
            candidate.endpoint === prev.endpoint &&
            Math.abs(candidate.snapPoint.x - prev.snapPoint.x) < 0.5 &&
            Math.abs(candidate.snapPoint.y - prev.snapPoint.y) < 0.5
          ) {
            return prev;
          }
          return candidate;
        });
      };

      // Threshold handling: only start actual drag after moving beyond threshold
      if (!dragStartedRef.current) {
        if (!dragStartScreenRef.current) return;
        const dxs = e.clientX - dragStartScreenRef.current.x;
        const dys = e.clientY - dragStartScreenRef.current.y;
        const dist = Math.hypot(dxs, dys);
        if (dist < DRAG_THRESHOLD) return;
        // Mark started and initialize canvas-space baseline and original endpoints
        dragStartedRef.current = true;
        dragStartPosRef.current = screenToCanvas(dragStartScreenRef.current.x, dragStartScreenRef.current.y);
        const conn = (useCanvasStore.getState().canvas.connections || []).find((c) => c.id === dragConnIdRef.current);
        if (!conn) return;
        const override = dragEndpointOverridesRef.current;
        originalEndpointsRef.current = {
          from: conn.fromPoint ? { ...conn.fromPoint } : (override?.from ? { ...override.from } : null),
          to: conn.toPoint ? { ...conn.toPoint } : (override?.to ? { ...override.to } : null),
        };
        dragEndpointOverridesRef.current = null;
        const a = (conn as any).curveAnchor as { x: number; y: number } | undefined;
        originalAnchorRef.current = a ? { x: a.x, y: a.y } : null;
        if (
          (dragModeRef.current === 'line' && (!conn.fromPoint || !conn.toPoint)) ||
          (dragModeRef.current === 'from' && !conn.fromPoint) ||
          (dragModeRef.current === 'to' && !conn.toPoint)
        ) {
          // allow node endpoints to detach; initialize free position based on node
          if (dragModeRef.current === 'from') {
            const node = (useCanvasStore.getState().canvas.nodes || []).find((n) => n.id === conn.from);
            if (node) {
              const target = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
              originalEndpointsRef.current!.from = target;
              originalAnchorRef.current = null;
              detachEndpointRef.current = 'from';
            } else {
              return;
            }
          } else if (dragModeRef.current === 'to') {
            const node = (useCanvasStore.getState().canvas.nodes || []).find((n) => n.id === conn.to);
            if (node) {
              const target = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
              originalEndpointsRef.current!.to = target;
              originalAnchorRef.current = null;
              detachEndpointRef.current = 'to';
            } else {
              return;
            }
          } else {
            return;
          }
        } else {
          detachEndpointRef.current = null;
        }
      }

      if (!dragStartPosRef.current || !originalEndpointsRef.current) return;
      const start = dragStartPosRef.current;
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      const eid = dragConnIdRef.current;

      // Build updated connections and optionally mirror anchor into metadata when moving line
      const state = useCanvasStore.getState();
      const current = state.canvas;
      let movedAnchor: { x: number; y: number } | null = null;
      const updatedConnections = (current.connections || []).map((c) => {
        if (c.id !== eid) return c;
        const hasCurve = Boolean(
          (c as any).curveAnchor ||
          ((c as any).controlPoints && (c as any).controlPoints.length >= 2) ||
          (c as any).curveMode === 'manual'
        );
        const baseFrom = originalEndpointsRef.current?.from;
        const baseTo = originalEndpointsRef.current?.to;

        if (dragModeRef.current === 'line') {
          if (!baseFrom || !baseTo) return c;
          const next: any = {
            ...c,
            fromPoint: { x: baseFrom.x + dx, y: baseFrom.y + dy },
            toPoint: { x: baseTo.x + dx, y: baseTo.y + dy },
          };
          const a0 = originalAnchorRef.current;
          if (a0 && typeof a0.x === 'number' && typeof a0.y === 'number') {
            const na = { x: a0.x + dx, y: a0.y + dy };
            next.curveAnchor = na;
            movedAnchor = na;
          }
          updateSnapState(null);
          return next;
        }

        if (dragModeRef.current === 'from') {
          if (!baseFrom) return c;
          const tentative = { x: baseFrom.x + dx, y: baseFrom.y + dy };
          const stationary = baseTo;
          const axisSnap = !hasCurve && stationary
            ? snapFreeLineToAxis(stationary, tentative, FREE_LINE_SNAP_THRESHOLD_DEG)
            : { point: tentative, snapped: false, axis: null };
          const candidate = findSnapCandidate(axisSnap.point, 'from', canvas.nodes || []);
          const finalPoint = candidate ? candidate.snapPoint : axisSnap.point;
          const next: any = { ...c, fromPoint: finalPoint };
          if (axisSnap.snapped && !candidate) {
            next.curveAnchor = undefined;
            next.controlPoints = undefined;
            next.curveMode = undefined;
          }
          updateSnapState(candidate);
          return next;
        }

        if (dragModeRef.current === 'to') {
          if (!baseTo) return c;
          const tentative = { x: baseTo.x + dx, y: baseTo.y + dy };
          const stationary = baseFrom;
          const axisSnap = !hasCurve && stationary
            ? snapFreeLineToAxis(stationary, tentative, FREE_LINE_SNAP_THRESHOLD_DEG)
            : { point: tentative, snapped: false, axis: null };
          const candidate = findSnapCandidate(axisSnap.point, 'to', canvas.nodes || []);
          const finalPoint = candidate ? candidate.snapPoint : axisSnap.point;
          const next: any = { ...c, toPoint: finalPoint };
          if (axisSnap.snapped && !candidate) {
            next.curveAnchor = undefined;
            next.controlPoints = undefined;
            next.curveMode = undefined;
          }
          updateSnapState(candidate);
          return next;
        }

        return c;
      });
      if (movedAnchor) {
        const prevMeta = (current.metadata || {}) as any;
        const prevAnchors = { ...(prevMeta.connectionAnchors || {}) } as Record<string, { x: number; y: number }>;
        prevAnchors[eid] = { x: movedAnchor.x, y: movedAnchor.y };
        updateCanvas({ connections: updatedConnections, metadata: { ...prevMeta, connectionAnchors: prevAnchors } });
      } else {
        updateCanvas({ connections: updatedConnections });
      }
    };
    const onUp = () => {
      const eid = dragConnIdRef.current;
      const didDrag = dragStartedRef.current;
      // reset flags
      isDraggingRef.current = false;
      dragConnIdRef.current = null;
      dragModeRef.current = null;
      dragStartPosRef.current = null;
      originalEndpointsRef.current = null;
      originalAnchorRef.current = null;
      dragStartedRef.current = false;
      dragStartScreenRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const snap = dragSnapRef.current;
      const detachTarget = detachEndpointRef.current;
      if (snap && didDrag && eid) {
        try {
          const st = useCanvasStore.getState();
          const current = st.canvas;
          const nextConnections = (current.connections || []).map((c) => {
            if (c.id !== eid) return c;
            const next: any = { ...(c as any) };
            if (snap.endpoint === 'from') {
              next.from = snap.nodeId;
              delete next.fromPoint;
              delete next.anchorParams;
              next.curveAnchor = undefined;
              next.controlPoints = undefined;
              next.curveMode = undefined;
            } else {
              next.to = snap.nodeId;
              delete next.toPoint;
              delete next.anchorParams;
              next.curveAnchor = undefined;
              next.controlPoints = undefined;
              next.curveMode = undefined;
            }
            const fromNode = next.from ? current.nodes.find((n) => n.id === next.from) : null;
            const toNode = next.to ? current.nodes.find((n) => n.id === next.to) : null;
            if (fromNode && toNode) {
              next.anchorParams = computeAnchorParams(
                { x: fromNode.x + fromNode.width / 2, y: fromNode.y + fromNode.height / 2 },
                { x: toNode.x + toNode.width / 2, y: toNode.y + toNode.height / 2 },
                { x: (fromNode.x + fromNode.width / 2 + toNode.x + toNode.width / 2) / 2, y: (fromNode.y + fromNode.height / 2 + toNode.y + toNode.height / 2) / 2 }
              );
            } else {
              delete next.anchorParams;
            }
            return next as CanvasConnection;
          });
          updateCanvas({ ...current, connections: nextConnections, updatedAt: Date.now() });
        } catch {}
      } else if (!snap && didDrag && detachTarget && eid) {
        try {
          const st = useCanvasStore.getState();
          const current = st.canvas;
          const nextConnections = (current.connections || []).map((c) => {
            if (c.id !== eid) return c;
            const next: any = { ...(c as any) };
            if (detachTarget === 'from') {
              delete next.from;
              delete next.anchorParams;
              next.curveAnchor = undefined;
              next.controlPoints = undefined;
              next.curveMode = undefined;
            } else {
              delete next.to;
              delete next.anchorParams;
              next.curveAnchor = undefined;
              next.controlPoints = undefined;
              next.curveMode = undefined;
            }
            return next as CanvasConnection;
          });
          updateCanvas({ ...current, connections: nextConnections, updatedAt: Date.now() });
        } catch {}
      }
      dragSnapRef.current = null;
      dragEndpointOverridesRef.current = null;
      detachEndpointRef.current = null;
      setSnapIndicator(null);
      // Click without drag: treat as selection (single select)
      if (!didDrag && eid) {
        try {
          const st = useCanvasStore.getState();
          st.selectConnections([eid]);
          st.selectNodes([]);
        } catch {}
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [screenToCanvas, updateCanvas, canvas, findSnapCandidate]);

  const beginDragFreeConnection = useCallback((connectionId: string, mode: 'line' | 'from' | 'to', e: React.MouseEvent, opts?: { initialPoint?: Position }) => {
    e.preventDefault();
    e.stopPropagation();
    const conn = (useCanvasStore.getState().canvas.connections || []).find((c) => c.id === connectionId);
    if (!conn) return;
    // 允许 node 端点开启拖拽以便“脱离节点”
    if (mode === 'line' && (!conn.fromPoint || !conn.toPoint)) return;
    if (mode === 'from' && !conn.fromPoint && !opts?.initialPoint) return;
    if (mode === 'to' && !conn.toPoint && !opts?.initialPoint) return;
    isDraggingRef.current = true;
    dragConnIdRef.current = connectionId;
    dragModeRef.current = mode;
    dragStartedRef.current = false;
    dragStartScreenRef.current = { x: e.clientX, y: e.clientY };
    dragSnapRef.current = null;
    dragEndpointOverridesRef.current = mode === 'from' && opts?.initialPoint ? { from: opts.initialPoint } :
      (mode === 'to' && opts?.initialPoint ? { to: opts.initialPoint } : null);
    setSnapIndicator(null);
    attachGlobalDrag();
  }, [attachGlobalDrag]);

  const handleNodes: React.ReactNode[] = [];

  // Effective node lookup with transient overrides (keeps connections visually attached during drag)
  const transientTick = transientVersion ?? 0;
  const nodeMap = useMemo(() => {
    // transientTick is the render tick for transientPositionsRef.current mutations during drag
    const overrides = transientTick >= 0 ? (transientPositionsRef?.current || {}) : {};
    const map = new Map<string, CanvasNode>();
    (canvas.nodes || []).forEach((n) => {
      const ov = overrides[n.id];
      if (ov) {
        map.set(n.id, { ...(n as any), x: ov.x, y: ov.y } as CanvasNode);
      } else {
        map.set(n.id, n);
      }
    });
    return map;
  }, [canvas.nodes, transientPositionsRef, transientTick]);

  return (
    <>
      <svg
        className="absolute pointer-events-none"
        style={{ zIndex: 0, left: canvasBounds.minX, top: canvasBounds.minY, width: canvasBounds.width, height: canvasBounds.height }}
        viewBox={`0 0 ${canvasBounds.width} ${canvasBounds.height}`}
      >
        {canvas.connections?.map((connection) => {
        const hasFromPoint = Boolean(connection.fromPoint);
        const hasToPoint = Boolean(connection.toPoint);
        const fromNode = nodeMap.get(connection.from);
        const toNode = nodeMap.get(connection.to);
        const isFree = hasFromPoint && hasToPoint && !fromNode && !toNode;
        const isMixed = (hasFromPoint && toNode) || (hasToPoint && fromNode);
        if (!hasFromPoint && !fromNode) return null;
        if (!hasToPoint && !toNode) return null;
        if (fromNode && (fromNode as any).type === 'group') return null;
        if (toNode && (toNode as any).type === 'group') return null;

        if (!hasFromPoint && !hasToPoint && viewportRect && canvas.nodes.length > cullThreshold) {
          const inViewA = !(
            fromNode.x + fromNode.width < viewportRect.x ||
            fromNode.x > viewportRect.x + viewportRect.w ||
            fromNode.y + fromNode.height < viewportRect.y ||
            fromNode.y > viewportRect.y + viewportRect.h
          );
          const inViewB = !(
            toNode.x + toNode.width < viewportRect.x ||
            toNode.x > viewportRect.x + viewportRect.w ||
            toNode.y + toNode.height < viewportRect.y ||
            toNode.y > viewportRect.y + viewportRect.h
          );
          if (!inViewA && !inViewB) return null;
        }

        const isHiddenConn = (!hasFromPoint && hiddenMindmapNodeIds.has(fromNode!.id)) || (!hasToPoint && hiddenMindmapNodeIds.has(toNode!.id));
        const isDetachPreview = !hasToPoint && (dragPreview?.action === 'detach' && dragPreview.currentParent?.id === connection.from && draggingNodeId === connection.to);
        const isReplacePreview = !hasToPoint && (dragPreview?.action === 'attach' && connection.to === draggingNodeId && dragPreview.candidateParent?.id !== connection.from);

        const isMidDragging = midDraggingRef.current && midConnIdRef.current === connection.id;
        const connForRender: any = isMidDragging ? { ...(connection as any), _suppressReanchor: true } : connection;
        // Per-connection override or mindmap default
        const overrideEndpoint = ((connection as any).appearance?.endpointStrategy as 'center-ray' | 'side-midpoints' | undefined);
        const isMindmapInternal = (!isFree && fromNode && toNode && fromNode.parentGroupId && toNode.parentGroupId && fromNode.parentGroupId === toNode.parentGroupId) ? (() => {
          const gid = fromNode!.parentGroupId as string;
          const g = canvas.nodes.find(n => n.id === gid && (n as any).type === 'group');
          return Boolean(g && (g as any).groupMode === 'mindmap');
        })() : false;
        const isFullyNodeAnchored = !hasFromPoint && !hasToPoint;
        const preferSideMidpoints = isFullyNodeAnchored && (overrideEndpoint === 'side-midpoints' ? true : isMindmapInternal);
        const useDynamicRenderer = isFullyNodeAnchored;
        const nodeCenters = {
          from: fromNode
            ? { x: fromNode.x + fromNode.width / 2, y: fromNode.y + fromNode.height / 2 }
            : (connection.fromPoint ? { x: connection.fromPoint.x, y: connection.fromPoint.y } : { x: 0, y: 0 }),
          to: toNode
            ? { x: toNode.x + toNode.width / 2, y: toNode.y + toNode.height / 2 }
            : (connection.toPoint ? { x: connection.toPoint.x, y: connection.toPoint.y } : { x: 0, y: 0 }),
        };
        let renderResult: ConnectionRenderResult;
        const nodeHandlePositions: { from?: { handle: Position; anchor: Position; center: Position }; to?: { handle: Position; anchor: Position; center: Position } } = {};
        const mixedCenterMode = (hasFromPoint && toNode && !connection.fromPoint) || (hasToPoint && fromNode && !connection.toPoint);
        const getNodeAttachmentPoint = (node: CanvasNode, otherPoint: Position | null): Position => {
          if (!node) return otherPoint || { x: 0, y: 0 };
          const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
          if (!otherPoint) return center;
          const dx = otherPoint.x - center.x;
          const dy = otherPoint.y - center.y;
          if (preferSideMidpoints) {
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);
            if (absDx >= absDy) {
              return { x: dx >= 0 ? node.x + node.width : node.x, y: center.y };
            }
            return { x: center.x, y: dy >= 0 ? node.y + node.height : node.y };
          }
          const len = Math.hypot(dx, dy) || 1;
          return {
            x: center.x + (dx / len) * (node.width / 2),
            y: center.y + (dy / len) * (node.height / 2),
          };
        };

        if (useDynamicRenderer) {
          renderResult = renderConnectionDynamically(
            connForRender,
            fromNode!,
            toNode!,
            overrideEndpoint ? { endpointOverride: overrideEndpoint } : (preferSideMidpoints ? { endpointOverride: 'side-midpoints' } : undefined)
          );
        } else {
          const renderStart = hasFromPoint ? connection.fromPoint! : nodeCenters.from;
          const renderEnd = hasToPoint ? connection.toPoint! : nodeCenters.to;
          const clipStartRect = hasFromPoint ? undefined : { left: fromNode!.x, right: fromNode!.x + fromNode!.width, top: fromNode!.y, bottom: fromNode!.y + fromNode!.height };
          const clipEndRect = hasToPoint ? undefined : { left: toNode!.x, right: toNode!.x + toNode!.width, top: toNode!.y, bottom: toNode!.y + toNode!.height };
          renderResult = renderConnectionFromPoints(renderStart, renderEnd, connForRender, { clipStartRect, clipEndRect });
        }
        const pendingOverrides = dragEndpointOverridesRef.current;
        const cubicForAnchors = renderResult.cubic;
        const fallbackCenterFrom = fromNode ? nodeCenters.from : (connection.fromPoint || nodeCenters.from);
        const fallbackCenterTo = toNode ? nodeCenters.to : (connection.toPoint || nodeCenters.to);
        const fromAnchor = hasFromPoint
          ? connection.fromPoint!
          : (cubicForAnchors ? cubicForAnchors.start : fallbackCenterFrom);
        const toAnchor = hasToPoint
          ? connection.toPoint!
          : (cubicForAnchors ? cubicForAnchors.end : fallbackCenterTo);
        const useSideHandles = preferSideMidpoints && !hasFromPoint && !hasToPoint;
        const finalFromHandle = pendingOverrides?.from
          || (hasFromPoint ? connection.fromPoint! : (useSideHandles ? fromAnchor : fallbackCenterFrom));
        const finalToHandle = pendingOverrides?.to
          || (hasToPoint ? connection.toPoint! : (useSideHandles ? toAnchor : fallbackCenterTo));
        nodeHandlePositions.from = {
          handle: finalFromHandle,
          anchor: fromAnchor,
          center: nodeCenters.from,
        };
        nodeHandlePositions.to = {
          handle: finalToHandle,
          anchor: toAnchor,
          center: nodeCenters.to,
        };

        const { path: connectionPath, midPoint, cubic } = renderResult as any;
        const guidePaths = (renderResult as any).guides as { from?: string; to?: string } | undefined;
        const displayPath = connectionPath;
        const isSelected = selectedConnectionIds.has(connection.id);
        const app = (connection as any).appearance || {};
        const lineColor = app.color || strokeMain;
        const lineWidth = Math.max(1, Number(app.width ?? 2));
        const dash = app.dashed ? (Array.isArray(app.dashArray) ? app.dashArray.join(',') : '6,3') : undefined;
        const op = typeof app.opacity === 'number' ? Math.max(0, Math.min(1, app.opacity)) : 1;
        const arrow = (app as any).arrow || {};
        const aStart = Boolean(arrow.start);
        const aEnd = arrow.end === undefined ? true : Boolean(arrow.end);
        const aSize = Math.max(16, Math.min(24, Number(arrow.size ?? 16)));
        const aShape = String(arrow.shape || 'triangle');
        const aFilled = arrow.filled === undefined ? true : Boolean(arrow.filled);
        let markerStartUrl: string | undefined;
        let markerEndUrl: string | undefined;
        const hideArrows = isMindmapInternal;
        if (!hideArrows) {
          if (aStart) {
            const mid = getMarkerId({ shape: aShape, size: aSize, filled: aFilled, color: lineColor, prefix: base + '_s' });
            ensureMarker(mid, aShape, aSize, aFilled, lineColor, true);
            markerStartUrl = `url(#${mid})`;
          }
          if (aEnd) {
            const mid = getMarkerId({ shape: aShape, size: aSize, filled: aFilled, color: lineColor, prefix: base + '_e' });
            ensureMarker(mid, aShape, aSize, aFilled, lineColor, false);
            markerEndUrl = `url(#${mid})`;
          }
        }
        let trimStart = markerStartUrl ? markerTrimPx(aShape, aSize, lineWidth) : 0;
        let trimEnd = markerEndUrl ? markerTrimPx(aShape, aSize, lineWidth) : 0;
        let renderedPath = displayPath;
        if ((trimStart > 0 || trimEnd > 0) && cubic) {
          const toPath = (seg: { start: Position; cp1: Position; cp2: Position; end: Position }) =>
            `M ${seg.start.x} ${seg.start.y} C ${seg.cp1.x} ${seg.cp1.y}, ${seg.cp2.x} ${seg.cp2.y}, ${seg.end.x} ${seg.end.y}`;
          let trimmed = trimCubicByDistance(cubic, trimStart, trimEnd);
          if (!trimmed && markerStartUrl && markerEndUrl) {
            // Prefer preserving end arrow (product default) when total curve is too short for both heads.
            markerStartUrl = undefined;
            trimStart = 0;
            trimmed = trimCubicByDistance(cubic, 0, trimEnd);
          }
          if (!trimmed && markerEndUrl) {
            markerEndUrl = undefined;
            trimEnd = 0;
            trimmed = trimCubicByDistance(cubic, trimStart, 0);
          }
          if (!trimmed && markerStartUrl) {
            markerStartUrl = undefined;
            trimStart = 0;
            trimmed = trimCubicByDistance(cubic, 0, trimEnd);
          }
          if (trimmed) {
            renderedPath = toPath(trimmed);
          } else {
            // Never fall back to "untrimmed path + marker": that is the direct source of head overlap artifacts.
            markerStartUrl = undefined;
            markerEndUrl = undefined;
          }
        } else if ((markerStartUrl || markerEndUrl) && !cubic) {
          // Marker placement depends on cubic trimming; disable safely if cubic data is missing.
          markerStartUrl = undefined;
          markerEndUrl = undefined;
        }
        const mainStrokeLinecap: 'butt' | 'round' = markerStartUrl || markerEndUrl ? 'butt' : 'round';

        // Handled display: free-line shows the true anchor; node-connections show projection onto visible curve
        const anchor = (connection as any).curveAnchor as { x: number; y: number } | undefined;
        let handlePoint = midPoint;
        if (!isFree && anchor && cubic) {
          // For node connections, project anchor onto visible curve for handle rendering
          const bezierPoint = (t: number, p0: any, p1: any, p2: any, p3: any) => {
            const u = 1 - t; const tt = t * t; const uu = u * u; const uuu = uu * u; const ttt = tt * t;
            return { x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
                     y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y };
          };
          const dist2 = (a: any, b: any) => { const dx = a.x - b.x, dy = a.y - b.y; return dx*dx + dy*dy; };
          let best = cubic.start; let bestD = dist2(best, anchor);
          const SEG = 64;
          for (let i = 1; i <= SEG; i++) {
            const t = i / SEG;
            const p = bezierPoint(t, cubic.start, cubic.cp1, cubic.cp2, cubic.end);
            const d = dist2(p, anchor);
            if (d < bestD) { best = p; bestD = d; }
          }
          handlePoint = best;
        }

        return (
          <g key={connection.id} data-connection-id={connection.id}>
            {isSelected && (
              <path
                d={renderedPath}
                transform={`translate(${-canvasBounds.minX}, ${-canvasBounds.minY})`}
                stroke={strokeSelected}
                strokeWidth="6"
                opacity={isHiddenConn ? 0 : 0.2}
                fill="none"
                strokeLinecap={mainStrokeLinecap}
                strokeLinejoin="round"
                style={{ pointerEvents: 'none' }}
              />
            )}
            <path
              data-connection-main="1"
              d={renderedPath}
              transform={`translate(${-canvasBounds.minX}, ${-canvasBounds.minY})`}
              stroke={lineColor}
              strokeWidth={String(lineWidth)}
              strokeDasharray={dash}
              fill="none"
              markerStart={markerStartUrl}
              markerEnd={markerEndUrl}
              opacity={(isHiddenConn || isDetachPreview || isReplacePreview) ? 0 : op}
              strokeLinecap={mainStrokeLinecap}
              strokeLinejoin="round"
            />
            <path
              d={displayPath}
              transform={`translate(${-canvasBounds.minX}, ${-canvasBounds.minY})`}
              stroke="transparent"
              strokeWidth="12"
              fill="none"
              style={{ cursor: 'pointer', pointerEvents: isHiddenConn || isDetachPreview || isReplacePreview ? 'none' : 'auto', opacity: isHiddenConn || isDetachPreview || isReplacePreview ? 0 : 1 }}
            onMouseDown={(e) => {
              if (isFree) {
                beginDragFreeConnection(connection.id, 'line', e);
                return;
              }
              onConnectionClick(connection.id, e);
            }}
              onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); onLabelEdit(connection.id); }}
              onContextMenu={(e) => onConnectionContextMenu(e, connection.id)}
            >
              <title>单击选中，双击编辑标签，右键菜单</title>
            </path>

            {connection.label && (editMode !== 'connection' || editingEntityId !== connection.id) && (
              <g transform={`translate(${midPoint.x - canvasBounds.minX}, ${midPoint.y - canvasBounds.minY})`}>
                <rect
                  x={-(connection.label.length * 10 + 8) / 2}
                  y={-10}
                  width={connection.label.length * 10 + 8}
                  height={20}
                  fill={labelBg}
                  stroke="none"
                  strokeWidth="0"
                  rx={2}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); onLabelEdit(connection.id); }}
                />
                <text
                  x={0}
                  y={1}
                  textAnchor="middle"
                  fontSize="12"
                  fill={labelFg}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); onLabelEdit(connection.id); }}
                >
                  {connection.label}
                </text>
              </g>
            )}

            {editMode === 'connection' && editingEntityId === connection.id && (
              // Remove transition to avoid relying on undefined allowMindmapMotion
              <g transform={`translate(${midPoint.x - canvasBounds.minX}, ${midPoint.y - canvasBounds.minY})`}>
                <foreignObject x={-60} y={-15} width={120} height={30} style={{ overflow: 'visible', pointerEvents: 'all' }}>
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: labelBg, border: `var(--stroke-2) solid ${accent}`, borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-elev-6)' }}>
                    <input
                      ref={connectionInputRef}
                      type="text"
                      value={connectionLabelInput}
                      onChange={(e) => onLabelInputChange(e.target.value)}
                      onKeyDown={onLabelKeyDown}
                      onBlur={onLabelSave}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: '100%', height: '24px', border: 'none', outline: 'none', background: 'transparent', fontSize: '12px', textAlign: 'center', fontFamily: 'inherit', color: labelFg, padding: '0 8px' }}
                      placeholder={t('canvas.connection.placeholder', { default: 'Label...' })}
                      autoFocus
                    />
                  </div>
                </foreignObject>
              </g>
            )}

            {isSelected && (() => {
              (['from', 'to'] as const).forEach((endpoint) => {
                const conf = endpoint === 'from' ? nodeHandlePositions.from : nodeHandlePositions.to;
                if (!conf) return;
                const isFreeish = endpoint === 'from' ? Boolean(connection.fromPoint) : Boolean(connection.toPoint);
                const handlePos = conf.handle;
                const anchorPos = conf.anchor;
                const nodeCenter = endpoint === 'from' ? nodeCenters.from : nodeCenters.to;
                const effectiveSide = preferSideMidpoints;
                if (!handlePos || !anchorPos) return;
                const guideFromRenderer = guidePaths ? (endpoint === 'from' ? guidePaths.from : guidePaths.to) : undefined;
                const guidePath = guideFromRenderer || buildGuidePath(nodeCenter, anchorPos);
                handleNodes.push(
                  <g key={`${connection.id}-${endpoint}`} transform={`translate(${-canvasBounds.minX}, ${-canvasBounds.minY})`}>
                    {!isFreeish && !(preferSideMidpoints || isFree) && (
                      <path
                        d={guidePath}
                        stroke={selectedGuideStroke}
                        strokeWidth={1}
                        strokeDasharray="4 4"
                        opacity={0.8}
                        fill="none"
                      />
                    )}
                    <circle
                      cx={handlePos.x}
                      cy={handlePos.y}
                      r={Math.max(4, 6 / Math.max(0.01, props.containerScale))}
                      fill={labelBg}
                      stroke={accent}
                      strokeWidth={Math.max(1, 2 / Math.max(0.01, props.containerScale))}
                      style={{ cursor: 'move', pointerEvents: 'auto' }}
                      onMouseDown={(e) =>
                        beginDragFreeConnection(
                          connection.id,
                          endpoint,
                          e,
                          !isFreeish ? { initialPoint: handlePos } : undefined
                        )
                      }
                    />
                  </g>
                );
              });
              return null;
            })()}

            {/* Single mid-handle for curvature editing (both node and free) */}
            {(() => {
              // Hide mid-handle for node-to-node connections when using side-midpoints strategy
              const overrideEndpoint = ((connection as any).appearance?.endpointStrategy as 'center-ray' | 'side-midpoints' | undefined);
              const effectiveSideMid = (!isFree) && (overrideEndpoint === 'side-midpoints' || preferSideMidpoints);
              if (!isSelected || effectiveSideMid) return null;
              return (
              <g transform={`translate(${handlePoint.x - canvasBounds.minX}, ${handlePoint.y - canvasBounds.minY})`} style={{ pointerEvents: 'auto' }}>
                <circle
                  cx={0}
                  cy={0}
                  r={Math.max(4, 6 / Math.max(0.01, props.containerScale))}
                  fill={labelBg}
                  stroke={accent}
                  strokeWidth={Math.max(1, 2 / Math.max(0.01, props.containerScale))}
                  style={{ cursor: 'move' }}
                  onMouseDown={(e) => {
                    const cubic = renderResult.cubic as any;
                    beginDragMidHandle(connection.id, cubic, e);
                  }}
                />
              </g>
              );
            })()}
          </g>
        );
        })}

        {dragPreview && dragPreview.action !== 'none' && (
          <g>
            {dragPreview.action === 'attach' && dragPreview.candidateParent && draggingNodeId && (() => {
              const draggingNode = nodeMap.get(draggingNodeId) || canvas.nodes.find((n) => n.id === draggingNodeId);
              if (!draggingNode) return null;
              const candidateParent = nodeMap.get(dragPreview.candidateParent.id) || dragPreview.candidateParent;
              const sameGroup = candidateParent.parentGroupId && draggingNode.parentGroupId && candidateParent.parentGroupId === draggingNode.parentGroupId;
              const groupNode = sameGroup ? canvas.nodes.find(n => n.id === candidateParent.parentGroupId && (n as any).type === 'group') : null;
              const preferSide = Boolean(groupNode && (groupNode as any).groupMode === 'mindmap');
              const renderResult = renderConnectionDynamically({ id: 'preview', from: candidateParent.id, to: draggingNodeId, createdAt: Date.now() } as any, candidateParent, draggingNode, preferSide ? { endpointOverride: 'side-midpoints' } : undefined);
              return (
                <path
                  d={(renderResult as any).path}
                  transform={`translate(${-canvasBounds.minX}, ${-canvasBounds.minY})`}
                  stroke={accent}
                  strokeWidth="2"
                  fill="none"
                  // 思维导图“候选父子关系”预览也不显示箭头
                  markerEnd={preferSide ? undefined : `url(#${markerPreviewId})`}
                  opacity={0.3 + dragPreview.confidence * 0.7}
                />
              );
            })()}
          </g>
        )}

      {snapIndicator && (() => {
        const target = canvas.nodes.find((n) => n.id === snapIndicator.nodeId);
        if (!target) return null;
        const inverseScale = 1 / Math.max(0.01, props.containerScale);
        const r = Math.max(6, 8 * inverseScale);
        const pad = Math.max(4, 8 * inverseScale);
        return (
          <g transform={`translate(${-canvasBounds.minX}, ${-canvasBounds.minY})`} pointerEvents="none">
            <rect
              x={target.x - pad}
              y={target.y - pad}
              width={target.width + pad * 2}
              height={target.height + pad * 2}
              fill="none"
              stroke={accent}
              strokeWidth={Math.max(1.5, 2 * inverseScale)}
              strokeDasharray="6 3"
              opacity={0.6}
              rx={4 * inverseScale}
              ry={4 * inverseScale}
            />
            <circle
              cx={snapIndicator.snapPoint.x}
              cy={snapIndicator.snapPoint.y}
              r={r}
              fill={accent}
              opacity={0.35}
            />
          </g>
        );
      })()}

        <defs>
          {/* Larger arrowheads; fixed size; tip at path end; fully outside nodes when path shortened */}
          <marker id={markerId} markerWidth="12" markerHeight="9" refX="12" refY="4.5" orient="auto-start-reverse" markerUnits="userSpaceOnUse" viewBox="0 0 12 9">
            <polygon points="0 0, 12 4.5, 0 9" fill={strokeMain} shapeRendering="geometricPrecision" />
          </marker>
          <marker id={markerSelectedId} markerWidth="12" markerHeight="9" refX="12" refY="4.5" orient="auto-start-reverse" markerUnits="userSpaceOnUse" viewBox="0 0 12 9">
            <polygon points="0 0, 12 4.5, 0 9" fill={strokeSelected} shapeRendering="geometricPrecision" />
          </marker>
          <marker id={markerPreviewId} markerWidth="12" markerHeight="9" refX="11" refY="4.5" orient="auto-start-reverse" markerUnits="userSpaceOnUse" viewBox="0 0 12 9">
            <polygon points="0 0, 12 4.5, 0 9" fill={accent} shapeRendering="geometricPrecision" />
          </marker>
          {renderDynamicMarkers()}
          {/* legacy marker removed; using namespaced markers above */}
        </defs>
      </svg>

      {handleNodes.length > 0 && (
        <svg
          className="absolute pointer-events-none"
          style={{ zIndex: 2, left: canvasBounds.minX, top: canvasBounds.minY, width: canvasBounds.width, height: canvasBounds.height }}
        >
          {handleNodes}
        </svg>
      )}
    </>
  );
};

export default ConnectionsLayer;
