// ✏️ SVG文字原位置编辑器
// 在text元素位置显示可编辑输入框

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {useTranslations} from 'next-intl';
import type { SvgElement } from './utils/svgParser';

interface SvgTextEditorProps {
  /** 要编辑的text元素 */
  element: SvgElement;
  /** SVG容器引用（用于坐标计算） */
  containerRef: React.RefObject<HTMLDivElement>;
  /** 保存回调 */
  onSave: (elementId: string, newText: string) => void;
  /** 取消回调 */
  onCancel: () => void;
}

export const SvgTextEditor: React.FC<SvgTextEditorProps> = ({
  element,
  containerRef,
  onSave,
  onCancel
}) => {
  const t = useTranslations();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localValue, setLocalValue] = useState(element.textContent || '');
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [style, setStyle] = useState<React.CSSProperties>({});

  // 计算输入框位置和样式
  useEffect(() => {
    if (!element.domNode || !containerRef.current) return;

    try {
      // 获取text元素的屏幕坐标
      const textRect = element.domNode.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();

      // 计算相对于容器的位置
      const relativeX = textRect.left - containerRect.left;
      const relativeY = textRect.top - containerRect.top;

      setPosition({ x: relativeX, y: relativeY });

      // 提取并匹配样式
      const computedStyle = window.getComputedStyle(element.domNode);
      const fontSize = element.attributes['font-size'] || computedStyle.fontSize;
      const fill = element.attributes['fill'] || computedStyle.fill;
      const fontFamily = element.attributes['font-family'] || computedStyle.fontFamily;
      const fontWeight = element.attributes['font-weight'] || computedStyle.fontWeight;
      const textAnchor = element.attributes['text-anchor'] || 'start';

      // 根据text-anchor调整对齐方式
      let textAlign: 'left' | 'center' | 'right' = 'left';
      if (textAnchor === 'middle') textAlign = 'center';
      else if (textAnchor === 'end') textAlign = 'right';

      setStyle({
        fontSize,
        color: fill,
        fontFamily,
        fontWeight,
        textAlign,
        width: Math.max(textRect.width, 100) + 'px',
        minWidth: '50px'
      });
    } catch (error) {
      console.error('计算文字编辑器位置失败:', error);
    }
  }, [element, containerRef]);

  // 自动聚焦并全选
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  // 保存编辑
  const handleSave = useCallback(() => {
    if (localValue.trim() !== element.textContent) {
      onSave(element.id, localValue.trim());
    } else {
      onCancel();
    }
  }, [localValue, element.id, element.textContent, onSave, onCancel]);

  // 键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  }, [handleSave, onCancel]);

  // 失焦保存
  const handleBlur = useCallback(() => {
    // 延迟执行，避免与其他事件冲突
    setTimeout(() => {
      handleSave();
    }, 100);
  }, [handleSave]);

  // 阻止事件冒泡
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      className="absolute z-50"
      style={{
        left: position.x,
        top: position.y,
        pointerEvents: 'auto'
      }}
      onClick={handleClick}
    >
      {/* 编辑提示浮层 */}
      <div className="absolute -top-16 left-0 flex flex-col gap-1 animate-in fade-in duration-200">
        <div className="text-xs bg-blue-600 text-white px-2 py-1 rounded shadow-lg whitespace-nowrap">
          {t('canvas.svgTextEditor.editHint', { default: '✏️ Edit text (Enter to save / ESC to cancel)' })}
        </div>
        <div className="text-xs bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded shadow whitespace-nowrap">
          {t('canvas.svgTextEditor.updateNote', { default: '💾 Changes will directly update SVG code' })}
        </div>
      </div>

      {/* 输入框 */}
      <input
        ref={inputRef}
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="px-2 py-1 border-2 border-blue-500 rounded bg-white dark:bg-zinc-800 outline-none shadow-lg ring-2 ring-blue-200 dark:ring-blue-900"
        style={style}
        placeholder={t('canvas.svgTextEditor.placeholder', { default: 'Enter text...' })}
      />
    </div>
  );
};

export default SvgTextEditor;
