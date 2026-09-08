import { useCallback, useEffect, useRef, useState } from 'react';
import type { Canvas, CanvasNode, CanvasConnection } from '../../../../types/canvas';
import type { SpatialIndex } from '../../../utils/spatialIndex';
import { queryRect } from '../../../utils/spatialIndex';
import { getNodesInSelectionBox } from '../systems/CoordinateSystem';
import { useCanvasStore } from '../../../stores/canvas.store';
import { sampleConnectionPoints } from '../../../utils/connectionGeometry';

export interface UseBoxSelectionParams {
  canvas: Canvas;
  spatialIndexRef: React.MutableRefObject<SpatialIndex | null>;
  screenToCanvas: (sx: number, sy: number) => { x: number; y: number };
  coordinatesReady: boolean;
  setPreviewSelectedNodes: (set: Set<string>) => void;
  isGroupActive: boolean;
  createGroup: (ids: string[], nodes: CanvasNode[]) => any | null;
  destroyGroup: () => void;
  // External editing lock (e.g., group label editing) to mirror text-node editing behavior
  externalEditingActive?: boolean;
}

export interface UseBoxSelectionResult {
  isBoxSelecting: boolean;
  screenBoxSelection: { startX: number; startY: number; currentX: number; currentY: number } | null;
  handleMouseDown: (e: React.MouseEvent) => void;
  isJustFinished: () => boolean;
}

