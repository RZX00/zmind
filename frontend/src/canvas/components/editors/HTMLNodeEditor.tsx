'use client';

// 🌐 HTML节点编辑器
// 使用CodeMirror进行编辑，iframe进行预览

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Code, Save } from 'lucide-react';
import CodeMirrorEditor from './shared/CodeMirrorEditor';
import type { CanvasNode, FontStyle, CornerStyle } from '../../types/canvas';
import { useTranslations } from 'next-intl';
import { getPresentationMetadata, isPresentationResultHtmlNode } from '../../utils/presentationMetadata';

type HTMLNodeType = CanvasNode & { type: 'code'; codeType: 'html' };

interface HTMLNodeEditorProps {
  node: HTMLNodeType;
  editing?: boolean;
  selected?: boolean;
  fontStyle?: FontStyle;
  cornerStyle?: CornerStyle;
  onContentChange?: (nodeId: string, content: string) => void;
  onEditToggle?: (nodeId: string, editing: boolean) => void;
  onSelect?: (nodeId: string, multiSelect?: boolean) => void;
}

// 🖼️ HTML预览组件 - 实时 iframe 渲染
const HTMLPreview: React.FC<{
  htmlContent: string;
  height?: string;
  cornerStyle?: CornerStyle;
  interactive?: boolean;
}> = ({
  htmlContent,
  height = '400px',
  cornerStyle,
  interactive = false,
}) => {
  const srcDoc = useMemo(() => {
    const trimmed = (htmlContent || '').trim();
    const hasFrame = /<!DOCTYPE|<html\b|<body\b/i.test(trimmed);
    const scrollbarCss = `
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
      }
      * {
        scrollbar-width: thin;
        scrollbar-color: #9ca3af transparent;
      }
      ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      ::-webkit-scrollbar-track {
        background: transparent;
      }
      ::-webkit-scrollbar-thumb {
        background-color: #9ca3af;
        border-radius: var(--radius-full, 999px);
        border: var(--stroke-1, 1px) solid transparent;
      }
      ::-webkit-scrollbar-button {
        display: none;
        height: 0;
        width: 0;
      }
    `;
    return hasFrame
      ? htmlContent.replace('</head>', `<style>${scrollbarCss}</style></head>`)
      : `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${scrollbarCss}</style></head><body>${htmlContent}</body></html>`;
  }, [htmlContent]);

  const t = useTranslations();
  return (
    <div
      className={`relative w-full border border-border bg-transparent overflow-hidden ${cornerStyle?.className || 'rounded'}`}
      style={{ height }}
    >
      <iframe
        srcDoc={srcDoc}
        className="w-full h-full border-none"
        sandbox="allow-scripts allow-forms allow-pointer-lock"
        allow="fullscreen"
        allowFullScreen
        data-html-preview-iframe
        title={t('canvas.htmlEditor.previewTitle', { default: 'HTML Preview' })}
      />
      {!interactive && (
        <div
          className="absolute inset-0 cursor-pointer"
          style={{ background: 'transparent', pointerEvents: 'auto' }}
          aria-hidden="true"
        />
      )}
    </div>
  );
};

