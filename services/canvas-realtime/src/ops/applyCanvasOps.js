import { extractStoragePathFromUrl } from "../utils/mediaPath.js";
import { ALLOWED_OPS, OP_ALIASES, CANVAS_PATCH_KEYS } from "./contract.js";
import { makeCanvasError } from "./errors.js";
import { reconcileContainment } from "./containment.js";

// Upper bound on ops per /apply batch (WS4 BATCH_TOO_LARGE). Beyond this we return a
// typed, non-retryable envelope with a split_batch self-heal recipe instead of running
// an unbounded batch.
export const MAX_OPS = 500;

const DEFAULT_NODE_SIZES = {
  text: { width: 300, height: 60 },
  todo: { width: 300, height: 60 },
  column: { width: 300, height: 200 },
  table: { width: 400, height: 130 },
  "canvas-link": { width: 280, height: 180 },
  media: { width: 240, height: 160 },
};

const DEFAULT_CODE_SIZES = {
  mermaid: { width: 350, height: 250 },
  html: { width: 650, height: 540 },
  svg: { width: 400, height: 400 },
};

const ALLOWED_OP_SET = new Set(ALLOWED_OPS);

const parseSizeEnv = (value) => {
  if (!value) return null;
  const cleaned = String(value).replace(/[xX]/g, ",");
  const parts = cleaned
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
};

const normalizeOpValue = (value) => {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (ALLOWED_OP_SET.has(raw)) return raw;
  const rawSnake = raw.replace(/[-\s]+/g, "_");
  if (ALLOWED_OP_SET.has(rawSnake)) return rawSnake;
  const camel = rawSnake.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  if (ALLOWED_OP_SET.has(camel)) return camel;
  const compact = raw.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return OP_ALIASES[compact] || null;
};

const getDefaultNodeSize = (nodeType, codeType) => {
  const normalizedType = String(nodeType || "").toLowerCase();
  if (normalizedType === "code") {
    const normalizedCode = String(codeType || "mermaid").toLowerCase();
    const envKey = `CANVAS_DEFAULT_SIZE_CODE_${normalizedCode.toUpperCase()}`;
    const envOverride = parseSizeEnv(process.env[envKey]);
    if (envOverride) return envOverride;
    return DEFAULT_CODE_SIZES[normalizedCode] || DEFAULT_CODE_SIZES.mermaid;
  }
  const envKey = `CANVAS_DEFAULT_SIZE_${normalizedType.replace("-", "_").toUpperCase()}`;
  const envOverride = parseSizeEnv(process.env[envKey]);
  if (envOverride) return envOverride;
  return DEFAULT_NODE_SIZES[normalizedType] || { width: 300, height: 120 };
};

const isTmpId = (value) => typeof value === "string" && value.startsWith("tmp:");

export const clampOpacity = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
};

