import { useCallback, useEffect, useRef, useState } from 'react';
import type { Canvas, CanvasNode, CanvasToolMode, FontStyle } from '../../../../types/canvas';
import { isPositionInColumn, getNodeParentColumn } from '../../../utils/canvasUtils';
import { computeInsertionIndex, applyColumnLayout } from '../systems/ColumnLayout';
import { useCanvasStore } from '../../../stores/canvas.store';
import { getConnectionSettings } from '../../../stores/settings.store';
import { anchorFromParams } from '../../../utils/dynamicConnectionRenderer';
import { buildCanvasSnapshot, createGuidesController } from '../../../../application/guides';
import { getGuideOptions } from '../../../../infrastructure/guides/settingsRepository';
import { buildBaselineMap } from '../../../../infrastructure/guides/baselineProvider';
import type { DistanceHint, GuideLine, GuideSession } from '../../../../domain/guides';
import {
  autoSnapOrDetachOnDragEnd,
  findMindmapGroupForNode,
  tidyLayout,
  applyLayout,
  type MindmapDragPreview,
} from '../../../utils/mindmapLayout';

const SNAP_COMMIT_TOLERANCE_PX = 4;
const SNAP_PREVIEW_TOLERANCE_PX = 8;
const SNAP_MAX_DELTA_PX = 6;

export interface UseNodesDndParams {
  canvas: Canvas;
  updateCanvas: (canvas: Canvas) => void;
  selectedNodeIds: Set<string>;
  effectiveToolMode: CanvasToolMode | 'hand' | 'select';
  editingNodeId: string | null;
  isGroupActive: boolean;
  activeGroup: { nodeIds: Set<string> } | null;
  setGroupDragging: (dragging: boolean) => void;
  updateGroupBounds: (nodes: CanvasNode[]) => void;
  setDragPreview: (preview: MindmapDragPreview | null) => void;
  setSmartGuides?: (guides: GuideLine[] | null, distances?: DistanceHint[] | null, options?: { force?: boolean }) => void;
  fontStyle?: FontStyle;
  nodeRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  transientPositionsRef: React.MutableRefObject<Record<string, { x: number; y: number }>>;
  scheduleTransientFlush: () => void;
}

export interface UseNodesDndResult {
  dragInsertionIndex: number | null;
  dragSourceColumnId: string | null;
  sanitizeChildren: (children: string[]) => string[];
  handleDragStart: (nodeId: string) => void;
  handleNodePositionChange: (nodeId: string, position: { x: number; y: number }) => void;
  handleDragEnd: () => void;
}

