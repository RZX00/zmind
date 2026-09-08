'use client';

// 浮窗编辑面板组件 - 左侧显示画布源代码(JSON)，可切到选中节点内容
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {useTranslations} from 'next-intl';
import { X, Maximize2, Minimize2, Code, RotateCcw, RotateCw } from 'lucide-react';
import CodeMirrorEditor from '../components/editors/shared/CodeMirrorEditor';
import type { Canvas, CanvasNode } from '../types/canvas';

// JSON数据清理工具函数（处理意外拼接的JSON片段）
const cleanupJsonData = (rawData: string): string => {
  try {
    const trimmed = rawData.trim();
    const multiJsonPattern = /}\s*[A-Za-z]*\s*\{/g;
    const matches = trimmed.match(multiJsonPattern);
    if (matches && matches.length > 0) {
      let braceCount = 0;
      let firstJsonEnd = -1;
      for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (ch === '{') braceCount++;
        else if (ch === '}') {
          braceCount--;
          if (braceCount === 0) {
            firstJsonEnd = i;
            break;
          }
        }
      }
      if (firstJsonEnd > 0) {
        return trimmed.substring(0, firstJsonEnd + 1);
      }
    }
    return trimmed;
  } catch {
    return rawData;
  }
};

interface FloatingEditorPanelProps {
  isVisible: boolean;
  onClose: () => void;
  canvasData: Canvas;
  selectedNode?: CanvasNode | null;
  onCanvasDataChange?: (newData: Canvas) => void;
  onNodeContentChange?: (nodeId: string, newContent: string) => void;
}

