// 🚀 优化后的表格单元格组件
// 性能提升关键：独立memo组件 + 缓存计算

import React, { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import type { Canvas, CanvasNode, FontStyle } from '../../../../types/canvas';
import { renderCellMarkdown } from '../../../utils/markdownRenderer';
import { useTheme } from 'next-themes';

interface OptimizedTableCellProps {
  content: string;
  rowIndex: number;
  colIndex: number;
  isHeader?: boolean;
  isSelected?: boolean;
  isEditing?: boolean;
  nodeSelected?: boolean;
  fontStyle?: FontStyle;
  tableStyles?: any;
  onCellClick?: (row: number, col: number, event: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent, row?: number, col?: number) => void;
  onEditContent?: (content: string) => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
}

// 🎯 缓存className计算结果
const useCellClassName = (
  rowIndex: number, 
  colIndex: number, 
  isHeader: boolean, 
  isSelected: boolean, 
  isEditing: boolean,
  nodeSelected: boolean,
  tableStyles: any
) => {
  return useMemo(() => {
    let className = 'px-2 py-1 relative text-sm cursor-pointer min-h-4';
    
    // 选中/编辑状态优先：统一细灰色网格线
    if (nodeSelected || isEditing) {
      className += ' border border-solid border-gray-300 dark:border-zinc-600';
    } else if (tableStyles?.showGrid) {
      className += ' border border-solid';
    } else {
      // Booktabs等无网格格式
      if (isHeader) {
        className += ' border-t border-b border-solid';
      }
      className += ' border-l-0 border-r-0';
    }
    
    if (isSelected) {
      className += ' bg-blue-50 dark:bg-blue-900/20';
    }
    
    if (isEditing) {
      className += ' bg-blue-50 dark:bg-blue-900/20';
    }
    
    return className;
  }, [isHeader, isSelected, isEditing, nodeSelected, tableStyles]);
};

// 🎯 缓存style计算结果
const useCellStyle = (
  rowIndex: number, 
  colIndex: number, 
  isHeader: boolean, 
  isEditing: boolean,
  nodeSelected: boolean,
  tableStyles: any,
  fontStyle?: FontStyle,
  isDark?: boolean
) => {
  return useMemo(() => {
    const style: React.CSSProperties = {};
    
    // 在选中/编辑状态下，统一设置细灰色边框
    if (nodeSelected || isEditing) {
      style.borderColor = isDark ? '#52525B' : '#D1D5DB';
      style.borderWidth = '1px';
      style.borderStyle = 'solid';
    }
    
    if (tableStyles) {
      // 字体设置
      if (tableStyles.fontFamily) style.fontFamily = tableStyles.fontFamily;
      if (tableStyles.fontSize) style.fontSize = `${tableStyles.fontSize}px`;
      if (tableStyles.textAlign) style.textAlign = tableStyles.textAlign;
      
      // 背景色
      if (isHeader && tableStyles.headerBackground) {
        style.backgroundColor = tableStyles.headerBackground;
      } else if (!isHeader && tableStyles.alternateRows) {
        const isEvenRow = rowIndex % 2 === 0;
        style.backgroundColor = isEvenRow 
          ? (tableStyles.evenRowBackground || (isDark ? '#18181B' : '#ffffff'))
          : (tableStyles.oddRowBackground || (isDark ? '#27272A' : '#f9fafb'));
      }
      
      // 文字颜色
      if (isHeader && tableStyles.headerTextColor) {
        style.color = tableStyles.headerTextColor;
      } else if (tableStyles.textColor) {
        style.color = tableStyles.textColor;
      } else {
        // 继承父级颜色，便于暗色模式显示浅色文字
        style.color = 'inherit';
      }
      
      // 内边距
      if (tableStyles.cellPadding) {
        style.padding = `${tableStyles.cellPadding}px`;
      }
      
      // 粗体标题
      if (isHeader && tableStyles.headerBold) {
        style.fontWeight = 'bold';
      }
    }
    
    // 应用fontStyle
    if (fontStyle) {
      if (fontStyle.fontFamily) style.fontFamily = fontStyle.fontFamily;
      if (fontStyle.textAlign) style.textAlign = fontStyle.textAlign;
    }
    
    // 编辑时确保最高层级
    if (isEditing) {
      style.position = 'relative';
      style.zIndex = 10;
    }
    
    return style;
  }, [rowIndex, isHeader, isEditing, nodeSelected, tableStyles, fontStyle, isDark]);
};

// 🚀 优化后的表格单元格组件
export const OptimizedTableCell = memo<OptimizedTableCellProps>(({ 
  content,
  rowIndex,
  colIndex,
  isHeader = false,
  isSelected = false,
  isEditing = false,
  nodeSelected = false,
  fontStyle,
  tableStyles,
  onCellClick,
  onContextMenu,
  onEditContent,
  onSaveEdit,
  onCancelEdit
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [editContent, setEditContent] = useState(content);
  const headerInputRef = useRef<HTMLInputElement>(null);
  const cellTextareaRef = useRef<HTMLTextAreaElement>(null);
  
  // 🎯 缓存className和style计算
  const className = useCellClassName(
    rowIndex, colIndex, isHeader, isSelected, isEditing, nodeSelected, tableStyles
  );
  
  const style = useCellStyle(
    rowIndex, colIndex, isHeader, isEditing, nodeSelected, tableStyles, fontStyle, isDark
  );
  
  // 🎯 缓存markdown渲染结果 - 避免重复渲染
  const renderedContent = useMemo(() => {
    return renderCellMarkdown(content || '');
  }, [content]);
  
  // 🎯 优化事件处理 - 使用useCallback避免重复创建
  const handleClick = useCallback((e: React.MouseEvent) => {
    // 允许冒泡到 NodeContainer 以便选中节点，同时触发单元格编辑
    onCellClick?.(rowIndex, colIndex, e);
  }, [rowIndex, colIndex, onCellClick]);
  
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu?.(e, rowIndex, colIndex);
  }, [rowIndex, colIndex, onContextMenu]);
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSaveEdit?.();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancelEdit?.();
    }
  }, [onSaveEdit, onCancelEdit]);
  
  const handleEditChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setEditContent(newValue);
    onEditContent?.(newValue);
  }, [onEditContent]);

  // 进入编辑时将光标置于末尾
  useEffect(() => {
    if (!isEditing) return;
    const length = editContent?.length ?? 0;
    if (isHeader) {
      const el = headerInputRef.current;
      if (el) {
        try { el.focus(); el.setSelectionRange(length, length); } catch {}
      }
    } else {
      const el = cellTextareaRef.current;
      if (el) {
        try { el.focus(); el.setSelectionRange(length, length); } catch {}
      }
    }
  }, [isEditing, isHeader, editContent]);
  
  // 🎯 渲染优化 - 条件渲染减少DOM操作
  const TagName = isHeader ? 'th' : 'td';
  
  return (
    <TagName 
      className={className}
      style={style}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {isEditing ? (
        isHeader ? (
          <input
            ref={headerInputRef}
            type="text"
            value={editContent}
            onChange={handleEditChange}
            onBlur={onSaveEdit}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent border-none outline-none"
            style={{
              fontFamily: style.fontFamily || 'inherit',
              textAlign: style.textAlign as any || 'left',
              // 继承父级颜色，避免在暗色模式下被强制为深色
              color: style.color || 'inherit'
            }}
            autoFocus
          />
        ) : (
          <textarea
            ref={cellTextareaRef}
            value={editContent}
            onChange={handleEditChange}
            onBlur={onSaveEdit}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="w-full h-full bg-transparent border-none outline-none resize-none"
            style={{ 
              minHeight: '20px',
              fontFamily: style.fontFamily || 'inherit',
              textAlign: style.textAlign as any || 'left',
              // 继承父级颜色，避免在暗色模式下被强制为深色
              color: style.color || 'inherit'
            }}
            autoFocus
            rows={1}
          />
        )
      ) : (
        <div 
          className="min-h-4"
          onMouseDownCapture={(e) => {
            if (nodeSelected && !isEditing) {
              e.stopPropagation();
            }
          }}
          dangerouslySetInnerHTML={{ __html: renderedContent }}
        />
      )}
    </TagName>
  );
});

OptimizedTableCell.displayName = 'OptimizedTableCell';

export default OptimizedTableCell;
