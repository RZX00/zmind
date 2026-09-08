import { useMemo } from 'react';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';

export interface ViewTransform {
  scale: number;
  positionX: number;
  positionY: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface UseViewportRectParams {
  transformRef: React.RefObject<ReactZoomPanPinchRef>;
  viewTransform?: Partial<ViewTransform> | null;
  viewportSize?: Partial<ViewportSize> | null;
  buffer?: number;
  extraDeps?: unknown[];
}

export type ViewportRect = { x: number; y: number; w: number; h: number } | null;

export function useViewportRect({
  transformRef,
  viewTransform,
  viewportSize,
  buffer = 360,
  extraDeps = [],
}: UseViewportRectParams): ViewportRect {
  // 统一计算视口在画布坐标系中的矩形，带可配置缓冲区
  return useMemo(() => {
    try {
      const scale = viewTransform?.scale ?? transformRef.current?.instance?.transformState?.scale ?? 1;
      const posX = viewTransform?.positionX ?? transformRef.current?.instance?.transformState?.positionX ?? 0;
      const posY = viewTransform?.positionY ?? transformRef.current?.instance?.transformState?.positionY ?? 0;
      const vpW = viewportSize?.width ?? transformRef.current?.instance?.wrapperComponent?.getBoundingClientRect().width ?? 0;
      const vpH = viewportSize?.height ?? transformRef.current?.instance?.wrapperComponent?.getBoundingClientRect().height ?? 0;
      if (scale <= 0 || vpW <= 0 || vpH <= 0) return null;
      const x = -posX / scale;
      const y = -posY / scale;
      const w = vpW / scale;
      const h = vpH / scale;
      return { x: x - buffer, y: y - buffer, w: w + buffer * 2, h: h + buffer * 2 };
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewTransform, viewportSize, transformRef, buffer, ...extraDeps]);
}

export default useViewportRect;

