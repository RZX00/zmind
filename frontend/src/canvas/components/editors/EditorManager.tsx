// 🎛️ 节点编辑器管理器
// 根据节点类型路由到对应的编辑器组件

import React from 'react';
import type { NovelAiRequest, NovelEditorSnapshot } from '@/components/editor/novel';
import type { Canvas, CanvasNode, FontStyle, CornerStyle, NodeStyles } from '../../types/canvas';
import TextNodeEditor from './TextNodeEditor';
import TextNode from '../nodes/text/TextNode';
import MermaidNodeEditor from './MermaidNodeEditor';
import CodeNodeEditor from './CodeNodeEditor';
import HTMLNodeEditor from './HTMLNodeEditor';
import SvgNodeEditor from './SvgNodeEditor';
import MediaNodeEditor from './MediaNodeEditor';
import ColumnContainer from '../nodes/shared/ColumnContainer';
import TodoNode from '../nodes/todo/TodoNode';
import CanvasLinkNode from '../nodes/canvas-link/CanvasLinkNode';

interface EditorManagerProps {
  node: CanvasNode;
  editing?: boolean;
  selected?: boolean; // ✅ 添加选中状态
  readOnly?: boolean;
  fontStyle?: FontStyle;
  cornerStyle?: CornerStyle;
  onContentChange?: (nodeId: string, content: string) => void;
  onEditToggle?: (nodeId: string, editing: boolean) => void;
  onSizeChange?: (nodeId: string, size: { width: number; height: number }) => void;
  onRequestExpandedEdit?: (nodeId: string) => void;
  onRichSnapshotPersist?: (nodeId: string, snapshot: NovelEditorSnapshot) => void;
  onAiGenerate?: (request: NovelAiRequest) => Promise<string>;
  // 自动尺寸模式
  autoSizeEnabled?: boolean;
  onAutoSizeModeChange?: (nodeId: string, mode: 'auto' | 'manual') => void;
  onSelect?: (nodeId: string, multiSelect?: boolean) => void; // ✅ 添加节点选中回调
  // ✅ 添加节点样式支持，用于传递mermaidTheme等
  nodeStyles?: NodeStyles;
  
  // Canvas Link节点专用props
  onTitleChange?: (nodeId: string, title: string) => void;
  onNavigate?: (targetCanvasId: string, canvasName?: string) => void;
  onRefreshThumbnail?: (nodeId: string) => void;
  onCreateCanvas?: (name: string) => Promise<string>;
  onGetAvailableCanvases?: () => Promise<Array<{id: string, title: string, lastUpdated: number}>>;
}

