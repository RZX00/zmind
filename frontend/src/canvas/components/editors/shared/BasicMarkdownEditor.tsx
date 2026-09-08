import React, { useEffect, useRef, useCallback } from 'react';

interface BasicMarkdownEditorProps {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: (value: string) => void;
  onRawHeightChange?: (rawHeight: number) => void; // textarea.scrollHeight（不含外层padding/border）
  fontFamily?: string;
  fontSize?: number; // px
  lineHeight?: number; // px
  autoFocus?: boolean; // 是否自动聚焦并将光标置于末尾
}

// 极简 Markdown 文本编辑器：无滚动、自动换行、受控
const BasicMarkdownEditor: React.FC<BasicMarkdownEditorProps> = ({
  value,
  placeholder = '',
  onChange,
  onKeyDown,
  onBlur,
  onRawHeightChange,
  fontFamily = 'var(--font-playfair-display), NotoSerifSC-Regular, "Noto Serif SC", serif',
  fontSize = 16,
  lineHeight = 22,
  autoFocus = false,
}) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  const reportRawHeight = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const prev = el.style.height;
    // 临时设置为0以读取内容固有高度，避免可见高度影响scrollHeight
    el.style.height = '0px';
    const intrinsic = el.scrollHeight;
    // 恢复原高度
    el.style.height = prev;
    onRawHeightChange?.(intrinsic);
  }, [onRawHeightChange]);

  // 初次挂载与每次 value 改变后上报高度
  useEffect(() => {
    reportRawHeight();
  }, [value, reportRawHeight]);

  // 自动聚焦并将光标移动到末尾
  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    try {
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    } catch {}
  }, [autoFocus]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        // 变更时立即上报高度，缩短空窗（使用临时auto测量）
        const el = ref.current;
        if (el) {
          const prev = el.style.height;
          el.style.height = '0px';
          const intrinsic = el.scrollHeight;
          el.style.height = prev;
          onRawHeightChange?.(intrinsic);
        }
      }}
      onKeyDown={onKeyDown}
      onBlur={() => onBlur?.(value)}
      placeholder={placeholder}
      spellCheck={false}
      className="w-full h-full border-none outline-none resize-none bg-transparent"
      style={{
        // 不在 textarea 内部增加 padding，高度统一由外层容器 padding 提供
        padding: 0,
        margin: 0,
        overflow: 'hidden', // 不显示滚动条
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily,
        fontSize,
        lineHeight: `${lineHeight}px`,
        color: 'inherit',
      }}
    />
  );
};

export default BasicMarkdownEditor;
