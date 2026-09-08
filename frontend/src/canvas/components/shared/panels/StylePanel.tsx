import React, { useState, useCallback, useRef, useMemo } from 'react';
import {useTranslations} from 'next-intl';
import { createPortal } from 'react-dom';
import { Palette, X, Pipette, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import type { FontStyle, CornerStyle } from '../../../../types/canvas';
import { generateBackgroundStyle } from '../controls/selectors/BackgroundSelector';
import { useCanvasStore } from '../../../stores/canvas.store';
import { useTheme } from 'next-themes';
import {
  DEFAULT_TEXT_LAYOUT_PRESET,
  DEFAULT_TEXT_OPACITY_PRESET,
  TEXT_LAYOUT_PRESETS,
  TEXT_OPACITY_PRESETS
} from '../../../constants/textNodePresets';
import { mapPatternColorForTheme } from '../../../utils/themeColorMapping';

// 背景样式定义
export interface BackgroundStyle {
  id: string;
  name: string;
  pattern?: string;
  className?: string;
  type: 'dots' | 'grid' | 'solid';
  density?: 'small' | 'medium' | 'large';
  color?: string;
  opacity?: number;
  size?: number;
}

// 圆角样式：使用全局类型 CornerStyle（已在 types/canvas 定义）

// 连线样式定义已移除 - 现在使用智能连线系统

// 文本对齐样式定义
export interface TextAlignStyle {
  id: 'left' | 'center' | 'right';
  name: string;
  icon: React.ComponentType<any>;
  className: string;
}

// 预定义字体样式
const FONT_STYLES: FontStyle[] = [
  {
    id: 'serif',
    name: 'Serif',
    className: 'font-serif',
    fontFamily:
      'var(--font-playfair-display), "NotoSerifSC-Regular", "Noto Serif SC", "Noto Serif CJK SC", "Source Han Serif SC", "Source Han Serif CN", "Songti SC", "STSong", "SimSun", ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
    textAlign: 'left'
  },
  {
    id: 'sans-serif', 
    name: 'Sans-serif',
    className: 'font-sans',
    fontFamily: 'sans-serif',
    textAlign: 'left'
  },
  {
    id: 'mono',
    name: 'Monospace',
    className: 'font-mono',
    fontFamily: 'monospace',
    textAlign: 'left'
  }
];

// 预定义文本对齐样式
const TEXT_ALIGN_STYLES: TextAlignStyle[] = [
  {
    id: 'left',
    name: 'Align Left',
    icon: AlignLeft,
    className: 'text-left'
  },
  {
    id: 'center',
    name: 'Center',
    icon: AlignCenter,
    className: 'text-center'
  },
  {
    id: 'right',
    name: 'Align Right',
    icon: AlignRight,
    className: 'text-right'
  }
];

// 高级专业学术风格背景色板（浅色主题默认导出，仅在本组件内根据主题切换实际使用的候选集）
const BACKGROUND_COLORS = [
  '#eeeded',
  '#F2F3EE',
  '#f1f5f9',
  '#f8fafc',
  '#fefbf3',
  '#f0f9f4'
];

// 简化的样式图案 - 只保留网格和点阵，不同密集程度
// 重新导出generateBackgroundStyle函数
export { generateBackgroundStyle };

const PATTERN_STYLES: BackgroundStyle[] = [
  { 
    id: 'solid', 
    name: 'Solid', 
    pattern: '▢', 
    className: 'bg-solid',
    type: 'solid'
  },
  { 
    id: 'dots-medium', 
    name: 'Dots', 
    pattern: '●', 
    className: 'bg-dots',
    type: 'dots',
    density: 'medium',
    size: 20,
    opacity: 0.4
  },
  { 
    id: 'grid-medium', 
    name: 'Grid', 
    pattern: '▦', 
    className: 'bg-grid',
    type: 'grid',
    density: 'medium',
    size: 24,
    opacity: 0.5
  }
];

// 高级专业学术风格图案色板（浅色主题默认导出）
const PATTERN_COLORS = [
  '#C7C9CA',
  '#94a3b8',
  '#64748b',
  '#475569',
  '#1e293b',
  '#374151'
];

// 预定义圆角样式 - 简化为3级
const CORNER_STYLES: CornerStyle[] = [
  { id: 'none', name: 'Square', radius: 0, className: 'rounded-none' },
  { id: 'medium', name: 'Rounded', radius: 8, className: 'rounded-lg' },
  { id: 'large', name: 'Rounded (Large)', radius: 16, className: 'rounded-2xl' }
];

// 预定义连线样式已移除 - 现在使用智能连线系统自动处理

export interface StylePanelProps {
  selectedFont: FontStyle;
  selectedBackground: BackgroundStyle;
  selectedCorner: CornerStyle;
  backgroundColor: string;
  patternColor: string;
  onFontChange: (style: FontStyle) => void;
  onBackgroundChange: (style: BackgroundStyle) => void;
  onCornerChange: (style: CornerStyle) => void;
  onBackgroundColorChange: (color: string) => void;
  onPatternColorChange: (color: string) => void;
}

interface StylePanelContentProps extends StylePanelProps {
  onClose?: () => void;
  className?: string;
}

export const StylePanelContent: React.FC<StylePanelContentProps> = ({
  selectedFont,
  selectedBackground,
  selectedCorner,
  backgroundColor,
  patternColor,
  onFontChange,
  onBackgroundChange,
  onCornerChange,
  onBackgroundColorChange,
  onPatternColorChange,
  onClose,
  className
}) => {
  const t = useTranslations();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const normalizedBackgroundColor = (backgroundColor || '').trim().toLowerCase();
  const colorInputRef = useRef<HTMLInputElement>(null);
  const patternColorInputRef = useRef<HTMLInputElement>(null);
  const activeOpacityPreset = useCanvasStore(
    (state) => state.canvas?.textOpacityPreset ?? DEFAULT_TEXT_OPACITY_PRESET
  );
  const setTextOpacityPreset = useCanvasStore((state) => state.setTextOpacityPreset);
  const activeLayoutPreset = useCanvasStore(
    (state) => state.canvas?.textLayoutPreset ?? DEFAULT_TEXT_LAYOUT_PRESET
  );
  const setTextLayoutPreset = useCanvasStore((state) => state.setTextLayoutPreset);
  const maxLayoutWidth = useMemo(
    () => Math.max(...TEXT_LAYOUT_PRESETS.map((preset) => preset.metrics.minWidth)),
    []
  );
  const maxLayoutHeight = useMemo(
    () => Math.max(...TEXT_LAYOUT_PRESETS.map((preset) => preset.metrics.minHeight)),
    []
  );
  const maxLayoutPadding = useMemo(
    () => Math.max(...TEXT_LAYOUT_PRESETS.map((preset) => preset.metrics.padding)),
    []
  );

  // 依据主题切换颜色候选（仅用于面板展示，不改变导出常量）
  const backgroundColorOptions = useMemo(
    () => (isDark
      ? [
          '#141211', // 深色模式下的反转背景色
          '#1f2937',
          '#111827',
          '#0b0f12',
          '#101418',
          '#232628'
        ]
      : BACKGROUND_COLORS),
    [isDark]
  );
  const patternSwatches = useMemo(() => {
    const mode: 'light' | 'dark' = isDark ? 'dark' : 'light';
    return PATTERN_COLORS.map(base => ({
      base,
      display: mapPatternColorForTheme(base, mode),
    }));
  }, [isDark]);

  const handleFontSelect = useCallback((font: FontStyle) => {
    onFontChange(font);
  }, [onFontChange]);

  const handleTextAlignSelect = useCallback((alignStyle: TextAlignStyle) => {
    const updatedFont: FontStyle = {
      ...selectedFont,
      textAlign: alignStyle.id
    };
    onFontChange(updatedFont);
  }, [selectedFont, onFontChange]);

  const handleBackgroundSelect = useCallback((background: BackgroundStyle) => {
    onBackgroundChange(background);
  }, [onBackgroundChange]);

  const handleCornerSelect = useCallback((corner: CornerStyle) => {
    onCornerChange(corner);
  }, [onCornerChange]);

  // 连线处理函数已移除 - 现在使用智能连线系统

  const handleBackgroundColorSelect = useCallback((color: string) => {
    onBackgroundColorChange(color);
  }, [onBackgroundColorChange]);

  const handlePatternColorSelect = useCallback((color: string) => {
    onPatternColorChange(color);
  }, [onPatternColorChange]);

  // 自定义颜色选择处理
  const handleCustomBackgroundColor = useCallback(() => {
    if (colorInputRef.current) {
      colorInputRef.current.click();
    }
  }, []);

  const handleCustomPatternColor = useCallback(() => {
    if (patternColorInputRef.current) {
      patternColorInputRef.current.click();
    }
  }, []);

  const handleBackgroundColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onBackgroundColorChange(e.target.value);
  }, [onBackgroundColorChange]);

  const handlePatternColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onPatternColorChange(e.target.value);
  }, [onPatternColorChange]);

  const rootClassName = ['relative', className].filter(Boolean).join(' ');

  return (
    <div className={rootClassName}>
      {/* 隐藏的颜色选择器input元素 */}
      <input
        ref={colorInputRef}
        type="color"
        value={backgroundColor}
        onChange={handleBackgroundColorChange}
        className="absolute opacity-0 pointer-events-none -z-10"
        tabIndex={-1}
      />
      <input
        ref={patternColorInputRef}
        type="color"
        value={patternColor}
        onChange={handlePatternColorChange}
        className="absolute opacity-0 pointer-events-none -z-10"
        tabIndex={-1}
      />

      {/* 内容区域 */}
      <div className="relative p-4 text-gray-700 dark:text-zinc-200">
            {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <Palette size={16} className="text-gray-600 dark:text-zinc-200" />
                  <span className="text-base font-medium text-gray-700 dark:text-zinc-100">{t('canvas.style.globalTitle', { default: 'Global Style' })}</span>
                </div>
                {onClose ? (
                  <button
                    onClick={onClose}
                    className="w-6 h-6 rounded hover:bg-accent/60 flex items-center justify-center transition-all duration-150"
                  >
                    <X size={12} className="text-gray-500 dark:text-zinc-400" />
                  </button>
                ) : null}
              </div>

              {/* 主要设置区域 - 单列布局 */}
              <div className="space-y-4">
                {/* 字体 */}
                <div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    {FONT_STYLES.map((font) => (
                      <button
                        key={font.id}
                        onClick={() => handleFontSelect(font)}
                        className={`h-10 rounded-lg border transition-all duration-200 flex items-center justify-center ${
                          selectedFont.id === font.id
                            ? 'border-blue-300 bg-blue-50/80 shadow-sm dark:border-blue-400/70 dark:bg-blue-500/15'
                            : 'border-border/60 hover:border-border hover:bg-accent/40'
                        }`}
                        title={font.name}
                      >
                        <div 
                          className={`text-base font-medium transition-colors ${
                            selectedFont.id === font.id ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-zinc-200'
                          } ${font.className}`}
                          style={{ fontFamily: font.fontFamily }}
                        >
                          Aa
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 对齐 */}
                <div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    {TEXT_ALIGN_STYLES.map((alignStyle) => {
                      const IconComponent = alignStyle.icon;
                      return (
                        <button
                          key={alignStyle.id}
                          onClick={() => handleTextAlignSelect(alignStyle)}
                          className={`h-10 rounded-lg border transition-all duration-200 flex items-center justify-center ${
                            selectedFont.textAlign === alignStyle.id
                              ? 'border-blue-300 bg-blue-50/80 shadow-sm dark:border-blue-400/70 dark:bg-blue-500/15'
                              : 'border-border/60 hover:border-border hover:bg-accent/40'
                          }`}
                          title={alignStyle.name}
                        >
                          <IconComponent 
                            size={16} 
                            className={`transition-colors ${
                              selectedFont.textAlign === alignStyle.id ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-zinc-300'
                            }`} 
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 连线选择器已移除 - 现在使用智能连线系统自动处理 */}

                {/* 圆角 - 直观展示 */}
                <div>
                  <div className="flex justify-center gap-2">
                    {CORNER_STYLES.map((corner) => (
                      <div
                        key={corner.id}
                        onClick={() => handleCornerSelect(corner)}
                        className="flex-1 h-10 transition-all duration-200 flex items-center justify-center cursor-pointer hover:opacity-80"
                        title={corner.name}
                      >
                        {/* 模仿文本节点的组件框 */}
                        <div 
                          className={`w-16 h-8 bg-white dark:bg-zinc-800 flex items-center justify-center ${
                            selectedCorner.id === corner.id
                              ? 'border-2 border-blue-300 shadow-sm dark:border-blue-400/70'
                              : 'border border-gray-400 dark:border-zinc-600'
                          }`}
                          style={{ borderRadius: corner.radius }}
                        >
                          <div className="text-[8px] text-gray-500 dark:text-zinc-400">Aa</div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

                {/* Text node background opacity presets */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wide">Text Node Background</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    {TEXT_OPACITY_PRESETS.map((preset) => {
                      const isActive = activeOpacityPreset === preset.id;
                      const previewStyle: React.CSSProperties = preset.value === 0
                        ? (isDark
                            ? {
                                backgroundImage:
                                  'linear-gradient(45deg, rgba(255,255,255,0.28) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.28) 50%, rgba(255,255,255,0.28) 75%, transparent 75%, transparent)',
                                backgroundSize: '8px 8px',
                                backgroundColor: 'rgba(255, 255, 255, 0.08)'
                              }
                            : {
                                backgroundImage:
                                  'linear-gradient(45deg, rgba(148,163,184,0.35) 25%, transparent 25%, transparent 50%, rgba(148,163,184,0.35) 50%, rgba(148,163,184,0.35) 75%, transparent 75%, transparent)',
                                backgroundSize: '8px 8px',
                                backgroundColor: 'rgba(148, 163, 184, 0.2)'
                              })
                        : (isDark
                            ? { backgroundColor: `rgba(255, 255, 255, ${Math.min(0.75, preset.value * 0.75)})` }
                            : { backgroundColor: `rgba(148, 163, 184, ${preset.value})` });

                      return (
                        <div
                          key={preset.id}
                          role="button"
                          tabIndex={0}
                          aria-pressed={isActive}
                          onClick={() => setTextOpacityPreset(preset.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setTextOpacityPreset(preset.id);
                            }
                          }}
                          title={preset.label}
                          className="h-12 flex items-center justify-center cursor-pointer"
                        >
                          <div
                            className={`w-8/12 h-6 bg-white dark:bg-zinc-900/60 flex items-center justify-center overflow-hidden mx-auto border rounded-none ${isActive ? 'border-blue-500' : 'border-transparent'}`}
                            style={{ boxSizing: 'border-box' }}
                          >
                            <div
                              className="w-10/12 h-5"
                              style={previewStyle}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Text node layout presets */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wide">Text Node Layout</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    {TEXT_LAYOUT_PRESETS.map((preset) => {
                      const isActive = activeLayoutPreset === preset.id;
                      const widthRatio = Math.max(0.5, preset.metrics.minWidth / maxLayoutWidth);
                      const heightRatio = Math.max(0.5, preset.metrics.minHeight / maxLayoutHeight);
                      const previewWidth = 72 * widthRatio;
                      const previewHeight = 36 * heightRatio;
                      const previewPadding = Math.max(
                        1,
                        Math.round((preset.metrics.padding / Math.max(maxLayoutPadding, 1)) * 8)
                      );
                      return (
                        <div
                          key={preset.id}
                          role="button"
                          tabIndex={0}
                          aria-pressed={isActive}
                          onClick={() => setTextLayoutPreset(preset.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setTextLayoutPreset(preset.id);
                            }
                          }}
                          title={preset.label}
                          className="mx-auto h-12 flex items-center justify-center cursor-pointer"
                          style={{ width: previewWidth }}
                        >
                          <div
                            className={`relative flex items-center justify-start overflow-hidden border rounded-none ${isActive ? 'border-blue-500' : 'border-transparent'}`}
                            style={{
                              width: previewWidth,
                              height: previewHeight,
                              padding: previewPadding,
                              boxSizing: 'border-box',
                              backgroundColor: isDark
                                ? (preset.id === 'minimal' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.18)')
                                : (preset.id === 'minimal' ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.28)')
                            }}
                          >
                            <span className="text-[10px] font-medium text-slate-700 dark:text-zinc-200 px-1">text</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 背景图案 */}
                <div>
                  <div className="flex justify-center gap-2">
                    {PATTERN_STYLES.map((pattern) => (
                      <button
                        key={pattern.id}
                        onClick={() => handleBackgroundSelect(pattern)}
                        className={`w-10 h-10 rounded-lg transition-all duration-200 flex items-center justify-center text-sm flex-1 ${
                          selectedBackground.id === pattern.id
                            ? 'bg-blue-100/80 text-blue-700 shadow-sm ring-2 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30'
                            : 'text-muted-foreground hover:bg-accent/60'
                        }`}
                      title={pattern.name}
                      >
                        {pattern.pattern}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 背景颜色 */}
                <div>
                  <div className="flex justify-center gap-2">
                    {backgroundColorOptions.map((color) => {
                      const optionHex = color.trim().toLowerCase();
                      const isActive = normalizedBackgroundColor === optionHex;
                      return (
                        <button
                          key={color}
                          onClick={() => handleBackgroundColorSelect(color)}
                          className={`w-6 h-6 rounded-lg border transition-all duration-200 flex-1 ${
                            isActive
                              ? 'border-blue-300 shadow-sm ring-2 ring-blue-200 dark:border-blue-400/70 dark:ring-blue-500/30'
                              : 'border-gray-200/60 hover:border-gray-300/80 dark:border-zinc-700/60 dark:hover:border-zinc-500/70'
                          }`}
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      );
                    })}
                    <button
                      onClick={handleCustomBackgroundColor}
                      className="w-6 h-6 rounded-lg border border-gray-300 dark:border-zinc-600 hover:border-gray-400 dark:hover:border-zinc-400 flex items-center justify-center bg-gradient-to-br from-slate-400 via-blue-400 to-indigo-500 transition-all duration-200 flex-1"
                      title={t('canvas.style.customBackgroundColor', { default: 'Custom background color' })}
                    >
                      <Pipette size={10} className="text-white drop-shadow-sm" />
                    </button>
                  </div>
                </div>

                {/* 图案颜色 */}
                <div>
                  <div className="flex justify-center gap-2">
                    {patternSwatches.map(({ base, display }) => (
                      <button
                        key={base}
                        onClick={() => handlePatternColorSelect(base)}
                        className={`w-6 h-6 rounded-lg border transition-all duration-200 flex-1 ${
                          patternColor === base
                            ? 'border-blue-300 shadow-sm ring-2 ring-blue-200 dark:border-blue-400/70 dark:ring-blue-500/30'
                            : 'border-gray-200/60 hover:border-gray-300/80 dark:border-zinc-700/60 dark:hover:border-zinc-500/70'
                        }`}
                        style={{ backgroundColor: display }}
                        title={base}
                      />
                    ))}
                    <button
                      onClick={handleCustomPatternColor}
                      className="w-6 h-6 rounded-lg border border-gray-300 dark:border-zinc-600 hover:border-gray-400 dark:hover:border-zinc-400 flex items-center justify-center bg-gradient-to-br from-gray-500 via-slate-600 to-gray-700 transition-all duration-200 flex-1"
                      title={t('canvas.style.customPatternColor', { default: 'Custom pattern color' })}
                    >
                      <Pipette size={10} className="text-white drop-shadow-sm" />
                    </button>
                  </div>
                </div>
              </div>
      </div>
    </div>
  );
};

const StylePanel: React.FC<StylePanelProps> = (props) => {
  const [isOpen, setIsOpen] = useState(false);
  const [buttonPosition, setButtonPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const t = useTranslations();

  const togglePanel = useCallback(() => {
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setButtonPosition({
        top: rect.bottom,
        left: rect.right + 8
      });
    }
    setIsOpen(!isOpen);
  }, [isOpen]);

  return (
    <div className="relative">
      {/* 样式按钮 */}
      <button
        ref={buttonRef}
        onClick={togglePanel}
        className="w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md mx-auto"
        title={t('canvas.style.buttonTitle', { default: 'Style settings' })}
      >
        <Palette size={15} className="text-muted-foreground dark:text-zinc-300" />
      </button>

      {/* 样式面板 - 使用Portal渲染到body以避免z-index问题 */}
      {isOpen && createPortal(
        <>
          {/* 遮罩层 */}
          <div 
            className="fixed inset-0 z-[9998]" 
            onClick={() => setIsOpen(false)}
          />
          
          {/* 弹出面板 - 单列布局，稍大一些 */}
          <div 
            className="fixed w-64 backdrop-blur-xl rounded-[var(--canvas-panel-radius)] z-[9999]"
            style={{
              top: 'auto',
              bottom: `${window.innerHeight - buttonPosition.top}px`,
              left: `${buttonPosition.left}px`
            }}
          >
            {/* 玻璃效果背景层 */}
            <div className="absolute inset-0 bg-white dark:bg-zinc-900/95 rounded-[var(--canvas-panel-radius)] backdrop-blur-sm border border-gray-200/50 dark:border-zinc-700/60 shadow-2xl" />
            <StylePanelContent {...props} onClose={() => setIsOpen(false)} />
          </div>
        </>,
        document.body
      )}
    </div>
  );
};

export default StylePanel;
export { FONT_STYLES, PATTERN_STYLES, CORNER_STYLES, BACKGROUND_COLORS, PATTERN_COLORS, TEXT_ALIGN_STYLES };
