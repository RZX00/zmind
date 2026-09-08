// 📋 Todo 节点：多行子任务，始终以勾选+文本渲染，不暴露 Markdown。

import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CanvasNode, FontStyle, NodeStyles, CornerStyle } from '../../../../types/canvas';
import {
  parseTodoContent,
  toggleTodoLine,
  updateTodoLineText,
  insertTodoLine,
  removeTodoLine,
  normalizeTodoContent,
} from '../../../utils/todoUtils';
import CanvasMarkdownRenderer from '../../shared/CanvasMarkdownRenderer';

type TodoNodeType = CanvasNode & { type: 'todo' };

interface TodoNodeProps {
  node: TodoNodeType;
  editing?: boolean;
  selected?: boolean;
  fontStyle?: FontStyle;
  nodeStyles?: NodeStyles;
  cornerStyle?: CornerStyle;
  onContentChange?: (nodeId: string, content: string) => void;
  onEditToggle?: (nodeId: string, editing: boolean) => void;
  onSizeChange?: (nodeId: string, size: { width: number; height: number }) => void;
}

const TodoNode: React.FC<TodoNodeProps> = ({
  node,
  editing = false,
  selected = false,
  fontStyle,
  nodeStyles,
  cornerStyle,
  onContentChange,
  onEditToggle,
  onSizeChange, // 预留，当前未用
}) => {
  const t = useTranslations();
  const lines = useMemo(() => parseTodoContent(node.content || ''), [node.content]);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const OVERFLOW_EPSILON = 2;
  const [scrollThumb, setScrollThumb] = useState<{ visible: boolean; top: number; height: number }>({
    visible: false,
    top: 0,
    height: 0,
  });
  const effectiveFontSize = fontStyle?.size ?? 16;
  const effectiveFontFamily = fontStyle?.fontFamily ?? 'inherit';
  const effectiveFontWeight = fontStyle?.weight ?? 'normal';
  const textStyles = nodeStyles?.textStyles || {};
  const effectiveTextAlign = textStyles.textAlign ?? 'left';
  const accentColor = textStyles.accentColor || 'transparent';
  const topBorderRadius = cornerStyle?.radius ?? 0;
  const placeholderText = t('canvas.node.text.placeholder', { default: 'type here' });

  const commitContent = useCallback(
    (content: string) => {
      const normalized = normalizeTodoContent(content);
      onContentChange?.(node.id, normalized);
    },
    [node.id, onContentChange]
  );

  const handleToggle = useCallback(
    (lineIndex: number) => {
      const next = toggleTodoLine(node.content || '', lineIndex);
      commitContent(next);
    },
    [node.content, commitContent]
  );

  const handleTextChange = useCallback(
    (lineIndex: number, text: string) => {
      const next = updateTodoLineText(node.content || '', lineIndex, text);
      commitContent(next);
    },
    [node.content, commitContent]
  );

  const handleInsert = useCallback(
    (lineIndex: number) => {
      const { content: next, newIndex } = insertTodoLine(node.content || '', lineIndex);
      commitContent(next);
      requestAnimationFrame(() => inputsRef.current[newIndex]?.focus());
    },
    [node.content, commitContent]
  );

  const handleRemove = useCallback(
    (lineIndex: number) => {
      const { content: next, focusIndex } = removeTodoLine(node.content || '', lineIndex);
      commitContent(next);
      requestAnimationFrame(() => inputsRef.current[focusIndex]?.focus());
    },
    [node.content, commitContent]
  );

  // 空内容时进入编辑态自动创建一行，提升体验
  useEffect(() => {
    if (editing && (!lines || lines.length === 0)) {
      const { content: next } = insertTodoLine('', 0);
      commitContent(next);
    }
  }, [editing, lines, commitContent]);

  const fontClass = fontStyle?.className || 'font-sans';
  const nonEmptyLineCount = useMemo(() => lines.filter(line => (line.text || '').trim().length > 0).length, [lines]);
  const shouldCenterRows = nonEmptyLineCount <= 1;
  const enableScroll = Boolean(editing || selected);
  const scrollClass = enableScroll
    ? 'overflow-y-auto overflow-x-hidden scrollbar-none'
    : 'overflow-hidden';
  const scrollContainerProps = enableScroll ? { 'data-scroll-container': true } : {};
  const showScrollThumb = !editing && enableScroll && scrollThumb.visible;

  const updateScrollThumb = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollHeight, clientHeight, scrollTop } = el;
    const hasOverflow = scrollHeight > clientHeight + OVERFLOW_EPSILON;
    setScrollThumb((prev) => {
      if (!hasOverflow) {
        if (!prev.visible) return prev;
        return { visible: false, top: 0, height: 0 };
      }
      const ratio = clientHeight / scrollHeight;
      const thumbHeight = Math.max(12, Math.round(clientHeight * ratio));
      const maxTop = Math.max(0, clientHeight - thumbHeight);
      const top = maxTop > 0
        ? Math.round((scrollTop / (scrollHeight - clientHeight)) * maxTop)
        : 0;
      if (prev.visible && prev.top === top && prev.height === thumbHeight) return prev;
      return { visible: true, top, height: thumbHeight };
    });
  }, []);

  const scheduleThumbUpdate = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      updateScrollThumb();
    });
  }, [updateScrollThumb]);

  useEffect(() => {
    if (!enableScroll) {
      setScrollThumb((prev) => (prev.visible ? { visible: false, top: 0, height: 0 } : prev));
      return;
    }
    const t = window.setTimeout(() => scheduleThumbUpdate(), 0);
    const t2 = window.setTimeout(() => scheduleThumbUpdate(), 80);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
    };
  }, [
    enableScroll,
    node.content,
    node.width,
    node.height,
    effectiveFontSize,
    effectiveFontFamily,
    effectiveFontWeight,
    effectiveTextAlign,
    scheduleThumbUpdate,
  ]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!enableScroll || !el) return;
    const handleScroll = () => scheduleThumbUpdate();
    el.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', scheduleThumbUpdate);
    return () => {
      el.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', scheduleThumbUpdate);
    };
  }, [enableScroll, scheduleThumbUpdate]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        try { cancelAnimationFrame(scrollRafRef.current); } catch {}
        scrollRafRef.current = null;
      }
    };
  }, []);

  return (
    <div className="w-full h-full relative overflow-hidden">
      {accentColor !== 'transparent' && (
        <div
          className="absolute top-0 left-0 right-0 z-10"
          style={{
            backgroundColor: accentColor,
            height: '6px',
            borderTopLeftRadius: `${topBorderRadius}px`,
            borderTopRightRadius: `${topBorderRadius}px`
          }}
        />
      )}
      <div className="relative w-full h-full">
        <div
          ref={scrollRef}
          className={`w-full h-full p-4 select-text relative ${scrollClass}`}
          onDoubleClick={(e) => {
            if (!editing) {
              e.stopPropagation();
              onEditToggle?.(node.id, true);
            }
          }}
          {...scrollContainerProps}
        >
          <div className={`w-full h-full flex flex-col gap-2 ${shouldCenterRows ? 'justify-center' : ''}`}>
            {lines.length === 0 && !editing ? (
              <div className="text-gray-400 dark:text-zinc-500 italic select-none">{placeholderText}</div>
            ) : (
              lines.map((line, idx) => (
                <div key={`${node.id}-line-${idx}`} className="flex items-center gap-2 group">
                  <span className="w-4 h-4 flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={line.completed}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleToggle(line.lineIndex);
                      }}
                      className="w-4 h-4 text-blue-600 bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 rounded focus:ring-blue-500 focus:ring-2"
                    />
                  </span>
                  {editing ? (
                    <input
                      ref={(el) => {
                        inputsRef.current[idx] = el;
                      }}
                      value={line.text}
                      onChange={(e) => handleTextChange(line.lineIndex, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleInsert(line.lineIndex + 1);
                        } else if (e.key === 'Backspace' && !e.currentTarget.value) {
                          e.preventDefault();
                          handleRemove(line.lineIndex);
                        }
                      }}
                      className={`flex-1 bg-transparent outline-none text-foreground ${fontClass}`}
                      placeholder={placeholderText}
                    />
                  ) : (
                    <div
                      className={`flex-1 ${fontClass} ${line.completed ? 'text-gray-400 dark:text-zinc-500' : 'text-foreground'}`}
                      style={{
                        fontWeight: effectiveFontWeight,
                        textDecoration: line.completed ? 'line-through' : 'none',
                      }}
                    >
                      {line.text ? (
                        <CanvasMarkdownRenderer
                          content={line.text}
                          enableMath={false}
                          enableCodeCopy={false}
                          fontSize={effectiveFontSize}
                          fontFamily={effectiveFontFamily}
                          color="inherit"
                          textAlign={effectiveTextAlign}
                          variant="outline"
                          className="todo-line-markdown"
                        />
                      ) : (
                        <span>{' '}</span>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
        {showScrollThumb && (
          <div className="absolute right-1 top-1 bottom-1 w-[2px] pointer-events-none">
            <div
              className="absolute left-0 w-full bg-muted-foreground/45 rounded-none"
              style={{ top: scrollThumb.top, height: scrollThumb.height }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default TodoNode;
