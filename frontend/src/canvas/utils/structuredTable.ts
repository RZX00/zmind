/**
 * 🏗️ 结构化表格数据操作工具（无表头版本）
 */

export interface StructuredTableData {
  rows: string[][];
  columnWidths?: number[];  // px
  rowHeights?: number[];    // px
}

const DEFAULT_COLUMN_WIDTH = 160;
const DEFAULT_ROW_HEIGHT = 40;
const MIN_COLUMN_WIDTH = 60;
const MIN_ROW_HEIGHT = 28;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const ensureColumnWidths = (data: StructuredTableData, targetLength: number) => {
  const base = Array.isArray(data.columnWidths) ? [...data.columnWidths] : [];
  while (base.length < targetLength) {
    base.push(DEFAULT_COLUMN_WIDTH);
  }
  if (base.length > targetLength) {
    base.length = targetLength;
  }
  return base;
};

const ensureRowHeights = (data: StructuredTableData, targetLength: number) => {
  const base = Array.isArray(data.rowHeights) ? [...data.rowHeights] : [];
  while (base.length < targetLength) {
    base.push(DEFAULT_ROW_HEIGHT);
  }
  if (base.length > targetLength) {
    base.length = targetLength;
  }
  return base;
};

export function normalizeTableData(data: StructuredTableData): StructuredTableData {
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const colCount = rows[0]?.length ?? 0;
  return {
    rows,
    columnWidths: ensureColumnWidths(data, colCount),
    rowHeights: ensureRowHeights(data, rows.length),
  };
}

/**
 * 创建空表格
 */
export function createEmptyTable(cols: number = 3, rows: number = 3): StructuredTableData {
  return {
    rows: Array(rows).fill(null).map(() => new Array(cols).fill('')),
    columnWidths: new Array(cols).fill(DEFAULT_COLUMN_WIDTH),
    rowHeights: new Array(rows).fill(DEFAULT_ROW_HEIGHT),
  };
}

/**
 * 添加行
 */
export function addRow(data: StructuredTableData, index: number = -1): StructuredTableData {
  const colCount = data.rows[0]?.length ?? 0;
  const newRow = new Array(colCount).fill('');
  const newRows = [...data.rows];
  const rowHeights = ensureRowHeights(data, data.rows.length);
  const newRowHeights = [...rowHeights];

  if (index === -1 || index >= newRows.length) {
    newRows.push(newRow);
    newRowHeights.push(DEFAULT_ROW_HEIGHT);
  } else {
    newRows.splice(index, 0, newRow);
    newRowHeights.splice(index, 0, DEFAULT_ROW_HEIGHT);
  }

  return {
    rows: newRows,
    columnWidths: ensureColumnWidths(data, colCount),
    rowHeights: newRowHeights
  };
}

/**
 * 删除行
 */
export function deleteRow(data: StructuredTableData, index: number): StructuredTableData {
  if (index < 0 || index >= data.rows.length || data.rows.length <= 1) {
    return data;
  }

  const newRows = [...data.rows];
  newRows.splice(index, 1);
  const rowHeights = ensureRowHeights(data, data.rows.length);
  rowHeights.splice(index, 1);
  const colCount = newRows[0]?.length ?? 0;

  return {
    rows: newRows,
    columnWidths: ensureColumnWidths(data, colCount),
    rowHeights
  };
}

/**
 * 添加列
 */
export function addColumn(data: StructuredTableData, index: number = -1): StructuredTableData {
  const rows = data.rows.map(row => [...row]);
  const colCount = rows[0]?.length ?? 0;
  const columnWidths = ensureColumnWidths(data, colCount);

  if (index === -1 || index >= colCount) {
    rows.forEach(row => row.push(''));
    columnWidths.push(DEFAULT_COLUMN_WIDTH);
  } else {
    rows.forEach(row => row.splice(index, 0, ''));
    columnWidths.splice(index, 0, DEFAULT_COLUMN_WIDTH);
  }

  return {
    rows,
    columnWidths,
    rowHeights: ensureRowHeights(data, data.rows.length)
  };
}

/**
 * 删除列
 */
export function deleteColumn(data: StructuredTableData, index: number): StructuredTableData {
  const colCount = data.rows[0]?.length ?? 0;
  if (index < 0 || index >= colCount || colCount <= 1) {
    return data;
  }

  const rows = data.rows.map(row => {
    const newRow = [...row];
    newRow.splice(index, 1);
    return newRow;
  });

  const columnWidths = ensureColumnWidths(data, colCount);
  columnWidths.splice(index, 1);

  return {
    rows,
    columnWidths,
    rowHeights: ensureRowHeights(data, data.rows.length)
  };
}

/**
 * 更新单元格
 */