// 🎯 编辑器路由组件
export const EditorManager: React.FC<EditorManagerProps> = ({
  node,
  editing = false,
  selected = false, // ✅ 接收选中状态
  readOnly = false,
  fontStyle,
  cornerStyle,
  onContentChange,
  onEditToggle,
  onSizeChange,
  onRequestExpandedEdit,
  onRichSnapshotPersist,
  onAiGenerate,
  autoSizeEnabled = true,
  onAutoSizeModeChange,
  onSelect, // ✅ 接收节点选中回调
  nodeStyles,  // ✅ 接收节点样式
  
  // Canvas Link节点专用props
  onTitleChange,
  onNavigate,
  onRefreshThumbnail,
  onCreateCanvas,
  onGetAvailableCanvases
}) => {
  // 🎨 根据节点类型选择对应的编辑器
  const renderEditor = () => {
    switch (node.type) {
      case 'text':
        return editing ? (
          <TextNodeEditor
            node={node as any}
            editing={editing}
            fontStyle={fontStyle}
            cornerStyle={cornerStyle} // 🎨 传递圆角样式
            nodeStyles={nodeStyles}
            onContentChange={onContentChange}
            onEditToggle={onEditToggle}
            onSizeChange={onSizeChange}
            onRequestExpandedEdit={onRequestExpandedEdit}
            onRichSnapshotPersist={onRichSnapshotPersist}
            onAiGenerate={onAiGenerate}
            autoSizeEnabled={autoSizeEnabled}
            onAutoSizeModeChange={onAutoSizeModeChange}
          />
        ) : (
          <TextNode
            node={node as any}
            editing={editing}
            selected={selected}
            fontStyle={fontStyle}
            cornerStyle={cornerStyle} // 🎨 传递圆角样式
            nodeStyles={nodeStyles}
            onContentChange={onContentChange}
            onEditToggle={onEditToggle}
            onRequestExpandedEdit={onRequestExpandedEdit}
          />
        );

      case 'todo':
        // 🎯 使用 TodoNode 组件处理（包含 checkbox 逻辑）
        return (
          <TodoNode
            node={node as any}
            editing={editing}
            selected={selected}
            fontStyle={fontStyle}
            cornerStyle={cornerStyle} // 🎨 传递圆角样式
            nodeStyles={nodeStyles}
            onContentChange={onContentChange}
            onEditToggle={onEditToggle}
            onSizeChange={onSizeChange}
          />
        );
        
      case 'code':
        {
          const codeNode = node as any;
          const ct = (codeNode as any).codeType;
          if (ct === 'mermaid') {
            return (
              <MermaidNodeEditor
                node={codeNode}
                editing={editing}
                readOnly={readOnly}
                fontStyle={fontStyle}
                mermaidTheme={(() => {
                  const theme = nodeStyles?.mermaidTheme || (codeNode as any).mermaidTheme;
                  return theme;
                })()}
                mermaidThemeId={(() => {
                  const themeId = (codeNode as any).mermaidThemeId || (nodeStyles as any)?.mermaidThemeId;
                  return themeId;
                })()}
                onContentChange={onContentChange}
                onEditToggle={onEditToggle}
              />
            );
          } else if (ct === 'html') {
            return (
              <HTMLNodeEditor
                node={codeNode}
                editing={editing}
                selected={selected}
                fontStyle={fontStyle}
                cornerStyle={cornerStyle}
                onContentChange={onContentChange}
                onEditToggle={onEditToggle}
                onSelect={onSelect}
              />
            );
          } else if (ct === 'svg') {
            return (
              <SvgNodeEditor
                node={codeNode}
                editing={editing}
                selected={selected}
                fontStyle={fontStyle}
                cornerStyle={cornerStyle}
                onContentChange={onContentChange}
                onEditToggle={onEditToggle}
                onSelect={onSelect}
              />
            );
          } else {
            return (
              <CodeNodeEditor
                node={codeNode}
                editing={editing}
                selected={selected}
                fontStyle={fontStyle}
                cornerStyle={cornerStyle}
                onContentChange={onContentChange}
                onEditToggle={onEditToggle}
                onSelect={onSelect}
              />
            );
          }
        }
        
      case 'column':
        return (
          <ColumnContainer
            node={node as any}
            editing={editing}
            fontStyle={fontStyle}
            onContentChange={onContentChange}
            onEditToggle={onEditToggle}
          />
        );

      case 'media':
        return (
          <MediaNodeEditor
            node={node as any}
            editing={editing}
            selected={selected}
            fontStyle={fontStyle}
            cornerStyle={cornerStyle}
            nodeStyles={nodeStyles}
            onContentChange={onContentChange}
            onEditToggle={onEditToggle}
            onSizeChange={onSizeChange}
          />
        );

      case 'canvas-link':
        return (
          <CanvasLinkNode
            node={node as any}
            editing={editing}
            fontStyle={fontStyle}
            nodeStyles={nodeStyles?.linkStyles}
            onContentChange={onContentChange}
            onEditToggle={onEditToggle}
            onTitleChange={onTitleChange}
            onNavigate={onNavigate}
            onRefreshThumbnail={onRefreshThumbnail}
            onCreateCanvas={onCreateCanvas}
            onGetAvailableCanvases={onGetAvailableCanvases}
          />
        );

      // 'html' is represented as code node with codeType: 'html'

      default:
        // 回退到基础编辑器
        return (
          <div className="w-full h-full p-3 text-gray-500 dark:text-zinc-400 text-center">
            <div className="text-sm">
              📝 未知节点类型: {(node as CanvasNode).type}
            </div>
            <div className="text-xs mt-2">
              请使用左侧代码区域编辑
            </div>
          </div>
        );
    }
  };

  return (
    <div className="w-full h-full">
      {renderEditor()}
    </div>
  );
};

// 🎯 编辑器工厂函数 - 用于判断节点是否支持特定编辑功能
export const getEditorCapabilities = (node: CanvasNode) => {
  switch (node.type) {
    case 'text':
      return {
        supportsRealTimeEdit: true,
        supportsMarkdown: true,
        supportsDoubleClick: true,
        supportsExpandedEdit: true,
        editMode: 'split-view'
      };
      
    case 'code':
      {
        const codeNode = node as any;
        if (codeNode.codeType === 'mermaid') {
          return {
            supportsRealTimeEdit: true,
            supportsGraphicalEdit: true,
            supportsDoubleClick: true,
            editMode: 'graphical'
          };
        } else {
          return {
            supportsRealTimeEdit: true,
            supportsCodeEdit: true,
            supportsDoubleClick: true,
            editMode: 'code'
          };
        }
      }
      
    case 'column':
      return {
        supportsRealTimeEdit: true,
        supportsDragDrop: true,
        supportsDoubleClick: true,
        editMode: 'container'
      };

    case 'media':
      return {
        supportsRealTimeEdit: true,
        supportsPreview: true,
        supportsDoubleClick: true,
        editMode: 'media'
      };

    // HTML uses code node with codeType 'html'

    default:
      return {
        supportsRealTimeEdit: false,
        supportsDoubleClick: false,
        editMode: 'none'
      };
  }
};

export default EditorManager;
