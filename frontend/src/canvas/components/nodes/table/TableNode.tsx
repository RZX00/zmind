/**
 * 模块：Table Node
 *
 * 职责：
 * - 包装 TableBlock，处理 legacy headers 迁移、右键菜单、尺寸汇报。
 *
 * 边界：
 * - 不直接碰 store；格/结构变更通过回调上抛。
 *
 * 关键契约：
 * - onCellCommit / onRowOp / onColOp 优先；几何类仍走 onDataChange。
 *
 * 验证方式：
 * - 选中表格编辑一格、增删行列、拖列宽行高。
 */
import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { useTranslations } from 'next-intl';
import { UnifiedContextMenu } from '@/components/ui/context-menu';
import { useContextMenuController } from '@/hooks/useContextMenuController';
import type { CanvasNode, FontStyle } from '../../../../types/canvas';
import type { StructuredTableData } from '../../../utils/structuredTable';
import {
  createEmptyTable,
  addRow,
  deleteRow,
  addColumn,
  deleteColumn,
  normalizeTableData,
} from '../../../utils/structuredTable';
import { TableBlock } from './v2/TableBlock';

type TableNodeType = CanvasNode & { type: 'table'; data?: StructuredTableData };

interface TableNodeProps {
  node: TableNodeType;
  nodeSelected?: boolean;
  fontStyle?: FontStyle;
  tableStyles?: any;
  onDataChange?: (nodeId: string, data: StructuredTableData) => void;
  onCellCommit?: (nodeId: string, row: number, col: number, value: string) => void;
  onRowOp?: (nodeId: string, action: 'insert' | 'delete', index: number) => void;
  onColOp?: (nodeId: string, action: 'insert' | 'delete', index: number) => void;
  onSizeChange?: (nodeId: string, size: { width: number; height: number }) => void;
  onLockToggle?: (nodeId: string, locked: boolean) => void;
}

