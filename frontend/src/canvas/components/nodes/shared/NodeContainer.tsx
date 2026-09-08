// 🎯 节点容器组件
// 提供节点定位、中、调整大小等基础功能
'use client';

import React, { useRef, useCallback, useEffect } from 'react';
import { useTheme } from 'next-themes';
import type { CanvasNode, CornerStyle, FontStyle } from '../../../../types/canvas';
import type { ResizeHandle } from '../../../../domain/guides';
import { useTextLayoutPreset } from '../../../hooks/useTextNodePresets';
import { isAlphaCapableImageFormat } from '../../../utils/mediaUtils';

interface Position { x: number; y: number; }
interface Size { width: number; height: number; }
import { useDraggable } from '../../../hooks/useDraggable';
import ColumnContainer from './ColumnContainer';
import TableNode from '../table/TableNode';
import CanvasLinkNode from '../canvas-link/CanvasLinkNode';
import ShapeDecorationLayer from '../../shared/decorations/ShapeDecorationLayer';
import { computeTodoCompletion, setAllTodoLinesState } from '../../../utils/todoUtils';

interface NodeContainerProps {
  node: CanvasNode;
  selected?: boolean;
  editing?: boolean;
  isConnecting?: boolean;
  lineModeEnabled?: boolean;
  isHovered?: boolean; // 新增：是否被悬停（连线目标）
  isPreviewCandidate?: boolean; // 新增：是否是思维导图拖拽预览的父节点
  cornerStyle?: CornerStyle;
  fontStyle?: FontStyle;
  dragDisabled?: boolean;
  isDragLeader?: boolean;
  selectedNodes?: string[]; // 全局选中节点列表（可用于子组件同步）
  onSelect?: (nodeId: string, multiSelect?: boolean) => void;
  onEdit?: (nodeId: string) => void;
  onPositionChange?: (nodeId: string, position: Position) => void;
  onSizeChange?: (nodeId: string, size: Size, options?: { fromResize?: boolean; resizeHandle?: ResizeHandle }) => void;
  // 自动尺寸模式切换（临时）
  onAutoSizeModeChange?: (nodeId: string, mode: 'auto' | 'manual') => void;
  onConnectionStart?: (
    event: any,
    nodeId: string,
    handlePosition: 'top' | 'right' | 'bottom' | 'left',
    handleScreenPosition?: { x: number; y: number },
  ) => void;
  onLockToggle?: (nodeId: string, locked: boolean) => void;
  onTableCellCommit?: (nodeId: string, row: number, col: number, value: string) => void;
  onTableRowOp?: (nodeId: string, action: 'insert' | 'delete', index: number) => void;
  onTableColOp?: (nodeId: string, action: 'insert' | 'delete', index: number) => void;
  onDragStart?: (nodeId: string) => void;
  onDragEnd?: () => void;
  onResizeEnd?: (nodeId: string) => void;
  children: React.ReactNode;
  // 收集栏相关props
  childNodes?: CanvasNode[];
  isDragTarget?: boolean;
  isDraggingNode?: boolean;
  onContentChange?: (nodeId: string, content: string) => void;
  onEditToggle?: (nodeId: string, editing: boolean) => void;
  onTitleChange?: (nodeId: string, title: string) => void;
  onToggleCollapse?: (nodeId: string) => void;
  renderChildNode?: (childNode: CanvasNode) => React.ReactNode;
  onDropNode?: (columnId: string, droppedNodeId: string) => void;
  onChildNodeSelect?: (nodeId: string) => void;
  onChildNodeDragStart?: (nodeId: string, columnId: string, popupPosition?: { x: number; y: number }) => void;
  // 收纳态：在某收集栏中
  inColumn?: boolean;
  columnRemoveTarget?: boolean;
  // 列插入索引（用于插入线预览）
  insertionIndex?: number | null;
  // Canvas Link 相关
  onCanvasNavigate?: (targetCanvasId: string, canvasName?: string) => void;
  onRefreshThumbnail?: (nodeId: string) => void;
  onCreateCanvas?: (name: string) => Promise<string>;
  onGetAvailableCanvases?: () => Promise<Array<{id: string, title: string, lastUpdated: number}>>;
  // 🎯 群组拖拽相关
  isInActiveGroup?: boolean;
  onGroupDragStart?: (event: React.MouseEvent, nodeId: string) => void;
  // 🔒 当节点希望接管滚轮用于自身滚动时，知上层禁用画布缩放
  onWheelLockChange?: (locked: boolean) => void;
  anyDragging?: boolean;
  enableMindmapMotion?: boolean;
  // 是否处于遮挡态以加强阴影
  hasOverlapShadow?: boolean;
  // Read-only view hint to adjust cursors
  readOnly?: boolean;
  registerNodeRef?: (nodeId: string, el: HTMLDivElement | null) => void;
}