export const parseTableContentPayload = (content) => {
  if (typeof content !== "string") return null;
  const text = content.trim();
  if (!text || (!text.startsWith("{") && !text.startsWith("["))) return null;
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const rows = payload.rows;
  if (!Array.isArray(rows)) return null;
  const cleanedRows = [];
  for (const row of rows) {
    if (!Array.isArray(row)) return null;
    cleanedRows.push(row.map((cell) => (cell == null ? "" : String(cell))));
  }
  const result = { rows: cleanedRows };
  const columnWidths = payload.columnWidths;
  if (Array.isArray(columnWidths) && columnWidths.every((v) => Number.isFinite(Number(v)))) {
    result.columnWidths = columnWidths.map((v) => Number(v));
  }
  const rowHeights = payload.rowHeights;
  if (Array.isArray(rowHeights) && rowHeights.every((v) => Number.isFinite(Number(v)))) {
    result.rowHeights = rowHeights.map((v) => Number(v));
  }
  return result;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const nextSequentialId = (prefix, used, sep = "-") => {
  const pattern = new RegExp(`^${escapeRegex(prefix)}${escapeRegex(sep)}(\\d+)$`);
  let maxNum = 0;
  used.forEach((id) => {
    const match = pattern.exec(String(id));
    if (!match) return;
    const num = Number(match[1]);
    if (Number.isFinite(num) && num > maxNum) {
      maxNum = num;
    }
  });
  return `${prefix}${sep}${maxNum + 1}`;
};

const nodePrefixForType = (nodeType) => {
  const mapping = {
    text: "text",
    todo: "todo",
    code: "code",
    table: "table",
    media: "media",
    column: "column",
    "canvas-link": "link",
    group: "group",
  };
  return { base: mapping[nodeType] || "node", sep: "-" };
};

const normalizeOp = (op, warnings) => {
  const normKey = (target, src, dst, ctx) => {
    if (target && Object.prototype.hasOwnProperty.call(target, src) && !Object.prototype.hasOwnProperty.call(target, dst)) {
      target[dst] = target[src];
      warnings.push(`normalized ${ctx}.${src} -> ${dst}`);
    }
  };

  if (!op || typeof op !== "object") return;

  const normalized = normalizeOpValue(op.op);
  if (normalized && op.op !== normalized) {
    warnings.push(`normalized op value ${op.op} -> ${normalized}`);
    op.op = normalized;
  }
  if (!op.op) {
    for (const key of ["type", "operation", "action"]) {
      const candidate = op[key];
      const alt = normalizeOpValue(candidate);
      if (alt) {
        warnings.push(`normalized op.${key} -> op`);
        if (candidate !== alt) {
          warnings.push(`normalized op value ${candidate} -> ${alt}`);
        }
        op.op = alt;
        break;
      }
    }
  }

  const kind = op.op;
  if (!kind) return;

  if (["update_node", "delete_node", "move_node", "apply_style"].includes(kind)) {
    normKey(op, "node_id", "id", kind);
    normKey(op, "nodeId", "id", kind);
  }
  if (["add_connection", "update_connection", "delete_connection"].includes(kind)) {
    normKey(op, "connection_id", "id", kind);
    normKey(op, "connectionId", "id", kind);
  }
  if (kind === "relayout_mindmap") {
    normKey(op, "group_id", "id", kind);
    normKey(op, "groupId", "id", kind);
  }
  if (["add_connection", "update_connection"].includes(kind)) {
    normKey(op, "from_id", "from", kind);
    normKey(op, "fromId", "from", kind);
    normKey(op, "source", "from", kind);
    normKey(op, "sourceId", "from", kind);
    normKey(op, "to_id", "to", kind);
    normKey(op, "toId", "to", kind);
    normKey(op, "target", "to", kind);
    normKey(op, "targetId", "to", kind);
  }

  if (kind === "add_node" && typeof op.node === "object") {
    const node = op.node;
    normKey(node, "node_type", "type", "node");
    normKey(node, "nodeType", "type", "node");
    normKey(node, "code_type", "codeType", "node");
    normKey(node, "group_mode", "groupMode", "node");
    normKey(node, "target_canvas_id", "targetCanvasId", "node");
    normKey(node, "targetCanvasID", "targetCanvasId", "node");
    normKey(node, "parent_group_id", "parentGroupId", "node");
    normKey(node, "parentGroupID", "parentGroupId", "node");
    normKey(node, "children_ids", "children", "node");
    normKey(node, "childrenIds", "children", "node");
  } else if (["update_node", "apply_style"].includes(kind) && typeof op.patch === "object") {
    const patch = op.patch;
    normKey(patch, "node_type", "type", "patch");
    normKey(patch, "nodeType", "type", "patch");
    normKey(patch, "code_type", "codeType", "patch");
    normKey(patch, "group_mode", "groupMode", "patch");
    normKey(patch, "target_canvas_id", "targetCanvasId", "patch");
    normKey(patch, "targetCanvasID", "targetCanvasId", "patch");
    normKey(patch, "parent_group_id", "parentGroupId", "patch");
    normKey(patch, "parentGroupID", "parentGroupId", "patch");
    normKey(patch, "children_ids", "children", "patch");
    normKey(patch, "childrenIds", "children", "patch");
    normKey(patch, "curve_anchor", "curveAnchor", "patch");
    normKey(patch, "anchor_params", "anchorParams", "patch");
    normKey(patch, "curve_mode", "curveMode", "patch");
  } else if (kind === "update_canvas" && typeof op.patch === "object") {
    const patch = op.patch;
    normKey(patch, "background_color", "backgroundColor", "patch");
    normKey(patch, "background_style_id", "backgroundStyleId", "patch");
    normKey(patch, "pattern_color", "patternColor", "patch");
    normKey(patch, "corner_style", "cornerStyle", "patch");
    normKey(patch, "font_style", "fontStyle", "patch");
    normKey(patch, "text_opacity_preset", "textOpacityPreset", "patch");
    normKey(patch, "text_layout_preset", "textLayoutPreset", "patch");
    normKey(patch, "folder_id", "folderId", "patch");
  } else if (["add_connection", "update_connection"].includes(kind)) {
    normKey(op, "from_point", "fromPoint", kind);
    normKey(op, "to_point", "toPoint", kind);
    normKey(op, "curve_anchor", "curveAnchor", kind);
    normKey(op, "anchor_params", "anchorParams", kind);
    normKey(op, "curve_mode", "curveMode", kind);
    if (kind === "update_connection" && typeof op.patch === "object") {
      const patch = op.patch;
      normKey(patch, "from_point", "fromPoint", "patch");
      normKey(patch, "to_point", "toPoint", "patch");
      normKey(patch, "from_id", "from", "patch");
      normKey(patch, "fromId", "from", "patch");
      normKey(patch, "source", "from", "patch");
      normKey(patch, "sourceId", "from", "patch");
      normKey(patch, "to_id", "to", "patch");
      normKey(patch, "toId", "to", "patch");
      normKey(patch, "target", "to", "patch");
      normKey(patch, "targetId", "to", "patch");
      normKey(patch, "curve_anchor", "curveAnchor", "patch");
      normKey(patch, "anchor_params", "anchorParams", "patch");
      normKey(patch, "curve_mode", "curveMode", "patch");
    }
  }
};

const normalizeTextOpacity = (payload) => {
  if (!payload || typeof payload !== "object") return;
  if (Object.prototype.hasOwnProperty.call(payload, "opacity")) {
    const value = clampOpacity(payload.opacity);
    if (value !== null) {
      const textStyles = typeof payload.textStyles === "object" && payload.textStyles ? payload.textStyles : {};
      textStyles.opacity = value;
      payload.textStyles = textStyles;
    }
    delete payload.opacity;
  }
  if (payload.textStyles && typeof payload.textStyles === "object" && "opacity" in payload.textStyles) {
    const value = clampOpacity(payload.textStyles.opacity);
    if (value !== null) {
      payload.textStyles.opacity = value;
    }
  }
};

const stripMediaSignedUrls = (nodes) =>
  nodes.map((node) => {
    if (node && typeof node === "object" && node.type === "media") {
      const cleaned = { ...node };
      if (!cleaned.storagePath) {
        const candidate = cleaned.fileUrl || cleaned.fileDownloadUrl;
        const derived = extractStoragePathFromUrl(candidate);
        if (derived) {
          cleaned.storagePath = derived;
        }
      }
      delete cleaned.fileUrl;
      delete cleaned.fileDownloadUrl;
      delete cleaned.localPath;
      return cleaned;
    }
    return node;
  });

const firstLine = (value) => {
  if (typeof value !== "string") return "";
  return value.split(/\r?\n/)[0].trim();
};

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "tiff",
  "avif",
  "heic",
  "heif",
]);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv", "avi", "mpeg", "mpg"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "aac", "flac", "ogg", "m4a"]);
const DOC_EXTS = new Set(["pdf", "doc", "docx", "rtf", "txt", "md"]);
const SHEET_EXTS = new Set(["xls", "xlsx", "csv"]);
const SLIDE_EXTS = new Set(["ppt", "pptx", "key"]);
const MIME_BY_EXT = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  csv: "text/csv",
};

const inferMediaType = (ext, mimeType) => {
  const lowerMime = String(mimeType || "").toLowerCase();
  if (lowerMime.startsWith("image/")) return "image";
  if (lowerMime.startsWith("audio/")) return "audio";
  if (lowerMime.startsWith("video/")) return "video";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (SHEET_EXTS.has(ext)) return "spreadsheet";
  if (SLIDE_EXTS.has(ext)) return "presentation";
  if (DOC_EXTS.has(ext)) return "document";
  return "document";
};