export function useBoxSelection(params: UseBoxSelectionParams): UseBoxSelectionResult {
  const {
    canvas,
    spatialIndexRef,
    screenToCanvas,
    coordinatesReady,
    setPreviewSelectedNodes,
    isGroupActive,
    createGroup,
    destroyGroup,
    externalEditingActive = false,
  } = params;

  const storeState = useCanvasStore.getState();
  const DRAG_THRESHOLD = 8;

  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [screenBoxSelection, setScreenBoxSelection] = useState<{
    startX: number; startY: number; currentX: number; currentY: number;
  } | null>(null);

  // 实时节点快照（用于无索引回退）
  const liveNodesRef = useRef<CanvasNode[]>([]);
  useEffect(() => {
    liveNodesRef.current = canvas?.nodes || [];
  }, [canvas?.nodes, canvas?.nodes?.length, canvas?.updatedAt]);

  // 命中候选 + 精确相交
  const getNodesInSelectionBoxLocal = useCallback((startX: number, startY: number, endX: number, endY: number) => {
    try {
      const minX = Math.min(startX, endX);
      const minY = Math.min(startY, endY);
      const maxX = Math.max(startX, endX);
      const maxY = Math.max(startY, endY);
      const candidates = queryRect(spatialIndexRef.current, minX, minY, maxX, maxY);
      if (candidates && candidates.length > 0) {
        // 安全过滤：排除群组节点
        const leafCandidates = candidates.filter((n) => (n as any).type !== 'group');
        return getNodesInSelectionBox(startX, startY, endX, endY, leafCandidates);
      }
    } catch {}
    const sourceNodes = (liveNodesRef.current || []).filter((n) => (n as any).type !== 'group');
    return getNodesInSelectionBox(startX, startY, endX, endY, sourceNodes);
  }, [spatialIndexRef]);

  // 内部状态（Ref）
  const stateRef = useRef({
    isSelecting: false,
    startPos: null as null | { x: number; y: number },
    canvasStartPos: null as null | { x: number; y: number },
    lastFinishedAt: 0,
    mouseDownPos: null as null | { x: number; y: number },
    isPotentialDrag: false,
  });

  const handleBoxSelectionMove = useCallback((event: MouseEvent) => {
    if (!stateRef.current.isSelecting || !stateRef.current.startPos || !stateRef.current.canvasStartPos) return;
    if (!coordinatesReady) return;
    const currentPos = screenToCanvas(event.clientX, event.clientY);
    const updatedSelection = {
      startX: stateRef.current.canvasStartPos.x,
      startY: stateRef.current.canvasStartPos.y,
      currentX: currentPos.x,
      currentY: currentPos.y,
    };
    const updatedScreen = {
      startX: stateRef.current.startPos.x,
      startY: stateRef.current.startPos.y,
      currentX: event.clientX,
      currentY: event.clientY,
    };
    // 预览（节点）
    const nodesInBox = getNodesInSelectionBoxLocal(
      updatedSelection.startX,
      updatedSelection.startY,
      updatedSelection.currentX,
      updatedSelection.currentY,
    );
    setPreviewSelectedNodes(nodesInBox);
    // 更新状态
    setScreenBoxSelection(updatedScreen);
  }, [coordinatesReady, screenToCanvas, getNodesInSelectionBoxLocal, setPreviewSelectedNodes]);

  const handleBoxSelectionEnd = useCallback((event: MouseEvent) => {
    const wasSelecting = stateRef.current.isSelecting;
    stateRef.current.lastFinishedAt = Date.now();
    if (wasSelecting && stateRef.current.canvasStartPos) {
      if (!coordinatesReady) {
        setTimeout(() => {
          stateRef.current = { isSelecting: false, startPos: null, canvasStartPos: null, lastFinishedAt: stateRef.current.lastFinishedAt, mouseDownPos: null, isPotentialDrag: false };
          setIsBoxSelecting(false);
          setScreenBoxSelection(null);
          setPreviewSelectedNodes(new Set());
        }, 50);
        return;
      }
      const currentCanvasPos = screenToCanvas(event.clientX, event.clientY);
      const finalNodes = getNodesInSelectionBoxLocal(
        stateRef.current.canvasStartPos.x,
        stateRef.current.canvasStartPos.y,
        currentCanvasPos.x,
        currentCanvasPos.y,
      );
      // 计算框选到的连线（包括自由连线）
      const minX = Math.min(stateRef.current.canvasStartPos.x, currentCanvasPos.x);
      const minY = Math.min(stateRef.current.canvasStartPos.y, currentCanvasPos.y);
      const maxX = Math.max(stateRef.current.canvasStartPos.x, currentCanvasPos.x);
      const maxY = Math.max(stateRef.current.canvasStartPos.y, currentCanvasPos.y);
      const rect = { minX, minY, maxX, maxY };

      const connectionsInBox = new Set<string>();
      const nodesById = new Map<string, CanvasNode>();
      (canvas.nodes || []).forEach(n => nodesById.set(n.id, n));

      const pointInRect = (p: { x: number; y: number }) => p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY;
      const segsIntersect = (a: any, b: any, c: any, d: any) => {
        const cross = (p: any, q: any, r: any) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
        const onSeg = (p: any, q: any, r: any) => Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) && Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
        const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
        if (d1 === 0 && onSeg(a, c, b)) return true; if (d2 === 0 && onSeg(a, d, b)) return true;
        if (d3 === 0 && onSeg(c, a, d)) return true; if (d4 === 0 && onSeg(c, b, d)) return true;
        return false;
      };
      const segIntersectsRect = (p1: any, p2: any) => {
        if (pointInRect(p1) || pointInRect(p2)) return true;
        const r1 = { x: rect.minX, y: rect.minY }, r2 = { x: rect.maxX, y: rect.minY };
        const r3 = { x: rect.maxX, y: rect.maxY }, r4 = { x: rect.minX, y: rect.maxY };
        return segsIntersect(p1, p2, r1, r2) || segsIntersect(p1, p2, r2, r3) || segsIntersect(p1, p2, r3, r4) || segsIntersect(p1, p2, r4, r1);
      };

      const testConnection = (conn: CanvasConnection) => {
        try {
          // 快速跳过：粗略包围盒基于端点/控制点采样
          const points = sampleConnectionPoints(conn, nodesById);
          if (!points.length) return false;
          let prev = points[0];
          for (let i = 1; i < points.length; i++) {
            const curr = points[i];
            if (segIntersectsRect(prev, curr)) return true;
            prev = curr;
          }
        } catch {}
        return false;
      };

      for (const conn of (canvas.connections || [])) {
        if (testConnection(conn)) connectionsInBox.add(conn.id);
      }

      // 更新 store 选中（节点 + 连线）
      const newSelected = Array.from(finalNodes);
      const store = useCanvasStore.getState();
      store.selectNodes(newSelected);
      store.selectConnections(Array.from(connectionsInBox));
      // 临时群组构建/销毁
      // 规则：节点数>=2 或 节点数>=1 且 选中连线数>=1，则认为用户意图成组（显示群组边界与成组按钮）
      if (newSelected.length > 1 || (newSelected.length >= 1 && connectionsInBox.size >= 1)) {
        if (isGroupActive) destroyGroup();
        const selectedNodes = canvas.nodes.filter((n) => finalNodes.has(n.id));
        createGroup(Array.from(finalNodes), selectedNodes);
      } else {
        if (isGroupActive) destroyGroup();
      }
    }
    // 清理状态
    setTimeout(() => {
      stateRef.current = { isSelecting: false, startPos: null, canvasStartPos: null, lastFinishedAt: stateRef.current.lastFinishedAt, mouseDownPos: null, isPotentialDrag: false };
      setIsBoxSelecting(false);
      setScreenBoxSelection(null);
      setPreviewSelectedNodes(new Set());
      document.removeEventListener('mousemove', handleBoxSelectionMove);
      document.removeEventListener('mouseup', handleBoxSelectionEnd);
    }, 50);
  }, [coordinatesReady, screenToCanvas, getNodesInSelectionBoxLocal, isGroupActive, createGroup, destroyGroup, canvas.nodes, canvas.connections, handleBoxSelectionMove, setPreviewSelectedNodes]);

  const potentialDragMoveRef = useRef<(event: MouseEvent) => void>(() => {});
  const potentialDragEndRef = useRef<(event: MouseEvent) => void>(() => {});

  const handlePotentialDragMove = useCallback((event: MouseEvent) => {
    if (!stateRef.current.isPotentialDrag || !stateRef.current.mouseDownPos) return;
    if (!coordinatesReady) return;
    const dx = Math.abs(event.clientX - stateRef.current.mouseDownPos.x);
    const dy = Math.abs(event.clientY - stateRef.current.mouseDownPos.y);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= DRAG_THRESHOLD) {
      stateRef.current.isPotentialDrag = false;
      stateRef.current.isSelecting = true;
      stateRef.current.startPos = { ...stateRef.current.mouseDownPos };
      const canvasStart = screenToCanvas(stateRef.current.mouseDownPos.x, stateRef.current.mouseDownPos.y);
      stateRef.current.canvasStartPos = canvasStart;
      // 初始化选择框
      const currentCanvasPos = screenToCanvas(event.clientX, event.clientY);
      setIsBoxSelecting(true);
      setScreenBoxSelection({
        startX: stateRef.current.mouseDownPos.x,
        startY: stateRef.current.mouseDownPos.y,
        currentX: event.clientX,
        currentY: event.clientY,
      });
      document.removeEventListener('mousemove', potentialDragMoveRef.current);
      document.removeEventListener('mouseup', potentialDragEndRef.current);
      document.addEventListener('mousemove', handleBoxSelectionMove);
      document.addEventListener('mouseup', handleBoxSelectionEnd);
    }
  }, [coordinatesReady, screenToCanvas, handleBoxSelectionMove, handleBoxSelectionEnd]);

  const handlePotentialDragEnd = useCallback((_event: MouseEvent) => {
    stateRef.current.isPotentialDrag = false;
    stateRef.current.mouseDownPos = null;
    document.removeEventListener('mousemove', potentialDragMoveRef.current);
    document.removeEventListener('mouseup', potentialDragEndRef.current);
  }, []);

  useEffect(() => {
    potentialDragMoveRef.current = handlePotentialDragMove;
    potentialDragEndRef.current = handlePotentialDragEnd;
  }, [handlePotentialDragMove, handlePotentialDragEnd]);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return;
    const target = event.target as Element;
    const isNode = target.closest('[data-node-container]');
    if (isNode) return;

    // 正在编辑节点/连接时，不拦截空白区域的鼠标按下事件，
    // 让浏览器默认行为触发（包括 textarea/input 的失焦 blur），
    // 以便编辑器按 onBlur 保存并退出。
    try {
      const store = useCanvasStore.getState();
      const es = store.editState;
      if (
        (es && es.isActive && (es.mode === 'node' || es.mode === 'connection')) ||
        externalEditingActive
      ) {
        return; // 不启动框选，不阻止默认/冒泡
      }
    } catch {}
    // 初始化潜在拖拽
    event.preventDefault();
    event.stopPropagation();
    stateRef.current = {
      isSelecting: false,
      startPos: null,
      canvasStartPos: null,
      lastFinishedAt: stateRef.current.lastFinishedAt,
      mouseDownPos: { x: event.clientX, y: event.clientY },
      isPotentialDrag: true,
    };
    document.addEventListener('mousemove', handlePotentialDragMove);
    document.addEventListener('mouseup', handlePotentialDragEnd);
  }, [handlePotentialDragMove, handlePotentialDragEnd, externalEditingActive]);

  const isJustFinished = useCallback(() => {
    const now = Date.now();
    return now - stateRef.current.lastFinishedAt < 300;
  }, []);

  return {
    isBoxSelecting,
    screenBoxSelection,
    handleMouseDown,
    isJustFinished,
  };
}

export default useBoxSelection;
