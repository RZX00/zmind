// 🚀 优化的表格数据操作工具（无表头版本）

import type { StructuredTableData } from './structuredTable';

interface PerformanceMetrics {
  operationType: string;
  duration: number;
  dataSize: number;
  timestamp: number;
}

export interface TableOperation {
  type: 'updateCell' | 'addRow' | 'deleteRow' | 'addColumn' | 'deleteColumn';
  rowIndex?: number;
  colIndex?: number;
  value?: string;
  index?: number;
}

const DEFAULT_COLUMN_WIDTH = 160;
const DEFAULT_ROW_HEIGHT = 40;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const ensureColumnWidths = (data: StructuredTableData, colCount: number) => {
  const base = Array.isArray(data.columnWidths) ? [...data.columnWidths] : [];
  while (base.length < colCount) base.push(DEFAULT_COLUMN_WIDTH);
  if (base.length > colCount) base.length = colCount;
  return base;
};

const ensureRowHeights = (data: StructuredTableData, rowCount: number) => {
  const base = Array.isArray(data.rowHeights) ? [...data.rowHeights] : [];
  while (base.length < rowCount) base.push(DEFAULT_ROW_HEIGHT);
  if (base.length > rowCount) base.length = rowCount;
  return base;
};

export class OptimizedTableOperations {
  private static metrics: PerformanceMetrics[] = [];
  private static MAX_METRICS = 100;

  private static withTracking<T extends any[], R>(type: string, size: number, fn: (...args: T) => R) {
    return (...args: T): R => {
      const start = performance.now();
      const result = fn(...args);
      const duration = performance.now() - start;
      this.metrics.push({ operationType: type, duration, dataSize: size, timestamp: Date.now() });
      if (this.metrics.length > this.MAX_METRICS) this.metrics.shift();
      return result;
    };
  }

  static updateCell = this.withTracking('updateCell', 0, (data: StructuredTableData, rowIndex: number, colIndex: number, value: string): StructuredTableData => {
    if (rowIndex < 0 || rowIndex >= data.rows.length) return data;
    const row = data.rows[rowIndex];
    if (colIndex < 0 || !row || colIndex >= row.length) return data;
    if (row[colIndex] === value) return data;
    const newRows = data.rows.map((r, idx) => (idx === rowIndex ? r.map((cell, cIdx) => (cIdx === colIndex ? value : cell)) : [...r]));
    return {
      rows: newRows,
      columnWidths: ensureColumnWidths(data, newRows[0]?.length ?? 0),
      rowHeights: ensureRowHeights(data, newRows.length)
    };
  });

  static addRow = this.withTracking('addRow', 0, (data: StructuredTableData, index: number = -1): StructuredTableData => {
    const colCount = data.rows[0]?.length ?? (data.columnWidths?.length ?? 0);
    const newRow = new Array(colCount).fill('');
    const newRows = [...data.rows];
    if (index === -1 || index >= newRows.length) newRows.push(newRow);
    else newRows.splice(index, 0, newRow);
    return {
      rows: newRows,
      columnWidths: ensureColumnWidths(data, colCount),
      rowHeights: ensureRowHeights(data, newRows.length)
    };
  });

  static deleteRow = this.withTracking('deleteRow', 0, (data: StructuredTableData, index: number): StructuredTableData => {
    if (index < 0 || index >= data.rows.length || data.rows.length <= 1) return data;
    const newRows = [...data.rows];
    newRows.splice(index, 1);
    return {
      rows: newRows,
      columnWidths: ensureColumnWidths(data, newRows[0]?.length ?? 0),
      rowHeights: ensureRowHeights(data, newRows.length)
    };
  });

  static addColumn = this.withTracking('addColumn', 0, (data: StructuredTableData, index: number = -1): StructuredTableData => {
    const colCount = data.rows[0]?.length ?? 0;
    const insertIndex = index === -1 || index > colCount ? colCount : index;
    const rows = data.rows.map(row => {
      const newRow = [...row];
      newRow.splice(insertIndex, 0, '');
      return newRow;
    });
    const columnWidths = ensureColumnWidths(data, colCount + 1);
    columnWidths.splice(insertIndex, 0, DEFAULT_COLUMN_WIDTH);
    return { rows, columnWidths, rowHeights: ensureRowHeights(data, rows.length) };
  });