const extractFileName = (node) => {
  if (typeof node?.fileName === "string" && node.fileName.trim()) {
    return node.fileName.trim();
  }
  for (const key of ["fileUrl", "externalUrl", "embedUrl"]) {
    const raw = node?.[key];
    if (typeof raw !== "string" || !raw.trim()) continue;
    try {
      const parsed = new URL(raw, "http://localhost");
      const path = parsed.pathname || "";
      const name = path.split("/").pop();
      if (name) return name;
    } catch {
      const cleaned = raw.split("?")[0].split("#")[0];
      const name = cleaned.split("/").pop();
      if (name) return name;
    }
  }
  return null;
};

const fillMediaDefaults = (node, warnings) => {
  let changed = false;
  const fileName = extractFileName(node);
  if (!node.fileName && fileName) {
    node.fileName = fileName;
    changed = true;
  }
  const extension = (node.fileExtension || (fileName && fileName.split(".").pop()) || "")
    .toString()
    .replace(/^\./, "")
    .toLowerCase();
  if (!node.fileExtension && extension) {
    node.fileExtension = extension;
    changed = true;
  }
  if (!node.fileType) {
    node.fileType = MIME_BY_EXT[extension] || "application/octet-stream";
    changed = true;
  }
  if (node.fileSize == null || Number.isNaN(Number(node.fileSize))) {
    node.fileSize = 0;
    changed = true;
  }
  if (!node.mediaType) {
    node.mediaType = inferMediaType(extension, node.fileType);
    changed = true;
  }
  if (!node.uploadStatus) {
    node.uploadStatus = "mock";
    changed = true;
  }
  if (!node.mediaSource) {
    node.mediaSource = node.externalUrl || node.embedUrl ? "external" : "file";
    changed = true;
  }
  if (changed) {
    warnings.push("auto-filled media defaults");
  }
};

const validateTypeSpecificRequired = (node) => {
  const nodeType = node?.type;
  if (nodeType === "todo") {
    if (!Object.prototype.hasOwnProperty.call(node, "completed")) {
      node.completed = false;
    }
  } else if (nodeType === "code") {
    const codeType = node.codeType;
    if (!["mermaid", "html", "svg"].includes(codeType)) {
      return "code node requires codeType in {'mermaid','html','svg'}";
    }
  } else if (nodeType === "table") {
    const data = node.data;
    if (!data || typeof data !== "object") {
      return "table node requires data.rows[][] (and optional columnWidths/rowHeights)";
    }
    if (!Array.isArray(data.rows) || !data.rows.every((row) => Array.isArray(row))) {
      return "table node requires data.rows(list of list)";
    }
  } else if (nodeType === "media") {
    const required = ["fileName", "fileType", "fileExtension", "fileSize", "mediaType", "uploadStatus"];
    const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(node, key));
    if (missing.length) {
      return `media node missing fields: ${missing.join(", ")}`;
    }
  } else if (nodeType === "canvas-link") {
    if (!node.title) {
      return "canvas-link node requires title";
    }
  } else if (nodeType === "group") {
    const children = node.children;
    if (!Array.isArray(children)) {
      return "group node requires children(list of node ids)";
    }
    const seen = new Set();
    const uniq = [];
    for (const childId of children) {
      if (!childId || childId === node.id) continue;
      if (seen.has(childId)) continue;
      seen.add(childId);
      uniq.push(childId);
    }
    node.children = uniq;
  }
  return null;
};

const finalValidate = (nodes, connections) => {
  const nodeIds = nodes.map((node) => String(node.id)).filter(Boolean);
  if (nodeIds.length !== new Set(nodeIds).size) {
    return "duplicate node ids detected";
  }
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const connIds = connections.map((conn) => String(conn.id)).filter(Boolean);
  if (connIds.length !== new Set(connIds).size) {
    return "duplicate connection ids detected";
  }
  const collisions = connIds.filter((id) => nodeMap.has(id));
  if (collisions.length) {
    return "node and connection ids must be globally unique (collision detected)";
  }
  for (const conn of connections) {
    const hasNodes = conn.from != null && conn.to != null;
    const hasPoints = typeof conn.fromPoint === "object" && typeof conn.toPoint === "object";
    if (hasNodes && hasPoints) {
      return "connection must not contain both (from,to) and (fromPoint,toPoint)";
    }
    if (!hasNodes && !hasPoints) {
      return "connection requires either node endpoints or point endpoints";
    }
    if (hasNodes) {
      if (!nodeMap.has(conn.from) || !nodeMap.has(conn.to)) {
        return `connection references unknown node(s): from=${conn.from}, to=${conn.to}`;
      }
      // G4 (ratified): groups ARE connectable — a group is a node, and graph tools connect
      // containers. Previously this rejected group endpoints; relaxed per the founder decision.
    } else {
      const fp = conn.fromPoint || {};
      const tp = conn.toPoint || {};
      if (![fp.x, fp.y, tp.x, tp.y].every((v) => Number.isFinite(Number(v)))) {
        return "free connection requires numeric fromPoint/toPoint.x/y";
      }
    }
  }
  for (const node of nodes) {
    if (node.type === "column") {
      const children = Array.isArray(node.children) ? node.children : [];
      for (const childId of children) {
        const child = nodeMap.get(childId);
        if (child && child.type === "column") {
          return "column.children must not contain column nodes";
        }
      }
    }
  }
  for (const node of nodes) {
    if (node.type === "group") {
      const children = Array.isArray(node.children) ? node.children : [];
      for (const childId of children) {
        if (!nodeMap.has(childId)) {
          return `group.children references unknown node id: ${childId}`;
        }
      }
    }
  }
  // Containment cycles are HEALED (not rejected) by reconcileContainment, which runs
  // before finalValidate and in the live executor too — so both converge on an acyclic
  // forest without the live path needing to reject. No cycle check needed here.
  return null;
};

