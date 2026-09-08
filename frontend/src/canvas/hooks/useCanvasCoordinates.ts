/**
 * 🎯 画布坐标转换Hook
 * 
 * 
 * 
 * @author Claude Code
 * @since 2024-01-07
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { 
  screenToCanvasCore, 
  canvasToScreenCore, 
  Position,
  ContainerBounds,
  TransformState,
  isValidTransform,
  isValidContainerBounds
} from '../components/core/systems/CoordinateSystem';

// ==================== 类型定义 ====================

/**
 * Hook配置参数
 */
export interface UseCanvasCoordinatesConfig {
  transformRef: React.RefObject<ReactZoomPanPinchRef>;
  containerSelector?: string;
  /** When the wrapper element is remounted, bump this key to rebind observers */
  containerKey?: string | number;
}

/**
 */
export interface CanvasCoordinates {
  screenToCanvas: (screenX: number, screenY: number) => Position;
  canvasToScreen: (canvasX: number, canvasY: number) => Position;
  /** 坐标系统是否就绪 */
  isReady: boolean;
  /** 获取当前容器边界信息 */
  getContainerBounds: () => ContainerBounds | null;
  getTransform: () => TransformState | null;
}

// ==================== 默认配置 ====================

const DEFAULT_CONTAINER_SELECTOR = '.react-transform-wrapper';

/**
 */
const createDefaultPosition = (x = 0, y = 0): Position => ({ x, y });

// ==================== 主Hook ====================

/**
 * 画布坐标转换Hook
 * 
 * 
 * @param config - Hook配置参数
 */
export function useCanvasCoordinates({
  transformRef,
  containerSelector = DEFAULT_CONTAINER_SELECTOR,
  containerKey
}: UseCanvasCoordinatesConfig): CanvasCoordinates {
  
  
  
  const containerRef = useRef<Element | null>(null);
  const containerBoundsRef = useRef<ContainerBounds | null>(null);
  const [boundsVersion, setBoundsVersion] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const container = document.querySelector(containerSelector);
    containerRef.current = container;
    if (!container) return;

    const measure = () => {
      const rect = container.getBoundingClientRect();
      containerBoundsRef.current = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
      setBoundsVersion((v) => v + 1);
    };

    // 初次测量
    measure();

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => measure())
      : null;
    if (observer) {
      try { observer.observe(container); } catch {}
    }

    return () => {
      if (observer) {
        try { observer.disconnect(); } catch {}
      }
    };
  }, [containerSelector, containerKey]);

  // ==================== 辅助函数 ====================

  const getContainerBounds = useCallback((): ContainerBounds | null => {
    return containerBoundsRef.current;
  }, []);

  /**
   */
  const getTransform = useCallback((): TransformState | null => {
    if (!transformRef.current?.instance) {
      return null;
    }
    
    const state = transformRef.current.instance.transformState;
    
    if (!isValidTransform(state)) {
      return null;
    }

    return {
      scale: state.scale,
      positionX: state.positionX,
      positionY: state.positionY
    };
  }, [transformRef]);


  /**
   */
  const isReady = (() => {
    const container = containerRef.current;
    const transform = getTransform();
    const bounds = containerBoundsRef.current;
    return !!(container && transform && bounds && bounds.width && bounds.height);
  })();

  // ==================== 核心坐标转换函数 ====================

  /**
   * 
   * 🎯 行业标准的纯几何坐标转换：只进行数学变换，无任何业务逻辑污染
   */
  const screenToCanvas = useCallback((screenX: number, screenY: number): Position => {
    if (!isReady) {
      return createDefaultPosition(screenX, screenY);
    }

    const containerBounds = getContainerBounds();
    const transform = getTransform();

    if (!containerBounds || !transform) {
      return createDefaultPosition(screenX, screenY);
    }

    if (!isValidContainerBounds(containerBounds)) {
      return createDefaultPosition(screenX, screenY);
    }

    try {
      return screenToCanvasCore(
        screenX,
        screenY,
        containerBounds,
        transform
      );
    } catch (error) {
      return createDefaultPosition(screenX, screenY);
    }
  }, [isReady, getContainerBounds, getTransform]);

  /**
   * 
   * 🎯 纯几何的反向转换：用于将画布上的元素定位到屏幕坐标系
   */
  const canvasToScreen = useCallback((canvasX: number, canvasY: number): Position => {
    if (!isReady) {
      return createDefaultPosition(canvasX, canvasY);
    }

    const containerBounds = getContainerBounds();
    const transform = getTransform();

    if (!containerBounds || !transform) {
      return createDefaultPosition(canvasX, canvasY);
    }

    try {
      return canvasToScreenCore(
        canvasX,
        canvasY,
        containerBounds,
        transform
      );
    } catch (error) {
      return createDefaultPosition(canvasX, canvasY);
    }
  }, [isReady, getContainerBounds, getTransform]);

  // ==================== 返回Hook接口 ====================

  return {
    screenToCanvas,
    canvasToScreen,
    isReady,
    getContainerBounds,
    getTransform
  };
}

// ==================== 导出工具函数 ====================

/**
 * 创建默认Hook配置
 */
export function createDefaultCoordinatesConfig(): Partial<UseCanvasCoordinatesConfig> {
  return {
    containerSelector: DEFAULT_CONTAINER_SELECTOR
  };
}

/**
 * 
 * ```typescript
 * // 在InfiniteCanvas或其他组件中使用
 * function MyCanvasComponent() {
 *   const transformRef = useRef<ReactZoomPanPinchRef>(null);
 *   
 *   const { screenToCanvas, canvasToScreen, isReady } = useCanvasCoordinates({
 *     transformRef
 *   });
 *   
 *   const handleClick = (event: MouseEvent) => {
 *     if (!isReady) return;
 *     
 *
 *     const canvasPos = screenToCanvas(event.clientX, event.clientY);
 *     console.log('Canvas position:', canvasPos);
 *   };
 * }
 * ```
 */



