import React, { memo, useState, useCallback, useRef, useEffect } from 'react';
import { ResizeHandle } from './ResizeHandle';
import { DEFAULT_GRID_ROW_HEIGHT } from './TableBlock';

interface RowHeaderColumnProps {
  rowCount: number;
  rowHeights: number[]; // 这里的 rowHeights 是实时渲染高度
  rowMinHeights: Record<number, number>; // 记录手动设定的 min-height
  onRowResize: (index: number, newMinHeight: number) => void;
  onRowResizeEnd?: (index: number, finalHeight: number) => void;
  onRowMove?: (fromIndex: number, toIndex: number) => void;
  onRowSelect: (index: number, multi: boolean) => void;
  selectedRows: number[];
  width: number;
}

export const RowHeaderColumn: React.FC<RowHeaderColumnProps> = memo(({
  rowCount,
  rowHeights,
  rowMinHeights,
  onRowResize,
  onRowResizeEnd,
  onRowMove,
  onRowSelect,
  selectedRows,
  width
}) => {
  const rows = Array.from({ length: rowCount }, (_, i) => i);

  // --- 拖拽状态 ---
  const [dragState, setDragState] = useState<{
      isDragging: boolean;
      dragIndex: number | null;
      dropIndex: number | null; // 目标插入位置
      dragStartY: number;
  }>({ isDragging: false, dragIndex: null, dropIndex: null, dragStartY: 0 });
  const dragStateRef = useRef(dragState);
  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent, index: number) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('[data-table-resize-handle]') ||
        target.classList.contains('cursor-row-resize')
      ) {
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      
      const handleMove = (moveEvent: MouseEvent) => {
          const delta = Math.abs(moveEvent.clientY - startY);
          if (delta > 5) { 
              setDragState(prev => {
                  if (prev.isDragging) return prev;
                  return { ...prev, isDragging: true, dragIndex: index, dragStartY: startY };
              });
          }
          
          setDragState(prev => {
              if (!prev.isDragging) return prev;
              
              if (!containerRef.current) return prev;
              const containerRect = containerRef.current.getBoundingClientRect();
              const relativeY = moveEvent.clientY - containerRect.top;
              
              let accumulatedHeight = 0;
              let targetIndex = rowCount; 
              
              for (let i = 0; i < rowCount; i++) {
                  const h = rowHeights[i] || 32;
                  const center = accumulatedHeight + h / 2;
                  if (relativeY < center) {
                      targetIndex = i;
                      break;
                  }
                  accumulatedHeight += h;
              }
              
              return { ...prev, dropIndex: targetIndex };
          });
      };
      
      const handleUp = () => {
          window.removeEventListener('mousemove', handleMove);
          window.removeEventListener('mouseup', handleUp);

          const snapshot = dragStateRef.current;
          setDragState({ isDragging: false, dragIndex: null, dropIndex: null, dragStartY: 0 });
          if (snapshot.isDragging && snapshot.dragIndex !== null && snapshot.dropIndex !== null) {
              requestAnimationFrame(() => onRowMove?.(snapshot.dragIndex!, snapshot.dropIndex!));
          }
      };
      
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
  }, [rowCount, rowHeights, onRowMove]);

  // 计算 Drop Indicator 位置
  const getDropIndicatorTop = () => {
      if (dragState.dropIndex === null) return 0;
      let top = 0;
      for (let i = 0; i < dragState.dropIndex; i++) {
          top += rowHeights[i] || DEFAULT_GRID_ROW_HEIGHT;
      }
      return top;
  };

  return (
    <div 
      ref={containerRef}
      className="flex flex-col select-none border-r border-border bg-muted text-muted-foreground flex-shrink-0 shadow-sm"
      data-node-interactive="true"
      style={{ 
        width, 
        // Position handled by parent wrapper
        backgroundColor: 'var(--muted)',
      }}
    >
      {/* Drop Indicator */}
      {dragState.isDragging && dragState.dropIndex !== null && (
          <div 
            className="absolute left-0 right-0 h-0.5 bg-blue-500 z-50 pointer-events-none"
            style={{ top: getDropIndicatorTop(), width: '100%' }}
          >
            <div className="absolute -top-1 -left-1 w-2 h-2 bg-blue-500 transform rotate-45" />
          </div>
      )}

      {rows.map((rowIndex) => {
        // 注意：这里使用由 Grid 布局计算出的实际高度，确保对齐
        // 初始渲染时可能 rowHeights 还没更新，使用 fallback 或 minHeight
        const height = rowHeights[rowIndex] || DEFAULT_GRID_ROW_HEIGHT; 
        const isSelected = selectedRows.includes(rowIndex);
        const isDraggingThis = dragState.isDragging && dragState.dragIndex === rowIndex;

        return (
          <div
            key={rowIndex}
            className={`relative flex items-center justify-center text-xs font-medium text-muted-foreground border-b border-l border-border box-border first:border-t
              ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}
              ${isDraggingThis ? 'opacity-50 bg-muted' : ''}
            `}
            data-node-interactive="true"
            style={{ height, cursor: 'grab' }}
            onMouseDown={(e) => handleMouseDown(e, rowIndex)}
            onClick={(e) => {
                if (!dragState.isDragging) {
                    onRowSelect(rowIndex, e.shiftKey || e.metaKey);
                }
            }}
          >
            {rowIndex + 1}

            <ResizeHandle
              type="row"
              index={rowIndex}
              currentSize={height}
              onResizeStart={() => {}}
              onResize={(idx, h) => onRowResize(idx, h)}
              onResizeEnd={(idx, h) => onRowResizeEnd?.(idx, h)}
            />
          </div>
        );
      })}
    </div>
  );
});

RowHeaderColumn.displayName = 'RowHeaderColumn';
