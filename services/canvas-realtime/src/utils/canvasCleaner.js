import { extractStoragePathFromUrl } from "./mediaPath.js";

const DEFAULT_NODE_TITLES = new Set([
  "文本节点",
  "待办事项",
  "节点",
  "HTML节点",
  "代码节点",
  "表格",
  "Mermaid图表",
  "Column",
  "画布链接",
]);

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value);

const cloneIfNeeded = (value) => {
  if (Array.isArray(value)) {
    return value.map(cloneIfNeeded);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        cloneIfNeeded(entryValue),
      ]),
    );
  }
  return value;
};

export const cleanNode = (node) => {
  if (!isPlainObject(node)) {
    return node;
  }
  const result = {};
  Object.entries(node).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    result[key] = cloneIfNeeded(value);
  });
  const nodeType = result.type;

  if (!result.parentGroupId) {
    delete result.parentGroupId;
  }

  if (result.selected !== undefined) {
    delete result.selected;
  }
  if (result.isEditing !== undefined) {
    delete result.isEditing;
  }
  if (result.locked === false) {
    delete result.locked;
  }

  if (nodeType !== "code") {
    delete result.codeType;
    delete result.mermaidTheme;
    delete result.mermaidThemeId;
  }

  if (nodeType === "media") {
    if (!result.storagePath) {
      const candidate = result.fileUrl || result.fileDownloadUrl;
      const derived = extractStoragePathFromUrl(candidate);
      if (derived) {
        result.storagePath = derived;
      }
    }
    delete result.fileUrl;
    delete result.fileDownloadUrl;
    delete result.localPath;
  }

  if (!["column", "canvas-link", "group"].includes(nodeType || "")) {
    const title = result.title;
    if (!title || DEFAULT_NODE_TITLES.has(title)) {
      delete result.title;
    }
  }

  return result;
};

export const cleanConnection = (connection) => {
  if (!isPlainObject(connection)) {
    return connection;
  }
  const result = {};
  Object.entries(connection).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    result[key] = cloneIfNeeded(value);
  });
  delete result.selected;
  return result;
};

export const cleanCanvasDoc = (doc) => {
  if (!isPlainObject(doc)) {
    return doc;
  }
  const result = {};
  Object.entries(doc).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    if (key === "nodes" || key === "connections") {
      return;
    }
    result[key] = cloneIfNeeded(value);
  });

  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  result.nodes = nodes.map((node) => cleanNode({ ...(node || {}) }));

  const connections = Array.isArray(doc.connections) ? doc.connections : [];
  result.connections = connections.map((connection) =>
    cleanConnection({ ...(connection || {}) }),
  );

  if (!result.folderId) {
    delete result.folderId;
  }
  if (result.groups === undefined) {
    delete result.groups;
  }

  return result;
};
