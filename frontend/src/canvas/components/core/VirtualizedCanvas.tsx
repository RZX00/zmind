// 🚀 虚拟化画布组件
// 针对大型模板优化渲染性能，支持40+节点流畅显示

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import NodeContainer from '../nodes/shared/NodeContainer';
import type { Canvas, CanvasNode, CanvasToolMode, CornerStyle, FontStyle } from '../../types/canvas';
import { Loader2 } from 'lucide-react';
import { useVirtualizationConfig } from '../../hooks/useVirtualizationConfig';
import PerformanceIndicator from '../shared/PerformanceIndicator';
import TextNode from '../nodes/text/TextNode';
import { computeOverlapShadowMap } from '../../utils/overlapShadow';

interface ViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface VirtualizedCanvasProps {
  canvas: Canvas;
  isEditMode?: boolean;
  toolMode?: CanvasToolMode;
  cornerStyle?: CornerStyle;
  fontStyle?: FontStyle;
  onCanvasChange?: (canvas: Canvas) => void;
  onNodeClick?: (nodeId: string) => void;
  onCanvasClick?: () => void;
  // Optional: externally control view (world center + scale)
  controlledView?: { centerX: number; centerY: number; scale: number } | null;
  // Optional: highlight a node
  highlightNodeId?: string | null;
  // Optional: override className and performance HUD
  className?: string;
  showPerformanceIndicator?: boolean;
  // Disable all user interactions (pan/zoom/click/drag)
  disableInteractions?: boolean;
  // Optional node opacity mapping for cross-fades
  nodeOpacityMap?: Record<string, number>;
}

