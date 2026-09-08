import { useEffect, useMemo, useRef } from 'react';
import type { Canvas, CanvasNode } from '../../../../types/canvas';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { calculateCanvasBounds } from '../systems/CoordinateSystem';
import useViewportRect from '../../../hooks/useViewportRect';
import { buildSpatialIndex, type SpatialIndex } from '../../../utils/spatialIndex';

export interface UseCanvasViewModelParams {
  canvas: Canvas;
  externalCanvas?: Canvas | undefined;
  transformRef: React.RefObject<ReactZoomPanPinchRef>;
  viewTransform?: { scale: number; positionX: number; positionY: number } | null;
  viewportSize?: { width: number; height: number } | null;
  viewportBuffer?: number;
  cullThreshold?: number;
}

export interface CanvasViewModel {
  canvasBounds: { minX: number; minY: number; width: number; height: number };
  viewportRect: { x: number; y: number; w: number; h: number } | null;
  visibleNodes: CanvasNode[];
  hiddenMindmapNodeIds: Set<string>;
  spatialIndexRef: React.MutableRefObject<SpatialIndex | null>;
}

export function useCanvasViewModel(params: UseCanvasViewModelParams): CanvasViewModel {
  const {
    canvas,
    externalCanvas,
    transformRef,
    viewTransform,
    viewportSize,
    viewportBuffer = 360,
    cullThreshold = 180,
  } = params;

  const canvasBounds = useMemo(() => {
    return calculateCanvasBounds(canvas.nodes || [], 2000);
  }, [canvas.nodes]);

  // 视口矩形（含缓冲）
  const viewportRect = useViewportRect({
    transformRef: transformRef as React.RefObject<ReactZoomPanPinchRef>,
    viewTransform,
    viewportSize,
    buffer: viewportBuffer,
    extraDeps: [canvas?.updatedAt],
  });

  // 思维导图折叠隐藏集合
  const hiddenMindmapNodeIds = useMemo(() => {
    const sourceCanvas = externalCanvas || canvas;
    const out = new Set<string>();
    if (!sourceCanvas?.nodes) return out;
    const groups = sourceCanvas.nodes.filter((n) => (n as any).type === 'group' && (n as any).mindmap);
    for (const g of groups as any[]) {
      const members = new Set<string>((g.children || []) as string[]);
      const edges = (sourceCanvas.connections || []).filter((e) => members.has(e.from) && members.has(e.to));
      const fromMap = new Map<string, string[]>();
      for (const e of edges) {
        if (!fromMap.has(e.from)) fromMap.set(e.from, []);
        fromMap.get(e.from)!.push(e.to);
      }
      const collapsed: Record<string, boolean> = (g.mindmap?.collapsed || {}) as any;
      const roots = Object.keys(collapsed).filter((id) => collapsed[id]);
      for (const rid of roots) {
        const q = [rid];
        const seen = new Set<string>([rid]);
        while (q.length) {
          const u = q.shift()!;
          const nexts = fromMap.get(u) || [];
          for (const v of nexts) {
            if (!seen.has(v)) {
              seen.add(v);
              q.push(v);
              if (v !== rid) out.add(v);
            }
          }
        }
      }
    }
    return out;
  }, [externalCanvas, canvas]);

  // 可见节点（视口裁剪 + 折叠过滤）
  const visibleNodes = useMemo(() => {
    const sourceCanvas = externalCanvas || canvas;
    if (!sourceCanvas?.nodes) return [];
    const hiddenIds = new Set<string>(hiddenMindmapNodeIds);
    sourceCanvas.nodes.forEach((n) => {
      if ((n as any).type === 'column' && (n as any).isCollapsed) {
        (n.children || []).forEach((id) => hiddenIds.add(id));
      }
    });
    const base = sourceCanvas.nodes.filter((node) => (node as any).type !== 'group' && !hiddenIds.has(node.id));
    if (!viewportRect || base.length <= cullThreshold) return base;
    const minX = viewportRect.x;
    const minY = viewportRect.y;
    const maxX = viewportRect.x + viewportRect.w;
    const maxY = viewportRect.y + viewportRect.h;
    return base.filter(
      (n) => !(n.x + n.width < minX || n.x > maxX || n.y + n.height < minY || n.y > maxY)
    );
  }, [externalCanvas, canvas, hiddenMindmapNodeIds, viewportRect, cullThreshold]);

  // 轻量空间索引（命中/框选专用）
  const spatialIndexRef = useRef<SpatialIndex | null>(null);
  useEffect(() => {
    try {
      if (canvas?.nodes && canvas.nodes.length > 0) {
        // 仅对可见参与框选/命中的“非群组节点”建立空间索引，避免群组节点的过期几何干扰
        const indexNodes = canvas.nodes.filter((n) => (n as any).type !== 'group');
        spatialIndexRef.current = indexNodes.length > 0 ? buildSpatialIndex(indexNodes, 320) : null;
      } else {
        spatialIndexRef.current = null;
      }
    } catch {
      spatialIndexRef.current = null;
    }
  }, [canvas?.nodes, canvas?.updatedAt]);

  return {
    canvasBounds,
    viewportRect,
    visibleNodes,
    hiddenMindmapNodeIds,
    spatialIndexRef,
  };
}

export default useCanvasViewModel;
