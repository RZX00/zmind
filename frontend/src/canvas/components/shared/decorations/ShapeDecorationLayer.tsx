// 🎨 形状装饰层组件
// 实现外层装饰 + 内层内容的分离式设计
// 支持圆形、三角形等装饰形状，不影响内容区域

import React from 'react';
import { useTheme } from 'next-themes';
import type { NodeShapeDecoration } from '../../../../types/canvas';

interface ShapeDecorationLayerProps {
  shape: NodeShapeDecoration;
  nodeSize: { width: number; height: number };
  selected?: boolean; // 选中状态影响装饰样式
  className?: string;
  nodeOpacity?: number; // 🎨 节点透明度，用于同步形状透明度
  shadowEnabled?: boolean;
  // 可选：堆叠边框弧段/边段（仅 circle/diamond 支持）
  rimSegments?:
    | { kind: 'circle'; segments: Array<{ t0: number; t1: number }>; color?: string; thickness?: number }
    | { kind: 'diamond'; segments: Array<{ edge: 'top'|'right'|'bottom'|'left'; s0: number; s1: number }>; color?: string; thickness?: number };
}

/**
 * 🎨 形状装饰层组件
 * 
 * 设计理念：
 * - 装饰层完全独立，不影响内容布局
 * - 支持多种几何形状
 * - 可扩展自定义形状
 * - 性能优化：pointer-events: none
 */
