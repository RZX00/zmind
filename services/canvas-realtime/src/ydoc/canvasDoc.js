import * as Y from "yjs";
import { CANVAS_PATCH_KEYS } from "../ops/contract.js";
import { reconcileContainment } from "../ops/containment.js";
import { parseTableContentPayload } from "../ops/applyCanvasOps.js";

const VALID_CONN_STYLE = new Set(["line", "arrow"]);
const VALID_CURVE_MODE = new Set(["auto", "tension", "manual", "orthogonal"]);
const clamp01 = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n < 0 ? 0 : n > 1 ? 1 : n;
};

// Produce the SAME result an applyCanvasOps update_connection would (snapshot path),
// but leniently — drop invalid fields instead of throwing, and signal a relation clear
// with `undefined` (applyPatchToMap deletes undefined keys). Keeps the live Y.Doc and
// the persisted snapshot in agreement on connection appearance/slots.
const sanitizeConnectionPatch = (patch) => {
  const out = {};
  if (!patch || typeof patch !== "object") return out;
  if ("label" in patch) out.label = patch.label;
  if ("style" in patch && VALID_CONN_STYLE.has(patch.style)) out.style = patch.style;
  if ("dashed" in patch && typeof patch.dashed === "boolean") out.dashed = patch.dashed;
  if (patch.curveAnchor && typeof patch.curveAnchor === "object") {
    const x = Number(patch.curveAnchor.x);
    const y = Number(patch.curveAnchor.y);
    if (Number.isFinite(x) && Number.isFinite(y)) out.curveAnchor = { x, y };
  }
  if (patch.anchorParams && typeof patch.anchorParams === "object") {
    const u = Number(patch.anchorParams.u);
    const v = Number(patch.anchorParams.v);
    if (Number.isFinite(u) && Number.isFinite(v)) out.anchorParams = { u, v };
  }
  if ("curveMode" in patch && VALID_CURVE_MODE.has(patch.curveMode)) out.curveMode = patch.curveMode;
  if ("tension" in patch) {
    const t = clamp01(patch.tension);
    if (t != null) out.tension = t;
  }
  if ("relation" in patch) out.relation = patch.relation == null ? undefined : String(patch.relation);
  if ("directed" in patch && typeof patch.directed === "boolean") out.directed = patch.directed;
  if ("relationData" in patch && patch.relationData && typeof patch.relationData === "object") {
    out.relationData = patch.relationData;
  }
  // Endpoint switch mirrors applyCanvasOps: set the chosen end and DELETE the opposite
  // (undefined => applyPatchToMap deletes the key), so a node<->point switch never leaves
  // a stale fromPoint/from behind in the live doc.
  if ("from" in patch || "fromPoint" in patch) {
    if (patch.from) {
      out.from = patch.from;
      out.fromPoint = undefined;
    } else if (patch.fromPoint && typeof patch.fromPoint === "object") {
      const x = Number(patch.fromPoint.x);
      const y = Number(patch.fromPoint.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        out.fromPoint = { x, y };
        out.from = undefined;
      }
    }
  }
  if ("to" in patch || "toPoint" in patch) {
    if (patch.to) {
      out.to = patch.to;
      out.toPoint = undefined;
    } else if (patch.toPoint && typeof patch.toPoint === "object") {
      const x = Number(patch.toPoint.x);
      const y = Number(patch.toPoint.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        out.toPoint = { x, y };
        out.to = undefined;
      }
    }
  }
  return out;
};

const ROOT_KEY = "canvas";
const NODES_KEY = "nodes";
const NODE_ORDER_KEY = "nodeOrder";
const CONNECTIONS_KEY = "connections";
const CONNECTION_ORDER_KEY = "connectionOrder";
const CANVAS_PATCH_KEY_SET = new Set(CANVAS_PATCH_KEYS);

const cloneValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return JSON.parse(JSON.stringify(value));
  }
  return value;
};

const objectToYMap = (input) => {
  const map = new Y.Map();
  if (!input || typeof input !== "object") {
    return map;
  }
  Object.entries(input).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }
    map.set(key, cloneValue(value));
  });
  return map;
};

