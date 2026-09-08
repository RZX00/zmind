// 🚀 虚拟化表格组件 - 处理大表格的核心优化
// 性能提升：只渲染可见区域，支持100x100+大表格流畅操作

import React, { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import type { StructuredTableData } from '../../../utils/structuredTable';
import type { Canvas, CanvasNode, FontStyle } from '../../../../types/canvas';
import { OptimizedTableCell } from './OptimizedTableCell';
import { virtualizationConfig } from '../../../utils/virtualizationConfig';

interface VirtualizedTableProps {
  data: StructuredTableData;
  containerHeight: number;
  containerWidth: number;
  nodeSelected?: boolean;
  fontStyle?: FontStyle;
  tableStyles?: any;
  selectedCell?: { row: number; col: number } | null;
  editingCell?: { row: number; col: number } | null;
  onCellClick?: (row: number, col: number, event: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent, row?: number, col?: number) => void;
  onEditContent?: (content: string) => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
}

// 🎯 虚拟化配置获取
const getVirtualConfig = () => {
  const config = virtualizationConfig.getConfig();
  return {
    ROW_HEIGHT: 40,
    COL_WIDTH: 160, // 默认列宽（与结构化表格默认宽一致）
    BUFFER_SIZE: config.tableBufferSize, // 智能缓冲区大小
    SCROLL_DEBOUNCE: config.debounceDelay // 智能防抖延迟
  };
};

// 🎯 虚拟化核心逻辑Hook
const useVirtualization = (
  totalRows: number,
  totalCols: number,
  containerHeight: number,
  containerWidth: number,
  scrollTop: number,
  scrollLeft: number
) => {
  return useMemo(() => {
    const { ROW_HEIGHT, COL_WIDTH, BUFFER_SIZE } = getVirtualConfig();
    const visibleRows = Math.ceil(containerHeight / ROW_HEIGHT);
    const visibleCols = Math.ceil(containerWidth / COL_WIDTH);
    const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_SIZE);
    const startCol = Math.max(0, Math.floor(scrollLeft / COL_WIDTH) - BUFFER_SIZE);
    const endRow = Math.min(totalRows - 1, startRow + visibleRows + BUFFER_SIZE * 2);
    const endCol = Math.min(totalCols - 1, startCol + visibleCols + BUFFER_SIZE * 2);
    return {
      visibleStartRow: startRow,
      visibleEndRow: endRow,
      visibleStartCol: startCol,
      visibleEndCol: endCol,
      visibleRowCount: endRow - startRow + 1,
      visibleColCount: endCol - startCol + 1,
      totalHeight: totalRows * ROW_HEIGHT,
      totalWidth: totalCols * COL_WIDTH
    };
  }, [totalRows, totalCols, containerHeight, containerWidth, scrollTop, scrollLeft]);
};

// 🎯 滚动状态管理Hook
const useScrollState = () => {
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      setScrollTop(target.scrollTop);
      setScrollLeft(target.scrollLeft);
    }, getVirtualConfig().SCROLL_DEBOUNCE);
  }, []);
  
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);
  
  return { scrollTop, scrollLeft, handleScroll };
};

// 🚀 虚拟化表格主组件
export const VirtualizedTable = memo<VirtualizedTableProps>(({
  data,
  containerHeight,
  containerWidth,
  nodeSelected = false,
  fontStyle,
  tableStyles,
  selectedCell,
  editingCell,
  onCellClick,
  onContextMenu,
  onEditContent,
  onSaveEdit,
  onCancelEdit
}) => {
  const { rows } = data;
  const colCount = rows[0]?.length ?? 0;
  const { scrollTop, scrollLeft, handleScroll } = useScrollState();
  
  const virtualization = useVirtualization(
    rows.length,
    colCount,
    containerHeight,
    containerWidth,
    scrollTop,
    scrollLeft
  );
  
  const {
    visibleStartRow,
    visibleEndRow,
    visibleStartCol,
    visibleEndCol,
    totalHeight,
    totalWidth
  } = virtualization;
  
  const visibleCells = useMemo(() => {
    const cells: Array<{ row: number; col: number; content: string; key: string }> = [];
    for (let row = visibleStartRow; row <= visibleEndRow; row++) {
      for (let col = visibleStartCol; col <= visibleEndCol; col++) {
        cells.push({
          row,
          col,
          content: rows[row]?.[col] || '',
          key: `${row}-${col}`
        });
      }
    }
    return cells;
  }, [rows, visibleStartRow, visibleEndRow, visibleStartCol, visibleEndCol]);
  
  const getCellPosition = useCallback((row: number, col: number) => {
    const { ROW_HEIGHT, COL_WIDTH } = getVirtualConfig();
    return {
      top: row * ROW_HEIGHT,
      left: col * COL_WIDTH,
      width: COL_WIDTH,
      height: ROW_HEIGHT
    };
  }, []);
  
  const renderVisibleCells = useMemo(() => {
    return visibleCells.map(({ row, col, content, key }) => {
      const position = getCellPosition(row, col);
      const isSelected = selectedCell?.row === row && selectedCell?.col === col;
      const isEditing = editingCell?.row === row && editingCell?.col === col;
      return (
        <div
          key={key}
          style={{
            position: 'absolute',
            top: position.top,
            left: position.left,
            width: position.width,
            height: position.height,
          }}
        >
          <OptimizedTableCell
            rowIndex={row}
            colIndex={col}
            content={content}
            isHeader={false}
            nodeSelected={nodeSelected}
            fontStyle={fontStyle}
            tableStyles={tableStyles}
            isSelected={isSelected}
            isEditing={isEditing}
            onCellClick={onCellClick}
            onContextMenu={onContextMenu}
            onEditContent={onEditContent}
            onSaveEdit={onSaveEdit}
            onCancelEdit={onCancelEdit}
          />
        </div>
      );
    });
  }, [visibleCells, getCellPosition, nodeSelected, fontStyle, tableStyles, selectedCell, editingCell, onCellClick, onContextMenu, onEditContent, onSaveEdit, onCancelEdit]);
  
  return (
    <div
      className="relative overflow-auto"
      style={{ maxHeight: containerHeight, maxWidth: containerWidth }}
      onScroll={handleScroll}
    >
      <div style={{ position: 'relative', width: totalWidth, height: totalHeight }}>
        {renderVisibleCells}
      </div>
    </div>
  );
});

VirtualizedTable.displayName = 'VirtualizedTable';

export default VirtualizedTable;
