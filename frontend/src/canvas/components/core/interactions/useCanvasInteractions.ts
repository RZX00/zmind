import { useCallback, useRef, useState } from 'react';
import type { Canvas, CanvasNode, CanvasToolMode } from '../../../../types/canvas';
import { useCanvasContextMenu } from '../../../hooks/useCanvasContextMenu';
import { useCanvasStore } from '../../../stores/canvas.store';
import { createNodeAtPosition } from '../systems/NodeFactory';
import { isPositionInColumn } from '../../../utils/canvasUtils';
import { applyColumnLayout, adjustNodeSizeForColumn } from '../systems/ColumnLayout';

export interface UseCanvasInteractionsParams {
  editingNodeId: string | null;
  effectiveToolMode: CanvasToolMode | 'hand' | 'select';
  onToolModeChange?: (mode: CanvasToolMode) => void;
  dragThreshold?: number;
}

export interface UseCanvasInteractionsResult {
  // context menu
  contextMenu: ReturnType<typeof useCanvasContextMenu>['contextMenu'];
  handleContextMenu: ReturnType<typeof useCanvasContextMenu>['handleContextMenu'];
  hideContextMenu: ReturnType<typeof useCanvasContextMenu>['hideContextMenu'];

  // panning + right-drag
  isRightDragging: boolean; // always false (right-pan disabled)
  hasRightDragged: boolean; // always false (right-pan disabled)
  // left-hand panning state (for cursor feedback)
  isHandDragging: boolean;
  onPanningStart: (_: unknown, event: MouseEvent | any) => boolean | void;
  onPanning: (_: unknown, event: MouseEvent | any) => void;
  onPanningStop: () => void;

  // helpers
  shouldDisablePanning: (event: MouseEvent | React.MouseEvent | TouchEvent) => boolean;
  handleToolModeChange: (mode: CanvasToolMode) => void;
}