const objectToYMapDeep = (input) => {
  const map = new Y.Map();
  if (!input || typeof input !== "object") {
    return map;
  }
  Object.entries(input).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      map.set(key, objectToYMapDeep(value));
      return;
    }
    map.set(key, cloneValue(value));
  });
  return map;
};

// Read a node's `data` as a plain mutable object regardless of how it was stored
// (Y.Map via add_node's deep convert, or a plain object via the shallow seed path).
const toPlainData = (raw) => {
  if (raw instanceof Y.Map) return raw.toJSON();
  if (raw && typeof raw === "object") return JSON.parse(JSON.stringify(raw));
  return null;
};

const ensureMap = (root, key) => {
  const existing = root.get(key);
  if (existing instanceof Y.Map) {
    return existing;
  }
  const next = new Y.Map();
  root.set(key, next);
  return next;
};

const ensureArray = (root, key) => {
  const existing = root.get(key);
  if (existing instanceof Y.Array) {
    return existing;
  }
  const next = new Y.Array();
  root.set(key, next);
  return next;
};

const ensureIdInOrder = (order, id) => {
  const ids = order.toArray();
  if (!ids.includes(id)) {
    order.push([id]);
  }
};

const removeIdFromOrder = (order, id) => {
  const ids = order.toArray();
  const idx = ids.indexOf(id);
  if (idx !== -1) {
    order.delete(idx, 1);
  }
};

const filterCanvasPatch = (patch) => {
  if (!patch || typeof patch !== "object") {
    return {};
  }
  const next = {};
  Object.entries(patch).forEach(([key, value]) => {
    if (CANVAS_PATCH_KEY_SET.has(key)) {
      next[key] = value;
    }
  });
  return next;
};

const applyPatchToMap = (target, patch) => {
  if (!patch || typeof patch !== "object") {
    return;
  }
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) {
      target.delete(key);
      return;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const existing = target.get(key);
      if (existing instanceof Y.Map) {
        applyPatchToMap(existing, value);
        return;
      }
      const child = new Y.Map();
      applyPatchToMap(child, value);
      target.set(key, child);
      return;
    }
    target.set(key, cloneValue(value));
  });
};

const findConnectionIdByEndpoints = (connectionsMap, from, to) => {
  if (!from || !to) return null;
  let found = null;
  connectionsMap.forEach((value, key) => {
    if (found) return;
    if (!(value instanceof Y.Map)) return;
    const fromId = value.get("from");
    const toId = value.get("to");
    if (fromId === from && toId === to) {
      found = String(key);
    }
  });
  return found;
};

const yMapToObject = (yMap) => {
  if (!(yMap instanceof Y.Map)) {
    return yMap;
  }
  const result = {};
  yMap.forEach((value, key) => {
    if (value instanceof Y.Map) {
      result[key] = yMapToObject(value);
    } else if (value instanceof Y.Array) {
      result[key] = value.toArray().map((entry) =>
        entry instanceof Y.Map ? yMapToObject(entry) : entry,
      );
    } else {
      result[key] = value;
    }
  });
  return result;
};

const buildIdOrderArray = (items = []) => {
  const arr = new Y.Array();
  const ids = items
    .map((item) => item?.id)
    .filter((id) => typeof id === "string" && id.length);
  if (ids.length) {
    arr.push(ids);
  }
  return arr;
};

const buildEntryMap = (items = []) => {
  const map = new Y.Map();
  items.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const id = item.id;
    if (!id) {
      return;
    }
    map.set(id, objectToYMap(item));
  });
  return map;
};