export function useNodesDnd(params: UseNodesDndParams): UseNodesDndResult {
  const {
    canvas,
    updateCanvas,
    selectedNodeIds,
    effectiveToolMode,
    editingNodeId,
    isGroupActive,
    activeGroup,
    setGroupDragging,
    updateGroupBounds,
    setDragPreview,
    setSmartGuides,
    fontStyle,
    nodeRefs,
    transientPositionsRef,
    scheduleTransientFlush,
  } = params;

  // 小范围移动不算拖拽（与右键/点击体验对齐）
  const START_DRAG_THRESHOLD = 6;
  // 思维导图断开/吸附需要的最小有效移动距离（避免轻微移动触发断开）
  const MINDMAP_DETACH_MOVE_THRESHOLD = 12;
  const LEAVE_COLUMN_THRESHOLD = 20;

  const [dragInsertionIndex, setDragInsertionIndex] = useState<number | null>(null);
  const [dragSourceColumnId, setDragSourceColumnId] = useState<string | null>(null);
  const dragInsertionIndexRef = useRef<number | null>(null);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragLastPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartedRef = useRef(false);
  const selectionStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const guideFrameRef = useRef<number | null>(null);
  const guideSessionRef = useRef<GuideSession | null>(null);
  const guidesControllerRef = useRef<ReturnType<typeof createGuidesController> | null>(null);
  const lastDragDeltaRef = useRef<{ dx: number; dy: number; movingIds: string[] } | null>(null);

  // Modifier: Alt disables snapping
  const altPressedRef = useRef(false);
  const shiftPressedRef = useRef(false);
  // setup global listeners once
  try {
    useEffect(() => {
      if (typeof window === 'undefined') return;
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.altKey) altPressedRef.current = true;
        if (e.shiftKey) shiftPressedRef.current = true;
      };
      const onKeyUp = (e: KeyboardEvent) => {
        if (!e.altKey) altPressedRef.current = false;
        if (!e.shiftKey) shiftPressedRef.current = false;
      };
      const onBlur = () => {
        altPressedRef.current = false;
        shiftPressedRef.current = false;
      };
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      return () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
      };
    }, []);
  } catch {}

  // 列 children 去重/清洗（保持顺序、移除空、去重复）
  const sanitizeChildren = useCallback((children: string[]): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const id of children) {
      if (!id) continue;
      if (!seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    }
    return result;
  }, []);

  const handleDragStart = useCallback((nodeId: string) => {
    if (editingNodeId === nodeId) return;

    // 重置预览
    setDragPreview(null);
    try { setSmartGuides && setSmartGuides(null, null, { force: false }); } catch {}
    guideSessionRef.current = null;
    lastDragDeltaRef.current = null;

    const store = useCanvasStore.getState();
    store.startNodeDrag(nodeId);
    dragStartedRef.current = false;
    setDragInsertionIndex(null);
    selectionStartRef.current = new Map();
    const primaryIds = (selectedNodeIds.size > 0 && selectedNodeIds.has(nodeId))
      ? Array.from(selectedNodeIds)
      : [nodeId];
    const node = canvas.nodes.find((n) => n.id === nodeId);
    primaryIds.forEach((id) => {
      const n = canvas.nodes.find((nn) => nn.id === id);
      if (n) selectionStartRef.current.set(id, { x: n.x, y: n.y });
    });

    // 如果拖拽列节点，预先记录子节点起始位置以便一起瞬态移动
    if (node?.type === 'column') {
      (node.children || []).forEach((childId) => {
        if (!childId) return;
        const child = canvas.nodes.find((n) => n.id === childId);
        if (child) selectionStartRef.current.set(childId, { x: child.x, y: child.y });
      });
    }

    // 如果拖拽的节点属于激活群组，标记群组拖拽
    if (isGroupActive && activeGroup?.nodeIds.has(nodeId)) {
      setGroupDragging(true);
    }

    // 记录起点与起始父列
    if (node) {
      const parent = getNodeParentColumn(canvas, nodeId);
      setDragSourceColumnId(parent ? parent.id : null);
      dragStartPosRef.current = { x: node.x, y: node.y };
    } else {
      setDragSourceColumnId(null);
      dragStartPosRef.current = null;
    }
    dragLastPosRef.current = null;
    dragInsertionIndexRef.current = null;
  }, [editingNodeId, isGroupActive, activeGroup, setGroupDragging, canvas, setDragPreview, selectedNodeIds, setSmartGuides]);

  const handleNodePositionChange = useCallback((nodeId: string, position: { x: number; y: number }) => {
    if (effectiveToolMode === 'hand') return;

    const nodeIndex = canvas?.nodes?.findIndex((n) => n.id === nodeId) ?? -1;
    if (nodeIndex === -1) return;
    const baseNode = canvas.nodes[nodeIndex];
    if (!baseNode) return;

    if (dragStartPosRef.current) {
      const dist = Math.hypot(position.x - dragStartPosRef.current.x, position.y - dragStartPosRef.current.y);
      if (!dragStartedRef.current && dist >= START_DRAG_THRESHOLD) {
        dragStartedRef.current = true;
      }
    }

    const primaryIds =
      selectedNodeIds.size > 1 && selectedNodeIds.has(nodeId)
        ? Array.from(selectedNodeIds)
        : [nodeId];

    const anchor = selectionStartRef.current.get(nodeId) || { x: baseNode.x, y: baseNode.y };
    const deltaX = position.x - anchor.x;
    const deltaY = position.y - anchor.y;

    const allowColumnLogic = baseNode.type === 'column' || dragStartedRef.current;
    let targetColumn: CanvasNode | null = null;
    let insertionIndex: number | null = null;
    const logicPos = transientPositionsRef.current[nodeId] || position;
    if (allowColumnLogic && baseNode.type !== 'column') {
      targetColumn = isPositionInColumn(canvas, logicPos.x + baseNode.width / 2, logicPos.y + baseNode.height / 2);
      useCanvasStore.getState().updateNodeDrag(targetColumn?.id || null);

      if (targetColumn && targetColumn.type === 'column') {
        const children = (targetColumn.children || [])
          .filter(Boolean)
          .filter((id, idx, arr) => arr.indexOf(id) === idx)
          .filter((id) => !primaryIds.includes(id))
          .map((id) => canvas.nodes.find((n) => n.id === id))
          .filter((n): n is CanvasNode => !!n);
        const pointerY = logicPos.y + baseNode.height;
        insertionIndex = computeInsertionIndex(targetColumn, children, pointerY);
      }
    } else {
      useCanvasStore.getState().updateNodeDrag(null);
    }
    dragLastPosRef.current = { x: position.x, y: position.y };
    setDragInsertionIndex(insertionIndex);
    dragInsertionIndexRef.current = insertionIndex;

    const movingIdSet = new Set<string>(primaryIds);
    if (baseNode.type === 'column') {
      (baseNode.children || []).forEach((childId) => {
        if (childId) movingIdSet.add(childId);
      });
    }
    const movingIds = Array.from(movingIdSet);
    lastDragDeltaRef.current = { dx: deltaX, dy: deltaY, movingIds };

    const nodesById = new Map(canvas.nodes.map((n) => [n.id, n]));
    const applyDeltaToMoving = (ids: string[], dx: number, dy: number) => {
      ids.forEach((id) => {
        const start = selectionStartRef.current.get(id) || (() => {
          const found = nodesById.get(id);
          return found ? { x: found.x, y: found.y } : { x: 0, y: 0 };
        })();
        const next = { x: start.x + dx, y: start.y + dy };
        const el = nodeRefs.current.get(id);
        const orig = nodesById.get(id);
        if (el && orig) {
          el.style.transform = `translate(${next.x - orig.x}px, ${next.y - orig.y}px)`;
        }
        transientPositionsRef.current[id] = next;
      });
    };

    applyDeltaToMoving(movingIds, deltaX, deltaY);

    scheduleTransientFlush();

    if (!guideFrameRef.current) {
      guideFrameRef.current = requestAnimationFrame(() => {
        guideFrameRef.current = null;
        try {
          const latest = lastDragDeltaRef.current;
          if (!latest) {
            setSmartGuides?.(null, null, { force: false });
            return;
          }
          const { dx, dy, movingIds: latestMovingIds } = latest;
          const options = getGuideOptions(altPressedRef.current);
          const precisionMode = shiftPressedRef.current;
          const shouldPreview = precisionMode || options.showLines;
          if (!options.enabled || options.modifierDisabled || !shouldPreview) {
            setSmartGuides?.(null, null, { force: false });
            guideSessionRef.current = null;
            return;
          }
          const scale = useCanvasStore.getState().viewState?.transform?.scale || 1;
          const previewOptions = { ...options, tolerancePx: precisionMode ? SNAP_PREVIEW_TOLERANCE_PX : options.tolerancePx };
          const baselineById = previewOptions.allowBaseline ? buildBaselineMap(canvas.nodes || [], fontStyle) : undefined;
          const canvasSnapshot = buildCanvasSnapshot(canvas.nodes || [], scale, { baselineById });
          const liveNodesById = new Map(canvas.nodes.map((n) => [n.id, n]));
          const selectionRect = (() => {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const id of latestMovingIds) {
              const node = liveNodesById.get(id);
              if (!node) continue;
              const start = selectionStartRef.current.get(id) || { x: node.x, y: node.y };
              const x = start.x + dx;
              const y = start.y + dy;
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x + node.width);
              maxY = Math.max(maxY, y + node.height);
            }
            if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
              return null;
            }
            return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
          })();

          if (!selectionRect) {
            setSmartGuides?.(null, null, { force: false });
            guideSessionRef.current = null;
            return;
          }

          if (!guidesControllerRef.current) {
            guidesControllerRef.current = createGuidesController();
          }
          if (!guideSessionRef.current) {
            guideSessionRef.current = guidesControllerRef.current.startDrag({ ids: latestMovingIds, rect: selectionRect });
          }

          const plan = guidesControllerRef.current.moveDrag(
            guideSessionRef.current,
            canvasSnapshot,
            { ids: latestMovingIds, rect: selectionRect },
            previewOptions
          );

          setSmartGuides?.(
            plan.guideLines || [],
            previewOptions.showDistance ? (plan.distances || []) : null,
            { force: precisionMode }
          );
          return;
        } catch {
          setSmartGuides?.(null, null, { force: false });
        }
      });
    }

    if (activeGroup && isGroupActive) {
      try {
        const nodesWithTransient = canvas.nodes.map((n) =>
          transientPositionsRef.current[n.id]
            ? ({ ...(n as any), x: transientPositionsRef.current[n.id].x, y: transientPositionsRef.current[n.id].y } as CanvasNode)
            : n
        );
        updateGroupBounds(nodesWithTransient);
      } catch {}
    }
  }, [effectiveToolMode, canvas, selectedNodeIds, isGroupActive, activeGroup, scheduleTransientFlush, nodeRefs, transientPositionsRef, setSmartGuides, updateGroupBounds, fontStyle]);

  const handleDragEnd = useCallback(() => {
    const store = useCanvasStore.getState();
    const draggingNodeId = store.interactionState.draggingNodeId;
    if (draggingNodeId) {
      const draggingNode = canvas.nodes.find((n) => n.id === draggingNodeId);
      const isColumnNode = draggingNode?.type === 'column';
      const nodeActive = isColumnNode || dragStartedRef.current;
      if (!nodeActive) {
        // 未达到拖拽阈值，视为点击，不做思维导图连接变更
        Object.keys(transientPositionsRef.current).forEach((id) => {
          const el = nodeRefs.current.get(id);
          if (el) el.style.transform = '';
        });
        transientPositionsRef.current = {};
        scheduleTransientFlush();
        setSmartGuides?.(null, null, { force: false });
        setDragPreview(null);
        setDragSourceColumnId(null);
        dragStartPosRef.current = null;
        dragStartedRef.current = false;
        guideSessionRef.current = null;
        setDragInsertionIndex(null);
        dragInsertionIndexRef.current = null;
        store.endNodeDrag();
        store.updateNodeDrag(null);
        return;
      }

      const endPos =
        transientPositionsRef.current[draggingNodeId] ||
        dragLastPosRef.current ||
        (draggingNode ? { x: draggingNode.x, y: draggingNode.y } : dragStartPosRef.current);

      const dragTargetColumnId = store.interactionState.dragTargetColumnId;

      // 延迟一次提交：先清理变换，再统一构建最终画布
      const transient = { ...transientPositionsRef.current };
      Object.entries(transient).forEach(([id, pos]) => {
        const el = nodeRefs.current.get(id);
        if (el) el.style.transform = '';
      });
      transientPositionsRef.current = {};
      scheduleTransientFlush();
      setSmartGuides?.(null, null, { force: false });
      setDragPreview(null);

      try {
        const latest = lastDragDeltaRef.current;
        const movingIds = (() => {
          if (latest?.movingIds?.length) return latest.movingIds;
          const base =
            selectedNodeIds.size > 1 && selectedNodeIds.has(draggingNodeId)
              ? Array.from(selectedNodeIds)
              : [draggingNodeId];
          if (draggingNode?.type === 'column') {
            (draggingNode.children || []).forEach((childId) => {
              if (childId) base.push(childId);
            });
          }
          return Array.from(new Set(base));
        })();

        if (movingIds.length > 0) {
          const baseOptions = getGuideOptions(altPressedRef.current, { tolerancePx: SNAP_COMMIT_TOLERANCE_PX });
          if (baseOptions.enabled && !baseOptions.modifierDisabled) {
            const scale = useCanvasStore.getState().viewState?.transform?.scale || 1;
            const s = Math.max(scale, 0.01);
            const commitTol = SNAP_COMMIT_TOLERANCE_PX / s;
            const maxDelta = SNAP_MAX_DELTA_PX / s;
            const baselineById = baseOptions.allowBaseline ? buildBaselineMap(canvas.nodes || [], fontStyle) : undefined;
            const canvasSnapshot = buildCanvasSnapshot(canvas.nodes || [], scale, { baselineById });
            const nodesById = new Map(canvas.nodes.map((n) => [n.id, n]));
            const selectionRect = (() => {
              let minX = Infinity;
              let minY = Infinity;
              let maxX = -Infinity;
              let maxY = -Infinity;
              for (const id of movingIds) {
                const node = nodesById.get(id);
                if (!node) continue;
                const pos = transient[id] || { x: node.x, y: node.y };
                minX = Math.min(minX, pos.x);
                minY = Math.min(minY, pos.y);
                maxX = Math.max(maxX, pos.x + node.width);
                maxY = Math.max(maxY, pos.y + node.height);
              }
              if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
                return null;
              }
              return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
            })();

            if (selectionRect) {
              if (!guidesControllerRef.current) {
                guidesControllerRef.current = createGuidesController();
              }
              const snapSession =
                guideSessionRef.current ||
                guidesControllerRef.current.startDrag({ ids: movingIds, rect: selectionRect });

              const plan = guidesControllerRef.current.moveDrag(
                snapSession,
                canvasSnapshot,
                { ids: movingIds, rect: selectionRect },
                baseOptions
              );

              const snapDx = Math.abs(plan.delta.x) <= commitTol && Math.abs(plan.delta.x) <= maxDelta ? plan.delta.x : 0;
              const snapDy = Math.abs(plan.delta.y) <= commitTol && Math.abs(plan.delta.y) <= maxDelta ? plan.delta.y : 0;
              if (snapDx !== 0 || snapDy !== 0) {
                for (const id of movingIds) {
                  const node = nodesById.get(id);
                  if (!node) continue;
                  const pos = transient[id] || { x: node.x, y: node.y };
                  transient[id] = { x: pos.x + snapDx, y: pos.y + snapDy };
                }
              }
            }
          }
        }
      } catch {}

      const now = Date.now();
      let nextCanvas = { ...canvas } as Canvas;

      // 应用节点最终位置
      if (Object.keys(transient).length) {
        nextCanvas = {
          ...nextCanvas,
          nodes: (nextCanvas.nodes || []).map((n) => transient[n.id] ? ({ ...(n as any), x: transient[n.id].x, y: transient[n.id].y, updatedAt: now } as CanvasNode) : n),
          updatedAt: now,
        };
      }

      // 列内/跨列插入一次性处理
      if (dragTargetColumnId) {
        const targetColumn = nextCanvas.nodes.find((n) => n.id === dragTargetColumnId);
        if (targetColumn && targetColumn.type === 'column') {
          const draggingNode = nextCanvas.nodes.find((n) => n.id === draggingNodeId);
          if (draggingNode && draggingNode.type !== 'column') {
            const sourceParentId = dragSourceColumnId;
            const isSameColumn = sourceParentId === targetColumn.id;
            const childrenList = sanitizeChildren((targetColumn.children || []).filter(Boolean));
            const effectiveChildren = isSameColumn ? childrenList.filter((id) => id !== draggingNodeId) : childrenList.slice();
            const insertionFromState = typeof dragInsertionIndexRef.current === 'number' ? dragInsertionIndexRef.current : effectiveChildren.length;
            const insertion = Math.max(0, Math.min(insertionFromState, effectiveChildren.length));
            let newTargetChildren: string[];
            if (isSameColumn) {
              const original = childrenList.filter(Boolean);
              const filtered = original.filter((id) => id !== draggingNodeId);
              filtered.splice(insertion, 0, draggingNodeId);
              newTargetChildren = sanitizeChildren(filtered);
            } else {
              const base = childrenList.slice();
              base.splice(insertion, 0, draggingNodeId);
              newTargetChildren = sanitizeChildren(base);
            }
            nextCanvas = {
              ...nextCanvas,
              nodes: nextCanvas.nodes.map((n) => {
                if (n.id === targetColumn.id) return { ...n, children: newTargetChildren, updatedAt: now } as CanvasNode;
                if (!isSameColumn && dragSourceColumnId && n.id === dragSourceColumnId) {
                  const cleaned = sanitizeChildren((n.children || []).filter((id) => id !== draggingNodeId));
                  return { ...n, children: cleaned, updatedAt: now } as CanvasNode;
                }
                return n;
              }),
              updatedAt: now,
            };
            nextCanvas = applyColumnLayout(nextCanvas, targetColumn.id);
            if (!isSameColumn && dragSourceColumnId) {
              nextCanvas = applyColumnLayout(nextCanvas, dragSourceColumnId);
            }
          }
        }
      } else {
        const srcId = dragSourceColumnId;
        if (srcId && endPos && dragStartPosRef.current) {
          const dx = endPos.x - dragStartPosRef.current.x;
          const dy = endPos.y - dragStartPosRef.current.y;
          const dist = Math.hypot(dx, dy);
          if (dist >= LEAVE_COLUMN_THRESHOLD) {
            nextCanvas = {
              ...nextCanvas,
              nodes: nextCanvas.nodes.map((n) => {
                if (n.id === srcId) {
                  const cleaned = sanitizeChildren((n.children || []).filter((id) => id !== draggingNodeId));
                  return { ...n, children: cleaned, updatedAt: now } as CanvasNode;
                }
                return n;
              }),
              updatedAt: now,
            };
            nextCanvas = applyColumnLayout(nextCanvas, srcId);
          }
        }
      }

      updateCanvas(nextCanvas);
      if (isGroupActive) {
        try {
          updateGroupBounds(nextCanvas.nodes);
        } catch {}
      }
    }

    // 思维导图：拖拽结束后自动吸附/断开；需达到最小有效移动距离
    try {
      const draggingNodeId = useCanvasStore.getState().interactionState.draggingNodeId;
      if (draggingNodeId) {
        const start = dragStartPosRef.current;
        const endNode = canvas.nodes.find((n) => n.id === draggingNodeId);
        const movedDist = (start && endNode) ? Math.hypot((endNode.x - start.x), (endNode.y - start.y)) : 0;
        if (movedDist >= MINDMAP_DETACH_MOVE_THRESHOLD) {
          const changed = autoSnapOrDetachOnDragEnd(draggingNodeId as string);
          if (!changed) {
            const latestCanvas = useCanvasStore.getState().canvas;
            const group = findMindmapGroupForNode(latestCanvas, draggingNodeId as string);
            if (group) {
              const node = latestCanvas.nodes.find((n) => n.id === draggingNodeId);
              if (node && !(node as any).parentGroupId) {
                // 补全历史数据缺失的 parentGroupId，保障导图判定/连线样式/后续布局
                useCanvasStore.getState().updateNode(node.id, { parentGroupId: group.id } as any);
              }
              const result = tidyLayout(latestCanvas, group.id);
              applyLayout(result);
            }
          }
        }
      }
    } catch {}

    // 在节点拖拽结束后：统一用 anchorParams 反解 curveAnchor（保持冗余一致，保证保存/刷新稳定）
    try {
      const latest = useCanvasStore.getState().canvas;
      const settings = getConnectionSettings();
      const nodesById = new Map<string, CanvasNode>((latest.nodes || []).map(n => [n.id, n]));
      const H_TOL = 10;
      const sidePoint = (n: any, side: 'left'|'right'|'top'|'bottom') => {
        const cx = n.x + n.width / 2, cy = n.y + n.height / 2;
        if (side === 'left') return { x: cx - n.width / 2, y: cy };
        if (side === 'right') return { x: cx + n.width / 2, y: cy };
        if (side === 'top') return { x: cx, y: cy - n.height / 2 };
        return { x: cx, y: cy + n.height / 2 };
      };
      let changed = false;
      const nextConns = (latest.connections || []).map((c) => {
        const anyC: any = c as any;
        if (!anyC.from || !anyC.to || anyC.fromPoint || anyC.toPoint) return c;
        const ap = anyC.anchorParams as { u:number; v:number } | undefined;
        if (!ap || typeof ap.u !== 'number' || typeof ap.v !== 'number') return c;
        const fromNode = nodesById.get(anyC.from);
        const toNode = nodesById.get(anyC.to);
        if (!fromNode || !toNode) return c;
        const cA = { x: fromNode.x + fromNode.width / 2, y: fromNode.y + fromNode.height / 2 };
        const cB = { x: toNode.x + toNode.width / 2, y: toNode.y + toNode.height / 2 };
        const sameGroup = (fromNode as any).parentGroupId && (toNode as any).parentGroupId && (fromNode as any).parentGroupId === (toNode as any).parentGroupId;
        const groupNode = sameGroup ? (latest.nodes || []).find(n => n.id === (fromNode as any).parentGroupId && (n as any).type === 'group') as any : null;
        const forceSide = Boolean(groupNode && groupNode.groupMode === 'mindmap');
        const override = (((c as any).appearance?.endpointStrategy) as 'center-ray'|'side-midpoints'|undefined);
        const strategy = (forceSide || override === 'side-midpoints' || (!override && settings.endpointStrategy === 'side-midpoints')) ? 'side-midpoints' : 'center-ray';
        let P0 = cA, P3 = cB;
        if (strategy === 'side-midpoints') {
          const fromLeft = fromNode.x, fromRight = fromNode.x + fromNode.width;
          const toLeft = toNode.x, toRight = toNode.x + toNode.width;
          let gapX = 0;
          if (cB.x >= cA.x) gapX = Math.max(0, toLeft - fromRight); else gapX = Math.max(0, fromLeft - toRight);
          let fromSide: 'left'|'right'|'top'|'bottom';
          let toSide: 'left'|'right'|'top'|'bottom';
          if (gapX > H_TOL) { const dx = cB.x - cA.x; fromSide = dx >= 0 ? 'right' : 'left'; toSide = dx >= 0 ? 'left' : 'right'; }
          else { const dy = cB.y - cA.y; fromSide = dy >= 0 ? 'bottom' : 'top'; toSide = dy >= 0 ? 'top' : 'bottom'; }
          P0 = sidePoint(fromNode, fromSide);
          P3 = sidePoint(toNode, toSide);
        }
        const newAnchor = anchorFromParams(P0, P3, ap);
        if (!anyC.curveAnchor || Math.hypot(newAnchor.x - anyC.curveAnchor.x, newAnchor.y - anyC.curveAnchor.y) > 0.1) {
          changed = true;
          return { ...(c as any), curveAnchor: newAnchor } as any;
        }
        return c;
      });
      if (changed) {
        updateCanvas({ ...latest, connections: nextConns, updatedAt: Date.now() });
      }
    } catch {}

    // 结束清理
    const store2 = useCanvasStore.getState();
    store2.endNodeDrag();
    store2.updateNodeDrag(null);
    setDragInsertionIndex(null);
    setDragSourceColumnId(null);
    dragStartPosRef.current = null;
    dragStartedRef.current = false;
    setDragPreview(null);
    try { setSmartGuides && setSmartGuides(null, null, { force: false }); } catch {}
    guideSessionRef.current = null;
  }, [canvas, updateCanvas, sanitizeChildren, setDragPreview, dragSourceColumnId, isGroupActive, updateGroupBounds, setSmartGuides, nodeRefs, scheduleTransientFlush, transientPositionsRef, selectedNodeIds, fontStyle]);

  return {
    dragInsertionIndex,
    dragSourceColumnId,
    sanitizeChildren,
    handleDragStart,
    handleNodePositionChange,
    handleDragEnd,
  };
}

export default useNodesDnd;
