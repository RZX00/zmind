'use client';

import React from 'react';
import type { Canvas, CanvasNode, CanvasToolMode, CornerStyle, FontStyle } from '../../../../types/canvas';
import NodeContainer from '../../nodes/shared/NodeContainer';
import { isNodeInMindmap } from '../../../utils/mindmap';
import type { MindmapDragPreview } from '../../../utils/mindmapLayout';
import type { ResizeHandle } from '../../../../domain/guides';

export interface NodesLayerProps {
  canvas: Canvas;
  visibleNodes: CanvasNode[];
  selectedNodeIds: Set<string>;
  previewSelectedNodes: Set<string>;
  editingNodeId: string | null;
  isConnecting: boolean;
  hoveredNodeId: string | null;
  setHoveredNodeId: (id: string | null) => void;
  effectiveToolMode: CanvasToolMode | 'hand' | 'select';
  cornerStyle: CornerStyle;
  fontStyle: FontStyle;
  draggingNodeId: string | null;
  dragTargetColumnId: string | null;
  dragInsertionIndex: number | null;
  dragSourceColumnId: string | null;
  playState: 'idle' | 'playing' | 'paused';
  playbackFocusId: string | null;
  dragPreview: MindmapDragPreview | null;
  // 临时群组拖拽相关
  isGroupActive?: boolean;
  activeGroupNodeIds?: Set<string> | null;
  onNodeGroupDragStart?: (e: React.MouseEvent, nodeId: string) => void;
  getNodeParentColumn: (c: Canvas, id: string) => CanvasNode | null;
  sanitizeChildren: (ids: string[]) => string[];
  computeInsertionIndex: (column: CanvasNode, children: CanvasNode[], pointerY: number) => number;
  onConnectionEnd: (nodeId: string) => void;
  onContextMenuForNode: (e: React.MouseEvent, nodeId: string) => void;
  onNodeSelect: (nodeId: string, multi?: boolean) => void;
  onNodeEdit: (nodeId: string) => void;
  onContentChange: (nodeId: string, content: string) => void;
  onNodePositionChange: (nodeId: string, pos: { x: number; y: number }) => void;
  onNodeSizeChange: (
    nodeId: string,
    size: { width: number; height: number },
    options?: { fromResize?: boolean; resizeHandle?: ResizeHandle }
  ) => void;
  onAutoSizeModeChange: (nodeId: string, mode: 'auto' | 'manual') => void;
  onConnectionStart: (
    e: React.MouseEvent | MouseEvent,
    nodeId: string,
    side: 'top' | 'right' | 'bottom' | 'left',
    handleScreenPosition?: { x: number; y: number },
  ) => void;
  onLockToggle: (nodeId: string, locked: boolean) => void;
  onTableCellCommit?: (nodeId: string, row: number, col: number, value: string) => void;
  onTableRowOp?: (nodeId: string, action: 'insert' | 'delete', index: number) => void;
  onTableColOp?: (nodeId: string, action: 'insert' | 'delete', index: number) => void;
  onDragStart: (nodeId: string) => void;
  onDragEnd: () => void;
  onColumnTitleChange: (nodeId: string, title: string) => void;
  onColumnToggleCollapse: (nodeId: string) => void;
  onDropNodeToColumn: (columnId: string, nodeId: string) => void;
  renderNodeContent: (node: CanvasNode) => React.ReactNode;
  onChildNodeSelect: (nodeId: string) => void;
  onChildNodeDragStart: (nodeId: string, columnId: string, popupPosition?: { x: number; y: number }) => void;
  onCanvasNavigate: (targetCanvasId: string, canvasName?: string) => void;
  onRefreshThumbnail: (nodeId: string) => void;
  onCreateCanvas: (name: string) => Promise<string>;
  onGetAvailableCanvases: () => Promise<Array<{ id: string; title: string; lastUpdated: number }>>;
  setWheelLocked: (locked: boolean) => void;
  readOnly?: boolean;
  // When any global editing lock is active (e.g., group label editing), disable node dragging
  globalEditingLock?: boolean;
  // Resize end hook to allow canvas-level snapping logic
  onNodeResizeEnd: (nodeId: string) => void;
  // Overlap shadow hints for nodes (only nodes present with true will get boosted shadow)
  overlapShadowMap?: Record<string, boolean>;
  // 注册DOM引用，便于高性能拖拽阶段直接操作节点元素
  registerNodeRef: (nodeId: string, el: HTMLDivElement | null) => void;
}

