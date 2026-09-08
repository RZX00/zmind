// 📱 移动端画布适配器组件
// 专门针对移动设备优化的画布体验

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { ZoomIn, ZoomOut, Home, Grid, List, Eye, Menu } from 'lucide-react';
import VirtualizedCanvas from './VirtualizedCanvas';
import type { Canvas, CanvasNode, CanvasToolMode, CornerStyle, FontStyle } from '../../types/canvas';

interface MobileCanvasAdapterProps {
  canvas: Canvas;
  isEditMode?: boolean;
  toolMode?: CanvasToolMode;
  cornerStyle?: CornerStyle;
  fontStyle?: FontStyle;
  onCanvasChange?: (canvas: Canvas) => void;
  onNodeClick?: (nodeId: string) => void;
  onCanvasClick?: () => void;
}

const MobileCanvasAdapter: React.FC<MobileCanvasAdapterProps> = ({
  canvas,
  isEditMode = false,
  toolMode = 'select',
  cornerStyle,
  fontStyle,
  onCanvasChange,
  onNodeClick,
  onCanvasClick
}) => {
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const [viewMode, setViewMode] = useState<'canvas' | 'list'>('canvas');
  const [showMobileTools, setShowMobileTools] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(100);
  const [isCompactMode, setIsCompactMode] = useState(false);
  const [touchStartTime, setTouchStartTime] = useState(0);
  const [lastTap, setLastTap] = useState(0);

  // 检测设备类型
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  // 移动端优化的节点过滤
  const optimizedNodes = useMemo(() => {
    if (!isMobile) return canvas.nodes;
    
    // 在移动端优先显示较小的节点
    return canvas.nodes
      .sort((a, b) => {
        const aArea = a.width * a.height;
        const bArea = b.width * b.height;
        return aArea - bArea;
      })
      .slice(0, isCompactMode ? 20 : 30); // 限制节点数量
  }, [canvas.nodes, isMobile, isCompactMode]);

  // 触摸手势处理
  const handleResetView = useCallback(() => {
    transformRef.current?.resetTransform(300);
  }, []);

  const handleTouchStart = useCallback((_event: React.TouchEvent) => {
    setTouchStartTime(Date.now());
    
    // 双击检测
    const now = Date.now();
    const timeDiff = now - lastTap;
    if (timeDiff < 300 && timeDiff > 0) {
      // 双击重置视图
      handleResetView();
    }
    setLastTap(now);
  }, [lastTap, handleResetView]);

  const handleTouchEnd = useCallback((_event: React.TouchEvent) => {
    const touchDuration = Date.now() - touchStartTime;
    
    // 长按显示工具栏
    if (touchDuration > 500) {
      setShowMobileTools(!showMobileTools);
    }
  }, [touchStartTime, showMobileTools]);

  // 缩放控制
  const handleZoomIn = useCallback(() => {
    transformRef.current?.zoomIn(0.3, 200);
  }, []);

  const handleZoomOut = useCallback(() => {
    transformRef.current?.zoomOut(0.3, 200);
  }, []);

  

  // 监听缩放变化
  const handleTransformChange = useCallback((ref: ReactZoomPanPinchRef) => {
    setCurrentZoom(Math.round(ref.state.scale * 100));
  }, []);

  // 自适应初始缩放
  useEffect(() => {
    if (!transformRef.current || !canvas.nodes.length) return;

    const timer = setTimeout(() => {
      const containerWidth = window.innerWidth;
      const containerHeight = window.innerHeight;
      
      // 计算内容边界
      const maxX = Math.max(...canvas.nodes.map(n => n.x + n.width));
      const maxY = Math.max(...canvas.nodes.map(n => n.y + n.height));
      const minX = Math.min(...canvas.nodes.map(n => n.x));
      const minY = Math.min(...canvas.nodes.map(n => n.y));
      
      const contentWidth = maxX - minX;
      const contentHeight = maxY - minY;
      
      // 计算适合的缩放比例
      const scaleX = (containerWidth * 0.8) / contentWidth;
      const scaleY = (containerHeight * 0.8) / contentHeight;
      const initialScale = Math.min(scaleX, scaleY, 1);
      
      transformRef.current?.setTransform(
        -(minX * initialScale) + (containerWidth - contentWidth * initialScale) / 2,
        -(minY * initialScale) + (containerHeight - contentHeight * initialScale) / 2,
        initialScale,
        300
      );
    }, 500);

    return () => clearTimeout(timer);
  }, [canvas.nodes]);

  // 列表视图渲染
  const renderListView = () => (
    <div className="mobile-scroll-container h-full overflow-y-auto bg-[#eeeded] dark:bg-[#121417]">
      <div className="mobile-content-area">
        {optimizedNodes.map((node, index) => (
          <div
            key={node.id}
            className="mobile-card mb-3 cursor-pointer mobile-touch-feedback"
            onClick={() => onNodeClick?.(node.id)}
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-200 rounded-full flex items-center justify-center text-xs font-medium">
                {index + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-800 dark:text-zinc-100 mobile-text-sm mb-1">
                  {node.type === 'text' ? '文本节点' : node.type}
                </div>
                <div className="mobile-text-xs text-gray-600 dark:text-zinc-300 mobile-line-clamp-2">
                  {node.content?.substring(0, 100) || '暂无内容'}
                </div>
                <div className="flex items-center gap-2 mt-2 mobile-text-xs text-gray-500 dark:text-zinc-400">
                  <span>{node.width}×{node.height}</span>
                  <span>•</span>
                  <span>{node.content?.length || 0} 字符</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="relative w-full h-full bg-[#eeeded] dark:bg-[#0f1115]">
      {/* 移动端顶部工具栏 */}
      <div className="mobile-safe-area-top absolute top-0 left-0 right-0 z-40 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm border-b border-gray-200 dark:border-zinc-700">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMobileTools(!showMobileTools)}
              className="mobile-touch-target p-2 text-gray-600 dark:text-zinc-300 hover:bg-accent/60 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="mobile-text-sm font-medium text-gray-800 dark:text-zinc-100">
              {canvas.title || '画布'}
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            {/* 视图切换 */}
            <button
              onClick={() => setViewMode(viewMode === 'canvas' ? 'list' : 'canvas')}
              className="mobile-touch-target p-2 text-gray-600 dark:text-zinc-300 hover:bg-accent/60 rounded-lg"
              title={viewMode === 'canvas' ? '列表视图' : '画布视图'}
            >
              {viewMode === 'canvas' ? <List className="w-4 h-4" /> : <Grid className="w-4 h-4" />}
            </button>
            
            {/* 紧凑模式切换 */}
            <button
              onClick={() => setIsCompactMode(!isCompactMode)}
              className={`mobile-touch-target p-2 rounded-lg ${isCompactMode ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-200' : 'text-gray-600 dark:text-zinc-300 hover:bg-accent/60'}`}
              title={isCompactMode ? '退出紧凑模式' : '紧凑模式'}
            >
              <Eye className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {/* 节点统计信息 */}
        <div className="px-3 pb-2 flex items-center justify-between mobile-text-xs text-gray-500 dark:text-zinc-400">
          <span>{optimizedNodes.length} 个节点</span>
          {viewMode === 'canvas' && (
            <span>缩放 {currentZoom}%</span>
          )}
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="pt-20 h-full">
        {viewMode === 'list' ? (
          renderListView()
        ) : (
          <div
            className="w-full h-full"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <TransformWrapper
              ref={transformRef}
              initialScale={0.6}
              minScale={0.1}
              maxScale={3}
              limitToBounds={false}
              centerOnInit={false}
              wheel={{ step: 0.1 }}
              pinch={{ step: 5 }}
              doubleClick={{ step: 0.3, mode: 'zoomIn' }}
              onTransformed={handleTransformChange}
              // 移动端优化配置
              smooth={true}
              velocityAnimation={{ sensitivity: 1, animationTime: 400 }}
            >
              <TransformComponent
                wrapperClass="w-full h-full"
                contentClass="relative"
              >
                <VirtualizedCanvas
                  canvas={{ ...canvas, nodes: optimizedNodes }}
                  isEditMode={isEditMode}
                  toolMode={toolMode}
                  cornerStyle={cornerStyle}
                  fontStyle={fontStyle}
                  onCanvasChange={onCanvasChange}
                  onNodeClick={onNodeClick}
                  onCanvasClick={onCanvasClick}
                />
              </TransformComponent>
            </TransformWrapper>
          </div>
        )}
      </div>

      {/* 移动端缩放控制 */}
      {viewMode === 'canvas' && (
        <div className="absolute bottom-6 right-6 z-30 flex flex-col gap-2">
          <button
            onClick={handleZoomIn}
            className="mobile-touch-target-optimal bg-white dark:bg-zinc-900 shadow-lg rounded-full p-3 text-gray-700 dark:text-zinc-100 hover:bg-accent/40"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <button
            onClick={handleZoomOut}
            className="mobile-touch-target-optimal bg-white dark:bg-zinc-900 shadow-lg rounded-full p-3 text-gray-700 dark:text-zinc-100 hover:bg-accent/40"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
          <button
            onClick={handleResetView}
            className="mobile-touch-target-optimal bg-white dark:bg-zinc-900 shadow-lg rounded-full p-3 text-gray-700 dark:text-zinc-100 hover:bg-accent/40"
          >
            <Home className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* 移动端工具面板 */}
      {showMobileTools && (
        <>
          {/* 背景遮罩 */}
          <div
            className="fixed inset-0 bg-black/20 dark:bg-black/55 z-40"
            onClick={() => setShowMobileTools(false)}
          />
          
          {/* 工具面板 */}
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-zinc-900 rounded-t-xl shadow-2xl mobile-safe-area-bottom border-t border-gray-200 dark:border-zinc-700">
            <div className="p-4">
              <div className="w-12 h-1 bg-gray-300 dark:bg-zinc-600 rounded-full mx-auto mb-4" />
              
              <div className="grid grid-cols-3 gap-4">
                <button
                  onClick={() => setIsCompactMode(!isCompactMode)}
                  className="flex flex-col items-center gap-2 p-4 rounded-lg hover:bg-accent/40 mobile-touch-feedback"
                >
                  <Eye className="w-6 h-6 text-gray-600 dark:text-zinc-300" />
                  <span className="mobile-text-xs text-gray-600 dark:text-zinc-300">紧凑模式</span>
                </button>
                
                <button
                  onClick={() => setViewMode(viewMode === 'canvas' ? 'list' : 'canvas')}
                  className="flex flex-col items-center gap-2 p-4 rounded-lg hover:bg-accent/40 mobile-touch-feedback"
                >
                  {viewMode === 'canvas' ? <List className="w-6 h-6 text-gray-600 dark:text-zinc-300" /> : <Grid className="w-6 h-6 text-gray-600 dark:text-zinc-300" />}
                  <span className="mobile-text-xs text-gray-600 dark:text-zinc-300">{viewMode === 'canvas' ? '列表' : '画布'}</span>
                </button>
                
                <button
                  onClick={handleResetView}
                  className="flex flex-col items-center gap-2 p-4 rounded-lg hover:bg-accent/40 mobile-touch-feedback"
                >
                  <Home className="w-6 h-6 text-gray-600 dark:text-zinc-300" />
                  <span className="mobile-text-xs text-gray-600 dark:text-zinc-300">重置</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 性能提示 */}
      {isMobile && canvas.nodes.length > 30 && (
        <div className="absolute top-24 left-4 right-4 z-30 bg-orange-50 dark:bg-orange-950/35 border border-orange-200 dark:border-orange-800/60 rounded-lg p-3">
          <div className="mobile-text-sm text-orange-800 dark:text-orange-200">
            <strong>性能提示：</strong>检测到大量节点，建议开启紧凑模式以优化性能。
          </div>
          <button
            onClick={() => setIsCompactMode(true)}
            className="mt-2 mobile-button-small mobile-button-primary"
          >
            开启紧凑模式
          </button>
        </div>
      )}
    </div>
  );
};

export default MobileCanvasAdapter;