const TableNodeComponent: React.FC<TableNodeProps> = ({
  node,
  nodeSelected = false,
  fontStyle,
  tableStyles,
  onDataChange,
  onCellCommit,
  onRowOp,
  onColOp,
  onSizeChange,
  onLockToggle,
}) => {
  const t = useTranslations();
  const menuCtrl = useContextMenuController();
  const containerRef = useRef<HTMLDivElement>(null);
  const reportedSizeRef = useRef<{ width: number; height: number }>({
    width: node.width ?? 0,
    height: node.height ?? 0,
  });

  const { tableData, migratedFromLegacy } = React.useMemo(() => {
    const raw = node.data as any;
    if (raw && Array.isArray(raw.headers)) {
      const legacyHeaders = raw.headers as string[];
      const rows = Array.isArray(raw.rows) ? raw.rows : [];
      const merged = rows.length > 0 ? [legacyHeaders, ...rows] : [legacyHeaders];
      const structured: StructuredTableData = {
        rows: merged,
        columnWidths: raw.columnWidths,
        rowHeights: raw.rowHeights,
      };
      return { tableData: normalizeTableData(structured), migratedFromLegacy: true };
    }
    const structured = (node.data as StructuredTableData) || createEmptyTable();
    return { tableData: normalizeTableData(structured), migratedFromLegacy: false };
  }, [node.data]);

  const saveData = useCallback(
    (newData: StructuredTableData) => {
      onDataChange?.(node.id, newData);
    },
    [node.id, onDataChange],
  );

  useEffect(() => {
    if (migratedFromLegacy) {
      saveData(tableData);
    }
  }, [migratedFromLegacy, saveData, tableData]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const current = reportedSizeRef.current;
        if (Math.abs(current.width - width) > 1 || Math.abs(current.height - height) > 1) {
          reportedSizeRef.current = { width, height };
          onSizeChange?.(node.id, { width, height });
        }
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [node.id, onSizeChange]);

  const handleAddRowAbove = useCallback(
    (rowIndex: number) => {
      if (onRowOp) onRowOp(node.id, 'insert', rowIndex);
      else saveData(addRow(tableData, rowIndex));
      menuCtrl.close();
    },
    [tableData, saveData, menuCtrl, onRowOp, node.id],
  );

  const handleAddRowBelow = useCallback(
    (rowIndex: number) => {
      if (onRowOp) onRowOp(node.id, 'insert', rowIndex + 1);
      else saveData(addRow(tableData, rowIndex + 1));
      menuCtrl.close();
    },
    [tableData, saveData, menuCtrl, onRowOp, node.id],
  );

  const handleAddColumnLeft = useCallback(
    (colIndex: number) => {
      if (onColOp) onColOp(node.id, 'insert', colIndex);
      else saveData(addColumn(tableData, colIndex));
      menuCtrl.close();
    },
    [tableData, saveData, menuCtrl, onColOp, node.id],
  );

  const handleAddColumnRight = useCallback(
    (colIndex: number) => {
      if (onColOp) onColOp(node.id, 'insert', colIndex + 1);
      else saveData(addColumn(tableData, colIndex + 1));
      menuCtrl.close();
    },
    [tableData, saveData, menuCtrl, onColOp, node.id],
  );

  const handleDeleteRow = useCallback(
    (rowIndex: number) => {
      if (onRowOp) onRowOp(node.id, 'delete', rowIndex);
      else saveData(deleteRow(tableData, rowIndex));
      menuCtrl.close();
    },
    [tableData, saveData, menuCtrl, onRowOp, node.id],
  );

  const handleDeleteColumn = useCallback(
    (colIndex: number) => {
      if (onColOp) onColOp(node.id, 'delete', colIndex);
      else saveData(deleteColumn(tableData, colIndex));
      menuCtrl.close();
    },
    [tableData, saveData, menuCtrl, onColOp, node.id],
  );

  const handleExpandTable = useCallback(() => {
    if (onRowOp && onColOp) {
      onRowOp(node.id, 'insert', tableData.rows.length);
      onColOp(node.id, 'insert', tableData.rows[0]?.length || 0);
    } else {
      let newData = addRow(tableData);
      newData = addColumn(newData);
      saveData(newData);
    }
    menuCtrl.close();
  }, [tableData, saveData, menuCtrl, onRowOp, onColOp, node.id]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, row: number, col: number) => {
      e.preventDefault();
      e.stopPropagation();

      const items: any[] = [];
      const rowCount = tableData.rows.length;
      const columnCount = tableData.rows[0]?.length ?? 0;
      const effRow = Math.max(0, row);
      const effCol = Math.max(0, col);

      items.push(
        {
          id: 'insert-row-above',
          label: t('canvas.menu.table.insertRowAbove', { default: 'Insert Row Above' }),
          action: () => handleAddRowAbove(effRow),
        },
        {
          id: 'insert-row-below',
          label: t('canvas.menu.table.insertRowBelow', { default: 'Insert Row Below' }),
          action: () => handleAddRowBelow(effRow),
        },
        {
          id: 'insert-col-left',
          label: t('canvas.menu.table.insertColLeft', { default: 'Insert Column Left' }),
          action: () => handleAddColumnLeft(effCol),
        },
        {
          id: 'insert-col-right',
          label: t('canvas.menu.table.insertColRight', { default: 'Insert Column Right' }),
          action: () => handleAddColumnRight(effCol),
        },
        { id: 'sep-1', label: '', separator: true, action: () => {} },
      );

      items.push({
        id: 'quick-add',
        label: t('canvas.menu.table.quickAdd', { default: 'Quick Add Rows/Cols' }),
        action: () => {
          handleExpandTable();
        },
      });
      items.push({ id: 'sep-2', label: '', separator: true, action: () => {} });
      if (onLockToggle) {
        items.push({
          id: 'toggle-pin',
          label: node.locked ? 'unpin' : 'pin',
          action: () => onLockToggle(node.id, !node.locked),
        });
      }

      items.push({ id: 'sep-3', label: '', separator: true, action: () => {} });
      if (rowCount > 0) {
        items.push({
          id: 'delete-row',
          label: t('canvas.menu.table.deleteRow', { default: 'Delete Row' }),
          danger: true,
          action: () => handleDeleteRow(effRow),
        });
      }
      if (columnCount > 0) {
        items.push({
          id: 'delete-col',
          label: t('canvas.menu.table.deleteColumn', { default: 'Delete Column' }),
          danger: true,
          action: () => handleDeleteColumn(effCol),
        });
      }

      menuCtrl.openAtMouseEvent(e, items, { row, col, nodeId: node.id });
    },
    [
      tableData.rows,
      handleAddRowAbove,
      handleAddRowBelow,
      handleAddColumnLeft,
      handleAddColumnRight,
      handleExpandTable,
      handleDeleteRow,
      handleDeleteColumn,
      onLockToggle,
      node.id,
      node.locked,
      menuCtrl,
      t,
    ],
  );

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <TableBlock
        data={tableData}
        onDataChange={saveData}
        onCellCommit={
          onCellCommit
            ? (row, col, value) => onCellCommit(node.id, row, col, value)
            : undefined
        }
        onRowOp={onRowOp ? (action, index) => onRowOp(node.id, action, index) : undefined}
        onColOp={onColOp ? (action, index) => onColOp(node.id, action, index) : undefined}
        onCellContextMenu={handleContextMenu}
        readOnly={!nodeSelected}
        nodeSelected={nodeSelected}
        fontStyle={fontStyle}
        tableStyles={tableStyles}
      />

      <UnifiedContextMenu state={menuCtrl.state as any} onClose={menuCtrl.close} />
    </div>
  );
};

export const TableNode = TableNodeComponent;
export default TableNode;
