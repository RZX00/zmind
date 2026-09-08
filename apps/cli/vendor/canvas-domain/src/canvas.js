const { DomainError, DOMAIN_ERROR_CODES } = require('./errors');
const { deepMerge, isObject, nowIso } = require('./utils');

const CURRENT_CANVAS_SCHEMA_VERSION = 1;

function createCanvas(input, nowProvider) {
  const canvasId = String(input && input.canvasId ? input.canvasId : '').trim();
  const title = String(input && input.title ? input.title : '').trim();

  if (!canvasId) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
      'canvasId is required'
    );
  }
  if (!title) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
      'title is required'
    );
  }

  const timestamp = nowIso(nowProvider);
  return {
    schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
    canvasId,
    revision: 1,
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [],
    edges: [],
    metadata: {},
  };
}

function validateCanvasSnapshot(snapshot) {
  if (!isObject(snapshot)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.VALIDATION_FAILED,
      'snapshot must be an object'
    );
  }

  assertString(snapshot.canvasId, 'canvasId');
  assertString(snapshot.title, 'title');
  assertPositiveInteger(snapshot.schemaVersion, 'schemaVersion');
  assertPositiveInteger(snapshot.revision, 'revision');

  if (!Array.isArray(snapshot.nodes)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.VALIDATION_FAILED,
      'nodes must be an array'
    );
  }
  if (!Array.isArray(snapshot.edges)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.VALIDATION_FAILED,
      'edges must be an array'
    );
  }

  const nodeIdSet = new Set();
  for (const node of snapshot.nodes) {
    validateNode(node);
    if (nodeIdSet.has(node.id)) {
      throw new DomainError(
        DOMAIN_ERROR_CODES.DUPLICATE_NODE_ID,
        `duplicate node id: ${node.id}`
      );
    }
    nodeIdSet.add(node.id);
  }

  const edgeIdSet = new Set();
  for (const edge of snapshot.edges) {
    validateEdge(edge);
    if (edgeIdSet.has(edge.id)) {
      throw new DomainError(
        DOMAIN_ERROR_CODES.DUPLICATE_EDGE_ID,
        `duplicate edge id: ${edge.id}`
      );
    }
    edgeIdSet.add(edge.id);

    if (!nodeIdSet.has(edge.from) || !nodeIdSet.has(edge.to)) {
      throw new DomainError(
        DOMAIN_ERROR_CODES.EDGE_ENDPOINT_INVALID,
        `edge endpoints must reference existing nodes: ${edge.id}`,
        { edgeId: edge.id }
      );
    }
  }

  return true;
}

function addNode(snapshot, input, nowProvider) {
  validateCanvasSnapshot(snapshot);
  const node = normalizeNodeInput(input);

  if (snapshot.nodes.some((item) => item.id === node.id)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.DUPLICATE_NODE_ID,
      `duplicate node id: ${node.id}`
    );
  }

  const next = cloneSnapshot(snapshot);
  next.nodes.push(node);
  bumpRevision(next, nowProvider);
  return next;
}

function updateNode(snapshot, input, nowProvider) {
  validateCanvasSnapshot(snapshot);
  const nodeId = String(input && input.nodeId ? input.nodeId : '').trim();
  const patch = input ? input.patch : null;

  if (!nodeId) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
      'nodeId is required'
    );
  }
  if (!isObject(patch)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
      'patch must be an object'
    );
  }

  const index = snapshot.nodes.findIndex((item) => item.id === nodeId);
  if (index < 0) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.NODE_NOT_FOUND,
      `node not found: ${nodeId}`
    );
  }

  const next = cloneSnapshot(snapshot);
  const currentNode = next.nodes[index];
  next.nodes[index] = deepMerge(currentNode, patch);

  // Node identity is immutable.
  next.nodes[index].id = currentNode.id;

  validateNode(next.nodes[index]);
  bumpRevision(next, nowProvider);
  return next;
}

function addEdge(snapshot, input, nowProvider) {
  validateCanvasSnapshot(snapshot);
  const edge = normalizeEdgeInput(input);

  if (snapshot.edges.some((item) => item.id === edge.id)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.DUPLICATE_EDGE_ID,
      `duplicate edge id: ${edge.id}`
    );
  }

  const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
  if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.EDGE_ENDPOINT_INVALID,
      'edge endpoints must reference existing nodes',
      { edge }
    );
  }

  const next = cloneSnapshot(snapshot);
  next.edges.push(edge);
  bumpRevision(next, nowProvider);
  return next;
}

function updateEdge(snapshot, input, nowProvider) {
  validateCanvasSnapshot(snapshot);
  const edgeId = String(input && input.edgeId ? input.edgeId : '').trim();
  const patch = input ? input.patch : null;

  if (!edgeId) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
      'edgeId is required'
    );
  }
  if (!isObject(patch)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
      'patch must be an object'
    );
  }

  const index = snapshot.edges.findIndex((item) => item.id === edgeId);
  if (index < 0) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.EDGE_NOT_FOUND,
      `edge not found: ${edgeId}`
    );
  }

  const next = cloneSnapshot(snapshot);
  const currentEdge = next.edges[index];
  next.edges[index] = deepMerge(currentEdge, patch);
  next.edges[index].id = currentEdge.id;

  validateEdge(next.edges[index]);
  assertEdgeEndpointsExist(next.nodes, next.edges[index]);
  bumpRevision(next, nowProvider);
  return next;
}