const VirtualizedCanvas: React.FC<VirtualizedCanvasProps> = ({
  canvas,
  isEditMode = false,
  toolMode = 'select',
  cornerStyle,
  fontStyle,
  onCanvasChange,
  onNodeClick,
  onCanvasClick,
  controlledView = null,
  highlightNodeId = null,
  className = 'bg-transparent',
  showPerformanceIndicator = true,
  disableInteractions = false,
  nodeOpacityMap,
}) => {
  // 🎯 使用智能配置管理Hook
  const { config, shouldVirtualizeCanvas, reportPerformance } = useVirtualizationConfig();
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const viewportUpdateRafRef = useRef<number | null>(null);
  const [viewportBounds, setViewportBounds] = useState<ViewportBounds>({
    left: -1000,
    top: -1000,
    right: 2000,
    bottom: 2000
  });
  const lastViewportBoundsRef = useRef<ViewportBounds>({
    left: -1000,
    top: -1000,
    right: 2000,
    bottom: 2000
  });
  const [currentZoom, setCurrentZoom] = useState(1);
  const lastZoomRef = useRef<number>(100);
  const [currentFrameTime, setCurrentFrameTime] = useState(16);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const frameTimeRef = useRef<number>(16);

  // 计算视口边界
  const updateViewportBounds = useCallback(() => {
    if (viewportUpdateRafRef.current) return;
    const schedule = (typeof requestAnimationFrame === 'function')
      ? requestAnimationFrame
      : ((cb: FrameRequestCallback) => (typeof window !== 'undefined' ? window.setTimeout(cb, 16) : (setTimeout as any)(cb, 16)));
    viewportUpdateRafRef.current = schedule(() => {
      viewportUpdateRafRef.current = null;
      try {
        const api: any = transformRef.current;
        if (!api) return;
        const instance = api.instance;
        const state = api.state || instance?.transformState;
        if (!instance || !state) return;
        const { positionX = 0, positionY = 0, scale = 1 } = state;
        const containerElement: HTMLElement | undefined = instance.wrapperComponent;
        if (!containerElement) return;
        const rect = containerElement.getBoundingClientRect();
        if (!rect || rect.width === 0 || rect.height === 0) return;
        const viewportWidth = rect.width / (scale || 1);
        const viewportHeight = rect.height / (scale || 1);
        const padding = config.canvasVisibilityPadding;
        const left = -(positionX || 0) / (scale || 1) - padding;
        const top = -(positionY || 0) / (scale || 1) - padding;
        const right = left + viewportWidth + padding * 2;
        const bottom = top + viewportHeight + padding * 2;
        const next = { left, top, right, bottom };
        const prev = lastViewportBoundsRef.current;
        const changed = Math.abs(next.left - prev.left) > 0.5
          || Math.abs(next.top - prev.top) > 0.5
          || Math.abs(next.right - prev.right) > 0.5
          || Math.abs(next.bottom - prev.bottom) > 0.5;
        if (changed) {
          lastViewportBoundsRef.current = next;
          setViewportBounds(next);
        }
      } catch {
        /* ignore */
      }
    });
  }, [config.canvasVisibilityPadding]);

  // 监听变换事件 + 性能监控
  const handleTransformChange = useCallback((ref: ReactZoomPanPinchRef) => {
    const now = performance.now();
    const frameTime = now - lastFrameTimeRef.current;
    lastFrameTimeRef.current = now;

    // 报告性能指标（仅在有实际移动时）
    if (frameTime > 0) {
      reportPerformance(frameTime);
      if (Math.abs(frameTimeRef.current - frameTime) > 0.5) {
        frameTimeRef.current = frameTime;
        setCurrentFrameTime(frameTime);
      }
    }

    const s = (ref as any)?.state?.scale ?? (transformRef.current as any)?.state?.scale ?? (transformRef.current as any)?.instance?.transformState?.scale ?? 1;
    const pct = Math.round((s || 1) * 100);
    if (pct !== lastZoomRef.current) {
      lastZoomRef.current = pct;
      setCurrentZoom(pct);
    }
    updateViewportBounds();
  }, [updateViewportBounds, reportPerformance]);

  // 应用受控视图（基于世界中心坐标）
  useEffect(() => {
    if (!controlledView || !transformRef.current) return;
    let cancelled = false;
    let attempts = 0;
    const apply = () => {
      if (cancelled) return;
      try {
        const { centerX, centerY, scale } = controlledView;
        const api: any = transformRef.current;
        const instance = api?.instance;
        const wrapper: HTMLElement | undefined = instance?.wrapperComponent;
        if (!instance || !wrapper) { attempts++; return void requestAnimationFrame(apply); }
        const rect = wrapper.getBoundingClientRect();
        const vw = rect.width || 0;
        const vh = rect.height || 0;
        if (vw < 8 || vh < 8) { // wait for layout
          attempts++;
          if (attempts < 24) return void requestAnimationFrame(apply);
        }
        const s = Math.max(0.1, scale || 1);
        const positionX = vw / 2 - centerX * s;
        const positionY = vh / 2 - centerY * s;
        api.setTransform(positionX, positionY, s);
        requestAnimationFrame(() => updateViewportBounds());
      } catch { /* retry next frame */ requestAnimationFrame(apply); }
    };
    apply();
    return () => { cancelled = true; };
  }, [controlledView, updateViewportBounds]);

  // 检查节点是否在视口内
  const isNodeInViewport = useCallback((node: CanvasNode): boolean => {
    const nodeLeft = node.x;
    const nodeTop = node.y;
    const nodeRight = node.x + node.width;
    const nodeBottom = node.y + node.height;

    return !(
      nodeRight < viewportBounds.left ||
      nodeLeft > viewportBounds.right ||
      nodeBottom < viewportBounds.top ||
      nodeTop > viewportBounds.bottom
    );
  }, [viewportBounds]);

  // 🎯 智能可见节点计算
  const visibleNodes = useMemo(() => {
    if (!shouldVirtualizeCanvas(canvas.nodes.length)) {
      return canvas.nodes;
    }

    // 使用智能阈值过滤视口内的节点
    return canvas.nodes.filter(isNodeInViewport);
  }, [canvas.nodes, isNodeInViewport, shouldVirtualizeCanvas]);

  // 初始化视口
  useEffect(() => {
    const timer = setTimeout(() => {
      updateViewportBounds();
    }, 100);
    return () => clearTimeout(timer);
  }, [updateViewportBounds]);

  useEffect(() => () => {
    if (viewportUpdateRafRef.current) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(viewportUpdateRafRef.current);
      else clearTimeout(viewportUpdateRafRef.current);
    }
  }, []);

  // 是否启用了虚拟化
  const isVirtualized = shouldVirtualizeCanvas(canvas.nodes.length) && visibleNodes.length < canvas.nodes.length;

  // 轻量遮挡检测：虚拟化场景仅需根据可见节点判断是否重叠
  const overlapShadowMap = React.useMemo(() => {
    try {
      const renderIndex = new Map<string, number>();
      (canvas.nodes || []).forEach((n, idx) => renderIndex.set(n.id, idx));
      const stackLevel = () => 1;
      const nodeOpacity = (n: any) => {
        try {
          if (n?.type === 'media') return 0;
          if (n?.type === 'code' && n?.codeType === 'svg') {
            return n?.svgBgMode === 'auto' ? 1 : 0;
          }
          if (n?.type === 'group') {
            const bg = n?.groupStyles?.bgOpacity;
            return typeof bg === 'number' ? (isFinite(bg) ? bg : 0) : 0;
          }
          const ts = n?.textStyles;
          const op = typeof ts?.opacity === 'number' ? ts.opacity : 1;
          return isFinite(op) ? op : 1;
        } catch { return 1; }
      };
      const isFullyOpaque = (n: any) => {
        try {
          if (n?.type === 'media') return false;
          if (n?.type === 'code' && n?.codeType === 'svg') return n?.svgBgMode === 'auto';
          if (n?.type === 'group') {
            const bg = n?.groupStyles?.bgOpacity;
            return typeof bg === 'number' ? bg >= 0.999 : false;
          }
          return nodeOpacity(n) >= 0.999;
        } catch { return false; }
      };
      return computeOverlapShadowMap({
        spatialIndex: null,
        stackLevel,
        nodeOpacity,
        isFullyOpaque,
        renderIndex,
        visibleNodes,
      });
    } catch {
      return {} as Record<string, boolean>;
    }
  }, [visibleNodes, canvas.nodes]);


  return (
    <div className={`relative w-full h-full ${className}`}>
      {/* 🎯 智能性能指示器 */}
      {showPerformanceIndicator && (
        <PerformanceIndicator
          totalNodes={canvas.nodes.length}
          visibleNodes={visibleNodes.length}
          totalConnections={canvas.connections?.length || 0}
          frameTime={currentFrameTime}
          position="top-right"
          compact={false}
        />
      )}

      {/* 缩放指示器 */}
      {!disableInteractions && (
        <div className="absolute top-4 left-4 z-10 bg-white/90 dark:bg-zinc-900/85 backdrop-blur-sm rounded-lg px-3 py-2 text-xs text-gray-600 dark:text-zinc-300 shadow-sm border border-gray-200/70 dark:border-zinc-700/70">
          🔍 {currentZoom}%
        </div>
      )}

      <TransformWrapper
        ref={transformRef}
        initialScale={0.8}
        minScale={0.1}
        maxScale={3}
        limitToBounds={false}
        centerOnInit={true}
        wheel={{ step: 0.1, disabled: disableInteractions }}
        pinch={{ disabled: disableInteractions }}
        doubleClick={{ disabled: disableInteractions }}
        panning={{ disabled: disableInteractions } as any}
        onTransformed={handleTransformChange}
        onInit={() => updateViewportBounds()}
      >
        <TransformComponent
          wrapperClass={`w-full h-full overflow-hidden ${disableInteractions ? 'pointer-events-none select-none' : ''}`}
          contentClass={`${disableInteractions ? 'pointer-events-none select-none' : ''}`}
        >
          <div
            className="relative"
            style={{
              width: Math.max(2000, ...canvas.nodes.map(n => n.x + n.width)),
              height: Math.max(2000, ...canvas.nodes.map(n => n.y + n.height))
            }}
            onClick={onCanvasClick}
          >
              {/* 渲染可见节点 */}
              {visibleNodes.map((node) => (
                <div
                  key={node.id}
                  className={`absolute ${highlightNodeId === node.id ? 'ring-2 ring-brand-500 shadow-lg shadow-brand-500/20' : ''}`}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: node.width,
                    height: node.height,
                    opacity: nodeOpacityMap && nodeOpacityMap[node.id] !== undefined ? nodeOpacityMap[node.id] : 1,
                    transition: 'box-shadow 300ms ease, outline 300ms ease',
                  }}
                >
              <NodeContainer
                node={node}
                cornerStyle={cornerStyle}
                fontStyle={fontStyle}
                dragDisabled={disableInteractions}
                hasOverlapShadow={!!overlapShadowMap[node.id]}
                onSelect={disableInteractions ? undefined : (onNodeClick ? (id) => onNodeClick(id) : undefined)}
                onPositionChange={onCanvasChange ? (id, pos) => {
                  const updatedNodes = canvas.nodes.map(n =>
                        n.id === id ? { ...n, x: pos.x, y: pos.y } : n
                      );
                      onCanvasChange({ ...canvas, nodes: updatedNodes });
                    } : undefined}
                  >
                    {node.type === 'text' ? (
                      <TextNode node={node as any} editing={false} fontStyle={fontStyle} />
                    ) : (
                      <div className="w-full h-full" />
                    )}
                  </NodeContainer>
                </div>
              ))}

              {/* 连接线 */}
              {canvas.connections?.map((connection) => (
                <div key={connection.id}>
                  {/* 这里可以添加连接线的渲染逻辑 */}
                </div>
              ))}
          </div>
        </TransformComponent>
      </TransformWrapper>

    </div>
  );
};

export default VirtualizedCanvas;
