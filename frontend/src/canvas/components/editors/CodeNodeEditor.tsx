// 💻 代码节点编辑器
// 支持HTML预览和CodeMirror编辑器，双击进入专业编辑模式

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Check, X, Code, Eye } from 'lucide-react';
import CodeMirrorEditor from './shared/CodeMirrorEditor';
import type { Canvas, CanvasNode, FontStyle, CornerStyle } from '../../types/canvas';
import { extractH1Title, truncateText, willTextOverflow } from '../../utils/htmlUtils';
import { sanitizeHtmlForRender } from '@/lib/markdown/htmlSanitizer';
import {useTranslations} from 'next-intl';

type CodeNodeType = CanvasNode & { type: 'code' };

interface CodeNodeEditorProps {
  node: CodeNodeType;
  editing?: boolean;
  selected?: boolean; // ✅ 添加选中状态
  fontStyle?: FontStyle;
  cornerStyle?: CornerStyle;
  onContentChange?: (nodeId: string, content: string) => void;
  onEditToggle?: (nodeId: string, editing: boolean) => void;
  onSelect?: (nodeId: string, multiSelect?: boolean) => void; // ✅ 添加节点选中回调
}

// 🎨 简单的HTML预览组件
const HtmlPreview: React.FC<{ code: string; height?: string; cornerStyle?: CornerStyle }> = ({ code, height = "100%", cornerStyle }) => {
  const sanitized = useMemo(() => sanitizeHtmlForRender(code, { context: 'html-node' }), [code]);

  const srcDoc = useMemo(() => `<!DOCTYPE html><html><head><meta charset="utf-8" />
  <style>
    html,body{margin:0;padding:0;background:transparent;}
    ::-webkit-scrollbar{width:4px;height:4px;}
    ::-webkit-scrollbar-track{background:transparent;}
    ::-webkit-scrollbar-thumb{background:#9ca3af;border-radius:2px;}
    ::-webkit-scrollbar-thumb:hover{background:#6b7280;}
    ::-webkit-scrollbar-corner{background:transparent;}
    *{scrollbar-width:thin;scrollbar-color:#9ca3af transparent;}
  </style>
</head><body>${sanitized}</body></html>`, [sanitized]);

  const t = useTranslations();
  return (
    <div 
      className={`w-full border border-gray-200 dark:border-zinc-700 bg-transparent overflow-auto html-preview-container ${cornerStyle?.className || 'rounded'}`}
      style={{ 
        height,
        scrollbarWidth: 'thin',
        scrollbarColor: '#9ca3af transparent'
      }}
    >
      <iframe
        srcDoc={srcDoc}
        className="w-full h-full border-none"
        sandbox="allow-forms allow-pointer-lock"
        title={t('canvas.codeNode.previewTitle', { default: 'HTML Preview' })}
      />
    </div>
  );
};

