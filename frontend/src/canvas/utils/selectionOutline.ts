import type { Canvas, CanvasConnection, CanvasNode, TableNode } from '../types/canvas';
import { tableNodeToMarkdown } from '../stores/outlineSelectors';

interface OutlineTreeNode {
  id: string;
  depth: number;
  children: OutlineTreeNode[];
}

function firstLine(text: string): string {
  if (!text) return '';
  const idx = text.indexOf('\n');
  const ln = idx === -1 ? text : text.slice(0, idx);
  return ln.trim();
}

function getDisplayTitle(node: CanvasNode): string {
  const t = node.title && node.title.trim();
  const c = firstLine(node.content || '');
  if (node.type === 'canvas-link') {
    return (t || c || '').trim();
  }
  if (node.type === 'column' || node.type === 'group') {
    const columnText = c || (t || '');
    return columnText.trim();
  }
  return c;
}

function isContainer(node: CanvasNode): boolean {
  return node.type === 'group' || node.type === 'column';
}

function collectChildren(container: CanvasNode, allNodes: CanvasNode[], selected: Set<string>): string[] {
  const explicit = Array.isArray(container.children) ? container.children : [];
  const implicit = allNodes.filter(n => n.parentGroupId === container.id).map(n => n.id);
  const set = new Set<string>();
  explicit.forEach(id => { if (selected.has(id)) set.add(id); });
  implicit.forEach(id => { if (selected.has(id)) set.add(id); });
  return Array.from(set);
}

function topoOrder(
  ids: string[],
  edges: CanvasConnection[],
  nodesById: Map<string, CanvasNode>,
): string[] {
  const idSet = new Set(ids);
  const inDeg = new Map<string, number>();
  ids.forEach(id => inDeg.set(id, 0));
  const adj = new Map<string, string[]>();
  ids.forEach(id => adj.set(id, []));
  for (const e of edges) {
    if (idSet.has(e.from) && idSet.has(e.to)) {
      inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
      adj.get(e.from)!.push(e.to);
    }
  }
  const queue: string[] = [];
  ids.forEach(id => { if ((inDeg.get(id) || 0) === 0) queue.push(id); });
  queue.sort((a, b) => {
    const na = nodesById.get(a)!; const nb = nodesById.get(b)!;
    if (na.createdAt !== nb.createdAt) return na.createdAt - nb.createdAt;
    if (na.y !== nb.y) return na.y - nb.y;
    if (na.x !== nb.x) return na.x - nb.x;
    return getDisplayTitle(na).localeCompare(getDisplayTitle(nb));
  });
  const out: string[] = [];
  const pushQueue = (nid: string) => {
    out.push(nid);
    for (const nx of adj.get(nid) || []) {
      inDeg.set(nx, (inDeg.get(nx) || 0) - 1);
      if ((inDeg.get(nx) || 0) === 0) queue.push(nx);
    }
    queue.sort((a, b) => {
      const na = nodesById.get(a)!; const nb = nodesById.get(b)!;
      if (na.createdAt !== nb.createdAt) return na.createdAt - nb.createdAt;
      if (na.y !== nb.y) return na.y - nb.y;
      if (na.x !== nb.x) return na.x - nb.x;
      return getDisplayTitle(na).localeCompare(getDisplayTitle(nb));
    });
  };
  while (queue.length) {
    const cur = queue.shift()!;
    pushQueue(cur);
  }
  if (out.length < ids.length) {
    const remaining = ids.filter(id => !out.includes(id));
    remaining.sort((a, b) => {
      const na = nodesById.get(a)!; const nb = nodesById.get(b)!;
      if (na.createdAt !== nb.createdAt) return na.createdAt - nb.createdAt;
      if (na.y !== nb.y) return na.y - nb.y;
      if (na.x !== nb.x) return na.x - nb.x;
      return getDisplayTitle(na).localeCompare(getDisplayTitle(nb));
    });
    out.push(...remaining);
  }
  return out;
}

