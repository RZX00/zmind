'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SquarePen } from 'lucide-react';
import { NodeFactory } from '@/canvas/components/core/systems/NodeFactory';
import { useCanvasStore } from '@/canvas/stores/canvas.store';
import { calculateTextNodeHeight, estimateAutoTextWidth } from '@/canvas/utils/canvasUtils';
import { DEFAULT_NODE_SIZES } from '@/canvas/types/canvas';
import { DEFAULT_TEXT_LAYOUT_PRESET, getTextLayoutPreset } from '@/canvas/constants/textNodePresets';
import { computeCenterFromPosition } from '@/canvas/services/canvas-view-state.service';
import { toast } from 'sonner';
import { getSelectionBounds, getSelectionRects, isSelectionWithinContainer } from './selectionUtils';

interface SelectionAddToCanvasButtonProps {
  containerRef: React.RefObject<HTMLElement>;
  disabled?: boolean;
}

type SelectionInfo = {
  text: string;
  bounds: {
    left: number;
    top: number;
    width: number;
    height: number;
    right: number;
    bottom: number;
  };
  containerWidth: number;
  containerHeight: number;
};

const BUTTON_OFFSET = 8;
const BUTTON_PADDING = 8;
const PLACEMENT_STEP = 32;
const PLACEMENT_TRIES = 32;

const findAvailablePosition = (
  nodes: Array<{ x: number; y: number; width: number; height: number }>,
  centerX: number,
  centerY: number,
  nodeWidth: number,
  nodeHeight: number,
) => {
  const baseX = Math.round(centerX - nodeWidth / 2);
  const baseY = Math.round(centerY - nodeHeight / 2);

  const overlaps = (x: number, y: number) => {
    const x1 = x + nodeWidth;
    const y1 = y + nodeHeight;
    return nodes.some((n) => {
      const nX1 = n.x + n.width;
      const nY1 = n.y + n.height;
      return !(x1 <= n.x || x >= nX1 || y1 <= n.y || y >= nY1);
    });
  };

  if (!overlaps(baseX, baseY)) return { x: baseX, y: baseY };

  for (let i = 1; i <= PLACEMENT_TRIES; i += 1) {
    const delta = i * PLACEMENT_STEP;
    const candidates = [
      { x: baseX + delta, y: baseY },
      { x: baseX - delta, y: baseY },
      { x: baseX, y: baseY + delta },
      { x: baseX, y: baseY - delta },
      { x: baseX + delta, y: baseY + delta },
      { x: baseX + delta, y: baseY - delta },
      { x: baseX - delta, y: baseY + delta },
      { x: baseX - delta, y: baseY - delta },
    ];
    for (const candidate of candidates) {
      if (!overlaps(candidate.x, candidate.y)) return candidate;
    }
  }

  return { x: baseX + PLACEMENT_STEP, y: baseY + PLACEMENT_STEP };
};

