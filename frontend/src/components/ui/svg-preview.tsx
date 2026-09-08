'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Maximize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SvgRenderer } from '@/canvas/components/svg/SvgRenderer';

export interface SvgPreviewProps {
  content: string;
  className?: string;
  enableFullscreen?: boolean;
  title?: string;
}

export const SvgPreview: React.FC<SvgPreviewProps> = ({
  content,
  className,
  enableFullscreen = true,
  title = 'SVG Preview',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const lastTouchDistanceRef = useRef<number | null>(null);

  const handleOpen = useCallback(() => {
    if (!enableFullscreen) return;
    setIsOpen(true);
  }, [enableFullscreen]);

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(5, prev * 1.2));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(0.1, prev / 1.2));
  }, []);

  const handleResetView = useCallback(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (isOpen) {
      handleResetView();
    }
  }, [isOpen, handleResetView]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setIsDragging(true);
      setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    },
    [panOffset],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      setPanOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    },
    [isDragging, dragStart],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const getTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return null;
    const [t1, t2] = [touches[0], touches[1]];
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  };

  const getTouchCenter = (touches: React.TouchList) => {
    if (touches.length === 0) return { x: 0, y: 0 };
    if (touches.length === 1) return { x: touches[0].clientX, y: touches[0].clientY };
    const [t1, t2] = [touches[0], touches[1]];
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
  };

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        setIsDragging(true);
        setDragStart({
          x: e.touches[0].clientX - panOffset.x,
          y: e.touches[0].clientY - panOffset.y,
        });
      } else if (e.touches.length === 2) {
        setIsDragging(false);
        lastTouchDistanceRef.current = getTouchDistance(e.touches);
      }
    },
    [panOffset],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (isDragging || (e.touches.length === 2 && lastTouchDistanceRef.current)) {
        e.preventDefault();
      }

      if (e.touches.length === 1 && isDragging) {
        setPanOffset({
          x: e.touches[0].clientX - dragStart.x,
          y: e.touches[0].clientY - dragStart.y,
        });
        return;
      }

      if (e.touches.length === 2 && lastTouchDistanceRef.current) {
        const currentDistance = getTouchDistance(e.touches);
        if (!currentDistance || !canvasRef.current) return;
        const zoomFactor = currentDistance / lastTouchDistanceRef.current;
        const newZoom = Math.max(0.1, Math.min(5, zoom * zoomFactor));
        const rect = canvasRef.current.getBoundingClientRect();
        const center = getTouchCenter(e.touches);
        const centerX = center.x - rect.left;
        const centerY = center.y - rect.top;
        const nextOffset = {
          x: centerX - (centerX - panOffset.x) * (newZoom / zoom),
          y: centerY - (centerY - panOffset.y) * (newZoom / zoom),
        };
        setZoom(newZoom);
        setPanOffset(nextOffset);
        lastTouchDistanceRef.current = currentDistance;
      }
    },
    [isDragging, dragStart, panOffset, zoom],
  );

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    lastTouchDistanceRef.current = null;
  }, []);

  const handleWheelEvent = useCallback(
    (e: WheelEvent) => {
      if (!canvasRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(5, zoom * zoomFactor));
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const nextOffset = {
        x: mouseX - (mouseX - panOffset.x) * (newZoom / zoom),
        y: mouseY - (mouseY - panOffset.y) * (newZoom / zoom),
      };
      setZoom(newZoom);
      setPanOffset(nextOffset);
    },
    [zoom, panOffset],
  );

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !isOpen) return;
    el.addEventListener('wheel', handleWheelEvent, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheelEvent as EventListener);
    };
  }, [handleWheelEvent, isOpen]);

  return (
    <>
      <div
        className={cn(
          'group relative w-full overflow-hidden rounded-lg border border-border/60 bg-muted/20',
          enableFullscreen && 'cursor-pointer hover:ring-2 hover:ring-primary/20',
          className,
        )}
        onClick={enableFullscreen ? handleOpen : undefined}
      >
        <div className="w-full min-h-[180px] max-h-[480px] p-3">
          <SvgRenderer content={content} className="w-full h-full" />
        </div>
        {enableFullscreen && (
          <div className="absolute inset-0 bg-black/0 hover:bg-black/5 transition-colors rounded-lg flex items-center justify-center opacity-0 hover:opacity-100 pointer-events-none">
            <Button
              variant="secondary"
              size="sm"
              className="h-8 w-8 p-0 bg-background/90 hover:bg-background border shadow-sm pointer-events-auto"
              onClick={(e) => {
                e.stopPropagation();
                handleOpen();
              }}
              title="View fullscreen"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] w-full h-full p-0 overflow-hidden">
          <div className="flex flex-col h-full bg-background">
            <div className="flex items-center justify-between p-4 pr-16 border-b bg-background/95 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-sm font-medium">{title}</DialogTitle>
                <span className="text-xs text-muted-foreground">
                  Zoom: {Math.round(zoom * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleZoomOut}
                  className="h-8 w-8 p-0"
                  title="Zoom out"
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetView}
                  className="h-8 w-8 p-0"
                  title="Reset view"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleZoomIn}
                  className="h-8 w-8 p-0"
                  title="Zoom in"
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div
              ref={canvasRef}
              className="flex-1 min-h-0 relative overflow-hidden bg-muted/10 cursor-move touch-none select-none"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleMouseDown(e);
              }}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={(e) => {
                e.stopPropagation();
                handleTouchStart(e);
              }}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
            >
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
                  transformOrigin: 'center center',
                  transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                }}
              >
                <div className="w-full h-full max-w-[90vw] max-h-[90vh]">
                  <SvgRenderer content={content} className="w-full h-full" />
                </div>
              </div>

              <div className="absolute bottom-4 left-4 bg-background/80 backdrop-blur-sm rounded-md px-3 py-2 text-xs text-muted-foreground shadow-sm">
                <div>Drag to pan | Scroll to zoom | Pinch to zoom</div>
                <div className="mt-1 opacity-75">Esc: close | +/-: zoom | 0: reset</div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

SvgPreview.displayName = 'SvgPreview';
