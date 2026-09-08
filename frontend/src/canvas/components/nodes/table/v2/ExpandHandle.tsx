import React, { useState, useCallback, useRef } from 'react';
import { readCanvasScale } from './readCanvasScale';

interface DragExpandHandleProps {
  onPreviewChange: (rows: number, cols: number) => void;
  onExpand: (addRows: number, addCols: number) => void;
  baseRowHeight?: number;
  baseColWidth?: number;
}

export const DragExpandHandle: React.FC<DragExpandHandleProps> = ({
  onPreviewChange,
  onExpand,
  baseRowHeight = 32,
  baseColWidth = 100,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const previewRef = useRef<{ rows: number; cols: number }>({ rows: 0, cols: 0 });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      startPosRef.current = { x: e.clientX, y: e.clientY };
      setIsDragging(true);
      previewRef.current = { rows: 0, cols: 0 };
      onPreviewChange(0, 0);
      const scale = readCanvasScale();

      const handleMove = (event: MouseEvent) => {
        if (!startPosRef.current) return;

        const deltaX = (event.clientX - startPosRef.current.x) / scale;
        const deltaY = (event.clientY - startPosRef.current.y) / scale;

        const cols = Math.round(deltaX / baseColWidth);
        const rows = Math.round(deltaY / baseRowHeight);

        if (cols !== previewRef.current.cols || rows !== previewRef.current.rows) {
          previewRef.current = { rows, cols };
          onPreviewChange(rows, cols);
        }
      };

      const handleUp = () => {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);

        setIsDragging(false);
        startPosRef.current = null;

        const { rows, cols } = previewRef.current;
        onPreviewChange(0, 0);
        if (rows !== 0 || cols !== 0) {
          onExpand(rows, cols);
        }
      };

      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp, { once: true });
    },
    [baseColWidth, baseRowHeight, onPreviewChange, onExpand],
  );

  return (
    <div
      className="absolute -bottom-3 -right-3 w-6 h-6 flex items-center justify-center cursor-nwse-resize z-50 group"
      data-node-interactive="true"
      onMouseDown={handleMouseDown}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors duration-150
          ${isDragging
            ? 'scale-110 bg-primary text-white border-primary'
            : 'bg-card text-muted-foreground border-border group-hover:border-primary group-hover:bg-primary/10'
          } shadow-sm`}
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 16 16"
          fill="none"
          className={isDragging ? 'text-white' : 'text-muted-foreground group-hover:text-primary'}
        >
          <path d="M8 2V14M2 8H14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
};
