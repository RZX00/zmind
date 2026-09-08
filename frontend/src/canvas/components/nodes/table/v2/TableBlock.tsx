/**
 * 模块：Table Block v2
 *
 * 职责：
 * - 渲染表格网格、行列控制栏、扩展把手与单元格编辑。
 *
 * 边界：
 * - 不直接写 store / Yjs；格提交与增删通过回调交给上层。
 * - 不推断业务语义，只呈现 StructuredTableData。
 *
 * 关键契约：
 * - onCellCommit 优先于整表 onDataChange 写格。
 * - onRowOp / onColOp 优先于整表增删。
 * - 列宽/行高/重排仍走 onDataChange（整包 data）。
 *
 * 修改注意：
 * - 打字必须先走 draft，禁止每键整表写回。
 *
 * 验证方式：
 * - 选中表格：拖列宽/行高、拖到最右重排、Tab/Enter 移格、缩放后扩展。
 */
import React, {
  useState,
  useRef,
  useMemo,
  useEffect,
  useCallback,
  useLayoutEffect,
} from 'react';
import { HeaderRow } from './HeaderRow';
import { RowHeaderColumn } from './RowHeaderColumn';
import { AutoResizingTextarea } from './AutoResizingTextarea';
import { DragExpandHandle } from './ExpandHandle';
import {
  updateCell,
  addRow,
  addColumn,
  deleteRow,
  deleteColumn,
  moveColumn,
  moveRow,
  setRowHeight,
  gapIndexToDestination,
} from '../../../../utils/structuredTable';
import type { StructuredTableData } from '../../../../utils/structuredTable';
import type { FontStyle } from '../../../../types/canvas';
import { cn } from '@/lib/utils';
import { renderCellMarkdown } from '@/canvas/utils/markdownRenderer';

export const DEFAULT_GRID_ROW_HEIGHT = 28;
const CELL_LINE_HEIGHT_PX = 20;
const CELL_FONT_SIZE_PX = 13;
const CELL_COMMIT_DEBOUNCE_MS = 300;
const CELL_TEXT_CLASS =
  'block w-full min-w-0 bg-transparent border-none outline-none p-0 m-0 text-[13px] leading-5 font-normal whitespace-pre-wrap break-words';

const cellKey = (r: number, c: number) => `${r}:${c}`;

interface TableBlockProps {
  data: StructuredTableData;
  onDataChange: (newData: StructuredTableData) => void;
  /** 格提交（blur / Tab / Enter / debounce）；有则优先生效 */
  onCellCommit?: (row: number, col: number, value: string) => void;
  onRowOp?: (action: 'insert' | 'delete', index: number) => void;
  onColOp?: (action: 'insert' | 'delete', index: number) => void;
  onCellContextMenu?: (e: React.MouseEvent, row: number, col: number) => void;
  readOnly?: boolean;
  nodeSelected?: boolean;
  className?: string;
  fontStyle?: FontStyle;
  tableStyles?: any;
}