function removeNode(snapshot, input, nowProvider) {
  validateCanvasSnapshot(snapshot);
  const nodeId = String(input && input.nodeId ? input.nodeId : '').trim();

  if (!nodeId) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
      'nodeId is required'
    );
  }

  const exists = snapshot.nodes.some((item) => item.id === nodeId);
  if (!exists) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.NODE_NOT_FOUND,
      `node not found: ${nodeId}`
    );
  }

  const next = cloneSnapshot(snapshot);
  next.nodes = next.nodes.filter((item) => item.id !== nodeId);
  next.edges = next.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  bumpRevision(next, nowProvider);
  return next;
}

function removeEdge(snapshot, input, nowProvider) {
  validateCanvasSnapshot(snapshot);
  const edgeId = String(input && input.edgeId ? input.edgeId : '').trim();

  if (!edgeId) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
      'edgeId is required'
    );
  }

  const exists = snapshot.edges.some((item) => item.id === edgeId);
  if (!exists) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.EDGE_NOT_FOUND,
      `edge not found: ${edgeId}`
    );
  }

  const next = cloneSnapshot(snapshot);
  next.edges = next.edges.filter((item) => item.id !== edgeId);
  bumpRevision(next, nowProvider);
  return next;
}

function replaceCanvas(snapshot, input, nowProvider) {
  validateCanvasSnapshot(snapshot);

  const title = String(input && input.title ? input.title : snapshot.title).trim();
  const nodesInput = input && Object.prototype.hasOwnProperty.call(input, 'nodes')
    ? input.nodes
    : snapshot.nodes;
  const edgesInput = input && Object.prototype.hasOwnProperty.call(input, 'edges')
    ? input.edges
    : snapshot.edges;

  if (!title) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
      'title is required'
    );
  }
  if (!Array.isArray(nodesInput)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
      'nodes must be an array'
    );
  }
  if (!Array.isArray(edgesInput)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
      'edges must be an array'
    );
  }

  const metadata = input && Object.prototype.hasOwnProperty.call(input, 'metadata')
    ? ensureMetadataObject(input.metadata)
    : ensureMetadataObject(snapshot.metadata);

  const next = {
    schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
    canvasId: snapshot.canvasId,
    revision: snapshot.revision + 1,
    title,
    createdAt: snapshot.createdAt,
    updatedAt: nowIso(nowProvider),
    nodes: nodesInput.map(cloneNodeForReplace),
    edges: edgesInput.map(cloneEdgeForReplace),
    metadata,
  };

  validateCanvasSnapshot(next);
  return next;
}

function normalizeNodeInput(input) {
  const id = String(input && input.id ? input.id : '').trim();
  const type = String(input && input.type ? input.type : '').trim();
  const x = Number(input && input.x);
  const y = Number(input && input.y);
  const data = input && isObject(input.data) ? input.data : {};

  if (!id || !type || Number.isNaN(x) || Number.isNaN(y)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
      'node requires id/type/x/y'
    );
  }

  return {
    id,
    type,
    x,
    y,
    data: { ...data },
  };
}

function normalizeEdgeInput(input) {
  const id = String(input && input.id ? input.id : '').trim();
  const from = String(input && input.from ? input.from : '').trim();
  const to = String(input && input.to ? input.to : '').trim();
  const type = String(input && input.type ? input.type : 'arrow').trim();

  if (!id || !from || !to) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
      'edge requires id/from/to'
    );
  }

  return { id, from, to, type };
}

function validateNode(node) {
  if (!isObject(node)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.VALIDATION_FAILED,
      'node must be an object'
    );
  }
  assertString(node.id, 'node.id');
  assertString(node.type, 'node.type');
  if (typeof node.x !== 'number' || typeof node.y !== 'number') {
    throw new DomainError(
      DOMAIN_ERROR_CODES.VALIDATION_FAILED,
      'node.x and node.y must be numbers'
    );
  }
  if (!isObject(node.data)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.VALIDATION_FAILED,
      'node.data must be an object'
    );
  }
}

function validateEdge(edge) {
  if (!isObject(edge)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.VALIDATION_FAILED,
      'edge must be an object'
    );
  }
  assertString(edge.id, 'edge.id');
  assertString(edge.from, 'edge.from');
  assertString(edge.to, 'edge.to');
}

function assertEdgeEndpointsExist(nodes, edge) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.EDGE_ENDPOINT_INVALID,
      `edge endpoints must reference existing nodes: ${edge.id}`,
      { edgeId: edge.id }
    );
  }
}

function cloneNodeForReplace(node) {
  if (!isObject(node)) {
    return node;
  }
  const nextData = isObject(node.data) ? { ...node.data } : {};
  return {
    ...node,
    data: nextData,
  };
}

function cloneEdgeForReplace(edge) {
  if (!isObject(edge)) {
    return edge;
  }
  return { ...edge };
}

function ensureMetadataObject(metadata) {
  return isObject(metadata) ? { ...metadata } : {};
}

function assertString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DomainError(
      DOMAIN_ERROR_CODES.VALIDATION_FAILED,
      `${fieldName} must be a non-empty string`
    );
  }
}

function assertPositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 1) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.VALIDATION_FAILED,
      `${fieldName} must be a positive integer`
    );
  }
}

function cloneSnapshot(snapshot) {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => ({ ...node, data: { ...node.data } })),
    edges: snapshot.edges.map((edge) => ({ ...edge })),
    metadata: isObject(snapshot.metadata) ? { ...snapshot.metadata } : {},
  };
}

function bumpRevision(snapshot, nowProvider) {
  snapshot.revision += 1;
  snapshot.updatedAt = nowIso(nowProvider);
}

module.exports = {
  CURRENT_CANVAS_SCHEMA_VERSION,
  createCanvas,
  validateCanvasSnapshot,
  addNode,
  updateNode,
  addEdge,
  updateEdge,
  removeNode,
  removeEdge,
  replaceCanvas,
};