  static deleteColumn = this.withTracking('deleteColumn', 0, (data: StructuredTableData, index: number): StructuredTableData => {
    const colCount = data.rows[0]?.length ?? 0;
    if (index < 0 || index >= colCount || colCount <= 1) return data;
    const rows = data.rows.map(row => {
      const newRow = [...row];
      newRow.splice(index, 1);
      return newRow;
    });
    const columnWidths = ensureColumnWidths(data, colCount);
    columnWidths.splice(index, 1);
    return { rows, columnWidths, rowHeights: ensureRowHeights(data, rows.length) };
  });

  static batchUpdate = this.withTracking('batchUpdate', 0, (data: StructuredTableData, operations: TableOperation[]): StructuredTableData => {
    let result = data;
    for (const op of operations) {
      result = this.applySingleOperation(result, op);
    }
    return result;
  });

  private static applySingleOperation(data: StructuredTableData, operation: TableOperation) {
    switch (operation.type) {
      case 'updateCell':
        if (operation.rowIndex !== undefined && operation.colIndex !== undefined && operation.value !== undefined) {
          return this.updateCell(data, operation.rowIndex, operation.colIndex, operation.value);
        }
        break;
      case 'addRow':
        return this.addRow(data, operation.index);
      case 'deleteRow':
        if (operation.index !== undefined) return this.deleteRow(data, operation.index);
        break;
      case 'addColumn':
        return this.addColumn(data, operation.index);
      case 'deleteColumn':
        if (operation.index !== undefined) return this.deleteColumn(data, operation.index);
        break;
    }
    return data;
  }

  static validateData(data: StructuredTableData): boolean {
    if (!Array.isArray(data.rows) || data.rows.length === 0) return false;
    const colCount = data.rows[0].length;
    return data.rows.every(row => Array.isArray(row) && row.length === colCount);
  }

  static getDataStats(data: StructuredTableData) {
    const colCount = data.rows[0]?.length ?? 0;
    const totalCells = colCount * data.rows.length;
    const emptyCells = data.rows.reduce((count, row) => count + row.filter(cell => (cell || '').trim() === '').length, 0);
    const avgContentLength = totalCells ? data.rows.reduce((total, row) => total + row.reduce((sum, cell) => sum + cell.length, 0), 0) / totalCells : 0;
    return {
      rows: data.rows.length,
      columns: colCount,
      totalCells,
      emptyCells,
      filledCells: totalCells - emptyCells,
      fillRate: totalCells ? Math.round((totalCells - emptyCells) / totalCells * 100) : 0,
      avgContentLength: Math.round(avgContentLength * 100) / 100
    };
  }
}

export const updateCellOptimized = OptimizedTableOperations.updateCell;
export const addRowOptimized = OptimizedTableOperations.addRow;
export const deleteRowOptimized = OptimizedTableOperations.deleteRow;
export const addColumnOptimized = OptimizedTableOperations.addColumn;
export const deleteColumnOptimized = OptimizedTableOperations.deleteColumn;
export const batchUpdateOptimized = OptimizedTableOperations.batchUpdate;

export class TablePerformanceBenchmark {
  static async benchmarkOperations(data: StructuredTableData, operations: number = 1000) {
    console.log('🚀 表格性能基准测试开始...');
    const results = { updateCell: 0, addRow: 0, addColumn: 0, deleteRow: 0, deleteColumn: 0 };
    let testData = data;
    const start1 = performance.now();
    for (let i = 0; i < operations; i++) {
      const row = Math.floor(Math.random() * testData.rows.length);
      const col = Math.floor(Math.random() * (testData.rows[0]?.length ?? 1));
      testData = OptimizedTableOperations.updateCell(testData, row, col, `test-${i}`);
    }
    results.updateCell = performance.now() - start1;
    testData = data;
    const start2 = performance.now();
    for (let i = 0; i < Math.min(operations, 100); i++) {
      testData = OptimizedTableOperations.addRow(testData);
    }
    results.addRow = performance.now() - start2;
    console.log('📊 基准测试结果:', results);
    return results;
  }
}

export default OptimizedTableOperations;