const NodesLayer: React.FC<NodesLayerProps> = (props) => {
  const {
    canvas, visibleNodes, selectedNodeIds, previewSelectedNodes,
    editingNodeId, isConnecting, hoveredNodeId, setHoveredNodeId,
    effectiveToolMode, cornerStyle, fontStyle,
    draggingNodeId, dragTargetColumnId, dragInsertionIndex, dragSourceColumnId,
    playState, playbackFocusId, dragPreview,
    isGroupActive, activeGroupNodeIds, onNodeGroupDragStart,
    getNodeParentColumn, sanitizeChildren, computeInsertionIndex,
    onConnectionEnd, onContextMenuForNode, onNodeSelect, onNodeEdit, onContentChange,
    onNodePositionChange, onNodeSizeChange, onAutoSizeModeChange, onConnectionStart, onLockToggle,
    onTableCellCommit, onTableRowOp, onTableColOp,
    onDragStart, onDragEnd, onColumnTitleChange, onColumnToggleCollapse,
    onDropNodeToColumn, renderNodeContent, onChildNodeSelect, onChildNodeDragStart,
    onCanvasNavigate, onRefreshThumbnail, onCreateCanvas, onGetAvailableCanvases,
    setWheelLocked,
    globalEditingLock = false,
    onNodeResizeEnd,
    overlapShadowMap,
    registerNodeRef,
  } = props;

  return (
    <>
      {canvas.nodes?.length > 0 ? (
        visibleNodes.map((node) => {
          const dimmed = playState === 'playing' && playbackFocusId && node.id !== playbackFocusId;
          // 仅当节点属于思维导图群组时启用动效
          const enableMindmapMotion = isNodeInMindmap(canvas as any, node.id);
          return (
            <div
              key={node.id}
              data-node-container
              data-node-id={node.id}
              style={dimmed ? { opacity: 0.7, transition: 'none' } : { transition: 'none' }}
              onMouseUp={() => isConnecting && onConnectionEnd(node.id)}
              onContextMenu={node.type === 'table' ? undefined : (e) => onContextMenuForNode(e, node.id)}
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() => setHoveredNodeId(hoveredNodeId === node.id ? null : hoveredNodeId)}
            >
              <NodeContainer
                node={node}
                selected={selectedNodeIds.has(node.id) || previewSelectedNodes.has(node.id)}
                editing={editingNodeId === node.id}
                isConnecting={isConnecting}
                lineModeEnabled={effectiveToolMode === 'line'}
                isHovered={isConnecting && hoveredNodeId === node.id}
                isPreviewCandidate={dragPreview?.action === 'attach' && dragPreview?.candidateParent?.id === node.id}
                cornerStyle={cornerStyle}
                fontStyle={fontStyle}
                dragDisabled={!!props.readOnly || !!globalEditingLock}
                selectedNodes={Array.from(selectedNodeIds)}
                isDragLeader={draggingNodeId === node.id}
                anyDragging={!!draggingNodeId}
                enableMindmapMotion={enableMindmapMotion}
                isInActiveGroup={!!isGroupActive && !!activeGroupNodeIds && activeGroupNodeIds.has(node.id)}
                onGroupDragStart={onNodeGroupDragStart}
                hasOverlapShadow={!!overlapShadowMap && !!overlapShadowMap[node.id]}
                onSelect={onNodeSelect}
                onEdit={onNodeEdit}
                onPositionChange={onNodePositionChange}
                onSizeChange={onNodeSizeChange}
                onAutoSizeModeChange={onAutoSizeModeChange}
                onConnectionStart={onConnectionStart}
                onLockToggle={onLockToggle}
                onTableCellCommit={onTableCellCommit}
                onTableRowOp={onTableRowOp}
                onTableColOp={onTableColOp}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onResizeEnd={onNodeResizeEnd}
                childNodes={node.type === 'column' ? (() => {
                  const seen = new Set<string>();
                  const ordered = (node.children || []).filter((id): id is string => {
                    if (!id) return false;
                    if (seen.has(id)) return false;
                    seen.add(id);
                    return true;
                  });
                  return ordered
                    .map((childId) => canvas.nodes.find((n) => n.id === childId))
                    .filter((n): n is CanvasNode => !!n);
                })() : []}
                isDragTarget={node.type === 'column' && dragTargetColumnId === node.id}
                isDraggingNode={!!draggingNodeId && draggingNodeId !== node.id}
                inColumn={!!getNodeParentColumn(canvas, node.id)}
                columnRemoveTarget={!!draggingNodeId && (() => {
                  const parentOfDragging = getNodeParentColumn(canvas, draggingNodeId);
                  return !!parentOfDragging && parentOfDragging.id === node.id && (!dragTargetColumnId || dragTargetColumnId !== node.id);
                })()}
                insertionIndex={node.type === 'column' && dragTargetColumnId === node.id ? dragInsertionIndex ?? null : null}
                onContentChange={onContentChange}
                onEditToggle={onNodeEdit}
                onTitleChange={onColumnTitleChange}
                onToggleCollapse={onColumnToggleCollapse}
                onDropNode={onDropNodeToColumn}
                renderChildNode={(child) => renderNodeContent(child)}
                onChildNodeSelect={onChildNodeSelect}
                onChildNodeDragStart={onChildNodeDragStart}
                onCanvasNavigate={onCanvasNavigate}
                onRefreshThumbnail={onRefreshThumbnail}
                onCreateCanvas={onCreateCanvas}
                onGetAvailableCanvases={onGetAvailableCanvases}
                onWheelLockChange={setWheelLocked}
                readOnly={props.readOnly}
                registerNodeRef={registerNodeRef}
              >
                {renderNodeContent(node)}
              </NodeContainer>
            </div>
          );
        })
      ) : (
        null
      )}

      {dragTargetColumnId && dragInsertionIndex !== null && (() => {
        const targetColumn = canvas.nodes.find((n) => n.id === dragTargetColumnId);
        if (!targetColumn || targetColumn.type !== 'column') return null;
        const childrenIds = sanitizeChildren((targetColumn.children || []).filter(Boolean));
        const baseIds = (draggingNodeId && dragSourceColumnId === targetColumn.id)
          ? childrenIds.filter((id) => id !== draggingNodeId)
          : childrenIds.slice();
        if (baseIds.length === 0) return null;
        const prevIdIndex = Math.max(1, Math.min(dragInsertionIndex!, baseIds.length));
        const prevId = baseIds[prevIdIndex - 1];
        const prevNode = canvas.nodes.find((n) => n.id === prevId);
        if (!prevNode) return null;
        const prevH = Math.max(prevNode.height || 0, 1);
        const paddingX = 16;
        const left = targetColumn.x + paddingX;
        const width = Math.max(80, targetColumn.width - paddingX * 2);
        const top = prevNode.y + prevH + 2;
        return (
          <div className="absolute pointer-events-none" style={{ left, top, width, zIndex: 9999 }}>
            <div className="h-[2px] bg-blue-500" />
          </div>
        );
      })()}
    </>
  );
};

export default NodesLayer;