function buildSelectionOutlineTree(canvas: Canvas, selectedIds: string[]): OutlineTreeNode[] {
  const selected = new Set(selectedIds);
  const nodes = (canvas.nodes || []).filter(n => selected.has(n.id));
  const nodesById = new Map<string, CanvasNode>();
  nodes.forEach(n => nodesById.set(n.id, n));
  const selectedConnections = (canvas.connections || []).filter(
    c => selected.has(c.from) && selected.has(c.to),
  );
  const containers = nodes.filter(isContainer);
  const rootContainers = containers.filter(n => !n.parentGroupId || !selected.has(n.parentGroupId));

  const visited = new Set<string>();
  const includedIds = new Set<string>();

  const walk = (container: CanvasNode, depth: number): OutlineTreeNode => {
    if (visited.has(container.id)) {
      return { id: container.id, depth, children: [] };
    }
    visited.add(container.id);
    includedIds.add(container.id);
    const childIds = collectChildren(container, nodes, selected);
    const childContainers: string[] = [];
    const childOthers: string[] = [];
    for (const id of childIds) {
      const n = nodesById.get(id);
      if (!n) continue;
      if (isContainer(n)) childContainers.push(id); else childOthers.push(id);
    }
    childContainers.sort((a, b) => {
      const na = nodesById.get(a)!; const nb = nodesById.get(b)!;
      if (na.createdAt !== nb.createdAt) return na.createdAt - nb.createdAt;
      return getDisplayTitle(na).localeCompare(getDisplayTitle(nb));
    });
    const orderedOthers = topoOrder(childOthers, selectedConnections, nodesById);
    const children: OutlineTreeNode[] = [];
    for (const cid of childContainers) {
      const cn = nodesById.get(cid)!;
      children.push(walk(cn, Math.min(depth + 1, 6)));
    }
    for (const oid of orderedOthers) {
      const n = nodesById.get(oid)!;
      includedIds.add(n.id);
      children.push({
        id: n.id,
        depth: Math.min(depth + 1, 6),
        children: [],
      });
    }
    return { id: container.id, depth, children };
  };

  if (rootContainers.length === 0) {
    const others = nodes.filter(n => !isContainer(n));
    const ids = others.map(n => n.id);
    const ordered = topoOrder(ids, selectedConnections, nodesById);
    return ordered.map(id => ({
      id,
      depth: 2,
      children: [],
    }));
  }

  rootContainers.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return getDisplayTitle(a).localeCompare(getDisplayTitle(b));
  });
  const tree = rootContainers.map(rc => walk(rc, 2));

  const freeIds = nodes
    .filter(n => !isContainer(n) && !includedIds.has(n.id))
    .map(n => n.id);
  if (freeIds.length > 0) {
    const ordered = topoOrder(freeIds, selectedConnections, nodesById);
    for (const id of ordered) {
      tree.push({
        id,
        depth: 2,
        children: [],
      });
    }
  }
  return tree;
}

function getNodeContent(node: CanvasNode): string {
  if (node.type === 'table') {
    return tableNodeToMarkdown(node as TableNode);
  }
  return node.content || '';
}

export function buildSelectionOutlineMarkdown(canvas: Canvas, selectedIds: string[]): string {
  if (!canvas || !selectedIds || selectedIds.length === 0) return '';
  const selected = new Set(selectedIds);
  const nodes = (canvas.nodes || []).filter(n => selected.has(n.id));
  if (nodes.length === 0) return '';
  const nodesById = new Map<string, CanvasNode>();
  nodes.forEach(n => nodesById.set(n.id, n));

  const tree = buildSelectionOutlineTree(canvas, selectedIds);
  const lines: string[] = [];
  const walk = (node: OutlineTreeNode) => {
    const n = nodesById.get(node.id);
    if (!n) return;
    const title = getDisplayTitle(n);
    const level = Math.max(2, Math.min(6, node.depth));
    if (title) {
      lines.push(`${'#'.repeat(level)} ${title}`);
    }
    const content = getNodeContent(n).trim();
    if (content) {
      lines.push(content);
    }
    lines.push('');
    if (node.children && node.children.length > 0) {
      node.children.forEach(child => walk(child));
    }
  };
  tree.forEach(node => walk(node));

  const relations = (canvas.connections || [])
    .filter(c => selected.has(c.from) && selected.has(c.to))
    .map(c => {
      const from = nodesById.get(c.from);
      const to = nodesById.get(c.to);
      if (!from || !to) return null;
      const fromTitle = getDisplayTitle(from);
      const toTitle = getDisplayTitle(to);
      if (!fromTitle || !toTitle) return null;
      const label = (c.label || '').trim();
      if (label) return `- ${fromTitle} --${label}--> ${toTitle}`;
      return `- ${fromTitle} --> ${toTitle}`;
    })
    .filter(Boolean) as string[];

  if (relations.length > 0) {
    lines.push('## Relations');
    lines.push(...relations);
  }

  return lines.join('\n').trim();
}
