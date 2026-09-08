// 🎨 画布背景选择器组件
import React, { useState } from 'react';
import { Palette, ChevronDown } from 'lucide-react';
import { hexToRgba } from '../../../../utils/colorUtils';

// 背景类型定义
export interface BackgroundStyle {
  id: string;
  name: string;
  type: 'dots' | 'grid' | 'solid';
  density?: 'small' | 'medium' | 'large';
  color?: string;
  opacity?: number;
  size?: number;
}

// 预定义背景样式
const BACKGROUND_STYLES: BackgroundStyle[] = [
  // 点阵网格 - 不同密度
  {
    id: 'dots-small',
    name: '点阵 - 密集',
    type: 'dots',
    density: 'small',
    color: '#C7C9CA',
    opacity: 0.4,
    size: 12
  },
  {
    id: 'dots-medium',
    name: '点阵 - 标准',
    type: 'dots',
    density: 'medium',
    color: '#C7C9CA',
    opacity: 0.4,
    size: 20
  },
  {
    id: 'dots-large',
    name: '点阵 - 稀疏',
    type: 'dots',
    density: 'large',
    color: '#C7C9CA',
    opacity: 0.3,
    size: 32
  },
  
  // 线条网格 - 不同密度
  {
    id: 'grid-small',
    name: '网格 - 密集',
    type: 'grid',
    density: 'small',
    color: '#C7C9CA',
    opacity: 0.6,
    size: 16
  },
  {
    id: 'grid-medium',
    name: '网格 - 标准',
    type: 'grid',
    density: 'medium',
    color: '#C7C9CA',
    opacity: 0.5,
    size: 24
  },
  {
    id: 'grid-large',
    name: '网格 - 稀疏',
    type: 'grid',
    density: 'large',
    color: '#C7C9CA',
    opacity: 0.4,
    size: 40
  },
  
  // 纯色背景
  {
    id: 'solid-light',
    name: '浅色背景',
    type: 'solid',
    color: '#eeeded',
    opacity: 1
  },
  {
    id: 'solid-white',
    name: '纯白背景',
    type: 'solid',
    color: '#ffffff',
    opacity: 1
  },
  {
    id: 'solid-warm',
    name: '暖色背景',
    type: 'solid',
    color: '#fefcf3',
    opacity: 1
  },
  {
    id: 'solid-cool',
    name: '冷色背景',
    type: 'solid',
    color: '#f0f9ff',
    opacity: 1
  }
];

// 生成背景样式CSS
export const generateBackgroundStyle = (
  style: BackgroundStyle, 
  customBackgroundColor?: string, 
  customPatternColor?: string
): React.CSSProperties => {
  const baseStyle: React.CSSProperties = {
    pointerEvents: 'none'
  };

  const bgColor = customBackgroundColor || '#eeeded';

  // Detect dark background (simple luminance check on hex input)
  const isDarkHex = (hex: string): boolean => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return false;
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
      r = parseInt(hex[1] + hex[1], 16);
      g = parseInt(hex[2] + hex[2], 16);
      b = parseInt(hex[3] + hex[3], 16);
    } else {
      r = parseInt(hex.slice(1, 3), 16);
      g = parseInt(hex.slice(3, 5), 16);
      b = parseInt(hex.slice(5, 7), 16);
    }
    // perceived luminance
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luminance < 0.5;
  };

  let basePatternColor = customPatternColor || style.color || '#C7C9CA';
  if (!customPatternColor && isDarkHex(bgColor)) {
    // Default dark grid/dots color tuned for inverse background
    basePatternColor = '#4D4F52';
  }
  const patternOpacity = style.opacity || 0.4;
  const patternColor = hexToRgba(basePatternColor, patternOpacity);

  switch (style.type) {
    case 'dots':
      return {
        ...baseStyle,
        backgroundImage: `radial-gradient(circle, ${patternColor} 1.5px, transparent 1.5px)`,
        backgroundSize: `${style.size || 20}px ${style.size || 20}px`,
        backgroundPosition: '0 0',
        backgroundColor: bgColor
      };
      
    case 'grid':
      return {
        ...baseStyle,
        backgroundImage: `
          linear-gradient(${patternColor} 1px, transparent 1px),
          linear-gradient(90deg, ${patternColor} 1px, transparent 1px)
        `,
        backgroundSize: `${style.size || 24}px ${style.size || 24}px`,
        backgroundColor: bgColor
      };
      
    case 'solid':
      return {
        ...baseStyle,
        backgroundColor: bgColor,
        backgroundImage: 'none'
      };
      
    default:
      return {
        ...baseStyle,
        backgroundColor: bgColor
      };
  }
};

