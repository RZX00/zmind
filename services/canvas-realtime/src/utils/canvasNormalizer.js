import { extractStoragePathFromUrl } from "./mediaPath.js";

const nowMs = () => Date.now();

const isoToMs = (value) => {
  if (!value) {
    return nowMs();
  }
  try {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    const normalized = String(value).replace("Z", "+00:00");
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : nowMs();
  } catch (error) {
    return nowMs();
  }
};

const normalizeMediaNode = (node) => {
  if (!node || typeof node !== "object") {
    return node;
  }
  if (node.type !== "media") {
    return node;
  }
  const cloned = { ...node };
  if (!cloned.storagePath) {
    const candidate = cloned.fileUrl || cloned.fileDownloadUrl;
    const derived = extractStoragePathFromUrl(candidate);
    if (derived) {
      cloned.storagePath = derived;
    }
  }
  delete cloned.fileUrl;
  delete cloned.fileDownloadUrl;
  return cloned;
};

const mergeMetadataIntoDoc = (doc) => {
  if (!doc || typeof doc !== "object") {
    return;
  }
  const metadata = doc.metadata;
  if (!metadata || typeof metadata !== "object") {
    return;
  }
  const anchors = metadata.connectionAnchors || {};
  const anchorParams = metadata.connectionAnchorParams || {};
  const styles = metadata.connectionStyles || {};
  const attachments = metadata.groupAttachments || {};

  if (Array.isArray(doc.nodes)) {
    doc.nodes.forEach((node) => {
      if (!node || node.type !== "group") {
        return;
      }
      if (
        Array.isArray(node.attachedConnections) &&
        node.attachedConnections.length > 0
      ) {
        return;
      }
      const att = attachments[node.id];
      if (Array.isArray(att) && att.length) {
        node.attachedConnections = [...att];
      }
    });
  }

  if (Array.isArray(doc.connections)) {
    doc.connections.forEach((connection) => {
      if (!connection || typeof connection !== "object") {
        return;
      }
      const cid = connection.id;
      if (!cid) {
        return;
      }
      const anchor = anchors[cid];
      if (anchor && !connection.curveAnchor) {
        connection.curveAnchor = { x: anchor.x, y: anchor.y };
      }
      const params = anchorParams[cid];
      if (params && !connection.anchorParams) {
        connection.anchorParams = { u: params.u, v: params.v };
      }
      const style = styles[cid];
      if (style && !connection.appearance) {
        connection.appearance = style;
      }
    });
  }
};

export const composeCanvasDoc = (row) => {
  const doc = { ...(row?.doc ?? {}) };
  if (!doc.id && row?.id) {
    doc.id = row.id;
  }
  if (!doc.title && row?.title) {
    doc.title = row.title;
  }
  if (!doc.version && row?.version) {
    doc.version = row.version;
  }
  if (!doc.createdAt && row?.created_at) {
    doc.createdAt = isoToMs(row.created_at);
  }
  if (!doc.updatedAt && row?.updated_at) {
    doc.updatedAt = isoToMs(row.updated_at);
  }
  doc.nodes = Array.isArray(doc.nodes) ? doc.nodes.slice() : [];
  doc.nodes = doc.nodes.map((node) => normalizeMediaNode({ ...(node || {}) }));
  doc.connections = Array.isArray(doc.connections)
    ? doc.connections.slice()
    : [];
  mergeMetadataIntoDoc(doc);
  return doc;
};