const writeScalarFields = (root, canvasDoc) => {
  const skipKeys = new Set([
    NODES_KEY,
    CONNECTIONS_KEY,
    NODE_ORDER_KEY,
    CONNECTION_ORDER_KEY,
  ]);
  Object.entries(canvasDoc ?? {}).forEach(([key, value]) => {
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

export const createYDocFromCanvas = (canvasDoc) => {
  const doc = new Y.Doc();
  const root = doc.getMap(ROOT_KEY);
  writeScalarFields(root, canvasDoc);

  root.set(NODE_ORDER_KEY, buildIdOrderArray(canvasDoc?.nodes));
  root.set(CONNECTION_ORDER_KEY, buildIdOrderArray(canvasDoc?.connections));
  root.set(NODES_KEY, buildEntryMap(canvasDoc?.nodes));
  root.set(CONNECTIONS_KEY, buildEntryMap(canvasDoc?.connections));

  return doc;
};

export const updateDocFromCanvas = (doc, canvasDoc) => {
  const root = doc.getMap(ROOT_KEY);
  writeScalarFields(root, canvasDoc);
  root.set(NODE_ORDER_KEY, buildIdOrderArray(canvasDoc?.nodes));
  root.set(CONNECTION_ORDER_KEY, buildIdOrderArray(canvasDoc?.connections));
  root.set(NODES_KEY, buildEntryMap(canvasDoc?.nodes));
  root.set(CONNECTIONS_KEY, buildEntryMap(canvasDoc?.connections));
};

export const applyOpsToYDoc = (doc, operations, now = Date.now()) => {
  if (!doc || !Array.isArray(operations) || operations.length === 0) {
    return;
  }
  const root = doc.getMap(ROOT_KEY);
  const nodesMap = ensureMap(root, NODES_KEY);
  const nodeOrder = ensureArray(root, NODE_ORDER_KEY);
  const connectionsMap = ensureMap(root, CONNECTIONS_KEY);
  const connectionOrder = ensureArray(root, CONNECTION_ORDER_KEY);
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();

  const removeConnection = (id) => {
    if (!id) return;
    if (connectionsMap.has(id)) {
      connectionsMap.delete(id);
    }
    removeIdFromOrder(connectionOrder, id);
  };

  const removeNode = (id) => {
    if (!id) return;
    if (nodesMap.has(id)) {
      nodesMap.delete(id);
    }
    removeIdFromOrder(nodeOrder, id);
    const toDelete = [];
    connectionsMap.forEach((value, key) => {
      if (!(value instanceof Y.Map)) return;
      const fromId = value.get("from");
      const toId = value.get("to");
      if (fromId === id || toId === id) {
        toDelete.push(String(key));
      }
    });
    toDelete.forEach((connId) => removeConnection(connId));
  };

  // NODE_LOCKED: in prod applyCanvasOps runs first and throws on a locked node (422), so the
  // live path never sees it; this lenient skip keeps standalone behavior consistent.
  const isLockedY = (m) => m instanceof Y.Map && m.get("locked") === true;

  // MV1: shift every descendant of a container by (dx, dy), via parentGroupId, in the Y.Doc.
  const moveSubtreeY = (containerId, dx, dy) => {
    const seen = new Set([containerId]);
    const stack = [containerId];
    while (stack.length) {
      const pid = stack.pop();
      nodesMap.forEach((m) => {
        if (!(m instanceof Y.Map) || m.get("parentGroupId") !== pid) return;
        const cid = m.get("id");
        if (seen.has(cid)) return;
        seen.add(cid);
        m.set("x", (Number(m.get("x")) || 0) + dx);
        m.set("y", (Number(m.get("y")) || 0) + dy);
        m.set("updatedAt", nowMs);
        stack.push(cid);
      });
    }
  };

  operations.forEach((op) => {
    if (!op || typeof op !== "object") return;
    const kind = op.op;
    if (kind === "add_node") {
      const node = op.node || {};
      const id = node.id || op.id;
      if (!id) return;
      const payload = {
        ...node,
        id,
        createdAt: node.createdAt ?? nowMs,
        updatedAt: node.updatedAt ?? nowMs,
      };
      nodesMap.set(id, objectToYMapDeep(payload));
      ensureIdInOrder(nodeOrder, id);
      return;
    }

    if (kind === "update_node" || kind === "apply_style") {
      const id = op.id;
      if (!id) return;
      const existing = nodesMap.get(id);
      if (!(existing instanceof Y.Map)) return;
      if (isLockedY(existing)) return;
      const patch = { ...(op.patch || {}) };
      const ntype = existing.get("type");
      // Mirror applyCanvasOps: group/column title -> content fold.
      if ((ntype === "group" || ntype === "column") && patch.title && patch.content == null) {
        patch.content = String(patch.title);
      }
      // Mirror applyCanvasOps: a table whose content is a JSON rows payload becomes data.
      if (ntype === "table") {
        const parsed = parseTableContentPayload(patch.content);
        if (parsed) {
          patch.data = parsed;
          patch.content = "";
        }
      }
      applyPatchToMap(existing, patch);
      existing.set("updatedAt", nowMs);
      return;
    }

    if (kind === "move_node") {
      const id = op.id;
      if (!id) return;
      const existing = nodesMap.get(id);
      if (!(existing instanceof Y.Map)) return;
      if (isLockedY(existing)) return;
      // Coerce to finite numbers (match applyCanvasOps), so a string/NaN coord can't
      // diverge between snapshot and live.
      const oldX = Number(existing.get("x")) || 0;
      const oldY = Number(existing.get("y")) || 0;
      if ("x" in op) {
        const x = Number(op.x);
        if (Number.isFinite(x)) existing.set("x", x);
      }
      if ("y" in op) {
        const y = Number(op.y);
        if (Number.isFinite(y)) existing.set("y", y);
      }
      const dx = (Number(existing.get("x")) || 0) - oldX;
      const dy = (Number(existing.get("y")) || 0) - oldY;
      const ntype = existing.get("type");
      // MV1: moving a container drags its subtree by the same delta (parity with snapshot).
      if ((dx || dy) && (ntype === "group" || ntype === "column")) {
        moveSubtreeY(id, dx, dy);
      }
      existing.set("updatedAt", nowMs);
      return;
    }

    if (kind === "delete_node") {
      if (isLockedY(nodesMap.get(op.id))) return;
      removeNode(op.id);
      return;
    }

    if (kind === "add_connection") {
      const id = op.id;
      if (!id) return;
      const payload = {
        id,
        from: op.from,
        to: op.to,
        fromPoint: op.fromPoint,
        toPoint: op.toPoint,
        label: op.label,
        // Typed-edge slots (WS5-1) + provenance (WS5-5) — carried through Yjs persistence.
        // objectToYMapDeep skips undefined, so absent slots persist nothing (back-compat).
        relation: op.relation,
        directed: op.directed,
        relationData: op.relationData,
        provenance: op.provenance,
        curveAnchor: op.curveAnchor,
        anchorParams: op.anchorParams,
        curveMode: op.curveMode,
        tension: op.tension,
        style: op.style,
        dashed: op.dashed,
        createdAt: op.createdAt ?? nowMs,
        updatedAt: op.updatedAt ?? nowMs,
      };
      connectionsMap.set(id, objectToYMapDeep(payload));
      ensureIdInOrder(connectionOrder, id);
      return;
    }

    if (kind === "update_connection") {
      let id = op.id;
      if (!id) {
        id = findConnectionIdByEndpoints(connectionsMap, op.from, op.to) || undefined;
      }
      if (!id) return;
      const existing = connectionsMap.get(id);
      if (!(existing instanceof Y.Map)) return;
      applyPatchToMap(existing, sanitizeConnectionPatch(op.patch || {}));
      existing.set("updatedAt", nowMs);
      return;
    }

    if (kind === "delete_connection") {
      removeConnection(op.id);
      return;
    }

    if (kind === "update_canvas") {
      const patch = filterCanvasPatch(op.patch || {});
      if (!Object.keys(patch).length) return;
      applyPatchToMap(root, patch);
      return;
    }

    if (kind === "set_collapsed") {
      const id = op.id;
      if (!id) return;
      const existing = nodesMap.get(id);
      if (!(existing instanceof Y.Map)) return;
      existing.set("isCollapsed", op.collapsed === undefined ? true : Boolean(op.collapsed));
      existing.set("updatedAt", nowMs);
      return;
    }

    if (kind === "update_table_cell") {
      const id = op.id;
      if (!id) return;
      const existing = nodesMap.get(id);
      if (!(existing instanceof Y.Map)) return;
      if (isLockedY(existing)) return;
      const row = Number(op.row);
      const col = Number(op.col);
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) return;
      const data = toPlainData(existing.get("data"));
      const rows = data && Array.isArray(data.rows) ? data.rows : null;
      if (!rows || row >= rows.length || !Array.isArray(rows[row]) || col >= rows[row].length) return;
      rows[row][col] = op.value == null ? "" : String(op.value);
      existing.set("data", data);
      existing.set("updatedAt", nowMs);
      return;
    }

    if (kind === "table_row_op" || kind === "table_col_op") {
      const id = op.id;
      if (!id) return;
      const existing = nodesMap.get(id);
      if (!(existing instanceof Y.Map)) return;
      if (isLockedY(existing)) return;
      const action = op.action;
      if (action !== "insert" && action !== "delete") return;
      const data = toPlainData(existing.get("data"));
      const rows = data && Array.isArray(data.rows) ? data.rows : null;
      if (!rows) return;
      const index = Number(op.index);
      if (!Number.isInteger(index) || index < 0) return;
      if (kind === "table_row_op") {
        const colCount = rows.length ? rows[0].length : Array.isArray(op.rowData) ? op.rowData.length : 0;
        if (action === "insert") {
          if (index > rows.length) return;
          const wasEmpty = rows.length === 0;
          // Normalize to colCount (pad/truncate) so an insert never makes the table ragged.
          const newRow = Array.from({ length: colCount }, (_, i) => {
            const v = Array.isArray(op.rowData) ? op.rowData[i] : undefined;
            return v == null ? "" : String(v);
          });
          rows.splice(index, 0, newRow);
          if (Array.isArray(data.rowHeights)) data.rowHeights.splice(index, 0, data.rowHeights[0] ?? 40);
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
        if (action === "insert") {
          if (rows.length === 0) return; // never add a width without a real column
          if (index > colCount) return;
          const header = op.header == null ? "" : String(op.header);
          rows.forEach((r, i) => {
            if (Array.isArray(r)) r.splice(index, 0, i === 0 ? header : "");
          });
          if (Array.isArray(data.columnWidths)) data.columnWidths.splice(index, 0, data.columnWidths[0] ?? 160);
        } else {
          if (index >= colCount) return;
          rows.forEach((r) => {
            if (Array.isArray(r)) r.splice(index, 1);
          });
          if (Array.isArray(data.columnWidths)) data.columnWidths.splice(index, 1);
        }
      }
      existing.set("data", data);
      existing.set("updatedAt", nowMs);
      return;
    }

    if (kind === "group_nodes") {
      const ids = Array.isArray(op.ids) ? op.ids.filter((x) => typeof x === "string") : [];
      if (!ids.length) return;
      const groupId = op.id; // resolved server-side id, propagated onto the op by applyCanvasOps
      if (!groupId) return;
      const members = [];
      for (const mid of ids) {
        const m = nodesMap.get(mid);
        if (!(m instanceof Y.Map)) return;
        if (m.get("type") === "group") return; // mirror applyCanvasOps: cannot nest a group
        members.push(m);
      }
      const coord = (m, key) => Number(m.get(key)) || 0;
      const minX = Math.min(...members.map((m) => coord(m, "x")));
      const minY = Math.min(...members.map((m) => coord(m, "y")));
      const maxRight = Math.max(...members.map((m) => coord(m, "x") + coord(m, "width")));
      const maxBottom = Math.max(...members.map((m) => coord(m, "y") + coord(m, "height")));
      members.forEach((m, i) => {
        const prevId = m.get("parentGroupId");
        if (prevId && prevId !== groupId) {
          const prev = nodesMap.get(prevId);
          if (prev instanceof Y.Map) {
            const ch = prev.get("children");
            if (Array.isArray(ch)) prev.set("children", ch.filter((c) => c !== ids[i]));
          }
        }
        m.set("parentGroupId", groupId);
        m.set("updatedAt", nowMs);
      });
      nodesMap.set(
        groupId,
        objectToYMapDeep({
          id: groupId,
          type: "group",
          x: minX,
          y: minY,
          width: maxRight - minX,
          height: maxBottom - minY,
          content: typeof op.content === "string" ? op.content : "",
          children: ids.slice(),
          groupMode: op.mode === "mindmap" ? "mindmap" : "normal",
          createdAt: nowMs,
          updatedAt: nowMs,
        }),
      );
      ensureIdInOrder(nodeOrder, groupId);
      return;
    }

    if (kind === "ungroup") {
      const groupId = op.id || op.group_id;
      if (!groupId) return;
      const group = nodesMap.get(groupId);
      if (!(group instanceof Y.Map) || group.get("type") !== "group") return;
      nodesMap.forEach((value) => {
        if (!(value instanceof Y.Map)) return;
        if (value.get("parentGroupId") === groupId) {
          value.delete("parentGroupId");
          value.set("updatedAt", nowMs);
        }
        const ch = value.get("children");
        if (Array.isArray(ch) && ch.includes(groupId)) {
          value.set("children", ch.filter((c) => c !== groupId));
        }
      });
      // Mirror applyCanvasOps: remove only the group node (no connection cascade).
      if (nodesMap.has(groupId)) nodesMap.delete(groupId);
      removeIdFromOrder(nodeOrder, groupId);
      return;
    }

    if (kind === "relayout_mindmap") {
      const id = op.id || op.group_id;
      if (!id) return;
      const existing = nodesMap.get(id);
      if (!(existing instanceof Y.Map)) return;
      const patch = op.patch || {};
      // Mirror applyCanvasOps: set groupMode (enum), and MERGE mindmap config key-wise
      // into the existing object — never replace it (which would drop rootId/dir).
      if ("groupMode" in patch && [null, "mindmap", "normal"].includes(patch.groupMode)) {
        existing.set("groupMode", patch.groupMode);
      }
      if (patch.mindmap && typeof patch.mindmap === "object") {
        const merged = { ...(toPlainData(existing.get("mindmap")) || {}), ...patch.mindmap };
        existing.set("mindmap", merged);
      }
      existing.set("updatedAt", nowMs);
      return;
    }
  });

  // Containment reconcile (WS5-3) — shared with applyCanvasOps so the live Y.Doc
  // converges on the same parentGroupId<->children invariant as the persisted snapshot.
  const view = [];
  nodesMap.forEach((v, key) => {
    if (!(v instanceof Y.Map)) return;
    view.push({
      id: String(key),
      children: Array.isArray(v.get("children")) ? v.get("children").slice() : undefined,
      parentGroupId: v.has("parentGroupId") ? v.get("parentGroupId") : undefined,
      _y: v,
    });
  });
  reconcileContainment(view);
  for (const p of view) {
    if (p.parentGroupId == null) {
      if (p._y.has("parentGroupId")) p._y.delete("parentGroupId");
    } else if (p._y.get("parentGroupId") !== p.parentGroupId) {
      p._y.set("parentGroupId", p.parentGroupId);
    }
    if (Array.isArray(p.children)) {
      const cur = p._y.get("children");
      if (!Array.isArray(cur) || JSON.stringify(cur) !== JSON.stringify(p.children)) {
        p._y.set("children", p.children);
      }
    }
  }

  root.set("updatedAt", nowMs);
};

const resolveOrder = (yMap, order) => {
  if (!(yMap instanceof Y.Map)) {
    return [];
  }
  const seen = new Set();
  const sequence =
    order instanceof Y.Array ? order.toArray().filter((id) => typeof id === "string") : [];
  const result = [];

  sequence.forEach((id) => {
    if (seen.has(id)) {
      return;
    }
    const entry = yMap.get(id);
    if (entry) {
      result.push(yMapToObject(entry));
      seen.add(id);
    }
  });

  yMap.forEach((value, key) => {
    if (seen.has(key)) {
      return;
    }
    result.push(yMapToObject(value));
  });

  return result;
};

export const exportCanvasFromDocument = (document) => {
  const root = document.getMap(ROOT_KEY);
  const result = {};
  root.forEach((value, key) => {
    if (
      key === NODES_KEY ||
      key === CONNECTIONS_KEY ||
      key === NODE_ORDER_KEY ||
      key === CONNECTION_ORDER_KEY
    ) {
      return;
    }
    result[key] = value;
  });
  const nodesMap = root.get(NODES_KEY);
  const connectionsMap = root.get(CONNECTIONS_KEY);
  const nodeOrder = root.get(NODE_ORDER_KEY);
  const connectionOrder = root.get(CONNECTION_ORDER_KEY);
  result.nodes = resolveOrder(nodesMap, nodeOrder);
  result.connections = resolveOrder(connectionsMap, connectionOrder);
  return result;
};
