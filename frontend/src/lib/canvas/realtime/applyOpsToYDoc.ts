import * as Y from 'yjs';
import type { CanvasConnection, CanvasNode } from '@/canvas/types/canvas';
import { CANVAS_PATCH_KEYS, normalizeCanvasOps } from './opsContract';

const ROOT_KEY = 'canvas';
const NODES_KEY = 'nodes';
const NODE_ORDER_KEY = 'nodeOrder';
const CONNECTIONS_KEY = 'connections';
const CONNECTION_ORDER_KEY = 'connectionOrder';
const CANVAS_PATCH_KEY_SET = new Set(CANVAS_PATCH_KEYS);

const cloneValue = <T>(value: T): T => {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // fallback to JSON path below
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

const objectToYMap = (input: Record<string, any> | undefined | null): Y.Map<any> => {
  const map = new Y.Map<any>();
  if (!input || typeof input !== 'object') {
    return map;
  }
  Object.entries(input).forEach(([key, value]) => {
    if (value === undefined) return;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      map.set(key, objectToYMap(value as Record<string, any>));
      return;
    }
    map.set(key, cloneValue(value));
  });
  return map;
};

const ensureMap = (root: Y.Map<any>, key: string): Y.Map<any> => {
  const existing = root.get(key);
  if (existing instanceof Y.Map) {
    return existing;
  }
  const next = new Y.Map<any>();
  root.set(key, next);
  return next;
};

const ensureArray = (root: Y.Map<any>, key: string): Y.Array<string> => {
  const existing = root.get(key);
  if (existing instanceof Y.Array) {
    return existing as Y.Array<string>;
  }
  const next = new Y.Array<string>();
  root.set(key, next);
  return next as Y.Array<string>;
};

const ensureIdInOrder = (order: Y.Array<string>, id: string) => {
  const ids = order.toArray();
  if (!ids.includes(id)) {
    order.push([id]);
  }
};

const removeIdFromOrder = (order: Y.Array<string>, id: string) => {
  const ids = order.toArray();
  const idx = ids.indexOf(id);
  if (idx !== -1) {
    order.delete(idx, 1);
  }
};

const filterCanvasPatch = (patch: Record<string, any>): Record<string, any> => {
  if (!patch || typeof patch !== 'object') return {};
  const next: Record<string, any> = {};
  Object.entries(patch).forEach(([key, value]) => {
    if (CANVAS_PATCH_KEY_SET.has(key)) {
      next[key] = value;
    }
  });
  return next;
};

const isPlainObject = (value: unknown): value is Record<string, any> => {
  return Object.prototype.toString.call(value) === '[object Object]';
};

const applyPatchToMap = (target: Y.Map<any>, patch?: Record<string, any> | null) => {
  if (!patch || typeof patch !== 'object') {
    return;
  }
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) {
      target.delete(key);
      return;
    }
    if (isPlainObject(value)) {
      const existing = target.get(key);
      if (existing instanceof Y.Map) {
        applyPatchToMap(existing, value as Record<string, any>);
        return;
      }
      const child = new Y.Map<any>();
      applyPatchToMap(child, value as Record<string, any>);
      target.set(key, child);
      return;
    }
    target.set(key, cloneValue(value));
  });
};

const findConnectionIdByEndpoints = (
  connectionsMap: Y.Map<any>,
  from?: string,
  to?: string,
): string | null => {
  if (!from || !to) return null;
  let found: string | null = null;
  connectionsMap.forEach((value, key) => {
    if (found) return;
    if (!(value instanceof Y.Map)) return;
    const fromId = value.get('from');
    const toId = value.get('to');
    if (fromId === from && toId === to) {
      found = String(key);
    }
  });
  return found;
};

const toPlainData = (raw: unknown): Record<string, any> | null => {
  if (raw instanceof Y.Map) return raw.toJSON() as Record<string, any>;
  if (raw && typeof raw === 'object') return cloneValue(raw as Record<string, any>);
  return null;
};

