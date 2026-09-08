// 🎨 字体选择器组件
import React, { useState } from 'react';
import { Type, ChevronDown } from 'lucide-react';

// 字体类型定义
export interface FontStyle {
  id: string;
  name: string;
  className: string;
  fontFamily: string;
}

// 预定义字体样式
const FONT_STYLES: FontStyle[] = [
  {
    id: 'serif',
    name: '衬线字体',
    className: 'font-serif',
    fontFamily:
      'var(--font-playfair-display), "NotoSerifSC-Regular", "Noto Serif SC", "Noto Serif CJK SC", "Source Han Serif SC", "Source Han Serif CN", "Songti SC", "STSong", "SimSun", ui-serif, Georgia, Cambria, "Times New Roman", Times, serif'
  },
  {
    id: 'sans-serif',
    name: '非衬线字体',
    className: 'font-sans',
    fontFamily: 'sans-serif'
  },
  {
    id: 'mono',
    name: '等宽字体',
    className: 'font-mono',
    fontFamily: 'monospace'
  }
];

interface FontSelectorProps {
  selectedStyle: FontStyle;
  onStyleChange: (style: FontStyle) => void;
}

const FontSelector: React.FC<FontSelectorProps> = ({
  selectedStyle,
  onStyleChange
}) => {
  const currentStyle = selectedStyle;
  const [isOpen, setIsOpen] = useState(false);

  const handleStyleSelect = (style: FontStyle) => {
    onStyleChange(style);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      {/* Linear风格字体选择按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-8 h-8 rounded-md bg-gray-50/80 dark:bg-zinc-900/60 hover:bg-accent/60 border border-gray-200/50 dark:border-zinc-700/60 flex items-center justify-center transition-all duration-150 hover:shadow-sm"
        title="字体样式"
      >
        <Type size={14} className="text-gray-600 dark:text-zinc-300" />
      </button>

      {/* 字体选择下拉面板 */}
      {isOpen && (
        <>
          {/* 遮罩层 */}
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)}
          />
          
          {/* 下拉面板 */}
          <div className="absolute top-full right-0 mt-1 w-48 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-gray-200 dark:border-zinc-700 z-20">
            <div className="p-3">
              <div className="text-xs font-medium text-gray-500 dark:text-zinc-400 mb-3 px-1">字体样式</div>
              
              {/* 字体样式列表 */}
              <div className="space-y-1">
                {FONT_STYLES.map((style) => (
                  <button
                    key={style.id}
                    onClick={() => handleStyleSelect(style)}
                    className={`w-full flex items-center justify-between p-2 rounded-lg transition-all duration-200 ${
                      currentStyle.id === style.id
                        ? 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-200 dark:ring-blue-700/70 shadow-sm'
                        : 'hover:bg-accent/40 hover:shadow-sm'
                    }`}
                    title={style.name}
                  >
                    {/* 字体预览和名称 */}
                    <div className="flex items-center space-x-3">
                      <div 
                        className={`text-sm font-medium transition-colors ${
                          currentStyle.id === style.id
                            ? 'text-blue-700 dark:text-blue-300'
                            : 'text-gray-700 dark:text-zinc-200'
                        } ${style.className}`}
                        style={{ fontFamily: style.fontFamily }}
                      >
                        Aa
                      </div>
                      <span className={`text-sm font-medium transition-colors ${
                        currentStyle.id === style.id
                          ? 'text-blue-700 dark:text-blue-300'
                          : 'text-gray-600 dark:text-zinc-300'
                      }`}>
                        {style.name}
                      </span>
                    </div>
                    
                    {/* 选中标识 */}
                    {currentStyle.id === style.id && (
                      <div className="w-2 h-2 bg-blue-500 rounded-full" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default FontSelector;
export { FONT_STYLES };
