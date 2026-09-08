import * as Y from 'yjs';
import type { Canvas, CanvasConnection, CanvasNode } from '@/canvas/types/canvas';

const ROOT_KEY = "canvas";
const NODES_KEY = "nodes";
const NODE_ORDER_KEY = "nodeOrder";
const CONNECTIONS_KEY = "connections";
const CONNECTION_ORDER_KEY = "connectionOrder";

const cloneValue = <T>(value: T): T => {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof structuredClone === "function") {
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

const yMapToObject = (entry: any): any => {
  if (entry instanceof Y.Map) {
    const obj: Record<string, any> = {};
    entry.forEach((val, key) => {
      obj[key] = yMapToObject(val);
    });
    return obj;
  }
  if (entry instanceof Y.Array) {
    return entry.toArray().map((item) => yMapToObject(item));
  }
  return entry;
};

const buildOrderArray = (items: { id?: string }[] = []): Y.Array<string> => {
  const arr = new Y.Array<string>();
  const ids = items
    .map((item) => item?.id)
    .filter((id): id is string => typeof id === "string" && !!id);
  if (ids.length) {
    arr.push(ids);
  }
  return arr;
};

const buildEntryMap = <T extends { id?: string }>(items: T[] = []): Y.Map<any> => {
  const map = new Y.Map<any>();
  items.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const id = item.id;
    if (!id) {
      return;
    }
    map.set(id, objectToYMap(item as Record<string, any>));
  });
  return map;
};

const writeScalarFields = (root: Y.Map<any>, canvas: Canvas) => {
  const skipKeys = new Set([NODES_KEY, NODE_ORDER_KEY, CONNECTIONS_KEY, CONNECTION_ORDER_KEY]);
  const nextEntries = Object.entries(canvas ?? {});
  nextEntries.forEach(([key, value]) => {
    if (skipKeys.has(key)) {
      return;
    }
    if (value === undefined) {
      if (root.has(key)) {
        root.delete(key);
      }
      return;
    }
    root.set(key, cloneValue(value));
  });
};

export const createYDocFromCanvas = (canvas: Canvas): Y.Doc => {
  const doc = new Y.Doc();
  const root = doc.getMap(ROOT_KEY);
  writeScalarFields(root, canvas);
  root.set(NODES_KEY, buildEntryMap(canvas?.nodes || []));
  root.set(NODE_ORDER_KEY, buildOrderArray(canvas?.nodes || []));
  root.set(CONNECTIONS_KEY, buildEntryMap(canvas?.connections || []));
  root.set(CONNECTION_ORDER_KEY, buildOrderArray(canvas?.connections || []));
  return doc;
};

export const updateDocFromCanvas = (doc: Y.Doc, canvas: Canvas): void => {
  const root = doc.getMap(ROOT_KEY);
  writeScalarFields(root, canvas);
  root.set(NODES_KEY, buildEntryMap(canvas?.nodes || []));
  root.set(NODE_ORDER_KEY, buildOrderArray(canvas?.nodes || []));
  root.set(CONNECTIONS_KEY, buildEntryMap(canvas?.connections || []));
  root.set(CONNECTION_ORDER_KEY, buildOrderArray(canvas?.connections || []));
};

const resolveOrderedEntries = (
  map: Y.Map<any> | undefined,
  order: Y.Array<string> | undefined,
): any[] => {
  if (!(map instanceof Y.Map)) {
    return [];
  }
  const result: any[] = [];
  const seen = new Set<string>();
  if (order instanceof Y.Array) {
    order.toArray().forEach((id) => {
      const value = map.get(id);
      if (value) {
        result.push(yMapToObject(value));
        seen.add(id);
      }
    });
  }
  map.forEach((value, key) => {
    if (!seen.has(key)) {
      result.push(yMapToObject(value));
    }
  });
  return result;
};

export const exportCanvasFromDocument = (document: Y.Doc): Canvas => {
  const root = document.getMap(ROOT_KEY);
  const payload: Partial<Canvas> = {};
  root.forEach((value, key) => {
    if (
      key === NODES_KEY ||
      key === CONNECTIONS_KEY ||
      key === NODE_ORDER_KEY ||
      key === CONNECTION_ORDER_KEY
    ) {
      return;
    }
    (payload as any)[key] = yMapToObject(value);
  });

  const nodesMap = root.get(NODES_KEY) as Y.Map<any> | undefined;
  const nodeOrder = root.get(NODE_ORDER_KEY) as Y.Array<string> | undefined;
  const connectionsMap = root.get(CONNECTIONS_KEY) as Y.Map<any> | undefined;
  const connectionOrder = root.get(CONNECTION_ORDER_KEY) as Y.Array<string> | undefined;

  payload.nodes = resolveOrderedEntries(nodesMap, nodeOrder) as CanvasNode[];
  payload.connections = resolveOrderedEntries(connectionsMap, connectionOrder) as CanvasConnection[];

  return payload as Canvas;
};