export function updateCell(
  data: StructuredTableData,
  rowIndex: number,
  colIndex: number,
  value: string
): StructuredTableData {
  const cleanValue = typeof value === 'string' ? value : '';
  if (rowIndex < 0 || rowIndex >= data.rows.length) return data;
  if (colIndex < 0 || !data.rows[rowIndex] || colIndex >= data.rows[rowIndex].length) return data;

  const newRows = data.rows.map((row, rIdx) =>
    rIdx === rowIndex ? row.map((cell, cIdx) => (cIdx === colIndex ? cleanValue : cell)) : [...row]
  );

  return {
    rows: newRows,
    columnWidths: ensureColumnWidths(data, newRows[0]?.length ?? 0),
    rowHeights: ensureRowHeights(data, newRows.length)
  };
}

export function generateColumnLabel(index: number): string {
  if (index < 0) return 'A';
  if (index > 701) return 'ZZ';

  let result = '';
  let num = index;
  do {
    result = String.fromCharCode(65 + (num % 26)) + result;
    num = Math.floor(num / 26) - 1;
  } while (num >= 0);
  return result;
}

export function moveRow(data: StructuredTableData, from: number, to: number): StructuredTableData {
  if (from === to || from < 0 || to < 0 || from >= data.rows.length || to >= data.rows.length) {
    return data;
  }
  const rows = [...data.rows];
  const [movedRow] = rows.splice(from, 1);
  rows.splice(to, 0, movedRow);

  const rowHeights = ensureRowHeights(data, data.rows.length);
  const [movedHeight] = rowHeights.splice(from, 1);
  rowHeights.splice(to, 0, movedHeight ?? DEFAULT_ROW_HEIGHT);

  return {
    rows,
    columnWidths: ensureColumnWidths(data, rows[0]?.length ?? 0),
    rowHeights
  };
}

export function moveColumn(data: StructuredTableData, from: number, to: number): StructuredTableData {
  const colCount = data.rows[0]?.length ?? 0;
  if (from === to || from < 0 || to < 0 || from >= colCount || to >= colCount) {
    return data;
  }

  const rows = data.rows.map(row => {
    const newRow = [...row];
    const [cell] = newRow.splice(from, 1);
    newRow.splice(to, 0, cell ?? '');
    return newRow;
  });

  const columnWidths = ensureColumnWidths(data, colCount);
  const [width] = columnWidths.splice(from, 1);
  columnWidths.splice(to, 0, width ?? DEFAULT_COLUMN_WIDTH);

  return {
    rows,
    columnWidths,
    rowHeights: ensureRowHeights(data, data.rows.length)
  };
}

export function resizeColumn(data: StructuredTableData, colIndex: number, delta: number): StructuredTableData {
  const colCount = data.rows[0]?.length ?? 0;
  if (colIndex < 0 || colIndex >= colCount) {
    return data;
  }
  const columnWidths = ensureColumnWidths(data, colCount);
  columnWidths[colIndex] = clamp(
    (columnWidths[colIndex] ?? DEFAULT_COLUMN_WIDTH) + delta,
    MIN_COLUMN_WIDTH,
    2000
  );
  return {
    rows: data.rows.map(row => [...row]),
    columnWidths,
    rowHeights: ensureRowHeights(data, data.rows.length)
  };
}

export function resizeRow(data: StructuredTableData, rowIndex: number, delta: number): StructuredTableData {
  if (rowIndex < 0 || rowIndex >= data.rows.length) {
    return data;
  }
  const rowHeights = ensureRowHeights(data, data.rows.length);
  rowHeights[rowIndex] = clamp(
    (rowHeights[rowIndex] ?? DEFAULT_ROW_HEIGHT) + delta,
    MIN_ROW_HEIGHT,
    1000
  );
  return {
    rows: data.rows.map(row => [...row]),
    columnWidths: ensureColumnWidths(data, data.rows[0]?.length ?? 0),
    rowHeights
  };
}

/** 把手松手时写入绝对行高（与 columnWidths 对称持久化）。 */
export function setRowHeight(data: StructuredTableData, rowIndex: number, height: number): StructuredTableData {
  if (rowIndex < 0 || rowIndex >= data.rows.length) {
    return data;
  }
  const rowHeights = ensureRowHeights(data, data.rows.length);
  rowHeights[rowIndex] = clamp(height, MIN_ROW_HEIGHT, 1000);
  return {
    rows: data.rows.map(row => [...row]),
    columnWidths: ensureColumnWidths(data, data.rows[0]?.length ?? 0),
    rowHeights,
  };
}

/** Header/RowHeader 的缝隙索引 → moveRow/moveColumn 的目标下标。 */
export function gapIndexToDestination(from: number, gap: number, count: number): number | null {
  if (count <= 0 || from < 0 || from >= count) return null;
  let dest = gap > from ? gap - 1 : gap;
  dest = Math.max(0, Math.min(count - 1, dest));
  if (dest === from) return null;
  return dest;
}