export const TableBlock: React.FC<TableBlockProps> = (props) => {
  const {
    data,
    onDataChange,
    onCellCommit,
    onRowOp,
    onColOp,
    onCellContextMenu,
    readOnly = false,
    nodeSelected = false,
    className,
    fontStyle,
    tableStyles,
  } = props;

  const { rows } = data;

  const [colWidths, setColWidths] = useState<number[]>(() => {
    const count = rows[0]?.length || 0;
    const widths =
      data.columnWidths && data.columnWidths.length > 0 ? [...data.columnWidths] : [];
    while (widths.length < count) widths.push(160);
    return widths.map((w) => w || 160);
  });

  useEffect(() => {
    const count = data.rows[0]?.length || 0;
    const externalWidths = data.columnWidths;
    setColWidths((prev) => {
      if (externalWidths && externalWidths.length > 0) {
        const next = [...externalWidths];
        while (next.length < count) next.push(160);
        if (next.length > count) next.length = count;
        const mapped = next.map((w) => w || 160);
        const isSame =
          prev.length === mapped.length && prev.every((w, i) => w === mapped[i]);
        return isSame ? prev : mapped;
      }
      if (prev.length === count) return prev;
      const next = [...prev];
      if (next.length > count) return next.slice(0, count);
      while (next.length < count) next.push(160);
      return next;
    });
  }, [data.rows, data.columnWidths]);

  const [rowMinHeights, setRowMinHeights] = useState<Record<number, number>>(() => {
    const heights = data.rowHeights;
    if (!heights?.length) return {};
    const init: Record<number, number> = {};
    heights.forEach((h, i) => {
      if (typeof h === 'number' && h > 0) init[i] = h;
    });
    return init;
  });

  useEffect(() => {
    const heights = data.rowHeights;
    if (!heights?.length) return;
    setRowMinHeights((prev) => {
      let changed = false;
      const next = { ...prev };
      heights.forEach((h, i) => {
        if (typeof h === 'number' && h > 0 && next[i] !== h) {
          next[i] = h;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [data.rowHeights]);

  const [actualRowHeights, setActualRowHeights] = useState<number[]>([]);
  const gridRef = useRef<HTMLDivElement>(null);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [selectedCols, setSelectedCols] = useState<number[]>([]);
  const [focusedCell, setFocusedCell] = useState<{ r: number; c: number } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const commitTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  const [previewState, setPreviewState] = useState<{ rows: number; cols: number }>({
    rows: 0,
    cols: 0,
  });

  useEffect(() => {
    if (!nodeSelected) {
      setSelectedRows([]);
      setSelectedCols([]);
      setFocusedCell(null);
    }
  }, [nodeSelected]);

  useLayoutEffect(() => {
    if (!gridRef.current) return;

    const measure = () => {
      const grid = gridRef.current;
      if (!grid) return;
      const cells = Array.from(grid.children).filter((c) => c.hasAttribute('data-row'));
      const heightMap = new Map<number, number>();
      cells.forEach((cell) => {
        const r = parseInt(cell.getAttribute('data-row') || '-1');
        if (r >= 0) {
          const h = (cell as HTMLElement).offsetHeight;
          const currentMax = heightMap.get(r) || 0;
          if (h > currentMax) heightMap.set(r, h);
        }
      });
      const maxRowIndex = Math.max(...Array.from(heightMap.keys()), rows.length - 1);
      const newHeights = Array.from(
        { length: maxRowIndex + 1 },
        (_, i) => heightMap.get(i) || DEFAULT_GRID_ROW_HEIGHT,
      );
      setActualRowHeights((prev) => {
        if (
          prev.length === newHeights.length &&
          prev.every((h, i) => Math.abs(h - newHeights[i]) < 1)
        ) {
          return prev;
        }
        return newHeights;
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(gridRef.current);
    Array.from(gridRef.current.children).forEach((child) => ro.observe(child));
    return () => ro.disconnect();
  }, [rows, colWidths, rowMinHeights, previewState, nodeSelected, readOnly, drafts]);

  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;
  const dataRef = useRef(data);
  dataRef.current = data;

  const getCellValue = useCallback(
    (r: number, c: number) => {
      const key = cellKey(r, c);
      if (Object.prototype.hasOwnProperty.call(draftsRef.current, key)) {
        return draftsRef.current[key];
      }
      return dataRef.current.rows[r]?.[c] ?? '';
    },
    [],
  );

  const clearDraft = useCallback((r: number, c: number) => {
    const key = cellKey(r, c);
    if (commitTimersRef.current[key]) {
      clearTimeout(commitTimersRef.current[key]);
      delete commitTimersRef.current[key];
    }
    setDrafts((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, key)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const commitCell = useCallback(
    (r: number, c: number) => {
      const key = cellKey(r, c);
      if (commitTimersRef.current[key]) {
        clearTimeout(commitTimersRef.current[key]);
        delete commitTimersRef.current[key];
      }
      if (!Object.prototype.hasOwnProperty.call(draftsRef.current, key)) return;
      const value = draftsRef.current[key];
      const current = dataRef.current.rows[r]?.[c] ?? '';
      clearDraft(r, c);
      if (value === current) return;
      if (onCellCommit) {
        onCellCommit(r, c, value);
      } else {
        onDataChange(updateCell(dataRef.current, r, c, value));
      }
    },
    [clearDraft, onCellCommit, onDataChange],
  );

  const commitAllDrafts = useCallback(() => {
    const keys = Object.keys(draftsRef.current);
    keys.forEach((key) => {
      const [rs, cs] = key.split(':');
      commitCell(Number(rs), Number(cs));
    });
  }, [commitCell]);

  useEffect(() => {
    if (!nodeSelected) {
      commitAllDrafts();
    }
  }, [nodeSelected, commitAllDrafts]);

  useEffect(
    () => () => {
      Object.values(commitTimersRef.current).forEach(clearTimeout);
      commitTimersRef.current = {};
    },
    [],
  );

  const scheduleCommit = useCallback(
    (r: number, c: number) => {
      const key = cellKey(r, c);
      if (commitTimersRef.current[key]) clearTimeout(commitTimersRef.current[key]);
      commitTimersRef.current[key] = setTimeout(() => {
        delete commitTimersRef.current[key];
        commitCell(r, c);
      }, CELL_COMMIT_DEBOUNCE_MS);
    },
    [commitCell],
  );

  const handleDraftChange = useCallback(
    (r: number, c: number, value: string) => {
      const key = cellKey(r, c);
      setDrafts((prev) => ({ ...prev, [key]: value }));
      scheduleCommit(r, c);
    },
    [scheduleCommit],
  );

  const focusCell = useCallback((r: number, c: number) => {
    setFocusedCell({ r, c });
    requestAnimationFrame(() => {
      textareaRefs.current.get(cellKey(r, c))?.focus();
    });
  }, []);

  const navigateCell = useCallback(
    (fromR: number, fromC: number, dR: number, dC: number) => {
      commitCell(fromR, fromC);
      const rowCount = dataRef.current.rows.length;
      const colCount = dataRef.current.rows[0]?.length || 0;
      if (!rowCount || !colCount) return;

      let r = fromR;
      let c = fromC;
      if (dC !== 0) {
        c += dC;
        if (c >= colCount) {
          c = 0;
          r += 1;
        } else if (c < 0) {
          c = colCount - 1;
          r -= 1;
        }
      } else {
        r += dR;
      }
      if (r < 0 || r >= rowCount) return;
      focusCell(r, c);
    },
    [commitCell, focusCell],
  );

  const handleColResize = useCallback((index: number, newWidth: number) => {
    setColWidths((prev) => {
      if (prev[index] === newWidth) return prev;
      const next = [...prev];
      next[index] = newWidth;
      return next;
    });
  }, []);

  const handleColResizeEnd = useCallback(
    (index: number, newWidth: number) => {
      const currentWidths = [...colWidthsRef.current];
      currentWidths[index] = newWidth;
      setColWidths(currentWidths);
      onDataChange({ ...dataRef.current, columnWidths: currentWidths });
    },
    [onDataChange],
  );

  const handleRowResize = useCallback((index: number, newHeight: number) => {
    const constrained = Math.max(DEFAULT_GRID_ROW_HEIGHT, newHeight);
    setRowMinHeights((prev) => ({ ...prev, [index]: constrained }));
  }, []);

  const handleRowResizeEnd = useCallback(
    (index: number, finalHeight: number) => {
      const constrained = Math.max(DEFAULT_GRID_ROW_HEIGHT, finalHeight);
      setRowMinHeights((prev) => ({ ...prev, [index]: constrained }));
      onDataChange(setRowHeight(dataRef.current, index, constrained));
    },
    [onDataChange],
  );

  const handleExpand = useCallback(
    (addRows: number, addCols: number) => {
      if (onRowOp || onColOp) {
        if (addRows > 0) {
          const base = dataRef.current.rows.length;
          for (let i = 0; i < addRows; i++) onRowOp?.('insert', base + i);
        } else if (addRows < 0) {
          for (let i = 0; i < Math.abs(addRows); i++) {
            const len = dataRef.current.rows.length - i;
            if (len > 1) onRowOp?.('delete', len - 1);
          }
        }
        if (addCols > 0) {
          const base = dataRef.current.rows[0]?.length || 0;
          for (let i = 0; i < addCols; i++) onColOp?.('insert', base + i);
        } else if (addCols < 0) {
          for (let i = 0; i < Math.abs(addCols); i++) {
            const colLen = (dataRef.current.rows[0]?.length || 0) - i;
            if (colLen > 1) onColOp?.('delete', colLen - 1);
          }
        }
        setPreviewState({ rows: 0, cols: 0 });
        return;
      }

      let newData = { ...dataRef.current };
      if (addRows > 0) {
        for (let i = 0; i < addRows; i++) newData = addRow(newData);
      } else if (addRows < 0) {
        for (let i = 0; i < Math.abs(addRows); i++) {
          if (newData.rows.length > 1) newData = deleteRow(newData, newData.rows.length - 1);
        }
      }
      if (addCols > 0) {
        for (let i = 0; i < addCols; i++) newData = addColumn(newData);
      } else if (addCols < 0) {
        for (let i = 0; i < Math.abs(addCols); i++) {
          const colLen = newData.rows[0]?.length || 0;
          if (colLen > 1) newData = deleteColumn(newData, colLen - 1);
        }
      }
      onDataChange(newData);
      setPreviewState({ rows: 0, cols: 0 });
    },
    [onColOp, onDataChange, onRowOp],
  );

  const handleColumnReorder = useCallback(
    (fromIndex: number, gapIndex: number) => {
      const count = dataRef.current.rows[0]?.length || 0;
      const dest = gapIndexToDestination(fromIndex, gapIndex, count);
      if (dest == null) return;
      const newData = moveColumn(dataRef.current, fromIndex, dest);
      if (newData.columnWidths) setColWidths(newData.columnWidths.map((w) => w || 160));
      onDataChange(newData);
    },
    [onDataChange],
  );

  const handleRowReorder = useCallback(
    (fromIndex: number, gapIndex: number) => {
      const count = dataRef.current.rows.length;
      const dest = gapIndexToDestination(fromIndex, gapIndex, count);
      if (dest == null) return;
      const newData = moveRow(dataRef.current, fromIndex, dest);
      setRowMinHeights((prev) => {
        const maxRow = Math.max(
          ...Object.keys(prev).map(Number),
          fromIndex,
          dest,
          count - 1,
        );
        const heightArray = Array.from({ length: maxRow + 1 }, (_, i) => prev[i]);
        const item = heightArray[fromIndex];
        heightArray.splice(fromIndex, 1);
        heightArray.splice(dest, 0, item);
        const next: Record<number, number> = {};
        heightArray.forEach((h, i) => {
          if (h !== undefined) next[i] = h;
        });
        return next;
      });
      onDataChange(newData);
    },
    [onDataChange],
  );

  const toggleMultiSelect = useCallback((list: number[], index: number) => {
    if (list.includes(index)) return list.filter((i) => i !== index);
    return [...list, index];
  }, []);

  const baseRowCount = rows.length;
  const baseColCount = rows[0]?.length || 0;
  const totalRowCount = baseRowCount + Math.max(0, previewState.rows);
  const totalColCount = baseColCount + Math.max(0, previewState.cols);

  const renderColWidths = useMemo(() => {
    const widths = [...colWidths];
    while (widths.length < totalColCount) widths.push(160);
    return widths;
  }, [colWidths, totalColCount]);

  const gridTemplateColumns = renderColWidths
    .slice(0, Math.max(baseColCount, totalColCount))
    .map((w) => `${w}px`)
    .join(' ');

  return (
    <div className={cn('relative group/table', className)} style={{ width: 'max-content' }}>
      {nodeSelected && (
        <div style={{ position: 'absolute', top: -42, left: 0, zIndex: 50 }}>
          <HeaderRow
            colCount={Math.max(baseColCount, totalColCount)}
            columnWidths={renderColWidths}
            onColResize={handleColResize}
            onColResizeEnd={handleColResizeEnd}
            onColMove={handleColumnReorder}
            onColSelect={(idx, multi) =>
              setSelectedCols((prev) => (multi ? toggleMultiSelect(prev, idx) : [idx]))
            }
            selectedCols={selectedCols}
            rowHeaderWidth={40}
            scrollLeft={0}
          />
        </div>
      )}

      {nodeSelected && (
        <div style={{ position: 'absolute', top: 0, left: -50, zIndex: 50 }}>
          <RowHeaderColumn
            rowCount={Math.max(baseRowCount, totalRowCount)}
            rowHeights={actualRowHeights}
            rowMinHeights={rowMinHeights}
            onRowResize={handleRowResize}
            onRowResizeEnd={handleRowResizeEnd}
            onRowMove={handleRowReorder}
            onRowSelect={(idx, multi) =>
              setSelectedRows((prev) => (multi ? toggleMultiSelect(prev, idx) : [idx]))
            }
            selectedRows={selectedRows}
            width={40}
          />
        </div>
      )}

      <div
        ref={gridRef}
        className="grid rounded-md bg-card text-foreground"
        style={{
          gridTemplateColumns,
          gridAutoRows: 'max-content',
          backgroundColor: 'var(--card)',
        }}
      >
        {Array.from({ length: Math.max(baseRowCount, totalRowCount) }).map((_, rIndex) => {
          const isPreviewRow = rIndex >= baseRowCount;
          const isDeletePreviewRow =
            previewState.rows < 0 && rIndex >= baseRowCount + previewState.rows;

          return Array.from({ length: Math.max(baseColCount, totalColCount) }).map(
            (_, cIndex) => {
              const isPreviewCol = cIndex >= baseColCount;
              const isDeletePreviewCol =
                previewState.cols < 0 && cIndex >= baseColCount + previewState.cols;

              const committed = !isPreviewRow && !isPreviewCol ? rows[rIndex]?.[cIndex] || '' : '';
              const key = cellKey(rIndex, cIndex);
              const cellContent = Object.prototype.hasOwnProperty.call(drafts, key)
                ? drafts[key]
                : committed;

              const minH = rowMinHeights[rIndex] || DEFAULT_GRID_ROW_HEIGHT;
              const isSelected =
                selectedRows.includes(rIndex) || selectedCols.includes(cIndex);
              const isHeaderRow = rIndex === 0;
              const isLastRow = rIndex === baseRowCount - 1;
              const hasDataRows = baseRowCount > 1;
              const treatFirstRowAsHeader = hasDataRows || tableStyles;
              const dataRowIndex = treatFirstRowAsHeader ? rIndex - 1 : rIndex;
              const showGrid = tableStyles?.showGrid !== false;
              const baseBorderWidth = tableStyles?.borderWidth ?? 1;
              const defaultBorder = 'var(--border)';
              const activeBorder =
                'color-mix(in oklab, var(--border) 80%, var(--foreground) 20%)';
              const resolvedBorderColor =
                tableStyles?.borderColor || (nodeSelected ? activeBorder : defaultBorder);
              const borderStyle = tableStyles?.borderStyle ?? 'solid';

              const style: React.CSSProperties = {
                minHeight: minH,
                height: '100%',
                borderColor: resolvedBorderColor,
                borderStyle,
              };

              if (fontStyle?.fontFamily) style.fontFamily = fontStyle.fontFamily;
              if (fontStyle?.size) style.fontSize = `${fontStyle.size}px`;
              if (fontStyle?.weight)
                style.fontWeight = fontStyle.weight as React.CSSProperties['fontWeight'];
              if (fontStyle?.textAlign) style.textAlign = fontStyle.textAlign;
              if (fontStyle?.color) style.color = fontStyle.color;

              if (tableStyles?.fontFamily) style.fontFamily = tableStyles.fontFamily;
              if (tableStyles?.fontSize) style.fontSize = `${tableStyles.fontSize}px`;
              if (tableStyles?.textAlign) style.textAlign = tableStyles.textAlign;
              if (tableStyles?.cellPadding !== undefined) {
                style.padding = `${tableStyles.cellPadding}px`;
              }
              if (!style.color) style.color = 'var(--foreground)';

              if (isHeaderRow && treatFirstRowAsHeader) {
                if (tableStyles?.headerBackground)
                  style.backgroundColor = tableStyles.headerBackground;
                if (tableStyles?.headerTextColor) style.color = tableStyles.headerTextColor;
                if (tableStyles?.headerBold) style.fontWeight = 600;
              } else if (tableStyles?.alternateRows && dataRowIndex >= 0) {
                const isEvenDataRow = dataRowIndex % 2 === 0;
                const bg = isEvenDataRow
                  ? tableStyles.evenRowBackground
                  : tableStyles.oddRowBackground;
                if (bg) style.backgroundColor = bg;
                if (tableStyles?.textColor) style.color = tableStyles.textColor;
              } else if (tableStyles?.textColor && !tableStyles?.alternateRows) {
                style.color = tableStyles.textColor;
              }

              if (showGrid) {
                style.borderTopWidth = rIndex === 0 ? baseBorderWidth : 0;
                style.borderLeftWidth = cIndex === 0 ? baseBorderWidth : 0;
                style.borderRightWidth = baseBorderWidth;
                style.borderBottomWidth = baseBorderWidth;
              } else {
                const topThickness = tableStyles?.topBorder ?? baseBorderWidth;
                const headerDivider = tableStyles?.headerBorder ?? baseBorderWidth;
                const bottomThickness = tableStyles?.bottomBorder ?? baseBorderWidth;
                style.borderTopWidth = isHeaderRow ? topThickness : 0;
                if (isHeaderRow && treatFirstRowAsHeader) {
                  style.borderBottomWidth = headerDivider;
                } else if (isLastRow) {
                  style.borderBottomWidth = bottomThickness;
                } else {
                  style.borderBottomWidth = 0;
                }
                style.borderLeftWidth = cIndex === 0 ? baseBorderWidth : 0;
                style.borderRightWidth = cIndex === baseColCount - 1 ? baseBorderWidth : 0;
              }

              if (isPreviewRow || isPreviewCol) {
                style.backgroundColor = 'rgba(59, 130, 246, 0.05)';
                style.borderStyle = 'dashed';
                style.borderColor = '#3b82f6';
                style.color = '#9ca3af';
              }
              if (isDeletePreviewRow || isDeletePreviewCol) {
                style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                style.opacity = 0.6;
              }

              const cellInteractive =
                nodeSelected &&
                !readOnly &&
                !isPreviewRow &&
                !isPreviewCol &&
                !isDeletePreviewCol &&
                !isDeletePreviewRow;
              const markdownHtml = !cellInteractive ? renderCellMarkdown(cellContent) : '';
              const cellPadY =
                tableStyles?.cellPadding !== undefined ? Number(tableStyles.cellPadding) : 4;
              const textareaMinHeight = Math.max(CELL_LINE_HEIGHT_PX, minH - cellPadY * 2);
              const contentTypeStyle: React.CSSProperties = {
                color: style.color || 'var(--foreground)',
                textAlign: (style.textAlign as React.CSSProperties['textAlign']) || 'left',
                fontFamily: style.fontFamily || 'inherit',
                fontSize: style.fontSize || `${CELL_FONT_SIZE_PX}px`,
                lineHeight: `${CELL_LINE_HEIGHT_PX}px`,
              };

              return (
                <div
                  key={key}
                  data-row={rIndex}
                  data-col={cIndex}
                  data-node-interactive={cellInteractive ? 'true' : undefined}
                  className={cn('relative px-1 py-1 box-border', isSelected && 'bg-primary/10')}
                  style={style}
                  onContextMenu={(e) => onCellContextMenu?.(e, rIndex, cIndex)}
                  onPointerDown={(e) => {
                    if (cellInteractive) e.stopPropagation();
                  }}
                  onClick={() => {
                    if (selectedRows.length > 0 || selectedCols.length > 0) {
                      setSelectedRows([]);
                      setSelectedCols([]);
                    }
                    if (cellInteractive) setFocusedCell({ r: rIndex, c: cIndex });
                  }}
                >
                  <div className="relative w-full">
                    <AutoResizingTextarea
                      ref={(el) => {
                        if (el) textareaRefs.current.set(key, el);
                        else textareaRefs.current.delete(key);
                      }}
                      value={cellContent}
                      onChange={(e) => handleDraftChange(rIndex, cIndex, e.target.value)}
                      onBlur={() => commitCell(rIndex, cIndex)}
                      onKeyDown={(e) => {
                        if (!cellInteractive) return;
                        if (e.key === 'Tab') {
                          e.preventDefault();
                          navigateCell(rIndex, cIndex, 0, e.shiftKey ? -1 : 1);
                          return;
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          navigateCell(rIndex, cIndex, 1, 0);
                        }
                      }}
                      minHeight={textareaMinHeight}
                      className={cn(
                        CELL_TEXT_CLASS,
                        'placeholder:text-muted-foreground',
                        cellInteractive
                          ? 'relative z-10 select-text'
                          : 'opacity-0 pointer-events-none select-none',
                        focusedCell?.r === rIndex &&
                          focusedCell?.c === cIndex &&
                          'ring-1 ring-primary/40',
                      )}
                      style={contentTypeStyle}
                      placeholder=""
                      readOnly={!cellInteractive}
                      tabIndex={cellInteractive ? 0 : -1}
                      data-node-interactive={cellInteractive ? 'true' : undefined}
                    />
                    {!cellInteractive && (
                      <div
                        className={cn(
                          CELL_TEXT_CLASS,
                          'absolute inset-0 pointer-events-none select-none overflow-hidden [&_p]:m-0 [&_h1]:m-0 [&_h2]:m-0 [&_h3]:m-0 [&_ul]:m-0 [&_ol]:m-0',
                        )}
                        style={contentTypeStyle}
                        dangerouslySetInnerHTML={{ __html: markdownHtml }}
                      />
                    )}
                  </div>
                </div>
              );
            },
          );
        })}
      </div>

      {nodeSelected && !readOnly && (
        <DragExpandHandle
          onPreviewChange={(r, c) => setPreviewState({ rows: r, cols: c })}
          onExpand={handleExpand}
          baseColWidth={160}
          baseRowHeight={32}
        />
      )}
    </div>
  );
};
