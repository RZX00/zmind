// ✨ SVG元素选择器
// 显示选中元素的高亮边框

import React, { useMemo } from 'react';
import type { SvgElement } from './utils/svgParser';

interface SvgElementSelectorProps {
  /** 所有SVG元素 */
  elements: SvgElement[];
  /** 选中的元素ID列表 */
  selectedIds: string[];
  /** SVG容器引用（用于坐标转换） */
  containerRef: React.RefObject<HTMLDivElement>;
  /** 渲染器注入的真实 <svg> 根节点（用于测量真实DOM元素） */
  svgRoot?: SVGSVGElement | null;
  /** 当前画布缩放比例 */
  viewScale?: number;
}

export const SvgElementSelector: React.FC<SvgElementSelectorProps> = ({
  elements,
  selectedIds,
  containerRef,
  svgRoot,
  viewScale = 1
}) => {
  // 获取选中的元素
  const selectedElements = useMemo(() => {
    return elements.filter(el => selectedIds.includes(el.id));
  }, [elements, selectedIds]);

  if (selectedElements.length === 0) {
    return null;
  }

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
      {selectedElements.map(element => (
        <SelectionBox
          key={element.id}
          element={element}
          containerRef={containerRef}
          svgRoot={svgRoot}
          viewScale={viewScale}
        />
      ))}
    </div>
  );
};

/**
 * 单个元素的选择框
 */
interface SelectionBoxProps {
  element: SvgElement;
  containerRef: React.RefObject<HTMLDivElement>;
  svgRoot?: SVGSVGElement | null;
  viewScale: number;
}

const SelectionBox: React.FC<SelectionBoxProps> = ({ element, containerRef, svgRoot, viewScale }) => {
  try {
    if (!containerRef.current || !svgRoot) return null;
    // 在真实渲染的SVG中查找对应元素
    const realEl = svgRoot.querySelector(`[id="${element.id}"]`) as (SVGGraphicsElement | null);
    if (!realEl || typeof realEl.getBoundingClientRect !== 'function') return null;

    const rect = realEl.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();

    // 转换为容器内的相对坐标（回退到未缩放单位）
    const s = (isFinite(viewScale) && viewScale > 0) ? viewScale : 1;
    const left = (rect.left - containerRect.left) / s;
    const top = (rect.top - containerRect.top) / s;
    const width = rect.width / s;
    const height = rect.height / s;

    if (!width || !height) return null;

    // 合成一个伪 DOMRect，供控制点使用
    const bbox = new DOMRect(left, top, width, height);

    return (
      <>
        {/* 主选择框（相对容器定位） */}
        <div
          className="absolute border-2 border-blue-500 rounded animate-in fade-in duration-200"
          style={{
            left,
            top,
            width,
            height,
            pointerEvents: 'none'
          }}
        />

        {/* 四个角的控制点（相对容器定位） */}
        <SelectionHandles bbox={bbox} />
      </>
    );
  } catch (error) {
    console.warn('无法获取元素边界框:', element.id, error);
    return null;
  }
};

/**
 * 选择框的控制点
 */
interface SelectionHandlesProps {
  bbox: DOMRect;
}

const SelectionHandles: React.FC<SelectionHandlesProps> = ({ bbox }) => {
  const handleSize = 8;
  const handleStyle = 'absolute w-2 h-2 bg-blue-500 border border-white rounded-full';

  return (
    <>
      {/* 左上 */}
      <div
        className={handleStyle}
        style={{
          left: bbox.left - handleSize / 2,
          top: bbox.top - handleSize / 2,
          pointerEvents: 'auto',
          cursor: 'nwse-resize'
        }}
      />

      {/* 右上 */}
      <div
        className={handleStyle}
        style={{
          left: bbox.right - handleSize / 2,
          top: bbox.top - handleSize / 2,
          pointerEvents: 'auto',
          cursor: 'nesw-resize'
        }}
      />

      {/* 左下 */}
      <div
        className={handleStyle}
        style={{
          left: bbox.left - handleSize / 2,
          top: bbox.bottom - handleSize / 2,
          pointerEvents: 'auto',
          cursor: 'nesw-resize'
        }}
      />

      {/* 右下 */}
      <div
        className={handleStyle}
        style={{
          left: bbox.right - handleSize / 2,
          top: bbox.bottom - handleSize / 2,
          pointerEvents: 'auto',
          cursor: 'nwse-resize'
        }}
      />
    </>
  );
};

export default SvgElementSelector;
