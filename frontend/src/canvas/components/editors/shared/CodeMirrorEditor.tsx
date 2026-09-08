// 🎨 CodeMirror 6 编辑器组件
// 简单稳定的代码编辑器，替换Monaco Editor

import React, { useCallback, useRef, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { xcodeLight } from '@uiw/codemirror-theme-xcode';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { useTheme } from 'next-themes';

interface CodeMirrorEditorProps {
  value: string;
  language: 'html' | 'javascript' | 'json' | 'markdown';
  onChange?: (value: string) => void;
  onBlur?: (value: string) => void;
  height?: string;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  theme?: any; // CodeMirror 主题，可覆盖默认浅色主题
}

// 🎯 语言扩展映射
const getLanguageExtension = (language: string) => {
  switch (language) {
    case 'html':
      return html();
    case 'javascript':
      return javascript();
    case 'json':
      return json();
    case 'markdown':
      return markdown();
    default:
      return [];
  }
};

// 🎨 基础主题配置
const basicThemeLight = EditorView.theme({
  '&': {
    fontSize: '14px',
    fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
    backgroundColor: 'transparent',
  },
  '.cm-content': {
    padding: '16px',
    minHeight: '60px',
    color: '#111827',
    caretColor: '#111827',
  },
  '.cm-focused': {
    outline: 'none',
  },
  '.cm-editor': {
    borderRadius: 'var(--radius-sm)',
    border: '1px solid #e5e7eb',
    backgroundColor: 'transparent',
  },
  '.cm-editor.cm-focused': {
    borderColor: '#3b82f6',
    boxShadow: '0 0 0 1px #3b82f6',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    backgroundColor: 'transparent',
  },
  '.cm-gutters': {
    backgroundColor: '#f9fafb', // slate-50
    color: '#6b7280', // slate-500
    border: 'none',
  },
});

const basicThemeDark = EditorView.theme({
  '&': {
    fontSize: '14px',
    fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
    backgroundColor: 'transparent',
  },
  '.cm-content': {
    padding: '16px',
    minHeight: '60px',
    color: '#EAECEF',
    caretColor: '#EAECEF',
  },
  '.cm-focused': {
    outline: 'none',
  },
  '.cm-editor': {
    borderRadius: 'var(--radius-sm)',
    border: '1px solid #374151',
    backgroundColor: 'transparent',
  },
  '.cm-editor.cm-focused': {
    borderColor: '#3b82f6',
    boxShadow: '0 0 0 1px #3b82f6',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    backgroundColor: 'transparent',
  },
  '.cm-gutters': {
    backgroundColor: '#1f2937', // gray-800
    color: '#9ca3af', // gray-400
    border: 'none',
  },
});

export const CodeMirrorEditor: React.FC<CodeMirrorEditorProps> = ({
  value,
  language,
  onChange,
  onBlur,
  height = '200px',
  readOnly = false,
  placeholder,
  className = '',
  theme,
}) => {
  const editorRef = useRef<any>(null);
  const { resolvedTheme } = useTheme();

  // 🔧 处理内容变化
  const handleChange = useCallback((val: string) => {
    onChange?.(val);
  }, [onChange]);

  // 🔧 处理失焦事件
  const handleBlur = useCallback(() => {
    onBlur?.(value);
  }, [onBlur, value]);

  // 🎯 编辑器扩展配置
  const extensions = [
    getLanguageExtension(language),
    resolvedTheme === 'dark' ? basicThemeDark : basicThemeLight,
    EditorView.lineWrapping, // 启用自动换行
    EditorState.readOnly.of(readOnly),
  ];

  return (
    <div className={`codemirror-wrapper ${className}`}>
      <CodeMirror
        ref={editorRef}
        value={value}
        height={height}
        theme={theme || (resolvedTheme === 'dark' ? vscodeDark : xcodeLight)}
        extensions={extensions}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          dropCursor: true,
          allowMultipleSelections: false,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false, // 禁用自动补全保持简单
          highlightSelectionMatches: false,
          searchKeymap: false,
        }}
      />
    </div>
  );
};

export default CodeMirrorEditor;