interface BackgroundSelectorProps {
  selectedStyle: BackgroundStyle;
  onStyleChange: (style: BackgroundStyle) => void;
}

const BackgroundSelector: React.FC<BackgroundSelectorProps> = ({
  selectedStyle,
  onStyleChange
}) => {
  const currentStyle = selectedStyle;
  const [isOpen, setIsOpen] = useState(false);

  const handleStyleSelect = (style: BackgroundStyle) => {
    onStyleChange(style);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      {/* Linear风格背景选择按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-8 h-8 rounded-md bg-gray-50/80 dark:bg-zinc-900/60 hover:bg-accent/60 border border-gray-200/50 dark:border-zinc-700/60 flex items-center justify-center transition-all duration-150 hover:shadow-sm"
        title="背景样式"
      >
        <Palette size={14} className="text-gray-600 dark:text-zinc-300" />
      </button>

      {/* 背景选择下拉面板 */}
      {isOpen && (
        <>
          {/* 遮罩层 */}
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)}
          />
          
          {/* 下拉面板 */}
          <div className="absolute top-full right-0 mt-1 w-72 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-gray-200 dark:border-zinc-700 z-20">
            <div className="p-3">
              <div className="text-xs font-medium text-gray-500 dark:text-zinc-400 mb-3 px-1">背景样式</div>
              
              {/* 紧凑型分组显示 */}
              {[
                { type: 'dots', label: '点阵网格' },
                { type: 'grid', label: '线条网格' },
                { type: 'solid', label: '纯色背景' }
              ].map(({ type, label }) => {
                const stylesOfType = BACKGROUND_STYLES.filter(s => s.type === type);
                if (stylesOfType.length === 0) return null;
                
                return (
                  <div key={type} className="mb-4 last:mb-0">
                    <div className="text-xs font-medium text-gray-400 dark:text-zinc-500 mb-2 px-1">{label}</div>
                    
                    {/* 网格布局 - 点阵和线条网格用3列，纯色用4列 */}
                    <div className={`grid gap-2 ${type === 'solid' ? 'grid-cols-4' : 'grid-cols-3'}`}>
                      {stylesOfType.map((style) => (
                        <button
                          key={style.id}
                          onClick={() => handleStyleSelect(style)}
                          className={`group relative flex flex-col items-center p-2 rounded-lg transition-all duration-200 ${
                            currentStyle.id === style.id
                              ? 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-200 dark:ring-blue-700/70 shadow-sm'
                              : 'hover:bg-accent/40 hover:shadow-sm'
                          }`}
                          title={style.name}
                        >
                          {/* 背景预览 */}
                          <div 
                            className={`w-8 h-8 rounded border-2 mb-1.5 transition-all ${
                              currentStyle.id === style.id 
                                ? 'border-blue-300 dark:border-blue-500' 
                                : 'border-gray-200 dark:border-zinc-700 group-hover:border-gray-300 dark:group-hover:border-zinc-500'
                            }`}
                            style={{
                              ...generateBackgroundStyle(style),
                              pointerEvents: 'auto',
                              opacity: 1
                            }}
                          />
                          
                          {/* 密度标识 */}
                          <span className={`text-xs font-medium transition-colors ${
                            currentStyle.id === style.id
                              ? 'text-blue-700 dark:text-blue-300'
                              : 'text-gray-600 dark:text-zinc-300 group-hover:text-gray-800 dark:group-hover:text-zinc-100'
                          }`}>
                            {style.density === 'small' ? '密集' : 
                             style.density === 'medium' ? '标准' : 
                             style.density === 'large' ? '稀疏' : 
                             style.name.replace(/背景$/, '')}
                          </span>
                          
                          {/* 选中标识 */}
                          {currentStyle.id === style.id && (
                            <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full border-2 border-white dark:border-zinc-900" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default BackgroundSelector;
export { BACKGROUND_STYLES };
