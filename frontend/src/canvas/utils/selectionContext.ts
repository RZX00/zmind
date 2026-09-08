import type { Canvas, CanvasNode, CanvasConnection } from '../types/canvas';

// SelectionContext: lightweight, no content, ids required; attachments only meta
export interface SelectionContextNodeMeta {
  id: string;
  type: CanvasNode['type'];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  parentGroupId?: string;
  groupMode?: CanvasNode['groupMode'];
  codeType?: CanvasNode['codeType'];
  // media/meta fields (no binaries)
  fileName?: string;
  fileType?: string;
  fileExtension?: string;
  fileSize?: number;
  mediaType?: CanvasNode['mediaType'];
  fileUrl?: string;
  fileDownloadUrl?: string;
  storagePath?: string;
  fileId?: string;
  localPath?: string;
}

export interface SelectionContextConnectionMeta {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface SelectionContextGroupMeta {
  id: string;
  groupMode?: CanvasNode['groupMode'];
  mindmap?: CanvasNode['mindmap'];
  children?: string[];
}

export interface SelectionContextMeta {
  canvas_id: string;
  selection_ts: number;
}

export interface SelectionContext {
  meta: SelectionContextMeta;
  nodes: SelectionContextNodeMeta[];
  connections?: SelectionContextConnectionMeta[];
  groups?: SelectionContextGroupMeta[];
}

const MAX_NODES = 100;
const MAX_CONNECTIONS = 160;
const MAX_GROUPS = 80;

function pickNodeMeta(n: CanvasNode): SelectionContextNodeMeta {
  return {
    id: n.id,
    type: n.type,
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
    parentGroupId: (n as any).parentGroupId,
    groupMode: (n as any).groupMode,
    codeType: n.codeType,
    // media/meta only (no binaries)
    fileName: (n as any).fileName,
    fileType: (n as any).fileType,
    fileExtension: (n as any).fileExtension,
    fileSize: (n as any).fileSize,
    mediaType: (n as any).mediaType,
    fileUrl: (n as any).fileUrl,
    fileDownloadUrl: (n as any).fileDownloadUrl,
    storagePath: (n as any).storagePath,
    fileId: (n as any).fileId,
    localPath: (n as any).localPath,
  };
}

function pickConnectionMeta(c: CanvasConnection): SelectionContextConnectionMeta {
  return { id: c.id, from: c.from, to: c.to, label: c.label };
}

export function buildSelectionContext(
  canvas: Canvas,
  selectedNodeIds: string[],
  selectedConnectionIds?: string[]
): SelectionContext | null {
  if (!canvas || !Array.isArray(selectedNodeIds)) return null;
  const explicitConnIdSet = new Set((selectedConnectionIds || []).filter((id): id is string => typeof id === 'string' && id.length > 0));
  const idSet = new Set(selectedNodeIds.filter((id): id is string => typeof id === 'string' && id.length > 0));
  const allConnections = canvas.connections || [];
  const explicitlySelectedConnections = allConnections.filter(c => explicitConnIdSet.has(c.id));

  if (idSet.size === 0 && explicitlySelectedConnections.length === 0) return null;

  let nodes = (canvas.nodes || []).filter(n => idSet.has(n.id));
  if (nodes.length === 0 && explicitlySelectedConnections.length > 0) {
    const endpointIds = new Set<string>();
    explicitlySelectedConnections.forEach((c) => {
      if (typeof c.from === 'string' && c.from.length > 0) endpointIds.add(c.from);
      if (typeof c.to === 'string' && c.to.length > 0) endpointIds.add(c.to);
    });
    nodes = (canvas.nodes || []).filter(n => endpointIds.has(n.id));
  }

  const limitedNodes = nodes.slice(0, MAX_NODES);
  const nodeMetas = limitedNodes.map(pickNodeMeta);

  // Optional connections: include those connecting two selected nodes
  const selIdsLimited = new Set(limitedNodes.map(n => n.id));
  let connections = (canvas.connections || [])
    .filter(c => selIdsLimited.has(c.from) && selIdsLimited.has(c.to))
    .map(pickConnectionMeta);
  // Include explicitly selected connections even if endpoints are not both selected
  if (explicitConnIdSet.size > 0) {
    const connSet = new Set(connections.map(c => c.id));
    const extra = allConnections
      .filter(c => explicitConnIdSet.has(c.id))
      .map(pickConnectionMeta)
      .filter(c => !connSet.has(c.id));
    if (extra.length) connections = [...connections, ...extra];
  }
  if (connections.length > MAX_CONNECTIONS) {
    connections = connections.slice(0, MAX_CONNECTIONS);
  }

  // Optional groups: include selected group nodes and referenced parent groups (if present as nodes)
  const groupNodes = limitedNodes.filter(n => n.type === 'group');
  const groupById = new Map<string, CanvasNode>();
  (canvas.nodes || []).forEach(n => { if (n.type === 'group') groupById.set(n.id, n); });
  const parentGroups = Array.from(new Set(limitedNodes.map(n => (n as any).parentGroupId).filter(Boolean) as string[]))
    .map(id => groupById.get(id))
    .filter(Boolean) as CanvasNode[];

  const groupMetaById = new Map<string, SelectionContextGroupMeta>();
  [...groupNodes, ...parentGroups].forEach((g) => {
    if (!g?.id || groupMetaById.has(g.id) || groupMetaById.size >= MAX_GROUPS) return;
    groupMetaById.set(g.id, {
      id: g.id,
      groupMode: (g as any).groupMode,
      mindmap: (g as any).mindmap,
      children: (g as any).children,
    });
  });
  const groupMetas: SelectionContextGroupMeta[] = Array.from(groupMetaById.values());

  const ctx: SelectionContext = {
    meta: { canvas_id: canvas.id, selection_ts: Date.now() },
    nodes: nodeMetas,
  };

  if (connections.length > 0) ctx.connections = connections;
  if (groupMetas.length > 0) ctx.groups = groupMetas;
  if (ctx.nodes.length === 0 && !ctx.connections?.length && !ctx.groups?.length) {
    return null;
  }
  return ctx;
}