const ShapeDecorationLayer: React.FC<ShapeDecorationLayerProps> = ({
  shape,
  nodeSize,
  selected = false,
  className = '',
  nodeOpacity = 1,
  shadowEnabled = true,
  rimSegments
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  // 🎯 装饰层基础配置
  const offset = shape.offset || 8; // 默认外扩8px
  const strokeWidth = shape.strokeWidth || 2;
  const strokeColor = shape.strokeColor || (selected ? '#2563eb' : '#6b7280');
  
  // 🎨 计算最终的填充色和透明度，考虑节点透明度
  const baseFillColor = shape.fillColor || 'transparent';
  // 主题自适应：当 fillColor 为 'auto' 或使用了默认浅色填充时，在深色主题下替换为深色半透明；
  // 保持用户自定义颜色不被覆盖。
  const isDefaultLight = baseFillColor === 'rgba(255, 255, 255, 0.9)';
  let finalFillColor = baseFillColor === 'auto'
    ? (isDark ? 'rgba(24, 26, 27, 0.9)' : 'rgba(255, 255, 255, 0.9)')
    : (isDark && isDefaultLight ? 'rgba(24, 26, 27, 0.9)' : baseFillColor);
  let finalOpacity = (shape.opacity || 1) * nodeOpacity;

  // 🎯 当节点透明度为0时，只让背景透明，保留边框
  if (nodeOpacity === 0) {
    finalFillColor = 'transparent';
    finalOpacity = 1; // 保持容器可见，只让背景透明
  } else if (baseFillColor !== 'transparent' && baseFillColor.startsWith('rgba(')) {
    // 解析现有的rgba值并调整透明度
    const match = baseFillColor.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    if (match) {
      const [, r, g, b, a] = match;
      const adjustedAlpha = parseFloat(a) * nodeOpacity;
      finalFillColor = `rgba(${r}, ${g}, ${b}, ${adjustedAlpha})`;
      finalOpacity = 1; // 透明度已经融合到颜色中
    }
  } else if (baseFillColor !== 'transparent') {
    // 对于非rgba格式的颜色，使用opacity属性控制
    finalOpacity = nodeOpacity;
  }

  const enableShadow = shadowEnabled && finalFillColor !== 'transparent';

  // 📐 计算装饰层尺寸
  const decorationSize = {
    width: nodeSize.width + (offset * 2),
    height: nodeSize.height + (offset * 2)
  };

  /**
   * 🟢 圆形装饰渲染
   */
  const renderCircleDecoration = () => (
    <div 
      className={`shape-decoration-circle ${className}`}
      style={{
        position: 'absolute',
        top: -offset,
        left: -offset,
        width: decorationSize.width,
        height: decorationSize.height,
        borderRadius: '50%',
        border: `${strokeWidth}px solid ${strokeColor}`,
        backgroundColor: finalFillColor,
        backdropFilter: finalFillColor !== 'transparent' ? `blur(${12 * nodeOpacity}px)` : 'none',
        boxShadow: enableShadow ? `0 2px 6px rgba(0, 0, 0, ${0.04 * nodeOpacity})` : 'none',
        opacity: finalOpacity,
        pointerEvents: 'none', // 🔑 关键：不阻挡内容交互
        transition: 'all 0.2s ease',
        zIndex: 0 // 确保在内容下方
      }}
    />
  );


  /**
   * 🔷 菱形装饰渲染
   */
  const renderDiamondDecoration = () => {
    const centerX = decorationSize.width / 2;
    const centerY = decorationSize.height / 2;
    
    const points = [
      [centerX, offset], // 上
      [decorationSize.width - offset, centerY], // 右
      [centerX, decorationSize.height - offset], // 下
      [offset, centerY] // 左
    ].map(([x, y]) => `${x},${y}`).join(' ');

    return (
      <svg
        className={`shape-decoration-diamond ${className}`}
        style={{
          position: 'absolute',
          top: -offset,
          left: -offset,
          width: decorationSize.width,
          height: decorationSize.height,
          pointerEvents: 'none',
          zIndex: 0,
          opacity: finalOpacity,
          transition: 'all 0.2s ease',
          // 为SVG添加阴影效果
          filter: enableShadow ? `drop-shadow(0 2px 6px rgba(0, 0, 0, ${0.04 * nodeOpacity}))` : 'none'
        }}
      >
        {/* 背景层（毛玻璃效果）*/}
        {finalFillColor !== 'transparent' && (
          <defs>
            <filter id="backdrop-blur-diamond">
              <feGaussianBlur in="BackgroundImage" stdDeviation={6 * nodeOpacity}/>
            </filter>
          </defs>
        )}
        <polygon
          points={points}
          fill={finalFillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          style={{
            backdropFilter: finalFillColor !== 'transparent' ? `blur(${12 * nodeOpacity}px)` : 'none'
          }}
        />
      </svg>
    );
  };

  // 🚫 六边形装饰已移除 - 只保留圆形、三角形、菱形

  /**
   * 🎨 自定义形状装饰渲染
   */
  const renderCustomDecoration = () => {
    if (!shape.customPath) return null;

    return (
      <svg
        className={`shape-decoration-custom ${className}`}
        style={{
          position: 'absolute',
          top: -offset,
          left: -offset,
          width: decorationSize.width,
          height: decorationSize.height,
          pointerEvents: 'none',
          zIndex: 0,
          opacity: finalOpacity,
          transition: 'all 0.2s ease'
        }}
      >
        <path
          d={shape.customPath}
          fill={finalFillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
        />
      </svg>
    );
  };

  // 🎯 根据形状类型渲染对应装饰
  const renderShapeDecoration = () => {
    switch (shape.type) {
      case 'circle':
        return (
          <>
            {renderCircleDecoration()}
            {rimSegments && rimSegments.kind === 'circle' && rimSegments.segments?.length > 0 && (
              // 叠加堆叠边框弧段（使用圆弧 path，圆帽端近似渐隐）
              <svg
                className={`pointer-events-none absolute ${className}`}
                style={{
                  top: -offset,
                  left: -offset,
                  width: decorationSize.width,
                  height: decorationSize.height,
                  zIndex: 1,
                }}
              >
                {(() => {
                  const cx = decorationSize.width / 2;
                  const cy = decorationSize.height / 2;
                  const r = Math.min(decorationSize.width, decorationSize.height) / 2;
                  const color = rimSegments.color || (isDark ? '#8c8273' : '#3b82f6');
                  const thickness = rimSegments.thickness || 2;
                  return rimSegments.segments.map((seg, i) => {
                    const { t0, t1 } = seg;
                    // handle wrap-around
                    const segs: Array<{ a: number; b: number }> = [];
                    if (t1 >= t0) segs.push({ a: t0, b: t1 });
                    else { segs.push({ a: t0, b: Math.PI * 2 }); segs.push({ a: 0, b: t1 }); }
                    return (
                      <g key={`circle-rim-${i}`}>
                        {segs.map((s, j) => {
                          const a = s.a, b = s.b;
                          const large = (b - a) > Math.PI ? 1 : 0;
                          const x0 = cx + r * Math.cos(a);
                          const y0 = cy + r * Math.sin(a);
                          const x1 = cx + r * Math.cos(b);
                          const y1 = cy + r * Math.sin(b);
                          const d = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
                          return (
                            <path
                              key={`seg-${j}`}
                              d={d}
                              fill="none"
                              stroke={color}
                              strokeWidth={thickness}
                              strokeLinecap="butt"
                              strokeLinejoin="miter"
                            />
                          );
                        })}
                      </g>
                    );
                  });
                })()}
              </svg>
            )}
          </>
        );
      case 'diamond':
        return (
          <>
            {renderDiamondDecoration()}
            {rimSegments && rimSegments.kind === 'diamond' && rimSegments.segments?.length > 0 && (
              <svg
                className={`pointer-events-none absolute ${className}`}
                style={{
                  top: -offset,
                  left: -offset,
                  width: decorationSize.width,
                  height: decorationSize.height,
                  zIndex: 1,
                }}
              >
                {(() => {
                  const cx = decorationSize.width / 2;
                  const cy = decorationSize.height / 2;
                  const topP = { x: cx, y: offset };
                  const rightP = { x: decorationSize.width - offset, y: cy };
                  const bottomP = { x: cx, y: decorationSize.height - offset };
                  const leftP = { x: offset, y: cy };
                  const edgeMap: Record<'top'|'right'|'bottom'|'left', {a:{x:number;y:number}, b:{x:number;y:number}}> = {
                    top: { a: leftP, b: topP },
                    right: { a: topP, b: rightP },
                    bottom: { a: rightP, b: bottomP },
                    left: { a: bottomP, b: leftP },
                  };
                  const color = rimSegments.color || (isDark ? '#8c8273' : '#3b82f6');
                  const thickness = rimSegments.thickness || 2;
                  return rimSegments.segments.map((seg, i) => {
                    const { a, b } = edgeMap[seg.edge];
                    const x0 = a.x + (b.x - a.x) * seg.s0;
                    const y0 = a.y + (b.y - a.y) * seg.s0;
                    const x1 = a.x + (b.x - a.x) * seg.s1;
                    const y1 = a.y + (b.y - a.y) * seg.s1;
                    return (
                      <line
                        key={`diamond-rim-${i}`}
                        x1={x0}
                        y1={y0}
                        x2={x1}
                        y2={y1}
                        stroke={color}
                        strokeWidth={thickness}
                        strokeLinecap="butt"
                        strokeLinejoin="miter"
                      />
                    );
                  });
                })()}
              </svg>
            )}
          </>
        );
      case 'custom':
        return renderCustomDecoration();
      case 'none':
      default:
        return null;
    }
  };

  // 🚫 无装饰时不渲染
  if (!shape || shape.type === 'none') {
    return null;
  }

  return renderShapeDecoration();
};

export default ShapeDecorationLayer;
