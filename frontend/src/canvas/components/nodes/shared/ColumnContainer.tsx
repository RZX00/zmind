// 📦 收集栏容器组件
// 支持嵌套节点的收集和管理

import React, { useState, useCallback, useEffect } from 'react';
import {useTranslations} from 'next-intl';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Canvas, CanvasNode, FontStyle, CornerStyle } from '../../../../types/canvas';

interface ColumnContainerProps {
  node: CanvasNode;
  editing?: boolean;
  nodeSelected?: boolean; // 节点是否选中 (对应表格的nodeSelected)
  fontStyle?: FontStyle; // 字体样式
  cornerStyle?: CornerStyle; // 全局圆角样式
  selectedNodeIds?: string[]; // 全局选中的节点ID列表（用于同步清除子项本地选中）
  onContentChange?: (nodeId: string, content: string) => void;
  onEditToggle?: (nodeId: string, editing: boolean) => void;
  // 收集栏特有的props
  childNodes?: CanvasNode[]; // 子节点数据
  onTitleChange?: (nodeId: string, title: string) => void;
  onToggleCollapse?: (nodeId: string) => void;
  onDropNode?: (columnId: string, droppedNodeId: string) => void;
  renderChildNode?: (childNode: CanvasNode) => React.ReactNode;
  // 拖拽状态
  isDragTarget?: boolean; // 是否为拖拽目标
  isDraggingNode?: boolean; // 是否有节点正在拖拽
  isRemoveTarget?: boolean; // 拖出提示态（原父列显示）
  insertionIndex?: number | null; // 拖入插入索引（用于插入线）
  // 子节点操作相关
  onChildNodeSelect?: (nodeId: string) => void; // 选中子节点
  onChildNodeDragStart?: (nodeId: string, columnId: string, popupPosition?: { x: number; y: number }) => void; // 弹出子节点
  // 子节点编辑/尺寸变化
  onChildNodeSizeChange?: (nodeId: string, size: { width: number; height: number }) => void;
}

