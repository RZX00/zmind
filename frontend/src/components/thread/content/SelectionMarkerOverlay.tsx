'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { getSelectionRects, type SelectionRect } from './selectionUtils';

interface SelectionMarkerOverlayProps {
  containerRef: React.RefObject<HTMLElement>;
}

const RECT_PADDING_X = 3;
const RECT_PADDING_Y = 1;
const SKEW_DEG = -2;

export const SelectionMarkerOverlay: React.FC<SelectionMarkerOverlayProps> = ({
  containerRef,
}) => {
  const { resolvedTheme } = useTheme();
  const [rects, setRects] = useState<SelectionRect[]>([]);
  const rafRef = useRef<number | null>(null);

  const markerStyle = useMemo(() => {
    const isDark = resolvedTheme === 'dark';
    return {
      background: isDark
        ? 'rgba(74, 222, 128, 0.5)'
        : 'rgba(134, 239, 172, 0.6)',
      shadow: isDark
        ? 'rgba(74, 222, 128, 0.28)'
        : 'rgba(134, 239, 172, 0.35)',
    };
  }, [resolvedTheme]);

  const updateRects = useCallback(() => {
    if (typeof window === 'undefined') return;
    const container = containerRef.current;
    if (!container) {
      setRects([]);
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setRects([]);
      return;
    }
    const next = getSelectionRects(selection, container);
    setRects(next);
  }, [containerRef]);

  const scheduleUpdate = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateRects();
    });
  }, [updateRects]);

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

  return (
    <div className="pointer-events-none absolute inset-0 z-0">
      {rects.map((rect, idx) => (
        <span
          key={`${rect.left}-${rect.top}-${rect.width}-${idx}`}
          className="absolute"
          style={{
            left: rect.left - RECT_PADDING_X,
            top: rect.top - RECT_PADDING_Y,
            width: rect.width + RECT_PADDING_X * 2,
            height: rect.height + RECT_PADDING_Y * 2,
            background: markerStyle.background,
            boxShadow: `0 0 6px ${markerStyle.shadow}`,
            borderRadius: 6,
            transform: `skew(${SKEW_DEG}deg)`,
            transformOrigin: 'left center',
            opacity: 0.88,
          }}
        />
      ))}
    </div>
  );
};

SelectionMarkerOverlay.displayName = 'SelectionMarkerOverlay';
