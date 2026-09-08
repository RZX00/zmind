import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import type { Canvas } from '../../types/canvas';
import OutlineTreeGroup from './OutlineTreeGroup';
import { buildOutlineTree, buildAnchorExpansions } from '../../stores/outlineSelectors';
import { setAllTodoLinesState } from '../../utils/todoUtils';
import { buildNodeRelationSummary } from '../../application/outline/build-node-relation-summary';
import { useCanvasStore } from '../../stores/canvas.store';
import RelationDrawer from './outline/RelationDrawer';
import './outline.css';

interface OutlineViewProps {
  canvas: Canvas;
  onNodeSelect?: (nodeId: string) => void;
  onClose?: () => void;
  readOnly?: boolean;
  onOutlineToggle?: (open: boolean) => void;
}

const OutlineView: React.FC<OutlineViewProps> = ({ canvas, onNodeSelect, onClose, readOnly = false, onOutlineToggle }) => {
  const { updateNode, selectNode } = useCanvasStore();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 24, y: 96 });
  const [activeRelationNodeId, setActiveRelationNodeId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const tree = useMemo(() => buildOutlineTree(canvas), [canvas]);
  const expansions = useMemo(() => buildAnchorExpansions(canvas), [canvas]);
  const relationMap = useMemo(() => buildNodeRelationSummary(canvas), [canvas]);

  useEffect(() => {
    try {
      const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
      setPosition({ x: Math.max(12, w - 460), y: 96 });
    } catch {}
    try { onOutlineToggle?.(true); } catch {}
    return () => { try { onOutlineToggle?.(false); } catch {} };
  }, [onOutlineToggle]);

  const handleToggleTodo = useCallback((id: string, completed: boolean) => {
    if (readOnly) return;
    const node = (canvas.nodes || []).find(n => n.id === id);
    if (!node) return;
    const nextContent = setAllTodoLinesState(node.content || '', completed);
    updateNode(id, { content: nextContent, completed });
  }, [canvas.nodes, updateNode, readOnly]);

  const handleEditTitle = useCallback((id: string, newTitle: string) => {
    if (readOnly) return;
    const node = (canvas.nodes || []).find(n => n.id === id);
    if (!node) return;
    const trimmed = (newTitle || '').trim();
    // 规则：
    // - canvas-link：写入 title
    // - group/column/其他：改写 content 的首行
    if (node.type === 'canvas-link') {
      updateNode(id, { title: trimmed });
    } else {
      const content = node.content || '';
      const idx = content.indexOf('\n');
      const rest = idx === -1 ? '' : content.slice(idx);
      updateNode(id, { content: trimmed + (rest || '') });
    }
  }, [canvas.nodes, updateNode, readOnly]);

  const handleJump = useCallback((id: string) => {
    selectNode(id);
    try {
      const node = (canvas.nodes || []).find(n => n.id === id);
      if (node && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('canvas:focus-bbox', {
          detail: {
            x: node.x,
            y: node.y,
            w: node.width,
            h: node.height,
            padding: 16,
            keepScale: true
          }
        }));
      }
    } catch {}
    onNodeSelect?.(id);
    // outline-only view: selecting updates store; when switching回到画布可直接定位
  }, [selectNode, onNodeSelect, canvas.nodes]);

  const handleToggleCollapse = useCallback((id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleOpenRelations = useCallback((id: string) => {
    setActiveRelationNodeId(id);
  }, []);

  const handleCloseRelations = useCallback(() => {
    setActiveRelationNodeId(null);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = panelRef.current?.getBoundingClientRect();
    const offsetX = startX - (rect?.left ?? position.x);
    const offsetY = startY - (rect?.top ?? position.y);
    const onMove = (ev: PointerEvent) => {
      const nx = ev.clientX - offsetX;
      const ny = ev.clientY - offsetY;
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
      const w = panelRef.current?.offsetWidth ?? 420;
      const h = panelRef.current?.offsetHeight ?? 640;
      const clampedX = Math.min(Math.max(8, nx), Math.max(8, vw - w - 8));
      const clampedY = Math.min(Math.max(8, ny), Math.max(8, vh - h - 8));
      setPosition({ x: clampedX, y: clampedY });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [position.x, position.y]);

  return (
    <div
      ref={panelRef}
      className="fixed z-[120] w-[420px] max-h-[80vh] text-foreground font-sans outline-panel shadow-2xl backdrop-blur-lg bg-background/80 border border-border rounded-[var(--canvas-panel-radius)] overflow-hidden"
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="outline-drag-handle flex items-center justify-between px-4 py-3 bg-muted/60 border-b border-border cursor-move select-none"
        onPointerDown={handlePointerDown}
      >
        <span className="text-sm font-semibold">大纲</span>
        <div className="flex items-center gap-2">
          {readOnly && <span className="text-[11px] text-muted-foreground">只读</span>}
          <button
            className="outline-no-drag p-1 rounded-md hover:bg-muted"
            onClick={() => onClose?.()}
            aria-label="Close outline"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="outline-no-drag overflow-y-auto max-h-[calc(80vh-52px)] px-4 py-3 space-y-2">
        {tree.map(node => (
          <OutlineTreeGroup
            key={node.id}
            canvas={canvas}
            node={node}
            collapsed={collapsed}
            expansions={expansions}
            relationMap={relationMap}
            onToggle={handleToggleCollapse}
            onToggleTodo={handleToggleTodo}
            onEditTitle={handleEditTitle}
            onJump={handleJump}
            onOpenRelations={handleOpenRelations}
            allowEdit={!readOnly}
          />
        ))}
      </div>
      <RelationDrawer
        nodeId={activeRelationNodeId}
        relationMap={relationMap}
        onClose={handleCloseRelations}
        onJumpToNode={handleJump}
      />
    </div>
  );
};

export default OutlineView;