// 🌐 HTML节点编辑器主组件
export const HTMLNodeEditor: React.FC<HTMLNodeEditorProps> = ({
  node,
  editing = false,
  selected = false,
  fontStyle,
  cornerStyle,
  onContentChange,
  onEditToggle,
  onSelect,
}) => {
  const t = useTranslations();
  const [localContent, setLocalContent] = useState(node.content || '');
  const [hovered, setHovered] = useState(false);
  const presentationMeta = useMemo(() => getPresentationMetadata(node), [node]);
  const isPresentationResult = useMemo(() => isPresentationResultHtmlNode(node), [node]);
  const presentationTitle = presentationMeta?.title || '';

  useEffect(() => {
    if (!editing) {
      setLocalContent(node.content || '');
    }
  }, [editing, node.content]);

  // 🔧 处理内容变化
  const handleContentChange = useCallback((newContent: string) => {
    setLocalContent(newContent);
    onContentChange?.(node.id, newContent);
  }, [node.id, onContentChange]);

  // 🔧 处理失焦保存
  const handleBlur = useCallback((content: string) => {
    setLocalContent(content);
    onContentChange?.(node.id, content);
  }, [node.id, onContentChange]);

  // 🔧 切换编辑模式
  const handleEditToggle = useCallback(() => {
    onEditToggle?.(node.id, !editing);
  }, [node.id, editing, onEditToggle]);

  // 🔧 处理节点选中
  const handleNodeClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.(node.id, e.ctrlKey || e.metaKey);
  }, [node.id, onSelect]);

  // 🎨 编辑模式渲染 - 纯编辑，无预览
  if (editing) {
    return (
      <div className="w-full h-full flex flex-col bg-background" data-presentation-node={isPresentationResult ? 'true' : undefined}>
        {/* 简化工具栏 */}
        <div className="flex items-center justify-between p-2 border-b border-border bg-muted/60">
        <div className="flex items-center gap-2">
          <Code size={14} className="text-blue-600" />
          <span className="text-sm font-medium text-foreground">
            {isPresentationResult
              ? t('canvas.htmlEditor.presentationHeader', { default: 'PPT HTML Editor' })
              : t('canvas.htmlEditor.header', { default: 'HTML Editor' })}
          </span>
        </div>

          <button
            onClick={handleEditToggle}
            className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded transition-colors"
          >
            <Save size={14} />
            {t('canvas.htmlEditor.saveAndExit', { default: 'Save & Exit' })}
          </button>
        </div>

        {/* 纯编辑区域 */}
        <div className="flex-1 overflow-hidden" data-scroll-container style={{ height: '100%', overflow: 'auto' }}>
          <CodeMirrorEditor
            value={localContent}
            language="html"
            onChange={handleContentChange}
            onBlur={handleBlur}
            height="100%"
            placeholder={t('canvas.htmlEditor.placeholder', { default: 'Enter HTML code...' })}
            className="h-full"
          />
        </div>
      </div>
    );
  }

  // 🎨 预览模式渲染
  return (
    <div
      className={`relative w-full h-full cursor-pointer ${selected ? 'ring-2 ring-blue-500' : ''}`}
      onClick={handleNodeClick}
      onDoubleClick={handleEditToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-presentation-node={isPresentationResult ? 'true' : undefined}
      data-presentation-role={isPresentationResult ? 'result_html' : undefined}
    >
      {/* 浮动表头（选中或悬停时显示） */}
      {(selected || hovered) && (
        <div
          className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-3 py-2 bg-background/90 backdrop-blur-sm border-b border-border hover:bg-accent/40 transition-all duration-200 shadow-sm"
          data-html-node-drag-handle
          onDoubleClick={(e) => { e.stopPropagation(); handleEditToggle(); }}
          // 不处理右键，允许冒泡到外层，让画布菜单接管
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {isPresentationResult && (
              <span className="inline-flex items-center rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">
                PPT
              </span>
            )}
            <span>
              {isPresentationResult
                ? t('canvas.htmlEditor.presentationPreview', { default: '演示预览' })
                : t('canvas.htmlEditor.previewLive', { default: '实时预览' })}
            </span>
            {isPresentationResult && presentationTitle && (
              <span className="max-w-[220px] truncate" title={presentationTitle}>
                · {presentationTitle}
              </span>
            )}
          </div>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleEditToggle(); }}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-accent/60"
            title={t('canvas.htmlEditor.edit', { default: 'Edit HTML' })}
          >
            <Code size={16} />
          </button>
        </div>
      )}

      <div className="w-full h-full">
        <HTMLPreview
          htmlContent={localContent}
          height="100%"
          cornerStyle={cornerStyle}
          interactive={selected}
          data-html-node-content
        />
      </div>
    </div>
  );
};

export default HTMLNodeEditor;