// 💻 代码节点编辑器 - 简化状态管理，与TextNodeEditor保持一致
export const CodeNodeEditor: React.FC<CodeNodeEditorProps> = ({
  node,
  editing = false,
  selected = false, // ✅ 接收选中状态
  fontStyle,
  cornerStyle,
  onContentChange,
  onEditToggle,
  onSelect // ✅ 接收节点选中回调
}) => {
  const codeType = (node as any).codeType || 'html';
  const t = useTranslations();
  const [localContent, setLocalContent] = useState(node.content);
  const [showPreview, setShowPreview] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewHeight, setPreviewHeight] = useState(200); // HTML预览的基准高度

  // 🎯 处理节点选中（第一次点击）
  const handleNodeSelect = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selected) {
      onSelect?.(node.id, event.ctrlKey || event.metaKey);
    }
  }, [selected, onSelect, node.id]);

  // 🎯 阻止拖拽开始（防止单击触发拖拽）
  const handlePreventDrag = useCallback((event: React.MouseEvent) => {
    if (!selected) {
      // 未选中时阻止mousedown事件传播到NodeContainer
      event.preventDefault();
      event.stopPropagation();
    }
  }, [selected]);

  // 🎯 编辑器内容变更处理
  const handleContentChange = useCallback((newContent: string) => {
    setLocalContent(newContent);
  }, []);

  // 💾 保存内容 - 与TextNodeEditor完全一致的逻辑
  const handleSave = useCallback(() => {
    const trimmedContent = (localContent || '').trim();
    if (trimmedContent !== node.content) {
      onContentChange?.(node.id, trimmedContent);
    }
    onEditToggle?.(node.id, false);
  }, [localContent, node.content, node.id, onContentChange, onEditToggle]);

  // ❌ 取消编辑 - 与TextNodeEditor一致
  const handleCancel = useCallback(() => {
    setLocalContent(node.content);
    onEditToggle?.(node.id, false);
  }, [node.id, node.content, onEditToggle]);

  // 🎯 处理双击编辑
  const handleDoubleClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!editing) {
      onEditToggle?.(node.id, true);
    }
  }, [editing, node.id, onEditToggle]);

  // 🎯 编辑器键盘事件处理
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey) {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleSave();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        handleCancel();
      }
    }
  }, [handleSave, handleCancel]);

  // 🎯 获取预览高度（用于编辑器尺寸计算）
  const updatePreviewHeight = useCallback(() => {
    if (previewRef.current) {
      const height = previewRef.current.scrollHeight;
      setPreviewHeight(height);
    }
  }, []);

  // 🎯 同步外部内容变化 - 与TextNodeEditor一样
  useEffect(() => {
    if (node.content !== localContent && !editing) {
      setLocalContent(node.content);
    }
  }, [node.content, localContent, editing]);

  // 🎯 更新预览高度
  useEffect(() => {
    if (!editing) {
      updatePreviewHeight();
    }
  }, [editing, localContent, updatePreviewHeight]);

  return (
    <div className="w-full h-full relative">
      {editing ? (
        // ✏️ 编辑模式
        <div className="w-full h-full flex flex-col">
          {/* 编辑工具栏 */}
          <div className="flex items-center justify-between p-2 bg-green-50 border-b border-green-200">
            <div className="flex items-center space-x-2">
              <Code size={14} className="text-green-600" />
              <span className="text-xs font-medium text-green-700">
                {codeType.toUpperCase()} 编辑
              </span>
            </div>
            <div className="flex items-center space-x-1">
              {codeType === 'html' && (
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className={`p-1 rounded transition-colors ${
                    showPreview 
                      ? 'text-blue-600 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/30' 
                      : 'text-gray-600 dark:text-zinc-300 hover:bg-accent/60'
                  }`}
                  title={t('canvas.codeNode.togglePreview', { default: 'Toggle Preview' })}
                >
                  <Eye size={14} />
                </button>
              )}
              <button
                onClick={handleSave}
                className="p-1 text-green-600 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors"
                title={t('canvas.codeNode.saveHint', { default: 'Save (Ctrl+Enter)' })}
              >
                <Check size={14} />
              </button>
              <button
                onClick={handleCancel}
                className="p-1 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                title={t('canvas.codeNode.cancelHint', { default: 'Cancel (Esc)' })}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* CodeMirror编辑器区域 */}
          <div className="flex-1 flex">
            {/* CodeMirror代码编辑区 */}
            <div className={showPreview ? "w-1/2 border-r border-gray-200 dark:border-zinc-700" : "w-full"}>
              <CodeMirrorEditor
                value={localContent}
                language={codeType === 'html' ? 'html' : 'javascript'}
                height={`${Math.max(120, previewHeight)}px`}
                onChange={handleContentChange}
                onBlur={() => {/* handled by save button */}}
                className="w-full h-full"
              />
            </div>

            {/* HTML预览区 */}
            {showPreview && codeType === 'html' && (
              <div className="w-1/2 bg-transparent">
                <div className="p-2 bg-gray-50 dark:bg-zinc-800/50 border-b border-gray-200 dark:border-zinc-700">
                  <span className="text-sm font-medium text-foreground">实时预览</span>
                </div>
                <div className="h-full p-3">
                  <HtmlPreview code={localContent} cornerStyle={cornerStyle} />
                </div>
              </div>
            )}
          </div>

        </div>
      ) : (
        // 📖 HTML预览模式
        <div
          ref={previewRef}
          className="w-full h-full relative"
        >
          {/* 浮动表头区域 - 仅在选中时显示，覆盖在内容上方 */}
            {selected && (
              <div
              className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-3 py-2 bg-white/90 dark:bg-zinc-900/70 backdrop-blur-sm border-b border-gray-200 dark:border-zinc-700 cursor-pointer hover:bg-accent/40 transition-all duration-200 shadow-sm"
              onDoubleClick={handleDoubleClick}
            >
              <div className="flex-1"></div>
              <div className="flex items-center">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onEditToggle?.(node.id, true);
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-accent/60"
                  title={t('canvas.codeNode.edit', { default: 'Edit code' })}
                >
                  <Code size={16} />
                </button>
              </div>
            </div>
          )}

          {/* 内容区域 - 占据全部高度 */}
          <div className="w-full h-full relative">
            {/* HTML内容显示区域 */}
            {node.content.trim() ? (
              codeType === 'html' ? (
                <HtmlPreview code={node.content} cornerStyle={cornerStyle} />
              ) : (
                <pre className={`w-full h-full p-3 bg-gray-900 text-gray-100 text-sm font-mono overflow-auto ${cornerStyle?.className || 'rounded'}`}>
                  <code>{node.content}</code>
                </pre>
              )
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-gray-400 dark:text-zinc-500 text-center flex flex-col items-center space-y-2">
                  <Code size={24} className="text-gray-300 dark:text-zinc-600" />
                  <div>双击{selected ? '编辑按钮或' : ''}开始编辑{codeType.toUpperCase()}代码</div>
                  <div className="text-xs">
                    {codeType === 'html' ? 'CodeMirror编辑器 + HTML预览' : 'CodeMirror语法高亮编辑'}
                  </div>
                </div>
              </div>
            )}

            {/* 透明覆盖层 - 未选中时拦截点击事件并阻止拖拽 */}
            {!selected && (
              <div
                className="absolute inset-0 cursor-pointer"
                onClick={handleNodeSelect}
                onMouseDown={handlePreventDrag}
                title={t('canvas.codeNode.clickToSelect', { default: 'Click to select node' })}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CodeNodeEditor;
