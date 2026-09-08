// 🖱️ SVG交互层
// 处理SVG元素的点击选择和交互

import React, { useCallback, useRef, useEffect } from 'react';
import type { SvgElement } from './utils/svgParser';

interface SvgInteractionLayerProps {
  /** SVG容器引用 */
  containerRef: React.RefObject<HTMLDivElement>;
  /** 解析后的SVG元素列表 */
  svgElements: SvgElement[];
  /** 当前选中的元素ID列表 */
  selectedElementIds: string[];
  /** 元素选择回调 */
  onElementSelect: (elementId: string, multiSelect: boolean) => void;
  /** 元素双击回调（可选） */
  onElementDoubleClick?: (elementId: string) => void;
  /** 是否启用交互 */
  enabled?: boolean;
}

export const SvgInteractionLayer: React.FC<SvgInteractionLayerProps> = ({
  containerRef,
  svgElements,
  selectedElementIds,
  onElementSelect,
  onElementDoubleClick,
  enabled = true
}) => {
  const layerRef = useRef<HTMLDivElement>(null);

  /**
   * 处理点击事件
   */
  const handleClick = useCallback((event: React.MouseEvent) => {
    if (!enabled || !containerRef.current) return;

    event.stopPropagation();

    // 获取容器的边界框
    const containerRect = containerRef.current.getBoundingClientRect();

    // 计算相对于容器的点击坐标
    const clickX = event.clientX - containerRect.left;
    const clickY = event.clientY - containerRect.top;


    // 使用document.elementFromPoint获取被点击的元素
    // 临时隐藏交互层以获取下层元素
    if (layerRef.current) {
      layerRef.current.style.pointerEvents = 'none';
    }

    const elementAtPoint = document.elementFromPoint(event.clientX, event.clientY);

    if (layerRef.current) {
      layerRef.current.style.pointerEvents = 'auto';
    }

    // 检查是否是SVG元素
    if (elementAtPoint && elementAtPoint.tagName !== 'svg') {
      // 尝试获取元素ID
      const clickedId = elementAtPoint.getAttribute('id');

      if (clickedId) {
        // 检查是否在我们的元素列表中
        const svgElement = svgElements.find(el => el.id === clickedId);

        if (svgElement) {
          const multiSelect = event.ctrlKey || event.metaKey || event.shiftKey;
          onElementSelect(clickedId, multiSelect);
          return;
        }
      }
    }

    // 如果没有找到元素，清空选择
    onElementSelect('', false);
  }, [enabled, containerRef, svgElements, onElementSelect]);

  /**
   * 处理双击事件
   */
  const handleDoubleClick = useCallback((event: React.MouseEvent) => {
    if (!enabled || !containerRef.current || !onElementDoubleClick) return;

    event.stopPropagation();

    // 使用document.elementFromPoint获取被双击的元素
    if (layerRef.current) {
      layerRef.current.style.pointerEvents = 'none';
    }

    const elementAtPoint = document.elementFromPoint(event.clientX, event.clientY);

    if (layerRef.current) {
      layerRef.current.style.pointerEvents = 'auto';
    }

    // 检查是否是SVG元素
    if (elementAtPoint && elementAtPoint.tagName !== 'svg') {
      const clickedId = elementAtPoint.getAttribute('id');

      if (clickedId) {
        const svgElement = svgElements.find(el => el.id === clickedId);

        if (svgElement) {
          console.log('🖱️ 双击元素:', { id: clickedId, type: svgElement.type });
          onElementDoubleClick(clickedId);
          return;
        }
      }
    }
  }, [enabled, containerRef, svgElements, onElementDoubleClick]);

  /**
   * 处理鼠标悬停（未来可用于高亮）
   */
  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (!enabled) return;
    // TODO: 实现悬停高亮效果
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  return (
    <div
      ref={layerRef}
      className="absolute inset-0 cursor-pointer"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseMove={handleMouseMove}
      style={{
        pointerEvents: 'auto',
        zIndex: 10
      }}
      title="点击选择SVG元素，点击文字可直接编辑"
    />
  );
};

export default SvgInteractionLayer;
