import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Palette, ArrowLeft, Shapes } from 'lucide-react';
import './color-selector.css';
import type { Canvas, CanvasNode, NodeShapeDecoration } from '../../../../types/canvas';
import type { NodeStyles, TextStyles } from './NodeStylePanel';
import { CanvasIcon } from '../icons/CanvasIcon';
import type { CanvasIconName } from '../../../constants/canvasIcons';

// 🎨 文本节点顶部色带预设 - 便签纸风格
const ACCENT_COLOR_PRESETS = [
  { name: 'No Accent', color: 'transparent', category: 'neutral' },
  { name: 'Red', color: '#fb7185', category: 'warm' },
  { name: 'Orange', color: '#fb923c', category: 'warm' },
  { name: 'Yellow', color: '#fbbf24', category: 'warm' },
  { name: 'Yellow-Green', color: '#84cc16', category: 'cool' },
  { name: 'Green', color: '#34d399', category: 'cool' },
  { name: 'Cyan', color: '#22d3ee', category: 'cool' },
  { name: 'Blue', color: '#60a5fa', category: 'cool' },
  { name: 'Purple', color: '#a78bfa', category: 'cool' },
  { name: 'Pink', color: '#f472b6', category: 'warm' }
];

interface TextStylePanelProps {
  selectedNodes: CanvasNode[];
  onStyleChange: (nodeId: string, styles: NodeStyles) => void;
  onSubPanelStateChange?: (hasSubPanel: boolean) => void; // 通知父组件是否有子面板
}

// 🎨 面板模式 - 支持颜色、形状和透明度面板
type PanelMode = 'none' | 'accent' | 'shape' | 'opacity';

// 🎨 形状预设配置 - 只保留圆形、菱形
const SHAPE_PRESETS: Array<{
  name: string;
  icon: CanvasIconName;
  value: NodeShapeDecoration;
}> = [
  {
    name: 'Default',
    icon: 'shapeSquare',
    value: { type: 'none' }
  },
  {
    name: 'Circle',
    icon: 'shapeCircle',
    value: {
      type: 'circle',
      strokeWidth: 2,
      strokeColor: '#6b7280',
      fillColor: 'auto', // 主题自适应填充
      opacity: 1,
      offset: 0 // 去掉外扩，完全贴合
    }
  },
  {
    name: 'Diamond',
    icon: 'shapeDiamond',
    value: {
      type: 'diamond',
      strokeWidth: 2,
      strokeColor: '#6b7280',
      fillColor: 'auto', // 主题自适应填充
      opacity: 1,
      offset: 0 // 去掉外扩，完全贴合
    }
  }
];