const FloatingEditorPanel: React.FC<FloatingEditorPanelProps> = ({
  isVisible,
  onClose,
  canvasData,
  selectedNode,
  onCanvasDataChange,
  onNodeContentChange,
}) => {
  const t = useTranslations();
  const [isMaximized, setIsMaximized] = useState(false);
  const [canvasCode, setCanvasCode] = useState(() => {
    try { return JSON.stringify(canvasData, null, 2); } catch { return ''; }
  });
  const [nodeContent, setNodeContent] = useState(() => {
    if (!selectedNode) return '';
    return selectedNode.type === 'table' && (selectedNode as any).data
      ? JSON.stringify((selectedNode as any).data, null, 2)
      : (selectedNode.content || '');
  });
  const [canvasHistory, setCanvasHistory] = useState<string[]>([]);
  const [nodeHistory, setNodeHistory] = useState<string[]>([]);
  const [canvasHistoryIndex, setCanvasHistoryIndex] = useState(-1);
  const [nodeHistoryIndex, setNodeHistoryIndex] = useState(-1);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [activeTab, setActiveTab] = useState<'canvas' | 'node'>('canvas');
  // 编辑激活：默认关闭，点击编辑区域后开启
  const [editingActive, setEditingActive] = useState(false);

  const latestCanvasCodeRef = useRef<string>('');
  const latestNodeContentRef = useRef<string>('');
  const canvasUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const nodeUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 同步画布数据到JSON文本
  useEffect(() => {
    try {
      const json = JSON.stringify(canvasData, null, 2);
      setCanvasCode(json);
      latestCanvasCodeRef.current = json;
    } catch {
      // ignore
    }
  }, [canvasData]);

  // 选中节点变化时，同步节点内容
  const prevSelectedNodeRef = useRef(selectedNode);
  useEffect(() => {
    if (selectedNode?.id !== prevSelectedNodeRef.current?.id) {
      const content = selectedNode
        ? selectedNode.type === 'table' && (selectedNode as any).data
          ? JSON.stringify((selectedNode as any).data, null, 2)
          : (selectedNode.content || '')
        : '';
      setNodeContent(content);
      latestNodeContentRef.current = content;
      setActiveTab(selectedNode ? 'node' : 'canvas');
      prevSelectedNodeRef.current = selectedNode;
    } else if (selectedNode) {
      const content = selectedNode.type === 'table' && (selectedNode as any).data
        ? JSON.stringify((selectedNode as any).data, null, 2)
        : (selectedNode.content || '');
      if (content !== latestNodeContentRef.current) {
        setNodeContent(content);
        latestNodeContentRef.current = content;
      }
    }
  }, [selectedNode]);

  // 历史管理
  const addToCanvasHistory = useCallback((code: string) => {
    setCanvasHistory(prev => {
      const next = prev.slice(0, canvasHistoryIndex + 1);
      next.push(code);
      return next.slice(-50);
    });
    setCanvasHistoryIndex(prev => Math.min(prev + 1, 49));
  }, [canvasHistoryIndex]);

  const addToNodeHistory = useCallback((content: string) => {
    setNodeHistory(prev => {
      const next = prev.slice(0, nodeHistoryIndex + 1);
      next.push(content);
      return next.slice(-50);
    });
    setNodeHistoryIndex(prev => Math.min(prev + 1, 49));
  }, [nodeHistoryIndex]);

  const undoCanvas = useCallback(() => {
    if (canvasHistoryIndex > 0) {
      const i = canvasHistoryIndex - 1;
      setCanvasHistoryIndex(i);
      setCanvasCode(canvasHistory[i] || '');
    }
  }, [canvasHistory, canvasHistoryIndex]);

  const redoCanvas = useCallback(() => {
    if (canvasHistoryIndex < canvasHistory.length - 1) {
      const i = canvasHistoryIndex + 1;
      setCanvasHistoryIndex(i);
      setCanvasCode(canvasHistory[i] || '');
    }
  }, [canvasHistory, canvasHistoryIndex]);

  const undoNode = useCallback(() => {
    if (nodeHistoryIndex > 0) {
      const i = nodeHistoryIndex - 1;
      setNodeHistoryIndex(i);
      setNodeContent(nodeHistory[i] || '');
    }
  }, [nodeHistory, nodeHistoryIndex]);

  const redoNode = useCallback(() => {
    if (nodeHistoryIndex < nodeHistory.length - 1) {
      const i = nodeHistoryIndex + 1;
      setNodeHistoryIndex(i);
      setNodeContent(nodeHistory[i] || '');
    }
  }, [nodeHistory, nodeHistoryIndex]);

  // 画布代码编辑变化
  const handleCanvasCodeChange = (newCode: string) => {
    setCanvasCode(newCode);
    latestCanvasCodeRef.current = newCode;
    setHasUnsavedChanges(true);
  };

  // 节点内容编辑变化
  const handleNodeContentChange = (newContent: string) => {
    setNodeContent(newContent);
    latestNodeContentRef.current = newContent;
    setHasUnsavedChanges(true);
  };

  // 保存画布JSON（失焦或快捷键触发）
  const saveCanvasJson = useCallback((codeFromEditor?: string) => {
    const source = (codeFromEditor ?? latestCanvasCodeRef.current) || '';
    if (canvasUpdateTimeoutRef.current) clearTimeout(canvasUpdateTimeoutRef.current);
    setHasUnsavedChanges(true);
    canvasUpdateTimeoutRef.current = setTimeout(() => {
      addToCanvasHistory(source);
      try {
        if (!source.trim()) { setHasUnsavedChanges(false); return; }
        const cleaned = cleanupJsonData(source);
        const parsed = JSON.parse(cleaned);
        onCanvasDataChange?.(parsed);
        setHasUnsavedChanges(false);
      } catch (e) {
        console.error('JSON解析错误:', e);
        setHasUnsavedChanges(false);
      }
    }, 200);
  }, [addToCanvasHistory, onCanvasDataChange]);

  // 保存节点内容（失焦或快捷键触发）
  const saveNodeContent = useCallback((contentFromEditor?: string) => {
    const content = (contentFromEditor ?? latestNodeContentRef.current) || '';
    if (!selectedNode) return;
    if (nodeUpdateTimeoutRef.current) clearTimeout(nodeUpdateTimeoutRef.current);
    setHasUnsavedChanges(true);
    nodeUpdateTimeoutRef.current = setTimeout(() => {
      addToNodeHistory(content);
      onNodeContentChange?.(selectedNode.id, content);
      setHasUnsavedChanges(false);
    }, 200);
  }, [selectedNode, onNodeContentChange, addToNodeHistory]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, scope: 'canvas' | 'node') => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (scope === 'canvas') saveCanvasJson(); else saveNodeContent();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (scope === 'canvas') undoCanvas(); else undoNode();
    }
    if ((e.metaKey || e.ctrlKey) && (e.shiftKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (scope === 'canvas') redoCanvas(); else redoNode();
    }
  }, [saveCanvasJson, saveNodeContent, undoCanvas, redoCanvas, undoNode, redoNode]);

  // 全局快捷键(编辑激活时)：Ctrl/Cmd+S 保存当前活动页
  useEffect(() => {
    if (!editingActive) return;
    const onKey = (ev: KeyboardEvent) => {
      const key = ev.key.toLowerCase();
      if ((ev.metaKey || ev.ctrlKey) && key === 's') {
        ev.preventDefault();
        if (activeTab === 'canvas') saveCanvasJson(); else saveNodeContent();
      }
      if ((ev.metaKey || ev.ctrlKey) && key === 'z' && !ev.shiftKey) {
        ev.preventDefault();
        if (activeTab === 'canvas') undoCanvas(); else undoNode();
      }
      if ((ev.metaKey || ev.ctrlKey) && key === 'z' && ev.shiftKey) {
        ev.preventDefault();
        if (activeTab === 'canvas') redoCanvas(); else redoNode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingActive, activeTab, saveCanvasJson, saveNodeContent, undoCanvas, undoNode, redoCanvas, redoNode]);

  const getLanguageType = (): 'json' | 'markdown' | 'html' | 'javascript' => {
    if (!selectedNode) return 'json';
    switch (selectedNode.type) {
      case 'text':
        return 'markdown';
      case 'code': {
        const codeNode = selectedNode as any;
        if (codeNode.codeType === 'html') return 'html';
        if (codeNode.codeType === 'mermaid') return 'markdown'; // 用markdown近似显示
        return 'javascript';
      }
      default:
        return 'markdown';
    }
  };

  // 计算编辑区域固定高度
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const [editorHeight, setEditorHeight] = useState<number>(400);

  const measureEditorHeight = useCallback(() => {
    if (editorAreaRef.current) {
      const rect = editorAreaRef.current.getBoundingClientRect();
      // 留出少量内边距
      const h = Math.max(200, Math.floor(rect.height));
      setEditorHeight(h);
    }
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    measureEditorHeight();
    const onResize = () => measureEditorHeight();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measureEditorHeight, isVisible]);

  // 打开面板或切换目标时，默认进入只读（非编辑）状态
  useEffect(() => {
    if (isVisible) {
      setEditingActive(false);
      setActiveTab('canvas'); // 打开面板默认展示整份画布JSON
    }
  }, [isVisible, selectedNode?.id]);

  if (!isVisible) return null;

  return (
    <div 
      data-floating-editor-panel="true"
      className="relative bg-white dark:bg-zinc-900/80 backdrop-blur-xl border border-gray-200/50 dark:border-zinc-700/50 shadow-2xl rounded-xl transition-all duration-300 w-full h-full flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-gray-50/80 to-white/80 dark:from-zinc-800/70 dark:to-zinc-900/70 border-b border-gray-200/50 dark:border-zinc-700/50 rounded-t-xl">
        <div className="flex items-center space-x-3 flex-1">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          <h3 className="text-sm font-mono text-foreground font-medium">{t('canvas.floatingEditor.title', {default: 'code.editor'})}</h3>
          <span className="text-xs font-mono text-muted-foreground">
            {activeTab === 'canvas' ? 'json' : selectedNode ? getLanguageType() : t('canvas.floatingEditor.idle', {default: 'idle'})}
          </span>
          {hasUnsavedChanges && (
            <div className="w-1.5 h-1.5 bg-orange-400 rounded-full" title={t('canvas.floatingEditor.unsaved', {default: 'Unsaved changes'})} />
          )}
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={undoCanvas}
            disabled={canvasHistoryIndex <= 0}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors disabled:opacity-30"
            title={t('canvas.floatingEditor.undo', {default: 'undo'})}
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={redoCanvas}
            disabled={canvasHistoryIndex >= canvasHistory.length - 1}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors disabled:opacity-30"
            title={t('canvas.floatingEditor.redo', {default: 'redo'})}
          >
            <RotateCw size={14} />
          </button>
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
            title={isMaximized ? t('canvas.floatingEditor.restore', {default: 'restore'}) : t('canvas.floatingEditor.maximize', {default: 'maximize'})}
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
            title={t('canvas.floatingEditor.close', {default: 'close'})}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 状态栏 */}
      <div className="px-4 py-2 bg-white/50 dark:bg-zinc-900/40 border-b border-gray-200/50 dark:border-zinc-700/50">
        <div className="flex items-center justify-between text-xs">
          {activeTab === 'canvas' ? (
            <div className="flex items-center space-x-2">
              <span className="text-muted-foreground font-mono">{t('canvas.floatingEditor.editing', {default: 'editing:'})}</span>
              <span className="text-foreground font-mono bg-gray-100 dark:bg-zinc-800 px-2 py-1 border border-gray-200 dark:border-zinc-700">canvas.json</span>
            </div>
          ) : selectedNode ? (
            <div className="flex items-center space-x-2">
              <span className="text-muted-foreground font-mono">editing:</span>
              <span className="text-foreground font-mono bg-blue-50 dark:bg-blue-900/30 px-2 py-1 border border-blue-200 dark:border-blue-800">{selectedNode.type}.{selectedNode.id}</span>
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              <span className="text-muted-foreground font-mono">{t('canvas.floatingEditor.status', {default: 'status:'})}</span>
              <span className="text-muted-foreground font-mono">{t('canvas.floatingEditor.noSelection', {default: 'no selection'})}</span>
            </div>
          )}
          <div className="flex items-center space-x-3 text-xs font-mono text-muted-foreground">
            <span>{t('canvas.floatingEditor.chars', {count: (canvasCode || '').length})}</span>
            {selectedNode && (<span>{t('canvas.floatingEditor.lang', {lang: getLanguageType()})}</span>)}
          </div>
        </div>
      </div>

      {/* 编辑器区域 */}
      <div className="flex flex-col flex-1">
        <div ref={editorAreaRef} className="flex-1 bg-white/30 dark:bg-zinc-900/40 backdrop-blur-sm relative overflow-hidden">
          {activeTab === 'canvas' ? (
            <div key="canvas-editor" className="h-full">
              <CodeMirrorEditor
                value={canvasCode || ''}
                language="json"
                height={`${editorHeight}px`}
                readOnly={!editingActive}
                onChange={handleCanvasCodeChange}
                onBlur={() => saveCanvasJson()}
                className="h-full"
              />
              {!editingActive && (
                <div
                  className="absolute inset-0 cursor-text bg-transparent"
                  onClick={(e) => { e.stopPropagation(); setEditingActive(true); }}
                  title={t('canvas.floatingEditor.clickToEdit', {default: 'Click to edit'})}
                />
              )}
            </div>
          ) : selectedNode ? (
            <div key={`node-editor-${selectedNode.id}`} className="h-full">
              <CodeMirrorEditor
                value={nodeContent || ''}
                language={getLanguageType()}
                height={`${editorHeight}px`}
                readOnly={!editingActive}
                onChange={handleNodeContentChange}
                onBlur={() => saveNodeContent()}
                className="h-full"
              />
              {!editingActive && (
                <div
                  className="absolute inset-0 cursor-text bg-transparent"
                  onClick={(e) => { e.stopPropagation(); setEditingActive(true); }}
                  title={t('canvas.floatingEditor.clickToEdit', {default: 'Click to edit'})}
                />
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-zinc-700 dark:to-zinc-800 rounded-xl flex items-center justify-center">
                  <Code size={24} className="text-muted-foreground" />
                </div>
                <p className="text-sm font-mono text-gray-600 mb-2">{t('canvas.floatingEditor.noSelection', {default: 'no node selected'})}</p>
                <p className="text-xs font-mono text-gray-500">{t('canvas.floatingEditor.clickNode', {default: 'click a canvas node to edit'})}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FloatingEditorPanel;