const NodeContainer: React.FC<NodeContainerProps> = ({
  node,
  selected = false,
  editing = false,
  isConnecting = false,
  lineModeEnabled = false,
  isHovered = false,
  isPreviewCandidate = false,
  cornerStyle,
  fontStyle,
  dragDisabled = false,
  selectedNodes,
  isDragLeader = false,
  onSelect,
  onEdit,
  onPositionChange,
  onSizeChange,
  onAutoSizeModeChange,
  onConnectionStart,
  onLockToggle,
  onTableCellCommit,
  onTableRowOp,
  onTableColOp,
  onDragStart,
  onDragEnd,
  onResizeEnd,
  children,
  // 收集栏相关props
  childNodes = [],
  isDragTarget = false,
  isDraggingNode = false,
  onContentChange,
  onEditToggle,
  onTitleChange,
  onToggleCollapse,
  renderChildNode,
  onDropNode,
  onChildNodeSelect,
  onChildNodeDragStart,
  inColumn = false,
  columnRemoveTarget = false,
  insertionIndex = null,
  // Canvas Link 相关
  onCanvasNavigate,
  onRefreshThumbnail,
  onCreateCanvas,
  onGetAvailableCanvases,
  // Todo节点相关
  // 🎯 群组拖拽相关
  isInActiveGroup = false,
  onGroupDragStart,
  onWheelLockChange
  , anyDragging = false
  , enableMindmapMotion = false
  , hasOverlapShadow = false
  , readOnly = false
  , registerNodeRef
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const textLayoutPreset = useTextLayoutPreset();
  const layoutMetrics = textLayoutPreset.metrics;
  const textStyles = (node as any).textStyles || {};

  // 立即禁用/恢复容器过渡，避免拖拽起始一帧的跟手延迟
  const disableContainerTransition = useCallback(() => {
    try {
      const el = containerRef.current;
      if (el) {
        el.style.transition = 'none';
      }
    } catch {}
  }, []);
  const restoreContainerTransition = useCallback(() => {
    try {
      const el = containerRef.current;
      if (el) {
        el.style.removeProperty('transition');
      }
    } catch {}
  }, []);

  // 将容器引用暴露给上层，便于拖拽阶段直接写 transform
  useEffect(() => {
    registerNodeRef?.(node.id, containerRef.current);
    return () => registerNodeRef?.(node.id, null);
  }, [node.id, registerNodeRef]);

  const getHeightConstraints = useCallback(() => {
    if (node.type === 'text' || node.type === 'todo') {
      const minHeight = inColumn ? 1 : layoutMetrics.minHeight;
      return { minHeight, maxHeight: undefined };
    }
    if (node.type === 'media') return { minHeight: 1, maxHeight: undefined };
    if (node.type === 'canvas-link') {
      const TITLE_H = 32; // 2xl 近似行高
      const STATUS_H = 18; // 状点区域近似高度
      const PADDING_Y = 16;
      const minHeight = Math.max(48, TITLE_H + STATUS_H + PADDING_Y * 2); // ~82
      return { minHeight, maxHeight: undefined };
    }
    // 其他普节点：保持原有默认
    if (node.type !== 'column') return { minHeight: 100, maxHeight: undefined };
    
    const headerHeight = 60;
    const paddingY = 16;
    const itemSpacing = 8;
    const emptyStateHeight = 64;
    
    // 如果收集栏是收起状，只需要标题区域的高度
    if (node.isCollapsed) {
      return { minHeight: headerHeight, maxHeight: headerHeight };
    }
    
    const childCount = childNodes.length;
    const childrenTotalHeight = childCount > 0
      ? childNodes.reduce((sum, c) => sum + Math.max(c.height || 0, 1), 0)
      : 0;
    const gapsHeight = childCount > 1 ? (childCount - 1) * itemSpacing : 0;
    const bodyHeight = childCount > 0
      ? childrenTotalHeight + gapsHeight
      : emptyStateHeight;
    
    const minHeight = headerHeight + paddingY * 2 + bodyHeight;
    
    return { minHeight, maxHeight: undefined };
  }, [node.type, node.isCollapsed, childNodes, inColumn, layoutMetrics.minHeight]);
  
  const heightConstraints = getHeightConstraints();
  
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'KeyD' && (event.ctrlKey || event.metaKey) && node.type === 'todo' && selected && !editing) {
        event.preventDefault();
        event.stopPropagation();
        const nextState = !computeTodoCompletion(node.content || '');
        const nextContent = setAllTodoLinesState(node.content || '', nextState);
        onContentChange?.(node.id, nextContent);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [node.type, node.id, selected, editing, node.content, onContentChange]);
  
  const lastSizeRef = useRef<{ width: number; height: number } | null>(null);
  
  useEffect(() => {
    if (node.type === 'column' && onSizeChange) {
      const currentHeight = node.height;
      const minRequiredHeight = heightConstraints.minHeight;
      const maxAllowedHeight = heightConstraints.maxHeight;
      
      let targetSize: { width: number; height: number } | null = null;
      
      if (node.isCollapsed && maxAllowedHeight) {
        targetSize = {
          width: node.width,
          height: maxAllowedHeight // 收起状下maxHeight就是标题高度
        };
      }
      // 如果是展弢状且当前高度小于朢小要求高度，自动调整
      else if (!node.isCollapsed && currentHeight < minRequiredHeight) {
        targetSize = {
          width: node.width,
          height: minRequiredHeight
        };
      }
      
      if (targetSize && 
          (!lastSizeRef.current || 
           lastSizeRef.current.width !== targetSize.width || 
           lastSizeRef.current.height !== targetSize.height)) {
        lastSizeRef.current = targetSize;
        onSizeChange(node.id, targetSize);
      }
    }
  }, [node.type, node.id, node.isCollapsed, node.width, node.height, heightConstraints.minHeight, heightConstraints.maxHeight, childNodes.length, onSizeChange]);
  
  const resizeStartRef = useRef<{ w: number; h: number } | null>(null);
  const resizeHandleRef = useRef<ResizeHandle | null>(null);

  // 🎯 箢化方案：直接使用现有的useDraggable，只优化requestAnimationFrame
  const { isDragging, isResizing, handleMouseDown: originalHandleMouseDown, handleResizeStart } = useDraggable({
    initialPosition: { x: node.x, y: node.y },
    initialSize: { width: node.width, height: node.height },
    disabled: editing || node.locked || dragDisabled || isInActiveGroup || lineModeEnabled,
    minHeight: heightConstraints.minHeight,
    ...(node.type === 'media' ? { minWidth: 1 } : {}),
    onPositionChange: (position) => onPositionChange?.(node.id, position),
    onSizeChange: (size) => {
      if (node.type === 'media') {
        const mt = (node as any).mediaType;
        const isExternalVideo = mt === 'video' && ((node as any).mediaSource === 'external' || (node as any).externalUrl || (node as any).embedUrl);
        if (!isExternalVideo && (mt === 'image' || mt === 'video')) {
          // 基于调整弢始时的初始尺寸计算统丢缩放因子
          // 若未能捕获起始尺寸，则化为当前尺寸作为基准
          const w0 = (resizeStartRef.current?.w ?? node.width) || 1;
          const h0 = (resizeStartRef.current?.h ?? node.height) || 1;
          const sW = size.width / w0;
          const sH = size.height / h0;
          let s = Math.max(sW, sH);
          if (!isFinite(s) || s <= 0) s = 1;
          const newW = Math.max(1, Math.round(w0 * s));
          const newH = Math.max(1, Math.round(h0 * s));
          onSizeChange?.(node.id, { width: newW, height: newH }, { fromResize: true, resizeHandle: resizeHandleRef.current || 'bottom-right' });
          return;
        }
      }

      if (node.type === 'column' || node.type === 'text' || node.type === 'todo') {
        const constrainedHeight = (() => {
          const minH = heightConstraints.minHeight;
          const maxH = heightConstraints.maxHeight;
          if (typeof maxH === 'number') {
            return Math.min(Math.max(size.height, minH), maxH);
          }
          return Math.max(size.height, minH);
        })();
        const constrainedSize = {
          width: size.width,
          height: constrainedHeight,
        };
        onSizeChange?.(node.id, constrainedSize, { fromResize: true, resizeHandle: resizeHandleRef.current || 'bottom-right' });
      } else {
        onSizeChange?.(node.id, size, { fromResize: true, resizeHandle: resizeHandleRef.current || 'bottom-right' });
      }
    },
    onDragStart: () => {
      if (!selected) {
        onSelect?.(node.id, false);
      }
      disableContainerTransition();
      onDragStart?.(node.id);
    },
    onDragEnd: () => {
      restoreContainerTransition();
      onDragEnd?.();
    },
    onResizeEnd: () => {
      resizeHandleRef.current = null;
      onResizeEnd?.(node.id);
    }
  });

  const resolveConnectionSide = useCallback((event: React.MouseEvent): 'top' | 'right' | 'bottom' | 'left' => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return 'right';
    }
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0 ? 'right' : 'left';
    }
    return dy >= 0 ? 'bottom' : 'top';
  }, []);

  const handleResizeStartWithMode = useCallback((e: React.MouseEvent) => {
    onAutoSizeModeChange?.(node.id, 'manual');
    disableContainerTransition();
    try {
      // 捕获起始尺寸
      resizeStartRef.current = { w: Math.max(1, node.width || 1), h: Math.max(1, node.height || 1) };
      resizeHandleRef.current = 'bottom-right';
    } catch {}
    handleResizeStart(e);
  }, [handleResizeStart, onAutoSizeModeChange, node.id, node.width, node.height, disableContainerTransition]);


  const shouldSkipDrag = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    if (target.closest('[data-node-interactive="true"]')) return true;
    const interactiveTags = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'LABEL'];
    if (interactiveTags.includes(target.tagName)) return true;
    if (target.closest('[contenteditable="true"]')) return true;
    return false;
  }, []);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if (lineModeEnabled && onConnectionStart) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      onConnectionStart(event.nativeEvent, node.id, resolveConnectionSide(event));
      return;
    }
    if (node.type === 'code' && (node as any).codeType === 'html') {
      const target = event.target as HTMLElement;
      const dragHandle = target?.closest('[data-html-node-drag-handle]');
      if (!dragHandle) {
        return;
      }
    }
    if (shouldSkipDrag(event.target)) {
      return;
    }
    if (isInActiveGroup && onGroupDragStart) {
      event.preventDefault();
      event.stopPropagation();
      onGroupDragStart(event, node.id);
      return;
    }

    // 否则使用原始的单节点拖拽
    disableContainerTransition();
    originalHandleMouseDown(event);
  }, [
    disableContainerTransition,
    isInActiveGroup,
    lineModeEnabled,
    node,
    onConnectionStart,
    onGroupDragStart,
    originalHandleMouseDown,
    resolveConnectionSide,
    shouldSkipDrag,
  ]);


  // 🎯 处理节点点击选中
  const handleNodeClick = useCallback((event: React.MouseEvent) => {
    if (lineModeEnabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    
    // 如果是收集栏节点且按住C键，阻止选中
    if (editing) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    
    // 双击处理
    if (event.detail === 2) {
      // 🎯 棢查是否是Mermaid代码节点
      const isMermaidNode = node.type === 'code' && (node as any).codeType === 'mermaid';
      
      if (isMermaidNode) {
        // Mermaid节点不进入文本编辑模式，让MermaidRenderer自己处理图形编辑
        event.stopPropagation();
        return;
      }
      
      // 🎯 对于TextNode和TodoNode，让其自己处理双击事件，不在这里拦截
      if (node.type === 'text' || node.type === 'todo') {
        // 不阻止事件传播，让TextNode内部的双击处理器工作
        return;
      }
      
      // 🎯 对于TableNode，让其自己处理双击事件，不在这里拦截
      if (node.type === 'table') {
        // 不阻止事件传播，让TableNode内部的双击处理器工作
        return;
      }
      
      // 🎯 对于CanvasLinkNode，让其自己处理双击事件，不在这里拦截
      if (node.type === 'canvas-link') {
        // 不阻止事件传播，让CanvasLinkNode内部的双击处理器工作
        return;
      }
      
      // 其他节点正常进入编辑模式
      event.stopPropagation();
      onEdit?.(node.id);
      return;
    }
    
    // 只有在非编辑模式下才阻止事件传播
    event.stopPropagation();
    
    // 单击选中节点
    const multiSelect = event.ctrlKey || event.metaKey;
    onSelect?.(node.id, multiSelect);
  }, [lineModeEnabled, node, editing, onSelect, onEdit]);


  const handleConnectionStart = useCallback((position: 'top' | 'right' | 'bottom' | 'left') => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    if (onConnectionStart) {
      onConnectionStart(event.nativeEvent, node.id, position);
    }
  }, [node.id, onConnectionStart]);

  const hasShapeDecoration = node.shapeDecoration && node.shapeDecoration.type !== 'none';
  const useGlobalCornerStyle = !hasShapeDecoration; // 有形状装饰时屏蔽全局圆角

  const getBackgroundStyle = () => {
    if (hasShapeDecoration) {
      return {
        background: 'transparent',
        backdropFilter: 'none',
        boxShadow: 'none'
      };
    }
    
    // 媒体节点保持透明
    if (node.type === 'media') return {};

    try {
      if (node.type === 'code' && (node as any).codeType === 'svg') {
        const mode = (node as any).svgBgMode as ('transparent'|'auto'|undefined);
        if (mode === 'auto') {
          return {
            background: resolvedTheme === 'dark' ? '#14161a' : '#ffffff',
            backdropFilter: 'none',
            boxShadow: 'none'
          } as React.CSSProperties;
        }
        return {
          background: 'transparent',
          backdropFilter: 'none',
          boxShadow: 'none'
        } as React.CSSProperties;
      }
    } catch {}
    const nodeOpacity = textStyles.opacity !== undefined ? textStyles.opacity : 1;
    if (resolvedTheme === 'dark') {
      return {
        background: `rgba(24, 26, 27, ${nodeOpacity})`,
        backdropFilter: 'none',
        boxShadow: 'none'
      } as React.CSSProperties;
    }
    return {
      background: `rgba(255, 255, 255, ${nodeOpacity})`,
      backdropFilter: `blur(${12 * nodeOpacity}px)`,
      boxShadow: `0 2px 6px rgba(0, 0, 0, ${0.04 * nodeOpacity})`
    } as React.CSSProperties;
  };

  const rawBackgroundStyle = getBackgroundStyle();
  const backgroundStyle = editing
    ? { ...rawBackgroundStyle, backdropFilter: 'none' as any, boxShadow: 'none' as any }
    : rawBackgroundStyle;
  const getColorAlpha = (value?: string): number | null => {
    if (!value) return 0;
    const v = value.trim().toLowerCase();
    if (v === 'transparent') return 0;
    if (v === 'auto') return 0.9;
    const rgbaMatch = v.match(/^rgba?\(([^)]+)\)$/);
    if (rgbaMatch) {
      const parts = rgbaMatch[1].split(',').map((p) => p.trim());
      if (parts.length >= 4) {
        const a = Number(parts[3]);
        return Number.isFinite(a) ? a : null;
      }
      return 1;
    }
    const hslaMatch = v.match(/^hsla?\(([^)]+)\)$/);
    if (hslaMatch) {
      const parts = hslaMatch[1].split(',').map((p) => p.trim());
      if (parts.length >= 4) {
        const raw = parts[3];
        const num = Number(raw.replace('%', ''));
        if (!Number.isFinite(num)) return null;
        return raw.includes('%') ? num / 100 : num;
      }
      return 1;
    }
    if (v.startsWith('#')) {
      const hex = v.slice(1);
      if (hex.length === 4) {
        const a = parseInt(hex[3] + hex[3], 16);
        return Number.isFinite(a) ? a / 255 : null;
      }
      if (hex.length === 8) {
        const a = parseInt(hex.slice(6, 8), 16);
        return Number.isFinite(a) ? a / 255 : null;
      }
      return 1;
    }
    return null;
  };
  const normalizedMediaExtension = (() => {
    if (node.fileExtension) return node.fileExtension.toLowerCase();
    const name = node.fileName || '';
    return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  })();
  const fileTypeLower = ((node as any).fileType || '').toLowerCase();
  const isImageMediaNode = node.type === 'media' && (node as any).mediaType === 'image';
  const hasTransparentMediaBg = isImageMediaNode
    ? ((node as any).mediaHasTransparentBg ?? isAlphaCapableImageFormat(normalizedMediaExtension, fileTypeLower))
    : false;
  const explicitNodeOpacity = typeof node.opacity === 'number' ? node.opacity : 1;
  const textOpacity = typeof textStyles.opacity === 'number' ? textStyles.opacity : 1;
  const svgBgMode = (node as any).svgBgMode as ('transparent' | 'auto' | undefined);
  const isTransparentSvg = node.type === 'code' && (node as any).codeType === 'svg' && svgBgMode !== 'auto';
  const shapeOpacity = hasShapeDecoration && typeof node.shapeDecoration?.opacity === 'number'
    ? node.shapeDecoration.opacity
    : 1;
  const shapeFillAlpha = hasShapeDecoration ? getColorAlpha(node.shapeDecoration?.fillColor) : null;
  const isShapeTranslucent = hasShapeDecoration && (
    shapeOpacity < 0.999 || (shapeFillAlpha !== null && shapeFillAlpha < 0.999)
  );
  const groupBgOpacity = typeof (node as any).groupStyles?.bgOpacity === 'number'
    ? (node as any).groupStyles.bgOpacity
    : 1;
  const isGroupBgTranslucent = node.type === 'group' && groupBgOpacity < 0.999;
  const isTextTranslucent = textOpacity < 0.999;
  const isNodeTranslucent = explicitNodeOpacity < 0.999;
  const shouldSuppressShadow = hasTransparentMediaBg
    || isTransparentSvg
    || isShapeTranslucent
    || isGroupBgTranslucent
    || isTextTranslucent
    || isNodeTranslucent;

  const restingShadow = resolvedTheme === 'dark'
    ? '0 1px 2px rgba(0, 0, 0, 0.45)'
    : '0 1px 3px rgba(15, 23, 42, 0.12)';
  const occlusionShadow = resolvedTheme === 'dark'
    ? '0 0 0 1px rgba(255, 255, 255, 0.05), 0 4px 10px rgba(2, 6, 23, 0.6)'
    : '0 0 0 1px rgba(15, 23, 42, 0.07), 0 6px 12px rgba(15, 23, 42, 0.12)';
  const baseShadow = (inColumn || shouldSuppressShadow) ? 'none' : (hasOverlapShadow ? occlusionShadow : restingShadow);
  const selectionShadow = 'none';
  const draggingShadow = resolvedTheme === 'dark'
    ? '0 12px 28px rgba(18, 20, 24, 0.58), 0 4px 12px rgba(0, 0, 0, 0.4)'
    : '0 12px 32px rgba(189, 190, 191, 0.36), 0 4px 14px rgba(189, 190, 191, 0.42)';
  const isDragActive = isDragging || isResizing || isDragLeader;
  const interactiveShadow = editing
    ? 'none'
    : (shouldSuppressShadow
      ? 'none'
      : (isDragActive
        ? draggingShadow
        : (selected ? selectionShadow : baseShadow)));

  // 🎯 根据形状装饰计算内容区域约束
  const getContentConstraintForShape = (): React.CSSProperties => {
    if (!hasShapeDecoration || !node.shapeDecoration) {
      return { width: '100%', height: '100%' };
    }

    const shape = node.shapeDecoration;
    const { width: nodeWidth, height: nodeHeight } = node;

    switch (shape.type) {
      case 'circle': {
        const minDimension = Math.min(nodeWidth, nodeHeight);
        const radius = minDimension / 2;
        
        const maxInscribedSquare = radius * Math.SQRT2;
        
        // 实际可用区域：在保证不超出圆形边界的前提下最大化利用空间
        const contentWidth = Math.min(maxInscribedSquare, nodeWidth * 0.9);
        const contentHeight = Math.min(maxInscribedSquare, nodeHeight * 0.9);
        
        // 居中定位
        const offsetX = (nodeWidth - contentWidth) / 2;
        const offsetY = (nodeHeight - contentHeight) / 2;
        
        return {
          width: `${contentWidth}px`,
          height: `${contentHeight}px`,
          position: 'absolute' as const,
          left: `${offsetX}px`,
          top: `${offsetY}px`,
        };
      }
      case 'diamond': {
        // 🔷 菱形：使用四边中点连接形成的内接矩形
        const contentWidth = nodeWidth * 0.5;  // 四边中点矩形宽度
        const contentHeight = nodeHeight * 0.5; // 四边中点矩形高度
        const offsetX = (nodeWidth - contentWidth) / 2;   // 居中偏移
        const offsetY = (nodeHeight - contentHeight) / 2; // 居中偏移
        
        return {
          width: `${contentWidth}px`,
          height: `${contentHeight}px`,
          position: 'absolute' as const,
          left: `${offsetX}px`,
          top: `${offsetY}px`,
        };
      }
      default:
        return { width: '100%', height: '100%' };
    }
  };

  const lastHeightRef = useRef<number>(node.height);
  const isTextualNode = node.type === 'text' || node.type === 'todo';
  const isShrinking = node.height < lastHeightRef.current - 1;
  const isAnyDragging = isDragActive || anyDragging;
  const enableHeightTransition = false;
  const enableLayoutMotion = false;
  const combinedTransition = '';

  useEffect(() => {
    lastHeightRef.current = node.height;
  }, [node.height]);

  useEffect(() => {
    if (editing) {
      onWheelLockChange?.(true);
      return () => onWheelLockChange?.(false);
    }
  }, [editing, onWheelLockChange]);

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    left: node.x,
    top: node.y,
    // 表格节点由内容撑弢尺寸，不强制约束宽高，避免Grid布局塌缩
    width: node.type === 'table' ? 'auto' : node.width,
    height: node.type === 'table' ? 'auto' : node.height,
    cursor: readOnly
      ? 'default'
      : (lineModeEnabled ? 'crosshair' : (isAnyDragging ? 'move' : (editing ? 'text' : 'pointer'))),
    zIndex: node.type === 'column' ? 0 : (selected ? 1000 : (isAnyDragging ? 1001 : 1)),
    transition: 'none',
    willChange: undefined,
    ...backgroundStyle,
    boxShadow: interactiveShadow
  };

  const getBorderClass = () => {
    if (hasShapeDecoration) return 'border-0';

    // 预览连线悬停高亮：在连接预览时，目标节点显示与中丢致的边框效果
    const previewSelected = isConnecting && isHovered;

    // 选中或预览：深浅主题使用反转关系（浅色深边框，深色浅边框）
    if (selected || previewSelected) {
      return resolvedTheme === 'dark'
        ? 'border-2 border-[#eeeded]'
        : 'border-2 border-[#2f2f2f]';
    }

    if (inColumn) {
      return 'border border-gray-300/70 dark:border-zinc-600/70';
    }

    // 媒体节点：视频在暗色模式下去除边界，避免出现白色细边
    if (node.type === 'media') {
      const mediaType = (node as any).mediaType;
      if (mediaType === 'video') {
        return 'border-2 border-transparent';
      }
      return 'border-2 border-transparent dark:border-zinc-800/70';
    }

    // 其他：维持明 2px 边框，避免状态切换时抖动
    return 'border-2 border-transparent';
  };

  const borderClass = getBorderClass();
  const SCROLL_LOCK_EPSILON = 4;

  const handleWheelCapture = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!selected || editing) return; // 仅在选中且非编辑态时考虑拦截
    const container = containerRef.current;
    if (!container) return;

    const scrollEl = (e.target as HTMLElement).closest('[data-scroll-container]') as HTMLElement | null;
    if (scrollEl) {
      if (scrollEl.scrollHeight > scrollEl.clientHeight + SCROLL_LOCK_EPSILON) {
        onWheelLockChange?.(true); // 立即锁定画布缩放
        e.stopPropagation();
      }
      return;
    }

    // 兜底：从事件目标向上查找是否存在可垂直滚动的元素
      let el = e.target as HTMLElement | null;
    while (el && el !== container) {
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      const canScrollY = el.scrollHeight > el.clientHeight + SCROLL_LOCK_EPSILON;
      if (canScrollY && (overflowY === 'auto' || overflowY === 'scroll')) {
        onWheelLockChange?.(true);
        e.stopPropagation();
        return;
      }
      el = el.parentElement;
    }
  }, [selected, editing, onWheelLockChange]);

  // 🎯 悬停棢测：当鼠标进入中节点且存在可滚动内容时，通知上层禁用画布滚轮缩放
  const hasScrollableDescendant = useCallback(() => {
    const container = containerRef.current;
    if (!container) return false;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
    let nodeEl = walker.currentNode as HTMLElement | null;
    while (nodeEl) {
      const el = nodeEl as HTMLElement;
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      const canScrollY = el.scrollHeight > el.clientHeight + SCROLL_LOCK_EPSILON;
      if (canScrollY && (overflowY === 'auto' || overflowY === 'scroll')) {
        return true;
      }
      nodeEl = walker.nextNode() as HTMLElement | null;
    }
    return false;
  }, [SCROLL_LOCK_EPSILON]);

  const handleMouseEnter = useCallback(() => {
    if (!selected || editing) return;
    const lock = hasScrollableDescendant();
    onWheelLockChange?.(lock);
  }, [selected, editing, hasScrollableDescendant, onWheelLockChange]);

  const handleMouseLeave = useCallback(() => {
    onWheelLockChange?.(false);
  }, [onWheelLockChange]);

  // 角样式：媒体节点不使用全屢圆角，避免对内容产生圆角裁切视觉
  const cornerClass = node.type === 'media'
    ? 'rounded-none'
    : (useGlobalCornerStyle ? (cornerStyle?.className || 'rounded-none') : 'rounded-none');
  const rawCornerRadius = node.type === 'media'
    ? 0
    : (useGlobalCornerStyle ? (cornerStyle?.radius ?? 0) : 0);
  const maxAllowedCornerRadius = Math.max(0, Math.min((node.width || 0) / 2, (node.height || 0) / 2));
  const effectiveCornerRadius = Math.max(0, Math.min(rawCornerRadius, maxAllowedCornerRadius));
  // Position the top-right connection dot on the rounded-corner arc mid-point (45deg on the arc).
  const topRightHandleInset = effectiveCornerRadius * (1 - Math.SQRT1_2);
  const allowInnerOverflow = node.type === 'table' || node.type === 'text' || node.type === 'todo';
  const isDarkMode = resolvedTheme === 'dark';
  const connectionDotClass = isDarkMode
    ? 'w-[9px] h-[9px] bg-[#f8fafc] border border-[#d1d5db] rounded-full shadow-sm transition-all duration-300 ease-out group-hover:opacity-0 group-hover:scale-0'
    : 'w-[9px] h-[9px] bg-white border border-gray-400 rounded-full shadow-sm transition-all duration-300 ease-out group-hover:opacity-0 group-hover:scale-0';
  const connectionHandleClass = isDarkMode
    ? 'absolute inset-0 w-5 h-5 bg-[#111827] border border-[#f8fafc] text-[#f8fafc] flex items-center justify-center cursor-pointer rounded-full shadow-lg opacity-0 scale-75 transition-all duration-200 group-hover:opacity-100 group-hover:scale-100 hover:border-white'
    : 'absolute inset-0 w-5 h-5 bg-white border border-gray-400 text-foreground flex items-center justify-center cursor-pointer rounded-full shadow-lg opacity-0 scale-75 transition-all duration-200 group-hover:opacity-100 group-hover:scale-100 hover:border-black';

  return (
    <div
      ref={containerRef}
      data-node-id={node.id}
      style={containerStyle}
      className={`${borderClass} ${cornerClass} overflow-visible ${
        editing ? 'select-text' : 'select-none'
      }`}
      onMouseDown={editing ? undefined : handleMouseDown}
      onClick={handleNodeClick}
      onWheelCapture={handleWheelCapture}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 🤖 AI节点绿色外缘装饰层（不影响交互） */}
      {node.ai && (
        <div
          className={`pointer-events-none absolute -inset-1 ${cornerClass} border-2 border-[#10B981]`}
          aria-hidden="true"
        />
      )}
      
      {hasShapeDecoration && (
        <ShapeDecorationLayer
          shape={node.shapeDecoration!}
          nodeSize={{ width: node.width, height: node.height }}
          selected={selected}
          shadowEnabled={!shouldSuppressShadow && (!selected || isDragActive)}
          className="shape-decoration"
          nodeOpacity={(node as any).textStyles?.opacity !== undefined ? (node as any).textStyles.opacity : 1}
          rimSegments={undefined}
        />
      )}

      {/* 📝 节点内容区域 - 根据形状装饰调整约束 */}
      <div 
        className={`${allowInnerOverflow ? 'overflow-visible' : 'overflow-hidden'} bg-transparent text-[#111827] dark:text-foreground`}
        style={hasShapeDecoration ? getContentConstraintForShape() : { width: '100%', height: '100%' }}
      >
        {node.type === 'column' ? (
          <ColumnContainer
            node={node}
            editing={editing}
            nodeSelected={selected}
            childNodes={childNodes}
            isDragTarget={isDragTarget}
            isDraggingNode={isDraggingNode}
            fontStyle={fontStyle}
            cornerStyle={cornerStyle}
            selectedNodeIds={selectedNodes}
            isRemoveTarget={columnRemoveTarget}
            insertionIndex={insertionIndex}
            onContentChange={onContentChange}
            onEditToggle={onEditToggle}
            onTitleChange={onTitleChange}
            onToggleCollapse={onToggleCollapse}
            renderChildNode={renderChildNode}
            onDropNode={onDropNode}
          onChildNodeSelect={onChildNodeSelect}
          onChildNodeDragStart={onChildNodeDragStart}
          onChildNodeSizeChange={onSizeChange}
        />
        ) : node.type === 'table' ? (
          <TableNode
            node={node as any}
            nodeSelected={selected}
            fontStyle={fontStyle}
            tableStyles={(node as any).tableStyles}
            onDataChange={(nodeId, data) => {
              // legacy / 几何类（列宽行高重排）仍走 __tableData
              onContentChange?.(nodeId, JSON.stringify({ __tableData: data }));
            }}
            onCellCommit={onTableCellCommit}
            onRowOp={onTableRowOp}
            onColOp={onTableColOp}
            onSizeChange={onSizeChange}
            onLockToggle={onLockToggle}
          />
        ) : node.type === 'canvas-link' ? (
          <CanvasLinkNode
            node={node as any}
            editing={editing}
            fontStyle={fontStyle}
            nodeStyles={(node as any).linkStyles}
            onContentChange={onContentChange}
            onEditToggle={onEditToggle}
            onTitleChange={onTitleChange}
            onNavigate={onCanvasNavigate}
            onRefreshThumbnail={onRefreshThumbnail}
            onCreateCanvas={onCreateCanvas}
            onGetAvailableCanvases={onGetAvailableCanvases}
            onSizeChange={onSizeChange}
          />
        ) : (
          children
        )}
      </div>



      {/* 🔗 选中状的控制元素 */}
      {selected && !editing && !isConnecting && !inColumn && !lineModeEnabled && (
        <>
          
          <div
            className="absolute top-0 right-0 w-5 h-5 flex items-center justify-center group z-10"
            style={{
              top: `${topRightHandleInset}px`,
              right: `${topRightHandleInset}px`,
              transform: 'translate(50%, -50%)'
            }}
          >
            
            <div className={connectionDotClass} />
            
            <div
              className={connectionHandleClass}
              onMouseDown={handleConnectionStart('right')}
              title="创建连接"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                <path d="M4 12L12 4M8 4L12 4L12 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
          
          
          {!node.locked && !inColumn && node.type !== 'table' && (
            <div className="absolute bottom-0 right-0 cursor-se-resize z-10" style={{transform: 'translate(-3%, -3%)'}} onMouseDown={handleResizeStartWithMode} title="调整大小">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-muted-foreground hover:text-foreground transition-colors duration-200" style={{transform: 'rotate(180deg)'}}>
                <path d="M2 8L8 2M2 11L11 2M2 14L14 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
          )}
        </>
      )}

    </div>
  );
};

export default NodeContainer;
