// 🎨 增强的Textarea编辑器
// 作为Monaco Editor的回退方案，提供基础的语法高亮

import React, { useEffect, useRef, useState } from 'react';
import type { Canvas, CanvasNode, FontStyle } from '../../../../types/canvas';

interface EnhancedTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  language: 'json' | 'mermaid';
  placeholder?: string;
  readOnly?: boolean;
  height?: string;
  fontStyle?: FontStyle;
}

export const EnhancedTextarea: React.FC<EnhancedTextareaProps> = ({
  value,
  onChange,
  onBlur,
  language,
  placeholder = '',
  readOnly = false,
  height = '100%',
  fontStyle
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [lineCount, setLineCount] = useState(1);

  // 计算行数
  useEffect(() => {
    const lines = value.split('\n').length;
    setLineCount(lines);
  }, [value]);

  // 处理Tab键
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      
      const textarea = textareaRef.current;
      if (!textarea) return;
      
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      
      // 插入两个空格作为tab
      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      onChange(newValue);
      
      // 恢复光标位置
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }
  };

  // 格式化JSON
  const formatJSON = () => {
    if (language !== 'json') return;
    
    try {
      const parsed = JSON.parse(value);
      const formatted = JSON.stringify(parsed, null, 2);
      onChange(formatted);
    } catch (error) {
      // 静默处理错误
    }
  };

  return (
    <div className="relative w-full" style={{ height }}>
      {/* 行号 */}
      <div className="absolute left-0 top-0 bottom-0 w-12 bg-gray-800 text-gray-400 text-xs font-mono flex flex-col">
        {Array.from({ length: lineCount }, (_, i) => (
          <div
            key={i + 1}
            className="h-6 flex items-center justify-end pr-2"
            style={{ minHeight: '24px', lineHeight: '24px' }}
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* 编辑器 */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        readOnly={readOnly}
        placeholder={placeholder}
        className={`w-full h-full pl-14 pr-3 py-3 bg-gray-900 text-gray-100 ${fontStyle?.className || 'font-mono'} text-sm border-none outline-none resize-none`}
        style={{
          fontFamily: fontStyle?.fontFamily || 'JetBrains Mono, Consolas, Monaco, "Courier New", monospace',
          lineHeight: '24px',
          tabSize: 2
        }}
        spellCheck={false}
      />

      {/* 工具栏 */}
      <div className="absolute top-2 right-2 flex items-center space-x-1">
        {language === 'json' && (
          <button
            onClick={formatJSON}
            className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
            title="格式化JSON"
          >
            Format
          </button>
        )}
        
        <div className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded">
          {language.toUpperCase()}
        </div>
      </div>

    </div>
  );
};

export default EnhancedTextarea;