export const applyCanvasOps = ({ doc, operations, now, actor = null, enforceClientIds = false }) => {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("operations must be a non-empty array");
  }
  if (operations.length > MAX_OPS) {
    throw makeCanvasError(
      "BATCH_TOO_LARGE",
      `batch too large: ${operations.length} ops exceeds the limit of ${MAX_OPS}`,
      { self_heal: { action: "split_batch", params: { maxOps: MAX_OPS } } },
    );
  }
  const requireClientIds = Boolean(enforceClientIds);
  const baseDoc = doc && typeof doc === "object" ? { ...doc } : {};
  const nodes = Array.isArray(baseDoc.nodes) ? [...baseDoc.nodes] : [];
  let connections = Array.isArray(baseDoc.connections) ? [...baseDoc.connections] : [];
  const warnings = [];

  operations.forEach((op) => {
    if (op && typeof op === "object") {
      normalizeOp(op, warnings);
    }
  });

  const usedNodeIds = new Set(nodes.map((node) => String(node.id)).filter(Boolean));
  const usedConnIds = new Set(connections.map((conn) => String(conn.id)).filter(Boolean));
  const idMap = {};

  const genNodeId = (nodeType) => {
    const { base, sep } = nodePrefixForType(String(nodeType));
    while (true) {
      const candidate = nextSequentialId(base, usedNodeIds, sep);
      if (!usedNodeIds.has(candidate)) {
        usedNodeIds.add(candidate);
        return candidate;
      }
    }
  };

  const genConnId = () => {
    while (true) {
      const candidate = nextSequentialId("connection", usedConnIds, "-");
      if (!usedConnIds.has(candidate)) {
        usedConnIds.add(candidate);
        return candidate;
      }
    }
  };

  operations.forEach((op) => {
    if (!op || typeof op !== "object") return;
    if (op.op === "add_node") {
      const node = op.node || {};
      const nodeType = node.type;
      if (!nodeType) return;
      const givenId = node.id;
      if (givenId == null || isTmpId(givenId)) {
        const newId = genNodeId(nodeType);
        if (isTmpId(givenId)) {
          idMap[givenId] = newId;
        }
        node.id = newId;
        op.node = node;
      } else {
        usedNodeIds.add(String(givenId));
      }
    }
  });

  operations.forEach((op) => {
    if (!op || typeof op !== "object") return;
    if (op.op === "add_connection") {
      const givenId = op.id;
      const isSemantic = typeof givenId === "string" && /^connection-\d+$/.test(givenId || "");
      if (givenId == null || isTmpId(givenId) || !isSemantic) {
        const newId = genConnId();
        if (typeof givenId === "string" && !isSemantic) {
          idMap[givenId] = newId;
        } else if (isTmpId(givenId)) {
          idMap[givenId] = newId;
        }
        op.id = newId;
      } else {
        usedConnIds.add(String(givenId));
      }
    }
  });

  const mapTmp = (value) => {
    if (isTmpId(value)) {
      if (idMap[value]) return idMap[value];
      throw new Error(`Unknown temporary id reference: ${value}`);
    }
    return value;
  };
  const mapRemappedId = (value) => {
    if (typeof value === "string" && idMap[value]) {
      return idMap[value];
    }
    return value;
  };

  operations.forEach((op) => {
    if (!op || typeof op !== "object") return;
    const kind = op.op;
    if (kind === "add_node") {
      const node = op.node || {};
      normalizeTextOpacity(node);
      if (typeof node.parentGroupId === "string") {
        node.parentGroupId = mapTmp(node.parentGroupId);
      }
      if (Array.isArray(node.children)) {
        node.children = node.children.map((child) => mapTmp(child) || child);
      }
      op.node = node;
    } else if (["update_node", "move_node", "apply_style", "delete_node"].includes(kind)) {
      if ("id" in op) {
        op.id = mapTmp(op.id);
      }
      if (kind === "update_node") {
        const patch = op.patch || {};
        normalizeTextOpacity(patch);
        if (typeof patch.parentGroupId === "string") {
          patch.parentGroupId = mapTmp(patch.parentGroupId);
        }
        if (Array.isArray(patch.children)) {
          patch.children = patch.children.map((child) => mapTmp(child) || child);
        }
        op.patch = patch;
      }
    } else if (kind === "add_connection") {
      if ("from" in op) op.from = mapTmp(op.from);
      if ("to" in op) op.to = mapTmp(op.to);
      if ("id" in op) {
        op.id = mapRemappedId(op.id);
      }
    } else if (kind === "delete_connection") {
      if ("id" in op) {
        op.id = mapRemappedId(op.id);
      }
    } else if (kind === "update_connection") {
      if ("id" in op) {
        op.id = mapRemappedId(op.id);
      }
      if ("from" in op) op.from = mapTmp(op.from);
      if ("to" in op) op.to = mapTmp(op.to);
    }
  });

  const nodeExists = (id) => nodes.some((node) => node.id === id);
  const findNode = (id) => nodes.find((node) => node.id === id);
  const findConn = (id) => connections.find((conn) => conn.id === id);
  // NODE_LOCKED: a locked node rejects content/geometry/structure mutations (a typed,
  // non-retryable envelope) — the server enforces the lock, not just the frontend.
  const assertNotLocked = (node, kind) => {
    if (node && node.locked) {
      throw makeCanvasError("NODE_LOCKED", `${kind}: node '${node.id}' is locked`, { field: "locked" });
    }
  };
  // MV1: shift every descendant of a container by (dx, dy). Descendants resolved via
  // parentGroupId (the membership source of truth) so nested containers move too.
  const moveSubtree = (containerId, dx, dy) => {
    const seen = new Set([containerId]);
    const stack = [containerId];
    while (stack.length) {
      const pid = stack.pop();
      for (const n of nodes) {
        if (n.parentGroupId === pid && !seen.has(n.id)) {
          seen.add(n.id);
          n.x = (Number(n.x) || 0) + dx;
          n.y = (Number(n.y) || 0) + dy;
          n.updatedAt = nowMs;
          stack.push(n.id);
        }
      }
    }
  };
  const ensureUniqueNodeId = (id) => !nodes.some((node) => node.id === id);

  const applied = [];
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();

  for (const op of operations) {
    if (!op || typeof op !== "object") continue;
    const kind = op.op;
    if (kind === "update_canvas") {
      const patch = op.patch || {};
      if (!patch || typeof patch !== "object") {
        throw new Error("update_canvas requires non-empty 'patch' object");
      }
      const allowedKeys = new Set(CANVAS_PATCH_KEYS);
      Object.keys(patch).forEach((key) => {
        if (!allowedKeys.has(key)) {
          delete patch[key];
        }
      });
      if (!Object.keys(patch).length) {
        throw new Error("update_canvas patch contains no valid updatable fields");
      }
      Object.entries(patch).forEach(([key, value]) => {
        baseDoc[key] = value;
      });
      baseDoc.updatedAt = nowMs;
      applied.push({ op: "update_canvas", keys: Object.keys(patch) });
      continue;
    }

    if (kind === "add_node") {
      const node = op.node || {};
      const nodeType = node.type;
      if (node.content == null) node.content = "";
      const titleValue =
        typeof node.title === "string" ? node.title : node.title != null ? String(node.title) : "";
      if ((nodeType === "group" || nodeType === "column") && !firstLine(node.content) && titleValue) {
        node.content = titleValue;
        warnings.push("auto-filled group/column content from title");
      }
      if (nodeType === "canvas-link") {
        if (!node.title) {
          const derived = firstLine(node.content) || "Canvas Link";
          node.title = derived;
          warnings.push("auto-filled canvas-link title from content");
        }
        if (!firstLine(node.content) && node.title) {
          node.content = String(node.title);
        }
      }
      if (nodeType === "media") {
        fillMediaDefaults(node, warnings);
      }
      if (!("x" in node)) node.x = 0;
      if (!("y" in node)) node.y = 0;
      if (node.type === "code" && !node.codeType) {
        node.codeType = "mermaid";
      }
      if (!node.width || !node.height) {
        const defaults = getDefaultNodeSize(node.type, node.codeType);
        node.width = Number(node.width || defaults.width);
        node.height = Number(node.height || defaults.height);
      }
      if (node.type === "table") {
        const parsed = parseTableContentPayload(node.content);
        if (parsed) {
          node.data = parsed;
          node.content = "";
        } else if (!node.data || typeof node.data !== "object") {
          node.data = {
            rows: [
              ["Header 1", "Header 2"],
              ["", ""],
            ],
            columnWidths: [160, 160],
            rowHeights: [40, 40],
          };
        }
      }
      if (node.type === "group") {
        const children = Array.isArray(node.children) ? node.children : [];
        const seen = new Set();
        node.children = children.filter((childId) => {
          if (!childId || childId === node.id || seen.has(childId)) return false;
          seen.add(childId);
          return true;
        });
      }
      if (!node.id) {
        if (requireClientIds) {
          throw new Error("add_node requires client-provided id");
        }
        warnings.push("missing_node_id");
        node.id = genNodeId(node.type);
      } else if (!ensureUniqueNodeId(node.id)) {
        throw new Error(`add_node: duplicate id '${node.id}'`);
      }
      if (!node.createdAt) node.createdAt = nowMs;
      if (!node.updatedAt) node.updatedAt = nowMs;
      const required = ["id", "type", "x", "y", "width", "height"];
      const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(node, key));
      if (missing.length) {
        throw new Error(`add_node missing fields: ${missing.join(", ")}`);
      }
      const err = validateTypeSpecificRequired(node);
      if (err) {
        throw new Error(`add_node validation failed: ${err}`);
      }
      nodes.push(node);
      applied.push({ op: "add_node", id: node.id });
      continue;
    }

    if (kind === "update_node") {
      const node = findNode(op.id);
      if (!node) throw new Error(`update_node: node not found: ${op.id}`);
      assertNotLocked(node, "update_node");
      const patch = op.patch || {};
      if ((node.type === "group" || node.type === "column") && patch.title && patch.content == null) {
        patch.content = String(patch.title);
        warnings.push("normalized group/column title -> content");
      }
      if (node.type === "table") {
        const parsedPatch = parseTableContentPayload(patch.content);
        if (parsedPatch) {
          patch.data = parsedPatch;
          patch.content = "";
        }
      }
      if (patch.textStyles && typeof patch.textStyles === "object" && "opacity" in patch.textStyles) {
        const value = clampOpacity(patch.textStyles.opacity);
        if (value !== null) {
          patch.textStyles.opacity = value;
        }
      }
      Object.assign(node, patch);
      node.updatedAt = nowMs;
      applied.push({ op: "update_node", id: op.id });
      continue;
    }

    if (kind === "delete_node") {
      assertNotLocked(findNode(op.id), "delete_node");
      const before = nodes.length;
      const remaining = nodes.filter((node) => node.id !== op.id);
      connections = connections.filter((conn) => conn.from !== op.id && conn.to !== op.id);
      applied.push({ op: "delete_node", id: op.id, removed: before - remaining.length });
      while (nodes.length) nodes.pop();
      remaining.forEach((node) => nodes.push(node));
      continue;
    }

    if (kind === "add_connection") {
      const from = op.from;
      const to = op.to;
      const fromPoint = op.fromPoint;
      const toPoint = op.toPoint;
      const fromHasNode = Boolean(from);
      const fromHasPoint = typeof fromPoint === "object";
      const toHasNode = Boolean(to);
      const toHasPoint = typeof toPoint === "object";
      if ((fromHasNode && fromHasPoint) || (toHasNode && toHasPoint)) {
        throw new Error("add_connection: each endpoint must choose either node id or point coordinates, not both.");
      }
      if (!(fromHasNode || fromHasPoint) || !(toHasNode || toHasPoint)) {
        throw new Error("add_connection: missing endpoints. Provide node ids and/or point coordinates for both ends.");
      }
      let connId = op.id;
      if (!connId) {
        if (requireClientIds) {
          throw new Error("add_connection requires client-provided id");
        }
        warnings.push("missing_connection_id");
        connId = genConnId();
      }
      op.id = connId;
      if (connections.some((conn) => conn.id === connId)) {
        throw new Error(`add_connection: duplicate id '${connId}'`);
      }
      const payload = { id: connId, label: op.label, createdAt: nowMs };
      if (fromHasNode) {
        if (!nodeExists(from)) {
          throw new Error("add_connection: 'from' must reference an existing node.");
        }
        payload.from = from;
      } else {
        const x = Number(fromPoint?.x);
        const y = Number(fromPoint?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new Error("add_connection: fromPoint/toPoint must be objects with numeric x/y.");
        }
        payload.fromPoint = { x, y };
      }
      if (toHasNode) {
        if (!nodeExists(to)) {
          throw new Error("add_connection: 'to' must reference an existing node.");
        }
        payload.to = to;
      } else {
        const x = Number(toPoint?.x);
        const y = Number(toPoint?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new Error("add_connection: fromPoint/toPoint must be objects with numeric x/y.");
        }
        payload.toPoint = { x, y };
      }
      if (op.curveAnchor && typeof op.curveAnchor === "object") {
        const x = Number(op.curveAnchor.x);
        const y = Number(op.curveAnchor.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new Error("add_connection: curveAnchor must have numeric x/y");
        }
        payload.curveAnchor = { x, y };
      }
      if (op.anchorParams && typeof op.anchorParams === "object") {
        const u = Number(op.anchorParams.u);
        const v = Number(op.anchorParams.v);
        if (!Number.isFinite(u) || !Number.isFinite(v)) {
          throw new Error("add_connection: anchorParams must have numeric u/v");
        }
        payload.anchorParams = { u, v };
      }
      if (op.curveMode != null) {
        const mode = op.curveMode;
        if (!["auto", "tension", "manual", "orthogonal"].includes(mode)) {
          throw new Error("add_connection: curveMode must be one of 'auto'|'tension'|'manual'|'orthogonal'");
        }
        payload.curveMode = mode;
      }
      if (op.tension != null) {
        const tension = clampOpacity(op.tension);
        if (tension == null) {
          throw new Error("add_connection: tension must be a number (0..1)");
        }
        payload.tension = tension;
      }
      if (op.style === "line" || op.style === "arrow") {
        payload.style = op.style;
      }
      if (typeof op.dashed === "boolean") {
        payload.dashed = op.dashed;
      }
      // Universal structural slots (WS5-1): OPEN relation kind + logical direction.
      if (op.relation != null) {
        payload.relation = String(op.relation);
      }
      if (typeof op.directed === "boolean") {
        payload.directed = op.directed;
      }
      if (op.relationData && typeof op.relationData === "object") {
        payload.relationData = op.relationData;
      }
      connections.push(payload);
      applied.push({ op: "add_connection", id: connId });
      continue;
    }

    if (kind === "delete_connection") {
      const before = connections.length;
      connections = connections.filter((conn) => conn.id !== op.id);
      applied.push({ op: "delete_connection", id: op.id, removed: before - connections.length });
      continue;
    }

    if (kind === "update_connection") {
      let conn = op.id ? findConn(op.id) : null;
      if (!conn && "from" in op && "to" in op) {
        conn = connections.find((entry) => entry.from === op.from && entry.to === op.to);
      }
      if (!conn) {
        throw new Error("update_connection: connection not found (provide valid 'id' or matching 'from'+'to')");
      }
      const patch = op.patch || {};
      if (!patch || typeof patch !== "object" || !Object.keys(patch).length) {
        throw new Error("update_connection requires non-empty 'patch'");
      }
      let updatedAny = false;
      if ("label" in patch) {
        conn.label = patch.label;
        updatedAny = true;
      }
      if ("style" in patch && ["line", "arrow"].includes(patch.style)) {
        conn.style = patch.style;
        updatedAny = true;
      }
      if ("dashed" in patch && typeof patch.dashed === "boolean") {
        conn.dashed = patch.dashed;
        updatedAny = true;
      }
      if (patch.curveAnchor && typeof patch.curveAnchor === "object") {
        const x = Number(patch.curveAnchor.x);
        const y = Number(patch.curveAnchor.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new Error("update_connection: curveAnchor must have numeric x/y");
        }
        conn.curveAnchor = { x, y };
        updatedAny = true;
      }
      if (patch.anchorParams && typeof patch.anchorParams === "object") {
        const u = Number(patch.anchorParams.u);
        const v = Number(patch.anchorParams.v);
        if (!Number.isFinite(u) || !Number.isFinite(v)) {
          throw new Error("update_connection: anchorParams must have numeric u/v");
        }
        conn.anchorParams = { u, v };
        updatedAny = true;
      }
      if ("curveMode" in patch) {
        const mode = patch.curveMode;
        if (![null, "auto", "tension", "manual", "orthogonal"].includes(mode)) {
          throw new Error("update_connection: curveMode must be one of 'auto'|'tension'|'manual'|'orthogonal'");
        }
        if (mode != null) {
          conn.curveMode = mode;
          updatedAny = true;
        }
      }
      if ("tension" in patch) {
        const tension = clampOpacity(patch.tension);
        if (tension == null) {
          throw new Error("update_connection: tension must be a number (0..1)");
        }
        conn.tension = tension;
        updatedAny = true;
      }
      // Universal structural slots (WS5-1): relation kind / direction / open bag.
      if ("relation" in patch) {
        if (patch.relation == null) delete conn.relation;
        else conn.relation = String(patch.relation);
        updatedAny = true;
      }
      if ("directed" in patch && typeof patch.directed === "boolean") {
        conn.directed = patch.directed;
        updatedAny = true;
      }
      if ("relationData" in patch && patch.relationData && typeof patch.relationData === "object") {
        conn.relationData = patch.relationData;
        updatedAny = true;
      }
      if ("from" in patch || "fromPoint" in patch) {
        const from = "from" in patch ? patch.from : conn.from;
        const fromPoint = "fromPoint" in patch ? patch.fromPoint : conn.fromPoint;
        if (from && fromPoint) {
          throw new Error("update_connection: choose either 'from' (node id) or 'fromPoint', not both");
        }
        if (from) {
          if (!nodeExists(from)) {
            throw new Error("update_connection: 'from' must reference an existing node");
          }
          conn.from = from;
          delete conn.fromPoint;
        } else if (fromPoint && typeof fromPoint === "object") {
          const x = Number(fromPoint.x);
          const y = Number(fromPoint.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error("update_connection: fromPoint must have numeric x/y");
          }
          conn.fromPoint = { x, y };
          delete conn.from;
        } else {
          throw new Error("update_connection: provide valid 'from' or 'fromPoint'");
        }
        updatedAny = true;
      }
      if ("to" in patch || "toPoint" in patch) {
        const to = "to" in patch ? patch.to : conn.to;
        const toPoint = "toPoint" in patch ? patch.toPoint : conn.toPoint;
        if (to && toPoint) {
          throw new Error("update_connection: choose either 'to' (node id) or 'toPoint', not both");
        }
        if (to) {
          if (!nodeExists(to)) {
            throw new Error("update_connection: 'to' must reference an existing node");
          }
          conn.to = to;
          delete conn.toPoint;
        } else if (toPoint && typeof toPoint === "object") {
          const x = Number(toPoint.x);
          const y = Number(toPoint.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error("update_connection: toPoint must have numeric x/y");
          }
          conn.toPoint = { x, y };
          delete conn.to;
        } else {
          throw new Error("update_connection: provide valid 'to' or 'toPoint'");
        }
        updatedAny = true;
      }
      if (!((conn.from || conn.fromPoint) && (conn.to || conn.toPoint))) {
        throw new Error("update_connection: endpoints incomplete; ensure both ends are defined via node or point.");
      }
      if (!updatedAny) {
        throw new Error("update_connection patch contains no supported fields (label, style, dashed, curveAnchor, anchorParams, curveMode, tension, endpoints)");
      }
      applied.push({ op: "update_connection", id: conn.id });
      continue;
    }

    if (kind === "move_node") {
      const node = findNode(op.id);
      if (!node) throw new Error(`move_node: node not found: ${op.id}`);
      assertNotLocked(node, "move_node");
      // Coerce to finite numbers and drop garbage, so the snapshot and the live Y.Doc
      // (which also coerces) never disagree on a string/NaN coordinate.
      const oldX = Number(node.x) || 0;
      const oldY = Number(node.y) || 0;
      if ("x" in op) {
        const x = Number(op.x);
        if (Number.isFinite(x)) node.x = x;
      }
      if ("y" in op) {
        const y = Number(op.y);
        if (Number.isFinite(y)) node.y = y;
      }
      const dx = (Number(node.x) || 0) - oldX;
      const dy = (Number(node.y) || 0) - oldY;
      // MV1: moving a container drags its whole subtree by the same delta. Walk parentGroupId
      // (membership source of truth) so nested groups move too; cycle-safe via `seen`.
      if ((dx || dy) && (node.type === "group" || node.type === "column")) {
        moveSubtree(node.id, dx, dy);
      }
      node.updatedAt = nowMs;
      applied.push({ op: "move_node", id: op.id });
      continue;
    }

    if (kind === "apply_style") {
      const node = findNode(op.id);
      if (!node) throw new Error(`apply_style: node not found: ${op.id}`);
      assertNotLocked(node, "apply_style");
      const patch = op.patch || {};
      normalizeTextOpacity(patch);
      Object.assign(node, patch);
      node.updatedAt = nowMs;
      applied.push({ op: "apply_style", id: op.id });
      continue;
    }

    if (kind === "update_table_cell") {
      const node = findNode(op.id);
      if (!node) throw new Error(`update_table_cell: node not found: ${op.id}`);
      assertNotLocked(node, "update_table_cell");
      if (node.type !== "table") throw new Error(`update_table_cell: node is not a table: ${op.id}`);
      const row = Number(op.row);
      const col = Number(op.col);
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) {
        throw new Error("update_table_cell requires integer row/col >= 0");
      }
      const data = node.data && typeof node.data === "object" ? node.data : null;
      const rows = data && Array.isArray(data.rows) ? data.rows : null;
      if (!rows) throw new Error(`update_table_cell: table has no data.rows: ${op.id}`);
      if (row >= rows.length || !Array.isArray(rows[row]) || col >= rows[row].length) {
        throw new Error(`update_table_cell: cell out of range (row=${row}, col=${col})`);
      }
      rows[row][col] = op.value == null ? "" : String(op.value);
      node.updatedAt = nowMs;
      applied.push({ op: "update_table_cell", id: op.id, row, col });
      continue;
    }

    if (kind === "table_row_op" || kind === "table_col_op") {
      const node = findNode(op.id);
      if (!node) throw new Error(`${kind}: node not found: ${op.id}`);
      assertNotLocked(node, kind);
      if (node.type !== "table") throw new Error(`${kind}: node is not a table: ${op.id}`);
      const action = op.action;
      if (action !== "insert" && action !== "delete") {
        throw new Error(`${kind} requires action 'insert' or 'delete'`);
      }
      const data = node.data && typeof node.data === "object" ? node.data : null;
      const rows = data && Array.isArray(data.rows) ? data.rows : null;
      if (!rows) throw new Error(`${kind}: table has no data.rows: ${op.id}`);
      const index = Number(op.index);
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(`${kind} requires integer index >= 0`);
      }

      if (kind === "table_row_op") {
        const colCount = rows.length ? rows[0].length : Array.isArray(op.rowData) ? op.rowData.length : 0;
        if (action === "insert") {
          if (index > rows.length) throw new Error(`table_row_op insert index out of range: ${index}`);
          const wasEmpty = rows.length === 0;
          // Normalize to colCount (pad/truncate rowData) so an insert never makes the table ragged.
          const newRow = Array.from({ length: colCount }, (_, i) => {
            const v = Array.isArray(op.rowData) ? op.rowData[i] : undefined;
            return v == null ? "" : String(v);
          });
          rows.splice(index, 0, newRow);
          if (Array.isArray(data.rowHeights)) data.rowHeights.splice(index, 0, data.rowHeights[0] ?? 40);
          // When this row establishes the column count, backfill columnWidths to match.
          if (wasEmpty && Array.isArray(data.columnWidths)) {
            while (data.columnWidths.length < newRow.length) data.columnWidths.push(160);
          }
        } else {
          if (index >= rows.length) throw new Error(`table_row_op delete index out of range: ${index}`);
          rows.splice(index, 1);
          if (Array.isArray(data.rowHeights)) data.rowHeights.splice(index, 1);
        }
      } else {
        const colCount = rows.length ? rows[0].length : 0;
        if (action === "insert") {
          if (rows.length === 0) throw new Error("table_col_op: cannot insert a column into a table with no rows");
          if (index > colCount) throw new Error(`table_col_op insert index out of range: ${index}`);
          const header = op.header == null ? "" : String(op.header);
          rows.forEach((r, i) => {
            if (Array.isArray(r)) r.splice(index, 0, i === 0 ? header : "");
          });
          if (Array.isArray(data.columnWidths)) data.columnWidths.splice(index, 0, data.columnWidths[0] ?? 160);
        } else {
          if (index >= colCount) throw new Error(`table_col_op delete index out of range: ${index}`);
          rows.forEach((r) => {
            if (Array.isArray(r)) r.splice(index, 1);
          });
          if (Array.isArray(data.columnWidths)) data.columnWidths.splice(index, 1);
        }
      }
      node.updatedAt = nowMs;
      applied.push({ op: kind, id: op.id, action, index });
      continue;
    }

    if (kind === "group_nodes") {
      const ids = Array.isArray(op.ids) ? op.ids.filter((x) => typeof x === "string") : [];
      if (!ids.length) throw new Error("group_nodes requires a non-empty 'ids' array");
      const members = [];
      for (const id of ids) {
        const member = findNode(id);
        if (!member) throw new Error(`group_nodes: node not found: ${id}`);
        if (member.type === "group") throw new Error(`group_nodes: cannot nest a group: ${id}`);
        members.push(member);
      }
      const groupId = genNodeId("group");
      const minX = Math.min(...members.map((m) => Number(m.x) || 0));
      const minY = Math.min(...members.map((m) => Number(m.y) || 0));
      const maxRight = Math.max(...members.map((m) => (Number(m.x) || 0) + (Number(m.width) || 0)));
      const maxBottom = Math.max(...members.map((m) => (Number(m.y) || 0) + (Number(m.height) || 0)));
      // single-parent: detach each member from any other container before reparenting.
      for (const member of members) {
        if (member.parentGroupId && member.parentGroupId !== groupId) {
          const prev = findNode(member.parentGroupId);
          if (prev && Array.isArray(prev.children)) {
            prev.children = prev.children.filter((c) => c !== member.id);
          }
        }
        member.parentGroupId = groupId;
        member.updatedAt = nowMs;
      }
      nodes.push({
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
      });
      if (isTmpId(op.id)) idMap[op.id] = groupId;
      op.id = groupId; // propagate resolved id so the live Yjs replay (applyOpsToYDoc) uses the same group id
      applied.push({ op: "group_nodes", id: groupId, children: ids.slice() });
      continue;
    }

    if (kind === "ungroup") {
      const groupId = op.id || op.group_id;
      if (!groupId) throw new Error("ungroup requires 'id' (group id)");
      const group = findNode(groupId);
      if (!group) throw new Error(`ungroup: group not found: ${groupId}`);
      if (group.type !== "group") throw new Error(`ungroup: node is not a group: ${groupId}`);
      // Members survive as free nodes; strip their back-pointer and any container ref to the group.
      for (const node of nodes) {
        if (node.parentGroupId === groupId) {
          delete node.parentGroupId;
          node.updatedAt = nowMs;
        }
        if (Array.isArray(node.children) && node.children.includes(groupId)) {
          node.children = node.children.filter((c) => c !== groupId);
        }
      }
      const idx = nodes.findIndex((node) => node.id === groupId);
      if (idx >= 0) nodes.splice(idx, 1);
      applied.push({ op: "ungroup", id: groupId });
      continue;
    }

    if (kind === "set_collapsed") {
      const node = findNode(op.id);
      if (!node) throw new Error(`set_collapsed: node not found: ${op.id}`);
      if (node.type !== "column" && node.type !== "group") {
        throw new Error(`set_collapsed: node is not a container (column/group): ${op.id}`);
      }
      const collapsed = op.collapsed === undefined ? true : Boolean(op.collapsed);
      node.isCollapsed = collapsed;
      node.updatedAt = nowMs;
      applied.push({ op: "set_collapsed", id: op.id, collapsed });
      continue;
    }

    if (kind === "relayout_mindmap") {
      const groupId = op.id || op.group_id;
      if (!groupId) throw new Error("relayout_mindmap requires 'id' (group id)");
      const group = findNode(groupId);
      if (!group || group.type !== "group") {
        throw new Error(`relayout_mindmap: group not found or not a group: ${groupId}`);
      }
      const patch = op.patch || {};
      if (!patch || typeof patch !== "object" || !Object.keys(patch).length) {
        throw new Error("relayout_mindmap requires non-empty 'patch'");
      }
      if ("groupMode" in patch) {
        if (![null, "mindmap", "normal"].includes(patch.groupMode)) {
          throw new Error("relayout_mindmap: groupMode must be 'mindmap' or 'normal'");
        }
        group.groupMode = patch.groupMode;
      }
      if (patch.mindmap && typeof patch.mindmap === "object") {
        const nextMindmap = { ...(group.mindmap || {}) };
        Object.entries(patch.mindmap).forEach(([key, value]) => {
          nextMindmap[key] = value;
        });
        if (nextMindmap.rootId && !nodeExists(nextMindmap.rootId)) {
          throw new Error(`relayout_mindmap: rootId does not exist: ${nextMindmap.rootId}`);
        }
        group.mindmap = nextMindmap;
      }
      group.updatedAt = nowMs;
      applied.push({ op: "relayout_mindmap", id: groupId });
      continue;
    }

    throw new Error(`Unsupported operation: ${kind}`);
  }

  // Containment reconcile (WS5-3) — shared with the live Y.Doc executor so both converge.
  reconcileContainment(nodes);

  // Provenance (WS5-5): stamp who created/updated each touched entity from the request actor.
  // Single post-loop pass over `applied` — covers every op without per-branch churn. The OPEN
  // state/origin are never set here (the layer above owns them); `ai` is derived for agents.
  if (actor && typeof actor === "object" && typeof actor.actor === "string") {
    const actorObj = { actor: actor.actor };
    if (actor.id != null) actorObj.id = String(actor.id);
    if (actor.model != null) actorObj.model = String(actor.model);
    const createdOps = new Set(["add_node", "add_connection", "group_nodes"]);
    for (const entry of applied) {
      if (!entry || !entry.id) continue;
      const entity = findNode(entry.id) || findConn(entry.id);
      if (!entity) continue;
      const prov = entity.provenance && typeof entity.provenance === "object" ? entity.provenance : {};
      if (createdOps.has(entry.op)) {
        if (!prov.createdBy) prov.createdBy = actorObj;
        if (actorObj.actor === "agent") entity.ai = true;
      }
      prov.updatedBy = actorObj;
      entity.provenance = prov;
    }
  }

  const validationError = finalValidate(nodes, connections);
  if (validationError) {
    throw new Error(`Validation failed: ${validationError}`);
  }

  baseDoc.nodes = stripMediaSignedUrls(nodes);
  baseDoc.connections = connections;
  baseDoc.updatedAt = nowMs;
  baseDoc.version = String(baseDoc.version || "1.0.0");

  return {
    doc: baseDoc,
    applied,
    idMap,
    warnings,
    updatedAt: nowMs,
  };
};