export const ColumnContainer: React.FC<ColumnContainerProps> = ({
  node,
  editing = false,
  nodeSelected = false, // 节点选中状态
  fontStyle,
  cornerStyle,
  selectedNodeIds = [],
  onContentChange,
  onEditToggle,
  // 收集栏特有的props
  childNodes = [],
  onTitleChange,
  onToggleCollapse,
  onDropNode,
  renderChildNode,
  // 拖拽状态
  isDragTarget = false,
  isDraggingNode = false,
  isRemoveTarget = false,
  insertionIndex = null,
  // 子节点拖拽相关
  onChildNodeSelect,
  onChildNodeDragStart,
  // 子节点编辑/尺寸变化
  onChildNodeSizeChange
}) => {
  const t = useTranslations();
  // 标题改为基于 content 展示/编辑；兼容旧数据：content 为空时仅用于显示时回退 title
  const initialTitle = (node.content && node.content.trim()) || (node.title || '') || 'column';
  const [localTitle, setLocalTitle] = useState(initialTitle);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null); // 选中的子节点ID
  const [editingChildId, setEditingChildId] = useState<string | null>(null);   // 内部编辑中的子节点ID（仅Text/Todo）


  // 监听节点选中状态变化，重置子节点选中状态
  useEffect(() => {
    if (!nodeSelected) {
      setSelectedChildId(null);
    }
  }, [nodeSelected]);

  // 当全局选中清空时，同步清除本地子项选中状态
  useEffect(() => {
    if (selectedChildId && !selectedNodeIds.includes(selectedChildId)) {
      setSelectedChildId(null);
    }
  }, [selectedNodeIds, selectedChildId]);

  // 移除C键相关逻辑（内部交互采用直觉点击/拖拽）

  // 🎯 处理标题变更
  const handleTitleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setLocalTitle(event.target.value);
  }, []);

  // 💾 保存标题
  const handleSaveTitle = useCallback(() => {
    const trimmedTitle = (localTitle || '').trim();
    // 写回到 content（首行即标题），不再写 title
    if (trimmedTitle !== ((node.content || '').split('\n')[0] || '')) {
      const content = node.content || '';
      const idx = content.indexOf('\n');
      const rest = idx === -1 ? '' : content.slice(idx);
      onContentChange?.(node.id, trimmedTitle + (rest || ''));
    }
    onEditToggle?.(node.id, false);
  }, [localTitle, node.content, node.id, onContentChange, onEditToggle]);

  // ❌ 取消编辑
  const handleCancelEdit = useCallback(() => {
    setLocalTitle(((node.content || '').split('\n')[0] || node.title || 'column'));
    if (onEditToggle) {
      onEditToggle(node.id, false);
    }
  }, [node.id, node.content, node.title, onEditToggle]);

  // 🔄 切换展开/收起
  const handleToggleCollapse = useCallback(() => {
    if (onToggleCollapse) {
      onToggleCollapse(node.id);
    }
  }, [node.id, onToggleCollapse]);

  // 🎯 拖拽处理
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    
    const droppedNodeId = event.dataTransfer.getData('text/plain');
    if (droppedNodeId && onDropNode) {
      onDropNode(node.id, droppedNodeId);
    }
  }, [node.id, onDropNode]);

  // 🎯 处理子节点点击选中
  const handleChildNodeClick = useCallback((childNodeId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedChildId(childNodeId);
    onChildNodeSelect?.(childNodeId);
  }, [onChildNodeSelect]);

  // 🎯 双击子项：在列内打开编辑器浮层（仅Text/Todo）
  const handleChildNodeDoubleClick = useCallback((child: CanvasNode, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (child.type === 'text' || child.type === 'todo') {
      setEditingChildId(child.id);
      setSelectedChildId(child.id);
      onChildNodeSelect?.(child.id);
    }
  }, [onChildNodeSelect]);

  // 🎯 处理收集栏容器点击
  const handleContainerClick = useCallback((_event: React.MouseEvent) => {
    // 清除子节点选中状态（点击空白区域）
    if (selectedChildId !== null) {
      setSelectedChildId(null);
    }
  }, [selectedChildId]);


  // 📊 获取子节点数量
  const childCount = childNodes.length;

  return (
    <div 
      className={`
        w-full h-full bg-transparent shadow-sm transition-all duration-200
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleContainerClick}
    >
      {/* 📋 收集栏头部 - 固定高度60px，标题居中显示 */}
      <div className="relative grid place-items-center h-[60px] px-3">
        {/* 卡片数量显示 - 仅在选中时显示，只显示数字 */}
        {nodeSelected && (
          <div className="absolute left-3 text-sm text-muted-foreground">
            {childCount}
          </div>
        )}

        {/* 标题区域 - 完全居中显示 */}
        <div className="w-full flex justify-center">
          {editing ? (
            <input
              type="text"
              value={localTitle}
              onChange={handleTitleChange}
              className={`px-2 py-1 text-sm border border-gray-300 dark:border-zinc-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 text-foreground text-center ${fontStyle?.className || 'font-serif'}`}
              style={{ 
                maxWidth: '150px', 
                minWidth: '80px',
                fontFamily: fontStyle?.fontFamily || 'var(--font-playfair-display), ui-serif, Georgia, Cambria, "Times New Roman", Times, serif'
              }}
              placeholder={t('canvas.column.placeholder', { default: 'Enter column title' })}
              autoFocus
              onBlur={handleSaveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSaveTitle();
                } else if (e.key === 'Escape') {
                  handleCancelEdit();
                }
              }}
            />
          ) : (
            <h3 
              className={`font-medium text-foreground cursor-pointer text-center break-words max-w-full leading-tight ${fontStyle?.className || 'font-serif'}`}
              onDoubleClick={() => onEditToggle?.(node.id, true)}
              title={t('canvas.column.editHint', { default: 'Double-click to edit title' })}
              style={{ 
                wordWrap: 'break-word', 
                overflowWrap: 'break-word',
                fontFamily: fontStyle?.fontFamily || 'var(--font-playfair-display), ui-serif, Georgia, Cambria, "Times New Roman", Times, serif'
              }}
            >
              {((node.content || '').split('\n')[0] || node.title || 'column')}
            </h3>
          )}
        </div>

        {/* 展开/收起按钮 - 绝对定位到右侧 */}
        <button
          onClick={handleToggleCollapse}
          className="absolute right-3 p-1 hover:bg-accent/60 rounded transition-colors"
          title={node.isCollapsed ? 'Expand' : 'Collapse'}
        >
          {node.isCollapsed ? (
            <ChevronRight className="w-4 h-4 text-gray-600 dark:text-zinc-300" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-600 dark:text-zinc-300" />
          )}
        </button>
      </div>

      {/* 📦 收集栏内容区域（与布局引擎保持一致：paddingX=16, paddingY=16） */}
      {!node.isCollapsed && (
        <div className="relative px-4 py-4">
          {/* 空状态：始终显示首个槽位的灰色边框，不使用虚线 */}
          {childCount === 0 && (
            <div className={`relative h-[60px] border border-gray-300 dark:border-zinc-700 ${cornerStyle?.className || 'rounded-none'}`}>
              {/* 拖入时叠加浅灰底和提示文案（位置不偏移） */}
              {(isDragTarget || isRemoveTarget) && (
                <div className={`absolute inset-0 flex items-center justify-center ${isDragTarget ? 'bg-gray-100 dark:bg-zinc-800' : 'bg-gray-100/70 dark:bg-zinc-800/70'}`}>
                  <div className={`text-center ${fontStyle?.className || 'font-serif'} text-gray-600 dark:text-zinc-300`}
                       style={{ fontFamily: fontStyle?.fontFamily || 'var(--font-playfair-display), ui-serif, Georgia, Cambria, "Times New Roman", Times, serif' }}>
                    <div className="text-sm font-medium">{isDragTarget ? 'Release to add' : 'Release to remove'}</div>
                    <div className="text-xs mt-1">{isDragTarget ? 'Drop into this column' : 'Remove from this column'}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 插入预览线：仅在有子项时显示，横线位于目标子项“正下方+2px” */}
          {isDragTarget && childCount > 0 && typeof insertionIndex === 'number' && insertionIndex >= 1 && (
            (() => {
              const columnTop = node.y;
              const clampedIndex = Math.min(insertionIndex, childCount);
              const prev = childNodes[clampedIndex - 1];
              if (!prev) return null;
              const prevH = Math.max(prev.height || 0, 1);
              // 线条位于“前一个子项”的底部 + 2px
              const top = Math.max(0, (prev.y - columnTop) + prevH + 2);
              return (
                <div className="absolute left-4 right-4 pointer-events-none" style={{ top }}>
                  <div className="h-[2px] bg-blue-500" />
                </div>
              );
            })()
          )}
        </div>
      )}
    </div>
  );
};

export default ColumnContainer;
