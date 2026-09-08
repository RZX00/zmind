import React, { memo, useState, useCallback, useRef, useEffect } from 'react';
import { ResizeHandle } from './ResizeHandle';
import { generateColumnLabel } from '../../../../utils/structuredTable';

interface HeaderRowProps {
  colCount: number;
  columnWidths: number[];
  onColResize: (index: number, newWidth: number) => void;
  onColResizeEnd: (index: number, newWidth: number) => void;
  onColMove?: (fromIndex: number, toIndex: number) => void;
  onColSelect: (index: number, multi: boolean) => void;
  selectedCols: number[];
  rowHeaderWidth: number;
  scrollLeft: number;
}

export const HeaderRow: React.FC<HeaderRowProps> = memo(({
  colCount,
  columnWidths,
  onColResize,
  onColResizeEnd,
  onColMove,
  onColSelect,
  selectedCols,
  rowHeaderWidth,
  scrollLeft
}) => {
  // 生成列头数组
  const headers = Array.from({ length: colCount }, (_, i) => i);

  // --- 拖拽状态 ---
  const [dragState, setDragState] = useState<{
      isDragging: boolean;
      dragIndex: number | null;
      dropIndex: number | null; // 目标插入位置（列缝隙索引，0~colCount）
      dragStartX: number;
  }>({ isDragging: false, dragIndex: null, dropIndex: null, dragStartX: 0 });
  const dragStateRef = useRef(dragState);
  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent, index: number) => {
      // 列宽把手和列重排抢同一条顶栏，点在缝上只调宽
      const target = e.target as HTMLElement;
      if (
        target.closest('[data-table-resize-handle]') ||
        target.classList.contains('cursor-col-resize')
      ) {
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      
      // 延迟触发拖拽，防止与点击选择冲突
      // 简单的做法：记录初始位置，在 mousemove 中判断距离
      
      const handleMove = (moveEvent: MouseEvent) => {
          const delta = Math.abs(moveEvent.clientX - startX);
          if (delta > 5) { // 阈值 5px
              setDragState(prev => {
                  if (prev.isDragging) return prev; // 已经是拖拽状态
                  return { ...prev, isDragging: true, dragIndex: index, dragStartX: startX };
              });
          }
          
          setDragState(prev => {
              if (!prev.isDragging) return prev;
              
              // 计算 dropIndex
              // 遍历所有列的中心点
              if (!containerRef.current) return prev;
              const containerRect = containerRef.current.getBoundingClientRect();
              const relativeX = moveEvent.clientX - containerRect.left;
              
              let accumulatedWidth = 0;
              let targetIndex = colCount; // 默认最后
              
              for (let i = 0; i < colCount; i++) {
                  const w = columnWidths[i] || 160;
                  const center = accumulatedWidth + w / 2;
                  if (relativeX < center) {
                      targetIndex = i;
                      break;
                  }
                  accumulatedWidth += w;
              }
              
              return { ...prev, dropIndex: targetIndex };
          });
      };
      
      const handleUp = () => {
          window.removeEventListener('mousemove', handleMove);
          window.removeEventListener('mouseup', handleUp);

          const snapshot = dragStateRef.current;
          setDragState({ isDragging: false, dragIndex: null, dropIndex: null, dragStartX: 0 });
          if (snapshot.isDragging && snapshot.dragIndex !== null && snapshot.dropIndex !== null) {
              requestAnimationFrame(() => onColMove?.(snapshot.dragIndex!, snapshot.dropIndex!));
          }
      };
      
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
  }, [colCount, columnWidths, onColMove]);

  // 计算 Drop Indicator 位置
  const getDropIndicatorLeft = () => {
      if (dragState.dropIndex === null) return 0;
      let left = 0;
      for (let i = 0; i < dragState.dropIndex; i++) {
          left += columnWidths[i] || 160;
      }
      return left;
  };

  return (
    <div 
      ref={containerRef}
      className="flex select-none border-b border-border bg-muted text-muted-foreground shadow-sm"
      data-node-interactive="true"
      style={{ 
        height: 32,
        // Position is handled by parent wrapper
        width: 'max-content', // 随内容撑开
        backgroundColor: 'var(--muted)',
      }}
    >
      {/* Drop Indicator */}
      {dragState.isDragging && dragState.dropIndex !== null && (
          <div 
            className="absolute top-0 bottom-0 w-0.5 bg-blue-500 z-50 pointer-events-none"
            style={{ left: getDropIndicatorLeft(), height: '100%' }} // 这里的 height 实际上只覆盖 Header，如果要贯穿整个表格，需要父级传高度，或者在 TableBlock 渲染
          >
            {/* 顶部小三角 */}
            <div className="absolute -top-1 -left-1 w-2 h-2 bg-blue-500 transform rotate-45" />
          </div>
      )}

      {/* 列头列表 */}
      <div className="flex">
        {headers.map((colIndex) => {
          const width = columnWidths[colIndex] || 160;
          const isSelected = selectedCols.includes(colIndex);
          const isDraggingThis = dragState.isDragging && dragState.dragIndex === colIndex;

          return (
            <div
              key={colIndex}
              className={`relative flex items-center justify-center text-xs font-medium text-muted-foreground border-r border-t border-border box-border first:border-l
                ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}
                ${isDraggingThis ? 'opacity-50 bg-muted' : ''}
              `}
              data-node-interactive="true"
              style={{ width, height: 32, cursor: 'grab' }}
              onMouseDown={(e) => handleMouseDown(e, colIndex)}
              onClick={(e) => {
                  // 如果刚刚发生了拖拽，阻止 onClick 触发选中
                  if (!dragState.isDragging) {
                      onColSelect(colIndex, e.shiftKey || e.metaKey);
                  }
              }}
            >
              {generateColumnLabel(colIndex)}
              
              <ResizeHandle 
                type="col" 
                index={colIndex} 
                currentSize={width}
                onResizeStart={() => {}}
                onResize={(idx, w) => onColResize(idx, w)} // 实时回调
                onResizeEnd={(idx, w) => onColResizeEnd(idx, w)} // 结束回调
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

HeaderRow.displayName = 'HeaderRow';
