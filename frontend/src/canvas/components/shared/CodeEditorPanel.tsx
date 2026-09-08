// 🎯 简化版代码编辑器面板
// 提供基础的代码编辑功能

import React from 'react';
import {useTranslations} from 'next-intl';
import type { Canvas, CanvasNode } from '../../types/canvas';

interface CodeEditorPanelProps {
  canvas: Canvas;
  selectedNodes?: CanvasNode[];
  onNodeContentChange?: (nodeId: string, content: string) => void;
}

const CodeEditorPanel: React.FC<CodeEditorPanelProps> = ({
  canvas,
  selectedNodes = [],
  onNodeContentChange
}) => {
  const t = useTranslations();
  // 找到第一个代码节点作为编辑目标
  const codeNode = selectedNodes.find(node => node.type === 'code') ||
                   canvas.nodes?.find(node => node.type === 'code');

  const handleContentChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (codeNode && onNodeContentChange) {
      onNodeContentChange(codeNode.id, event.target.value);
    }
  };

  return (
    <div className="w-full h-full bg-background text-foreground flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center">
          <span className="mr-2">💻</span>
          <h3 className="text-sm font-medium">{t('canvas.codeEditor.title', {default: 'Code Editor'})}</h3>
        </div>
        <div className="text-xs text-muted-foreground">
          {codeNode 
            ? t('canvas.codeEditor.editing', {id: codeNode.id.substring(0,8)}) 
            : t('canvas.codeEditor.noCode', {default: 'No code node'})}
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 p-0">
        {codeNode ? (
          <textarea
            value={codeNode.content || ''}
            onChange={handleContentChange}
            className="w-full h-full bg-background text-foreground font-mono text-sm p-4 border-none outline-none resize-none"
            placeholder={t('canvas.codeEditor.placeholder', {default: '// Write your code here...'})}
            spellCheck={false}
            style={{
              fontFamily: 'JetBrains Mono, Consolas, Monaco, "Courier New", monospace',
              lineHeight: '1.5',
              tabSize: 2
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <div className="text-3xl mb-2">📝</div>
              <p className="text-sm">{t('canvas.codeEditor.tip.select', {default: 'Select a code node to start editing'})}</p>
              <p className="text-xs mt-1 text-muted-foreground/80">{t('canvas.codeEditor.tip.create', {default: 'Or create a new code node in the canvas'})}</p>
              </div>
            </div>
          )}
      </div>

      {/* 底部状态栏 */}
      <div className="p-2 bg-muted/30 border-t border-border text-xs text-muted-foreground flex justify-between">
        <span>
          {codeNode ? t('canvas.codeEditor.lines', {count: (codeNode.content || '').split('\n').length}) : ''}
        </span>
        <span>
          {codeNode ? t('canvas.codeEditor.chars', {count: (codeNode.content || '').length}) : ''}
        </span>
      </div>
    </div>
  );
};

export default CodeEditorPanel;