export default function useCanvasInteractions(
  params: UseCanvasInteractionsParams
): UseCanvasInteractionsResult {
  const { editingNodeId, effectiveToolMode, onToolModeChange, dragThreshold = 8 } = params;

  // Canvas + selections from store
  const canvas = useCanvasStore((s) => s.canvas);
  const selectionNodes = useCanvasStore((s) => s.selections.nodeIds);
  const selectionConnections = useCanvasStore((s) => s.selections.connectionIds);
  const editState = useCanvasStore((s) => s.editState);

  // Handlers wired to store operations
  const storeAddNode = useCanvasStore((s) => s.addNode);
  const storeSelectSingleNode = useCanvasStore((s) => s.selectSingleNode);
  const storeRemoveNode = useCanvasStore((s) => s.removeNode);
  const storeDuplicateNode = useCanvasStore((s) => s.duplicateNode);
  const storeUpdateNode = useCanvasStore((s) => s.updateNode);
  const storeRemoveConnection = useCanvasStore((s) => s.removeConnection);
  const storeEnterEdit = useCanvasStore((s) => s.enterEditMode);

  const { contextMenu, handleContextMenu, hideContextMenu } = useCanvasContextMenu({
    // 节点/画布上下文
    selectedNodes: Array.from(selectionNodes || new Set<string>()),
    nodes: canvas?.nodes || [],
    onDeleteNodes: (ids) => ids.forEach((id) => storeRemoveNode(id)),
    onDuplicateNodes: (ids) => ids.forEach((id) => storeDuplicateNode(id)),
    onEditNode: (id) => storeEnterEdit('node', id),
    onLockToggle: (id, locked) => storeUpdateNode(id, { locked }),
    onSizeChange: (id, size) => storeUpdateNode(id, { width: size.width, height: size.height }),
    onBatchSizeChange: (updates) => {
      updates.forEach((u) => storeUpdateNode(u.nodeId, { width: u.size.width, height: u.size.height }));
    },
    // 对齐操作（可选，留空不影响）
    // onAlignment: undefined,
    // 连线上下文
    selectedConnections: Array.from(selectionConnections || new Set<string>()),
    connections: canvas?.connections || [],
    onDeleteConnections: (ids) => ids.forEach((id) => storeRemoveConnection(id)),
    onEditConnection: (id) => storeEnterEdit('connection', id),
    // 画布上创建节点
    onCreateNode: (type, position) => {
      try {
        let node: CanvasNode;
        if (type === 'code') {
          node = createNodeAtPosition('code', { x: position.x, y: position.y }, canvas.id, { codeType: 'mermaid' });
        } else if (type === 'html') {
          node = createNodeAtPosition('code', { x: position.x, y: position.y }, canvas.id, { codeType: 'html' });
        } else {
          node = createNodeAtPosition(type as any, { x: position.x, y: position.y }, canvas.id);
        }

        // 若落点在列内且新建的不是列，则自动吸附并对该列布局
        const targetColumn = isPositionInColumn(canvas, position.x, position.y);
        if (targetColumn && (targetColumn as any).type === 'column' && node.type !== 'column') {
          const now = Date.now();
          // 将节点加入画布并更新列 children
          const nextCanvasBase = {
            ...canvas,
            nodes: [...(canvas?.nodes || []), node],
            updatedAt: now,
          } as Canvas;
          let updated: Canvas = nextCanvasBase;
          // 若列收起，先展开
          if ((targetColumn as any).isCollapsed) {
            updated = {
              ...updated,
              nodes: updated.nodes.map((n) => (n.id === targetColumn.id ? ({ ...n, isCollapsed: false, updatedAt: now } as CanvasNode) : n)),
              updatedAt: now,
            } as Canvas;
          }
          const newChildren = ((targetColumn.children || []).filter(Boolean)).concat(node.id);
          updated = {
            ...updated,
            nodes: updated.nodes.map((n) => (n.id === targetColumn.id ? ({ ...n, children: newChildren, updatedAt: now } as CanvasNode) : n)),
            updatedAt: now,
          } as Canvas;
          // 首次布局，得到列内容宽度
          updated = applyColumnLayout(updated, targetColumn.id);
          // 新建节点在列内：按列宽自适应高度
          updated = adjustNodeSizeForColumn(updated, node.id, node);
          // 高度变化后再次布局
          updated = applyColumnLayout(updated, targetColumn.id);
          // 直接设置画布，替代逐步更新，确保布局一次到位
          const setCanvas = useCanvasStore.getState().setCanvas;
          setCanvas(updated);
          storeSelectSingleNode(node.id);
        } else {
          // 非列内：保持原有流程
          storeAddNode(node);
          storeSelectSingleNode(node.id);
        }
      } catch (e) {
        // no-op: creation errors are non-fatal for menu
      }
    },
    // 组相关（保留为空实现）
    // onCreateGroup: undefined,
    // onUngroup: undefined,
    // onRenameGroup: undefined,
    // onSwitchGroupType: undefined,
    // onLeaveGroup: undefined,
    // groups: [],
    // 编辑模式状态
    isEditMode: editState?.mode !== 'none',
  });
  const setToolMode = useCanvasStore((s) => s.setToolMode);

  // right mouse drag state
  const [isRightDragging, setIsRightDragging] = useState(false);
  const [hasRightDragged, setHasRightDragged] = useState(false);
  const [isHandDragging, setIsHandDragging] = useState(false);
  const rightDragStartPos = useRef<{ x: number; y: number } | null>(null);

  const handleToolModeChange = useCallback((mode: CanvasToolMode) => {
    setToolMode(mode);
    onToolModeChange?.(mode);
  }, [onToolModeChange, setToolMode]);

  const shouldDisablePanning = useCallback((event: MouseEvent | React.MouseEvent | TouchEvent) => {
    const target = event.target as Element;
    const isNode = target.closest('[data-node-container]');
    return !!isNode;
  }, []);

  const onPanningStart = useCallback((_: unknown, event: any) => {
    // Right mouse: allow panning regardless of tool mode (unless editing or target should disable)
    if ('button' in event && event.button === 2) {
      if (editingNodeId || shouldDisablePanning(event)) {
        return false;
      }
      setIsRightDragging(true);
      rightDragStartPos.current = {
        x: 'clientX' in event ? event.clientX : 0,
        y: 'clientY' in event ? event.clientY : 0,
      };
      return true;
    }
    // Left mouse: only when in hand mode (e.g., holding Space)
    if (editingNodeId || effectiveToolMode !== 'hand' || shouldDisablePanning(event)) {
      return false;
    }
    setIsHandDragging(true);
    return true;
  }, [editingNodeId, effectiveToolMode, shouldDisablePanning]);

  const onPanning = useCallback((_: unknown, event: any) => {
    if (isRightDragging && !hasRightDragged && rightDragStartPos.current) {
      const clientX = 'clientX' in event ? event.clientX : 0;
      const clientY = 'clientY' in event ? event.clientY : 0;
      const dx = Math.abs(clientX - rightDragStartPos.current.x);
      const dy = Math.abs(clientY - rightDragStartPos.current.y);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= dragThreshold) {
        setHasRightDragged(true);
      }
    }
  }, [isRightDragging, hasRightDragged, dragThreshold]);

  const onPanningStop = useCallback(() => {
    setIsHandDragging(false);
    // Ensure right-drag flags remain false
    if (isRightDragging) setIsRightDragging(false);
    rightDragStartPos.current = null;
    if (hasRightDragged) setTimeout(() => setHasRightDragged(false), 50);
  }, [isRightDragging, hasRightDragged]);

  return {
    contextMenu,
    handleContextMenu,
    hideContextMenu,
    isRightDragging,
    hasRightDragged,
    isHandDragging,
    onPanningStart,
    onPanning,
    onPanningStop,
    shouldDisablePanning,
    handleToolModeChange,
  };
}