export const SelectionAddToCanvasButton: React.FC<SelectionAddToCanvasButtonProps> = ({
  containerRef,
  disabled = false,
}) => {
  const [info, setInfo] = useState<SelectionInfo | null>(null);
  const infoRef = useRef<SelectionInfo | null>(null);
  const rafRef = useRef<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [buttonSize, setButtonSize] = useState<{ width: number; height: number } | null>(null);

  const updateSelection = useCallback(() => {
    if (disabled) {
      setInfo(null);
      infoRef.current = null;
      return;
    }
    if (typeof window === 'undefined') return;
    const container = containerRef.current;
    if (!container) {
      setInfo(null);
      infoRef.current = null;
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setInfo(null);
      infoRef.current = null;
      return;
    }
    if (!isSelectionWithinContainer(selection, container)) {
      setInfo(null);
      infoRef.current = null;
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      setInfo(null);
      infoRef.current = null;
      return;
    }
    const rects = getSelectionRects(selection, container);
    const bounds = getSelectionBounds(rects);
    if (!bounds) {
      setInfo(null);
      infoRef.current = null;
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const next = {
      text,
      bounds,
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
    };
    setInfo(next);
    infoRef.current = next;
  }, [containerRef, disabled]);

  const scheduleUpdate = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateSelection();
    });
  }, [updateSelection]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleSelectionChange = () => scheduleUpdate();
    const handleResize = () => scheduleUpdate();
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('resize', handleResize);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [scheduleUpdate]);

  useEffect(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setButtonSize({ width: rect.width, height: rect.height });
    }
  }, [info?.text]);

  const buttonPosition = useMemo(() => {
    if (!info) return null;
    const safeWidth = buttonSize?.width ?? 96;
    const safeHeight = buttonSize?.height ?? 30;
    const rightEdge = info.bounds.right;
    const clampedRight = Math.min(
      Math.max(rightEdge, safeWidth + BUTTON_PADDING),
      Math.max(BUTTON_PADDING, info.containerWidth - BUTTON_PADDING),
    );
    let placeAbove = info.bounds.top > safeHeight + BUTTON_OFFSET;
    let top = placeAbove
      ? info.bounds.top - BUTTON_OFFSET
      : info.bounds.bottom + BUTTON_OFFSET;
    if (placeAbove && top - safeHeight < BUTTON_PADDING) {
      placeAbove = false;
      top = info.bounds.bottom + BUTTON_OFFSET;
    }
    const maxTop = info.containerHeight - safeHeight - BUTTON_PADDING;
    if (!placeAbove && top > maxTop) {
      top = Math.max(BUTTON_PADDING, maxTop);
    }
    return {
      left: clampedRight,
      top,
      transform: placeAbove ? 'translate(-100%, -100%)' : 'translate(-100%, 0)',
    };
  }, [buttonSize?.height, buttonSize?.width, info]);

  const handleAddToCanvas = useCallback(() => {
    const current = infoRef.current;
    if (!current) return;
    const content = current.text.trim();
    if (!content) return;

    const state = useCanvasStore.getState();
    const canvas = state.canvas;
    if (!canvas?.id) {
      toast.error('没有可用的画布');
      return;
    }

    const layoutPreset = getTextLayoutPreset(canvas.textLayoutPreset ?? DEFAULT_TEXT_LAYOUT_PRESET);
    const minWidth = layoutPreset?.metrics?.minWidth ?? DEFAULT_NODE_SIZES.text.width;
    const width = estimateAutoTextWidth(content, {
      layoutPreset,
      nodeType: 'text',
      clamp: { min: minWidth, max: Math.max(minWidth, 600) },
    });
    const height = calculateTextNodeHeight(content, width, { layoutPreset });

    const transform = state.viewState?.transform ?? { scale: 1, positionX: 0, positionY: 0 };
    const viewport = state.viewState?.viewport ?? { width: 0, height: 0 };
    const { centerX, centerY } =
      viewport.width > 0 && viewport.height > 0
        ? computeCenterFromPosition(transform.positionX, transform.positionY, transform.scale, viewport)
        : { centerX: 0, centerY: 0 };

    const pos = findAvailablePosition(canvas.nodes || [], centerX, centerY, width, height);
    const node = NodeFactory.create('text', pos, canvas.id, {
      width,
      height,
      content,
    });
    state.addNode(node);
    state.selectNodes([node.id]);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    setInfo(null);
    infoRef.current = null;

    toast.success('已添加到画布');
  }, []);

  if (disabled || !info || !buttonPosition) return null;

  return (
    <div
      className="absolute z-20"
      style={{
        left: buttonPosition.left,
        top: buttonPosition.top,
        transform: buttonPosition.transform,
      }}
    >
      <Button
        ref={buttonRef}
        type="button"
        size="icon"
        variant="cta"
        className="h-7 w-7 shadow-sm"
        disabled={disabled}
        onPointerDown={(event) => {
          if (disabled) return;
          event.preventDefault();
          event.stopPropagation();
          handleAddToCanvas();
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            handleAddToCanvas();
          }
        }}
        aria-label="添加到画布"
      >
        <SquarePen className="size-4" />
      </Button>
    </div>
  );
};

SelectionAddToCanvasButton.displayName = 'SelectionAddToCanvasButton';