const TextStylePanel: React.FC<TextStylePanelProps> = ({
  selectedNodes,
  onStyleChange,
  onSubPanelStateChange
}) => {
  // 仅处理文本节点和Todo节点 - 使用useMemo优化避免每次渲染都创建新数组
  const textNodes = useMemo(() => 
    selectedNodes.filter(node => node.type === 'text' || node.type === 'todo'), 
    [selectedNodes]
  );
  
  // 样式状态 - 支持混合状态检测
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right' | 'justify' | 'mixed'>('left');
  const [accentColor, setAccentColor] = useState<string | 'mixed'>('transparent');
  const [currentShape, setCurrentShape] = useState<NodeShapeDecoration | 'mixed'>({ type: 'none' });
  
  // 🎯 混合状态标识
  const [hasTextAlignMixed, setHasTextAlignMixed] = useState(false);
  const [hasAccentColorMixed, setHasAccentColorMixed] = useState(false);
  const [hasShapeMixed, setHasShapeMixed] = useState(false);

  // 🎨 透明度状态管理
  const [opacity, setOpacity] = useState(1);
  const [hasOpacityMixed, setHasOpacityMixed] = useState(false);
  // 拖拽状态ref，避免拖拽结束触发轨道点击导致的跳变
  const isDraggingRef = useRef(false);
  
  // 🎨 面板状态
  const [panelMode, setPanelMode] = useState<PanelMode>('none');

  // 🎯 批量样式状态检测 - 支持混合状态显示
  useEffect(() => {
    if (textNodes.length === 0) return;
    
    const allTextAligns: Array<'left' | 'center' | 'right' | 'justify'> = [];
    const allAccentColors: string[] = [];
    const allShapes: NodeShapeDecoration[] = [];
    
    textNodes.forEach(node => {
      const nodeTextStyles = (node as any).textStyles || {};
      // 收集对齐方式
      allTextAligns.push(nodeTextStyles.textAlign || 'left');
      // 收集色带颜色
      allAccentColors.push(nodeTextStyles.accentColor || 'transparent');
      // 收集形状装饰
      allShapes.push(node.shapeDecoration || { type: 'none' });
    });

    // 🎯 检测对齐方式是否混合
    const uniqueTextAligns = [...new Set(allTextAligns)];
    if (uniqueTextAligns.length > 1) {
      setTextAlign('mixed');
      setHasTextAlignMixed(true);
    } else {
      setTextAlign(uniqueTextAligns[0]);
      setHasTextAlignMixed(false);
    }

    // 🎯 检测色带颜色是否混合
    const uniqueAccentColors = [...new Set(allAccentColors)];
    if (uniqueAccentColors.length > 1) {
      setAccentColor('mixed');
      setHasAccentColorMixed(true);
    } else {
      setAccentColor(uniqueAccentColors[0]);
      setHasAccentColorMixed(false);
    }

    // 🎯 检测形状装饰是否混合
    const uniqueShapes = allShapes.filter((shape, index, self) => 
      index === self.findIndex(s => s.type === shape.type)
    );
    if (uniqueShapes.length > 1) {
      setCurrentShape('mixed');
      setHasShapeMixed(true);
    } else {
      setCurrentShape(uniqueShapes[0]);
      setHasShapeMixed(false);
    }
  }, [textNodes]); // 依赖textNodes数组

  // 🎨 初始化透明度状态
  useEffect(() => {
    const opacityValues = textNodes.map(node => 
      (node as any).textStyles?.opacity ?? 1
    );
    const uniqueOpacities = [...new Set(opacityValues)];
    
    if (uniqueOpacities.length > 1) {
      setOpacity(1);
      setHasOpacityMixed(true);
    } else {
      setOpacity(uniqueOpacities[0]);
      setHasOpacityMixed(false);
    }
  }, [textNodes]); // 依赖textNodes数组

  // 应用文本样式到节点 - 保留现有样式，只更新指定属性
  const applyStyles = useCallback((styles: Partial<TextStyles>) => {
    textNodes.forEach(node => {
      const existingTextStyles = (node as any).textStyles || {};
      const mergedStyles = {
        ...existingTextStyles,
        ...styles
      };
      onStyleChange(node.id, { textStyles: mergedStyles });
    });
  }, [textNodes, onStyleChange]);

  // 应用形状装饰到节点
  const applyShapeDecoration = useCallback((shapeDecoration: NodeShapeDecoration) => {
    textNodes.forEach(node => {
      onStyleChange(node.id, { shapeDecoration });
    });
  }, [textNodes, onStyleChange]);

  // 处理对齐方式变更
  const handleTextAlignChange = useCallback((align: 'left' | 'center' | 'right' | 'justify') => {
    setTextAlign(align);
    setHasTextAlignMixed(false);
    applyStyles({ textAlign: align });
  }, [applyStyles]);

  // 处理顶部色带颜色变更
  const handleAccentColorChange = useCallback((color: string) => {
    setAccentColor(color);
    setHasAccentColorMixed(false);
    applyStyles({ accentColor: color });
  }, [applyStyles]);

  // 处理形状装饰变更
  const handleShapeChange = useCallback((shapeDecoration: NodeShapeDecoration) => {
    setCurrentShape(shapeDecoration);
    setHasShapeMixed(false);
    applyShapeDecoration(shapeDecoration);
  }, [applyShapeDecoration]);

  // 🎨 处理透明度变更
  const handleOpacityChange = useCallback((newOpacity: number) => {
    setOpacity(newOpacity);
    setHasOpacityMixed(false);
    applyStyles({ opacity: newOpacity });
  }, [applyStyles]);

  // 面板切换 - 修复闭包问题，使用函数式状态更新
  const handlePanelToggle = useCallback((mode: PanelMode) => {
    if (mode === 'none') {
      setPanelMode('none');
    } else {
      setPanelMode(prevMode => prevMode === mode ? 'none' : mode);
    }
  }, []); // 移除panelMode依赖，避免闭包问题

  // 子面板状态通知
  useEffect(() => {
    onSubPanelStateChange?.(panelMode !== 'none');
  }, [panelMode, onSubPanelStateChange]);

  // 🎨 渲染"形状装饰"选择面板
  const renderShapePanel = () => {
    if (panelMode !== 'shape') return null;

    return (
      <>
        {/* 🔙 返回按钮 */}
        <button
          onClick={() => setPanelMode('none')}
          className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md text-gray-600 dark:text-zinc-300"
          title="返回样式设置"
        >
          <ArrowLeft size={16} />
        </button>

        {/* 分割线 */}
        <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-1" />

        {/* 形状选择器 - 竖向排列 */}
        <div className="flex flex-col gap-2">
          {SHAPE_PRESETS.map((preset) => {
            const isCurrentShape = !hasShapeMixed && 
              currentShape !== 'mixed' && 
              currentShape.type === preset.value.type;

            return (
              <button
                key={preset.name}
                className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-all duration-200 ${
                  isCurrentShape 
                    ? 'bg-blue-100/80 text-blue-700 ring-2 ring-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-400/60' 
                    : hasShapeMixed 
                    ? 'text-gray-400 bg-gray-50 dark:text-zinc-500 dark:bg-zinc-800/40' 
                    : 'text-muted-foreground hover:bg-accent/60'
                }`}
                onClick={() => handleShapeChange(preset.value)}
                title={hasShapeMixed ? `${preset.name} (当前混合状态)` : preset.name}
              >
                <CanvasIcon name={preset.icon} />
              </button>
            );
          })}
        </div>
      </>
    );
  };

  // 🎨 渲染"色带颜色"选择面板（采用用户要求的交互效果 + 竖向排列）
  const renderColorPanel = () => {
    if (panelMode !== 'accent') return null;

    const currentColor = hasAccentColorMixed ? null : accentColor;

    return (
      <>
        {/* 🔙 返回按钮 */}
        <button
          onClick={() => setPanelMode('none')}
          className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md text-gray-600 dark:text-zinc-300"
          title="返回样式设置"
        >
          <ArrowLeft size={16} />
        </button>

        {/* 分割线 */}
        <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-1" />

        {/* 色带颜色 - 竖向互动色块 */}
        <div className="accent-color-list">
          <div className="container-items">
            {ACCENT_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.name}
                className={`item-color ${currentColor === preset.color ? 'ring-2 ring-blue-400' : ''}`}
                style={{ ['--color' as any]: preset.color } as React.CSSProperties}
                data-color={preset.name || preset.color}
                onClick={() => handleAccentColorChange(preset.color)}
                title={preset.name}
              >
                {preset.color === 'transparent' && (
                  <span className="transparent-badge" />
                )}
              </button>
            ))}
          </div>
        </div>
      </>
    );
  };

  // 🎨 透明度调整面板
  const renderOpacityPanel = () => {
    // 统一管理滑块尺寸与有效透明度
    const sliderSize = 24; // px，与 w-6 h-6 保持一致
    const effectiveOpacity = hasOpacityMixed ? 1 : opacity;

    return (
      <>
        {/* 🎯 返回按钮 */}
        <button
          onClick={() => handlePanelToggle('none')}
          className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md text-gray-600 dark:text-zinc-300"
          title="返回主面板"
        >
          <ArrowLeft size={16} />
        </button>

        {/* 分割线 */}
        <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-1" />

        {/* 🎨 垂直透明度滑动条 */}
        <div className="flex flex-col items-center justify-center h-64 relative">
          {/* 背景轨道 - 增加点击功能 */}
          <div 
            className="relative w-6 h-48 bg-gradient-to-t from-black/20 via-gray-300 to-white dark:from-white/15 dark:via-zinc-600 dark:to-black border border-gray-300 dark:border-zinc-700/60 rounded-full overflow-hidden cursor-pointer"
            onClick={(e) => {
              if (hasOpacityMixed) return;
              // 如果正在拖拽，阻止点击计算，避免拖拽结束时触发点击导致跳变
              if (isDraggingRef.current) { isDraggingRef.current = false; return; }
              const track = e.currentTarget;
              const trackRect = track.getBoundingClientRect();
              const y = e.clientY - trackRect.top;
              
              // 计算滑块位置百分比，考虑滑块高度
              const usableHeight = trackRect.height - sliderSize;
              const boundedY = Math.max(0, Math.min(usableHeight, y - sliderSize/2));
              const percentage = 1 - (boundedY / usableHeight);
              const preciseValue = Math.max(0, Math.min(1, Math.round(percentage * 100) / 100));
              handleOpacityChange(preciseValue);
            }}
          >
            {/* 透明度刻度线 */}
            <div className="absolute inset-0 pointer-events-none">
              {[1, 0.8, 0.6, 0.4, 0.2, 0].map((value) => (
                <div
                  key={value}
                  className="absolute left-0 w-full h-px bg-gray-400/40 dark:bg-zinc-500/40"
                  style={{ top: `${(1 - value) * 100}%` }}
                />
              ))}
            </div>
            
            {/* 可拖拽的滑块 - 使用top+clamp精确定位，确保边缘触及轨道边缘且不越界 */}
            <div
              className={`absolute left-1/2 w-6 h-6 bg-white dark:bg-zinc-900 border-2 rounded-full cursor-pointer shadow-md transition-transform duration-150 hover:scale-110 ${
                hasOpacityMixed ? 'border-gray-400 dark:border-zinc-500' : 'border-blue-500 dark:border-blue-400'
              }`}
              style={{
                top: `clamp(0px, calc(${(1 - effectiveOpacity) * 100}% - ${sliderSize / 2}px), calc(100% - ${sliderSize}px))`,
                // 仅横向居中，不再使用 translateY 百分比（其相对于元素自身高度，易产生误差）
                transform: 'translateX(-50%)',
                background: hasOpacityMixed ? 'linear-gradient(45deg, #ccc, #fff)' : undefined,
              }}
              onClick={(e) => { e.stopPropagation(); }}
              onMouseDown={(e) => {
                if (hasOpacityMixed) return;
                e.preventDefault();
                e.stopPropagation();
                isDraggingRef.current = true;
                const track = e.currentTarget.parentElement! as HTMLDivElement;
                const trackRect = track.getBoundingClientRect();
                
                const handleMouseMove = (moveEvent: MouseEvent) => {
                  const y = moveEvent.clientY - trackRect.top;
                  // 限制在轨道范围内移动
                  const usableHeight = trackRect.height - sliderSize;
                  const boundedY = Math.max(0, Math.min(usableHeight, y - sliderSize/2));
                  const percentage = 1 - (boundedY / usableHeight);
                  const smoothValue = Math.max(0, Math.min(1, Math.round(percentage * 100) / 100));
                  handleOpacityChange(smoothValue);
                };
                
                const handleMouseUp = () => {
                  isDraggingRef.current = false;
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
                };
                
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
              }}
            />
          </div>
          
          {/* 数值显示 */}
          <div className="mt-3 text-xs text-gray-500 dark:text-zinc-400 text-center">
            {hasOpacityMixed ? '混合状态' : `${Math.round(opacity * 100)}%`}
          </div>
        </div>
      </>
    );
  };

  return (
    <>
      {panelMode === 'none' ? (
        // 🎯 主样式面板
        <>
          {/* 对齐方式 - 支持混合状态显示 */}
          <button
            onClick={() => handleTextAlignChange('left')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md ${
              textAlign === 'left' ? 'bg-blue-100/80 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' : 
              hasTextAlignMixed ? 'text-gray-400 bg-gray-50 dark:text-zinc-500 dark:bg-zinc-800/40' : 'text-gray-600 dark:text-zinc-300'
            }`}
            title={hasTextAlignMixed ? '左对齐 (当前混合状态)' : '左对齐'}
          >
            <AlignLeft size={16} />
          </button>

          <button
            onClick={() => handleTextAlignChange('center')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md ${
              textAlign === 'center' ? 'bg-blue-100/80 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' : 
              hasTextAlignMixed ? 'text-gray-400 bg-gray-50 dark:text-zinc-500 dark:bg-zinc-800/40' : 'text-gray-600 dark:text-zinc-300'
            }`}
            title={hasTextAlignMixed ? '居中对齐 (当前混合状态)' : '居中对齐'}
          >
            <AlignCenter size={16} />
          </button>

          <button
            onClick={() => handleTextAlignChange('right')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md ${
              textAlign === 'right' ? 'bg-blue-100/80 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' : 
              hasTextAlignMixed ? 'text-gray-400 bg-gray-50 dark:text-zinc-500 dark:bg-zinc-800/40' : 'text-gray-600 dark:text-zinc-300'
            }`}
            title={hasTextAlignMixed ? '右对齐 (当前混合状态)' : '右对齐'}
          >
            <AlignRight size={16} />
          </button>

          <button
            onClick={() => handleTextAlignChange('justify')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md ${
              textAlign === 'justify' ? 'bg-blue-100/80 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' : 
              hasTextAlignMixed ? 'text-gray-400 bg-gray-50 dark:text-zinc-500 dark:bg-zinc-800/40' : 'text-gray-600 dark:text-zinc-300'
            }`}
            title={hasTextAlignMixed ? '两端对齐 (当前混合状态)' : '两端对齐'}
          >
            <AlignJustify size={16} />
          </button>

          {/* 分割线 */}
          <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-1" />

          {/* 🎨 顶部色带按钮 - 支持混合状态 */}
          <button
            onClick={() => handlePanelToggle('accent')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md relative ${
              hasAccentColorMixed ? 'text-gray-400 bg-gray-50 dark:text-zinc-500 dark:bg-zinc-800/40' : 'text-gray-600 dark:text-zinc-300'
            }`}
            title={hasAccentColorMixed ? '顶部色带 (当前混合状态)' : '顶部色带'}
          >
            <Palette size={16} />
            {/* 显示当前色带颜色或混合状态 */}
            {hasAccentColorMixed ? (
              <div className="absolute bottom-1 right-1 w-2 h-2 rounded-full border border-gray-400 dark:border-zinc-500 bg-gradient-to-r from-red-400 via-blue-400 to-green-400" />
            ) : accentColor && accentColor !== 'transparent' ? (
              <div 
                className="absolute bottom-1 right-1 w-2 h-2 rounded-full border border-white"
                style={{ backgroundColor: accentColor as string }}
              />
            ) : null}
          </button>

          {/* 分割线 */}
          <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-1" />

          {/* 🎨 形状装饰按钮 - 支持混合状态 */}
          <button
            onClick={() => handlePanelToggle('shape')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md relative ${
              hasShapeMixed ? 'text-gray-400 bg-gray-50 dark:text-zinc-500 dark:bg-zinc-800/40' : 'text-gray-600 dark:text-zinc-300'
            }`}
            title={hasShapeMixed ? '节点形状 (当前混合状态)' : '节点形状'}
          >
            <Shapes size={16} />
            {/* 显示当前形状或混合状态 */}
            {hasShapeMixed ? (
              <div className="absolute bottom-1 right-1 w-2 h-2 rounded-full border border-gray-400 dark:border-zinc-500 bg-gradient-to-r from-yellow-400 via-green-400 to-blue-400" />
            ) : currentShape !== 'mixed' && currentShape.type !== 'none' ? (
              <div className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-blue-500 border border-white" />
            ) : null}
          </button>

          {/* 分割线 */}
          <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-1" />

          {/* 🎨 透明度按钮 - 支持混合状态 */}
          <button
            onClick={() => handlePanelToggle('opacity')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md relative ${
              hasOpacityMixed ? 'text-gray-400 bg-gray-50 dark:text-zinc-500 dark:bg-zinc-800/40' : 'text-gray-600 dark:text-zinc-300'
            }`}
            title={hasOpacityMixed ? '透明度 (当前混合状态)' : `透明度: ${Math.round(opacity * 100)}%`}
          >
            {/* 透明度图标 - 固定颜色的透明度网格 */}
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16">
              <path fill="currentColor" d="M0 0h3.2v3.2H0z"></path>
              <path fill="currentColor" d="M0 6.4h3.2v3.2H0z"></path>
              <path fill="currentColor" d="M0 12.801h3.2v3.2H0z"></path>
              <path fill="currentColor" fillOpacity="0.8" d="M3.2 3.199h3.2v3.2H3.2z"></path>
              <path fill="currentColor" fillOpacity="0.8" d="M3.2 9.6h3.2v3.2H3.2z"></path>
              <path fill="currentColor" fillOpacity="0.6" d="M6.4 0h3.2v3.2H6.4z"></path>
              <path fill="currentColor" fillOpacity="0.2" d="M12.8 0H16v3.2h-3.2z"></path>
              <path fill="currentColor" fillOpacity="0.6" d="M6.4 6.4h3.2v3.2H6.4z"></path>
              <path fill="currentColor" fillOpacity="0.2" d="M12.8 6.4H16v3.2h-3.2z"></path>
              <path fill="currentColor" fillOpacity="0.6" d="M6.4 12.801h3.2v3.2H6.4z"></path>
              <path fill="currentColor" fillOpacity="0.2" d="M12.8 12.801H16v3.2h-3.2z"></path>
              <path fill="currentColor" fillOpacity="0.4" d="M9.6 3.199h3.2v3.2H9.6zM9.6 9.6h3.2v3.2H9.6z"></path>
            </svg>
            
            {/* 显示当前透明度或混合状态 */}
            {hasOpacityMixed ? (
              <div className="absolute bottom-1 right-1 w-2 h-2 rounded-full border border-gray-400 dark:border-zinc-500 bg-gradient-to-r from-transparent via-gray-400 to-gray-600" />
            ) : opacity < 1 ? (
              <div className="absolute -bottom-1 -right-1 text-xs text-gray-400 dark:text-zinc-500 bg-white dark:bg-zinc-900 rounded px-1 text-[10px] leading-tight">
                {Math.round(opacity * 100)}
              </div>
            ) : null}
          </button>
        </>
      ) : panelMode === 'accent' ? (
        // 🎨 色带颜色选择面板
        renderColorPanel()
      ) : panelMode === 'shape' ? (
        // 🎨 形状装饰选择面板
        renderShapePanel()
      ) : panelMode === 'opacity' ? (
        // 🎨 透明度调整面板
        renderOpacityPanel()
      ) : null}
    </>
  );
};

export default TextStylePanel;