const isLockedY = (m: unknown): boolean => m instanceof Y.Map && m.get('locked') === true;

export const applyOpsToYDoc = (
  doc: Y.Doc,
  operations: any[],
  now: number = Date.now(),
): void => {
  if (!doc || !Array.isArray(operations) || operations.length === 0) {
    return;
  }
  const root = doc.getMap(ROOT_KEY);
  const nodesMap = ensureMap(root, NODES_KEY);
  const nodeOrder = ensureArray(root, NODE_ORDER_KEY);
  const connectionsMap = ensureMap(root, CONNECTIONS_KEY);
  const connectionOrder = ensureArray(root, CONNECTION_ORDER_KEY);
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const { operations: normalizedOps } = normalizeCanvasOps(
    operations.map((op) => cloneValue(op)),
  );

  const removeConnection = (id: string) => {
    if (!id) return;
    if (connectionsMap.has(id)) {
      connectionsMap.delete(id);
    }
    removeIdFromOrder(connectionOrder, id);
  };

  const removeNode = (id: string) => {
    if (!id) return;
    if (nodesMap.has(id)) {
      nodesMap.delete(id);
    }
    removeIdFromOrder(nodeOrder, id);
    const toDelete: string[] = [];
    connectionsMap.forEach((value, key) => {
      if (!(value instanceof Y.Map)) return;
      const fromId = value.get('from');
      const toId = value.get('to');
      if (fromId === id || toId === id) {
        toDelete.push(String(key));
      }
    });
    toDelete.forEach((connId) => removeConnection(connId));
  };

  normalizedOps.forEach((op) => {
    if (!op || typeof op !== 'object') return;
    const kind = op.op;
    if (kind === 'add_node') {
      const node: CanvasNode = op.node || {};
      const id = node.id;
      if (!id) return;
      const payload = {
        ...node,
        createdAt: node.createdAt ?? nowMs,
        updatedAt: node.updatedAt ?? nowMs,
      } as CanvasNode;
      nodesMap.set(id, objectToYMap(payload as any));
      ensureIdInOrder(nodeOrder, id);
      return;
    }

    if (kind === 'update_node' || kind === 'apply_style') {
      const id = op.id;
      if (!id) return;
      const patch = op.patch || {};
      const existing = nodesMap.get(id);
      if (!(existing instanceof Y.Map)) return;
      applyPatchToMap(existing, patch);
      existing.set('updatedAt', nowMs);
      return;
    }

    if (kind === 'move_node') {
      const id = op.id;
      if (!id) return;
      const existing = nodesMap.get(id);
      if (!(existing instanceof Y.Map)) return;
      if (typeof op.x === 'number') existing.set('x', op.x);
      if (typeof op.y === 'number') existing.set('y', op.y);
      existing.set('updatedAt', nowMs);
      return;
    }

    if (kind === 'delete_node') {
      removeNode(op.id);
      return;
    }

    if (kind === 'add_connection') {
      const id = op.id;
      if (!id) return;
      const payload: CanvasConnection = {
        id,
        from: op.from,
        to: op.to,
        fromPoint: op.fromPoint,
        toPoint: op.toPoint,
        label: op.label,
        curveAnchor: op.curveAnchor,
        anchorParams: op.anchorParams,
        curveMode: op.curveMode,
        tension: op.tension,
        style: op.style,
        dashed: op.dashed,
        createdAt: op.createdAt ?? nowMs,
        updatedAt: op.updatedAt ?? nowMs,
      } as CanvasConnection;
      connectionsMap.set(id, objectToYMap(payload as any));
      ensureIdInOrder(connectionOrder, id);
      return;
    }

    if (kind === 'update_connection') {
      let id = op.id;
      if (!id) {
        id = findConnectionIdByEndpoints(connectionsMap, op.from, op.to) || undefined;
      }
      if (!id) return;
      const existing = connectionsMap.get(id);
      if (!(existing instanceof Y.Map)) return;
      const patch = op.patch || {};
      applyPatchToMap(existing, patch);
      existing.set('updatedAt', nowMs);
      return;
    }

    if (kind === 'delete_connection') {
      removeConnection(op.id);
      return;
    }

    if (kind === 'update_canvas') {
      const patch = filterCanvasPatch(op.patch || {});
      if (!Object.keys(patch).length) return;
      applyPatchToMap(root, patch);
      return;
    }

    if (kind === 'relayout_mindmap') {
      const id = op.id || op.group_id;
      if (!id) return;
      const existing = nodesMap.get(id);
      if (!(existing instanceof Y.Map)) return;
      const patch = op.patch || {};
      applyPatchToMap(existing, patch);
      existing.set('updatedAt', nowMs);
      return;
    }

    if (kind === 'update_table_cell') {
      const id = op.id;
      if (!id) return;
      const existing = nodesMap.get(id);
      if (!(existing instanceof Y.Map)) return;
      if (isLockedY(existing)) return;
      const row = Number(op.row);
      const col = Number(op.col);
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) return;
      const data = toPlainData(existing.get('data'));
      const rows = data && Array.isArray(data.rows) ? data.rows : null;
      if (!rows || row >= rows.length || !Array.isArray(rows[row]) || col >= rows[row].length) {
        return;
      }
      rows[row][col] = op.value == null ? '' : String(op.value);
      existing.set('data', data);
      existing.set('updatedAt', nowMs);
      return;
    }

    if (kind === 'table_row_op' || kind === 'table_col_op') {
      const id = op.id;
      if (!id) return;
      const existing = nodesMap.get(id);
      if (!(existing instanceof Y.Map)) return;
      if (isLockedY(existing)) return;
      const action = op.action;
      if (action !== 'insert' && action !== 'delete') return;
      const data = toPlainData(existing.get('data'));
      const rows = data && Array.isArray(data.rows) ? data.rows : null;
      if (!rows) return;
      const index = Number(op.index);
      if (!Number.isInteger(index) || index < 0) return;
      if (kind === 'table_row_op') {
        const colCount = rows.length
          ? rows[0].length
          : Array.isArray(op.rowData)
            ? op.rowData.length
            : 0;
        if (action === 'insert') {
          if (index > rows.length) return;
          const wasEmpty = rows.length === 0;
          const newRow = Array.from({ length: colCount }, (_, i) => {
            const v = Array.isArray(op.rowData) ? op.rowData[i] : undefined;
            return v == null ? '' : String(v);
          });
          rows.splice(index, 0, newRow);
          if (Array.isArray(data.rowHeights)) {
            data.rowHeights.splice(index, 0, data.rowHeights[0] ?? 40);
          }
          if (wasEmpty && Array.isArray(data.columnWidths)) {
            while (data.columnWidths.length < newRow.length) data.columnWidths.push(160);
          }
        } else {
          if (index >= rows.length) return;
          rows.splice(index, 1);
          if (Array.isArray(data.rowHeights)) data.rowHeights.splice(index, 1);
        }
      } else {
        const colCount = rows.length ? rows[0].length : 0;
        if (action === 'insert') {
          if (rows.length === 0) return;
          if (index > colCount) return;
          const header = op.header == null ? '' : String(op.header);
          rows.forEach((r: any, i: number) => {
            if (Array.isArray(r)) r.splice(index, 0, i === 0 ? header : '');
          });
          if (Array.isArray(data.columnWidths)) {
            data.columnWidths.splice(index, 0, data.columnWidths[0] ?? 160);
          }
        } else {
          if (index >= colCount) return;
          rows.forEach((r: any) => {
            if (Array.isArray(r)) r.splice(index, 1);
          });
          if (Array.isArray(data.columnWidths)) data.columnWidths.splice(index, 1);
        }
      }
      existing.set('data', data);
      existing.set('updatedAt', nowMs);
      return;
    }
  });

  root.set('updatedAt', nowMs);
};
