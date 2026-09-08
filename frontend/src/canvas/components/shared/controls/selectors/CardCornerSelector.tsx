// 🎨 卡片圆角选择器组件
import React, { useState } from 'react';
import { Square } from 'lucide-react';
import { CORNER_STYLES } from '@/canvas/constants/cornerStyles';
import type { CornerStyle } from '@/canvas/types/canvas';

interface CardCornerSelectorProps {
  selectedStyle: CornerStyle;
  onStyleChange: (style: CornerStyle) => void;
}

const CardCornerSelector: React.FC<CardCornerSelectorProps> = ({
  selectedStyle,
  onStyleChange
}) => {
  const currentStyle = selectedStyle;
  const [isOpen, setIsOpen] = useState(false);

  const handleStyleSelect = (style: CornerStyle) => {
    onStyleChange(style);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      {/* Linear风格圆角选择按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-8 h-8 rounded-md bg-gray-50/80 dark:bg-zinc-900/60 hover:bg-accent/60 border border-gray-200/50 dark:border-zinc-700/60 flex items-center justify-center transition-all duration-150 hover:shadow-sm"
        title="圆角样式"
      >
        <Square size={14} className="text-gray-600 dark:text-zinc-300" />
      </button>

      {/* 圆角选择下拉面板 */}
      {isOpen && (
        <>
          {/* 遮罩层 */}
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)}
          />
          
          {/* 下拉面板 */}
          <div className="absolute top-full right-0 mt-1 w-64 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-gray-200 dark:border-zinc-700 z-20">
            <div className="p-3">
              <div className="text-xs font-medium text-gray-500 dark:text-zinc-400 mb-3 px-1">卡片圆角</div>
              
              {/* 圆角样式网格 */}
              <div className="grid grid-cols-3 gap-2">
                {CORNER_STYLES.map((style) => (
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
                    {/* 圆角预览 */}
                    <div 
                      className={`w-8 h-8 bg-gray-100 dark:bg-zinc-800 border-2 mb-1.5 transition-all ${
                        currentStyle.id === style.id 
                          ? 'border-blue-300 dark:border-blue-500' 
                          : 'border-gray-200 dark:border-zinc-700 group-hover:border-gray-300 dark:group-hover:border-zinc-500'
                      } ${style.className}`}
                    />
                    
                    {/* 样式名称 */}
                    <span className={`text-xs font-medium transition-colors ${
                      currentStyle.id === style.id
                        ? 'text-blue-700 dark:text-blue-300'
                        : 'text-gray-600 dark:text-zinc-300 group-hover:text-gray-800 dark:group-hover:text-zinc-100'
                    }`}>
                      {style.name}
                    </span>
                    
                    {/* 选中标识 */}
                    {currentStyle.id === style.id && (
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full border-2 border-white dark:border-zinc-900" />
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

export default CardCornerSelector;
export { CORNER_STYLES };
