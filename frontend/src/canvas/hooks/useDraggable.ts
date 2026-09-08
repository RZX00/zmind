// 🎯 可拖拽和可调整大小的Hook
// 提供通用的拖拽和调整大小功能，可在多个组件中复用

import { useState, useCallback, useEffect, useRef } from 'react';

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface DragState {
  x: number;
  y: number;
  nodeX: number;
  nodeY: number;
}

export interface ResizeState {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UseDraggableOptions {
  // 初始位置和大小
  initialPosition: Position;
  initialSize: Size;

  // 约束条件
  disabled?: boolean;
  minWidth?: number;
  minHeight?: number;
  dragThreshold?: number;
  
  // 回调函数
  onPositionChange?: (position: Position) => void;
  onSizeChange?: (size: Size) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}

export interface UseDraggableReturn {
  // 状态
  isDragging: boolean;
  isResizing: boolean;
  
  // 拖拽处理器
  handleMouseDown: (event: React.MouseEvent) => void;
  
  // 调整大小处理器
  handleResizeStart: (event: React.MouseEvent) => void;
}

export const useDraggable = ({
  initialPosition,
  initialSize,
  disabled = false,
  minWidth = 150,
  minHeight = 100,
  dragThreshold = 6,
  onPositionChange,
  onSizeChange,
  onDragStart,
  onDragEnd,
  onResizeStart,
  onResizeEnd,
}: UseDraggableOptions): UseDraggableReturn => {
  
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState<DragState | null>(null);
  const [resizeStart, setResizeStart] = useState<ResizeState | null>(null);
  const dragActiveRef = useRef(false);
  
  // 🚀 性能优化：缓存DOM元素和缩放比例
  const [cachedScale, setCachedScale] = useState(1);
  const [transformElement, setTransformElement] = useState<Element | null>(null);
  
  // 🚀 缓存DOM查询结果，避免每次移动都重新查询
  const getCachedScale = useCallback(() => {
    const activeElement = transformElement && (transformElement as HTMLElement).isConnected
      ? transformElement
      : null;
    if (!activeElement) {
      if (transformElement) setTransformElement(null);
      // 首次查询或缓存失效，重新获取
      const canvasContainer = document.querySelector('[data-canvas-container]');
      if (canvasContainer) {
        const transformWrapper = canvasContainer.querySelector('.react-transform-wrapper');
        const transformComponent = transformWrapper?.querySelector('.react-transform-component');
        
        if (transformComponent) {
          setTransformElement(transformComponent);
          
          const style = window.getComputedStyle(transformComponent);
          const transform = style.transform;
          
          if (transform && transform !== 'none') {
            const matrix = new DOMMatrix(transform);
            const scale = matrix.a;
            setCachedScale(scale);
            return scale;
          }
        }
      }
      return 1;
    }
    
    // 使用缓存的元素快速获取缩放比例
    try {
      const style = window.getComputedStyle(activeElement);
      const transform = style.transform;
      
      if (transform && transform !== 'none') {
        const matrix = new DOMMatrix(transform);
        const scale = matrix.a;
        setCachedScale(scale);
        return scale;
      }
    } catch (error) {
      // 缓存失效，清空缓存重新查询
      setTransformElement(null);
      return getCachedScale();
    }
    
    return cachedScale;
  }, [transformElement, cachedScale]);

  // 🖱️ 处理拖拽开始
  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if (disabled) return;
    // 仅处理左键按下，避免右键影响自定义菜单
    if (event.button !== 0) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    dragActiveRef.current = false;
    setIsDragging(false);
    setDragStart({
      x: event.clientX,
      y: event.clientY,
      nodeX: initialPosition.x,
      nodeY: initialPosition.y
    });
  }, [disabled, initialPosition]);

  // 🚀 使用requestAnimationFrame优化拖拽移动性能
  const animationFrameRef = useRef<number | null>(null);
  
  // 🖱️ 处理拖拽移动 - 🚀 高性能版本
  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!dragStart || disabled) return;

    const deltaX = event.clientX - dragStart.x;
    const deltaY = event.clientY - dragStart.y;
    const dist = Math.hypot(deltaX, deltaY);

    if (!dragActiveRef.current) {
      if (dist < dragThreshold) return;
      dragActiveRef.current = true;
      setIsDragging(true);
      onDragStart?.();
    }
    
    // 🚀 使用requestAnimationFrame避免过度渲染
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    animationFrameRef.current = requestAnimationFrame(() => {
      // 🚀 使用缓存的缩放比例，避免重复DOM查询
      const currentScale = getCachedScale();
      
      // 🎯 将屏幕像素差值转换为画布逻辑差值
      const logicalDeltaX = deltaX / currentScale;
      const logicalDeltaY = deltaY / currentScale;
      
      const newPosition = {
        x: dragStart.nodeX + logicalDeltaX,
        y: dragStart.nodeY + logicalDeltaY
      };
      
      onPositionChange?.(newPosition);
      animationFrameRef.current = null;
    });
  }, [dragStart, disabled, dragThreshold, onPositionChange, onDragStart, getCachedScale]);

  // 🖱️ 处理拖拽结束
  const handleMouseUp = useCallback(() => {
    if (!dragStart) return;

    // 🚀 清理待执行的动画帧，避免内存泄漏
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    dragActiveRef.current = false;
    setIsDragging(false);
    setDragStart(null);
    onDragEnd?.();
  }, [dragStart, onDragEnd]);

  // 📏 处理调整大小开始
  const handleResizeStart = useCallback((event: React.MouseEvent) => {
    if (disabled) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    setIsResizing(true);
    setResizeStart({
      x: event.clientX,
      y: event.clientY,
      width: initialSize.width,
      height: initialSize.height
    });
    
    onResizeStart?.();
  }, [disabled, initialSize, onResizeStart]);

  // 🚀 使用requestAnimationFrame优化调整大小性能
  const resizeAnimationFrameRef = useRef<number | null>(null);
  
  // 📏 处理调整大小移动 - 🚀 高性能版本
  const handleResizeMove = useCallback((event: MouseEvent) => {
    if (!isResizing || !resizeStart || disabled) return;
    
    // 🚀 使用requestAnimationFrame避免过度渲染
    if (resizeAnimationFrameRef.current) {
      cancelAnimationFrame(resizeAnimationFrameRef.current);
    }
    
    resizeAnimationFrameRef.current = requestAnimationFrame(() => {
      const deltaX = event.clientX - resizeStart.x;
      const deltaY = event.clientY - resizeStart.y;
      
      // 🚀 使用缓存的缩放比例，避免重复DOM查询
      const currentScale = getCachedScale();
      
      // 🎯 将屏幕像素差值转换为画布逻辑差值
      const logicalDeltaX = deltaX / currentScale;
      const logicalDeltaY = deltaY / currentScale;
      
      const newSize = {
        width: Math.max(minWidth, resizeStart.width + logicalDeltaX),
        height: Math.max(minHeight, resizeStart.height + logicalDeltaY)
      };
      
      onSizeChange?.(newSize);
      resizeAnimationFrameRef.current = null;
    });
  }, [isResizing, resizeStart, disabled, minWidth, minHeight, onSizeChange, getCachedScale]);

  // 📏 处理调整大小结束
  const handleResizeEnd = useCallback(() => {
    if (isResizing) {
      // 🚀 清理待执行的动画帧，避免内存泄漏
      if (resizeAnimationFrameRef.current) {
        cancelAnimationFrame(resizeAnimationFrameRef.current);
        resizeAnimationFrameRef.current = null;
      }
      
      setIsResizing(false);
      setResizeStart(null);
      onResizeEnd?.();
    }
  }, [isResizing, onResizeEnd]);

  // 🎮 全局事件监听 - 拖拽
  useEffect(() => {
    if (dragStart) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragStart, handleMouseMove, handleMouseUp]);

  // 🎮 全局事件监听 - 调整大小
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);
  
  // 🧹 组件卸载时清理所有动画帧，防止内存泄漏
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (resizeAnimationFrameRef.current) {
        cancelAnimationFrame(resizeAnimationFrameRef.current);
      }
    };
  }, []);

  return {
    isDragging,
    isResizing,
    handleMouseDown,
    handleResizeStart,
  };
};
