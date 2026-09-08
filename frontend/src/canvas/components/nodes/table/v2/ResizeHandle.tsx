import React, { useCallback, useState } from 'react';
import { readCanvasScale } from './readCanvasScale';

interface ResizeHandleProps {
  type: 'col' | 'row';
  index: number;
  onResizeStart: (index: number, startPixels: number) => void;
  onResize: (index: number, currentPixels: number, delta: number) => void;
  onResizeEnd: (index: number, finalPixels: number) => void;
  currentSize: number;
}

const MIN_COL_WIDTH = 60;
const MIN_ROW_HEIGHT = 28;

export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  type,
  index,
  onResizeStart,
  onResize,
  onResizeEnd,
  currentSize,
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const minSize = type === 'col' ? MIN_COL_WIDTH : MIN_ROW_HEIGHT;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      setIsResizing(true);
      const startScreenPos = type === 'col' ? e.clientX : e.clientY;
      const startSize = currentSize;
      const scale = readCanvasScale();

      onResizeStart(index, startSize);

      const sizeFromEvent = (event: MouseEvent) => {
        const currentScreenPos = type === 'col' ? event.clientX : event.clientY;
        const delta = (currentScreenPos - startScreenPos) / scale;
        return {
          delta,
          size: Math.max(minSize, startSize + delta),
        };
      };

      const handleMove = (event: MouseEvent) => {
        const { size, delta } = sizeFromEvent(event);
        onResize(index, size, delta);
      };

      const handleUp = (event: MouseEvent) => {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
        const { size } = sizeFromEvent(event);
        setIsResizing(false);
        onResizeEnd(index, size);
      };

      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp, { once: true });
    },
    [type, index, currentSize, minSize, onResizeStart, onResize, onResizeEnd],
  );

  return (
    <div
      data-node-interactive="true"
      data-table-resize-handle={type}
      className={`absolute z-30 hover:bg-blue-400/80
        ${type === 'col'
          ? 'cursor-col-resize top-0 bottom-0 -right-1.5 w-3'
          : 'cursor-row-resize left-0 right-0 -bottom-1 h-2.5'
        }
        ${isResizing ? 'bg-blue-500/80' : 'bg-transparent'}
      `}
      onMouseDown={handleMouseDown}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    />
  );
};
