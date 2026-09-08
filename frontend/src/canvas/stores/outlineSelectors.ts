import type { Canvas, CanvasNode, CanvasConnection, TableNode } from '../../types/canvas';

export interface OutlineTreeNode {
  id: string;
  kind: 'container' | 'note' | 'todo' | 'table' | 'other';
  title: string;
  depth: number; // H2=2 for root containers
  children: OutlineTreeNode[];
  completed?: boolean; // for todo nodes
}

function firstLine(text: string): string {
  if (!text) return '';
  const idx = text.indexOf('\n');
  const ln = idx === -1 ? text : text.slice(0, idx);
  return ln.trim();
}

function getDisplayTitle(node: CanvasNode): string {
  // 规则：
  // - canvas-link：优先使用 title，回退 content 首行
  // - group/column：使用 content 首行（兼容旧数据：若 content 为空则回退 title 再取首行）
  // - 其他类型：一律使用 content 首行（忽略多余的 title）
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

function collectChildren(container: CanvasNode, allNodes: CanvasNode[]): string[] {
  const explicit = Array.isArray(container.children) ? container.children : [];
  // also include nodes that reference parentGroupId = container.id (safety)
  const implicit = allNodes.filter(n => n.parentGroupId === container.id).map(n => n.id);
  // merge uniques preserving explicit order first
  const set = new Set<string>();
  explicit.forEach(id => set.add(id));
  implicit.forEach(id => set.add(id));
  return Array.from(set);
}

function topoOrder(ids: string[], edges: CanvasConnection[], nodesById: Map<string, CanvasNode>): string[] {
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
  // queue init
  const queue: string[] = [];
  ids.forEach(id => { if ((inDeg.get(id) || 0) === 0) queue.push(id); });
  // stable order by createdAt then position
  queue.sort((a,b) => {
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
    queue.sort((a,b) => {
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
  // if cycle, append remaining by stable fallback
  if (out.length < ids.length) {
    const remaining = ids.filter(id => !out.includes(id));
    remaining.sort((a,b) => {
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

export function getOutgoingEdges(canvas: Canvas, nodeId: string): Array<{ label: string; targetId: string }>{
  const edges = canvas.connections || [];
  return edges.filter(e => e.from === nodeId && !!e.to).map(e => ({ label: e.label || '', targetId: e.to }));
}

export function getNodeDisplayTitle(canvas: Canvas, nodeId: string): string {
  const node = (canvas.nodes || []).find(n => n.id === nodeId);
  if (!node) return nodeId;
  return getDisplayTitle(node) || nodeId;
}

// New: Get incoming edges for a node
export function getIncomingEdges(canvas: Canvas, nodeId: string): Array<{ label: string; sourceId: string }>{
  const edges = canvas.connections || [];
  return edges.filter(e => e.to === nodeId && !!e.from).map(e => ({ label: e.label || '', sourceId: e.from }));
}

export function tableNodeToMarkdown(node: TableNode): string {
  const data = node.data;
  const esc = (s: string) => (s ?? '').replace(/\|/g, '\\|');
  if (!data || !Array.isArray(data.rows) || data.rows.length === 0) return '';
  const [headerRow, ...bodyRows] = data.rows;
  const headers = (headerRow || []).map(esc);
  if (headers.length === 0) return '';
  const headerLine = `| ${headers.join(' | ')} |`;
  const sepLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const rowLines = bodyRows.map(r => `| ${(r || []).map(esc).join(' | ')} |`);
  return [headerLine, sepLine, ...rowLines].join('\n');
}

// New: Build a tree for collapsible outline
function classifyKind(n: CanvasNode): 'container' | 'note' | 'todo' | 'table' | 'other' {
  if (n.type === 'group' || n.type === 'column') return 'container';
  if (n.type === 'todo') return 'todo';
  if (n.type === 'table') return 'table';
  if (n.type === 'text' || n.type === 'code' || n.type === 'canvas-link' || n.type === 'media') return 'note';
  return 'other';
}

export function buildOutlineTree(canvas: Canvas): OutlineTreeNode[] {
  const nodes = canvas.nodes || [];
  const nodesById = new Map<string, CanvasNode>();
  nodes.forEach(n => nodesById.set(n.id, n));
  const containers = nodes.filter(n => classifyKind(n) === 'container');
  const rootContainers = containers.filter(n => !n.parentGroupId);

  const visited = new Set<string>();
  // Track all node ids that are included via container traversal to avoid omission or duplication
  const includedIds = new Set<string>();

  const walk = (container: CanvasNode, depth: number): OutlineTreeNode => {
    if (visited.has(container.id)) {
      return { id: container.id, kind: 'container', title: getDisplayTitle(container), depth, children: [] };
    }
    visited.add(container.id);
    includedIds.add(container.id);
    const childIds = collectChildren(container, nodes);
    const childContainers: string[] = [];
    const childOthers: string[] = [];
    for (const id of childIds) {
      const n = nodesById.get(id);
      if (!n) continue;
      if (classifyKind(n) === 'container') childContainers.push(id); else childOthers.push(id);
    }
    childContainers.sort((a,b) => {
      const na = nodesById.get(a)!; const nb = nodesById.get(b)!;
      if (na.createdAt !== nb.createdAt) return na.createdAt - nb.createdAt;
      return getDisplayTitle(na).localeCompare(getDisplayTitle(nb));
    });
    const orderedOthers = topoOrder(childOthers, canvas.connections || [], nodesById);
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
        kind: classifyKind(n),
        title: getDisplayTitle(n),
        depth: depth + 1,
        children: [],
        completed: n.type === 'todo' ? (n as any).completed : undefined
      });
    }
    return { id: container.id, kind: 'container', title: getDisplayTitle(container), depth, children };
  };

  // If no containers, create pseudo root heading and attach notes
  if (rootContainers.length === 0) {
    const others = nodes.filter(n => classifyKind(n) !== 'container');
    const ids = others.map(n => n.id);
    const ordered = topoOrder(ids, canvas.connections || [], nodesById);
    return ordered.map(id => {
      const n = nodesById.get(id)!;
      return {
        id: n.id,
        kind: classifyKind(n),
        title: getDisplayTitle(n),
        depth: 2,
        children: [],
        completed: n.type === 'todo' ? (n as any).completed : undefined
      };
    });
  }

  rootContainers.sort((a,b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return getDisplayTitle(a).localeCompare(getDisplayTitle(b));
  });
  const tree = rootContainers.map(rc => walk(rc, 2));

  // Also include any non-container nodes that are not under any container (free-floating nodes)
  const freeIds = nodes
    .filter(n => classifyKind(n) !== 'container' && !includedIds.has(n.id))
    .map(n => n.id);
  if (freeIds.length > 0) {
    const ordered = topoOrder(freeIds, canvas.connections || [], nodesById);
    for (const id of ordered) {
      const n = nodesById.get(id)!;
      tree.push({
        id: n.id,
        kind: classifyKind(n),
        title: getDisplayTitle(n),
        depth: 2,
        children: [],
        completed: n.type === 'todo' ? (n as any).completed : undefined
      });
    }
  }
  return tree;
}

export interface VisibleRow extends OutlineTreeNode { isLast: boolean; pathHasNext: boolean[]; hasChildren: boolean; }

export function flattenVisible(tree: OutlineTreeNode[], collapsed: Record<string, boolean>): VisibleRow[] {
  const out: VisibleRow[] = [];
  const dfs = (nodes: OutlineTreeNode[], ancestorsHasNext: boolean[]) => {
    nodes.forEach((node, idx) => {
      const isLast = idx === nodes.length - 1;
      const hasChildren = node.children && node.children.length > 0;
      out.push({ ...node, isLast, pathHasNext: ancestorsHasNext, hasChildren });
      if (hasChildren && !collapsed[node.id]) {
        dfs(node.children, [...ancestorsHasNext, !isLast]);
      }
    });
  };
  dfs(tree, []);
  return out;
}

// ===================== Anchor Forest + Outline VM (new) =====================
export interface LinkExpansion {
  sourceId: string;
  commonLabel?: string;
  targets: Array<LinkTarget>;
}

export interface LinkTarget {
  id: string;
  label?: string; // own edge label when commonLabel is not used
  expansion?: LinkExpansion; // nested expansion for multi-level
}

function stableNodeCompare(a: CanvasNode, b: CanvasNode): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  return getDisplayTitle(a).localeCompare(getDisplayTitle(b));
}

/**
 * Build anchor expansions so that each node is fully expanded under exactly one anchor (first-win assignment).
 * Anchors: nodes with outDegree>0 and inDegree==0; if none, fall back to the first node with outDegree>0.
 */
export function buildAnchorExpansions(canvas: Canvas): Map<string, LinkExpansion> {
  const expansions = new Map<string, LinkExpansion>();
  if (!canvas) return expansions;
  const nodes = canvas.nodes || [];
  const cons = canvas.connections || [];
  const nodesById = new Map<string, CanvasNode>();
  nodes.forEach(n => nodesById.set(n.id, n));

  // degrees
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  nodes.forEach(n => { inDeg.set(n.id, 0); outDeg.set(n.id, 0); });
  cons.forEach(c => {
    if (c.from && outDeg.has(c.from)) outDeg.set(c.from, (outDeg.get(c.from) || 0) + 1);
    if (c.to && inDeg.has(c.to)) inDeg.set(c.to, (inDeg.get(c.to) || 0) + 1);
  });

  // candidates & anchors
  const withOut = nodes.filter(n => (outDeg.get(n.id) || 0) > 0);
  withOut.sort(stableNodeCompare);
  const anchors: string[] = withOut.filter(n => (inDeg.get(n.id) || 0) === 0).map(n => n.id);
  if (anchors.length === 0 && withOut.length > 0) {
    // fallback: use the first node with outDegree>0
    anchors.push(withOut[0].id);
  }

  const assignedTo = new Map<string, string>(); // nodeId -> anchorId

  const buildExpansion = (sourceId: string, anchorId: string, localVisited: Set<string>, depth: number): LinkExpansion | null => {
    // collect edges from source
    const edges = (canvas.connections || []).filter(e => e.from === sourceId && !!e.to);
    if (edges.length === 0) return null;
    // filter targets by assignment (first-win)
    const filtered = edges.filter(e => {
      const t = e.to!;
      if (!nodesById.has(t)) return false;
      if (t === sourceId) return false; // self-loop skip
      if (assignedTo.has(t)) return false; // already owned/placed (either by this anchor earlier, or by other anchor)
      if (localVisited.has(t)) return false; // avoid local cycle
      return true;
    });
    if (filtered.length === 0) return null;
    // common label detection
    const labels = Array.from(new Set(filtered.map(e => (e.label || '').trim()).filter(Boolean)));
    const commonLabel = labels.length === 1 ? labels[0] : undefined;
    // order targets stably
    const targetsNodes = filtered
      .map(e => nodesById.get(e.to!)!)
      .filter(Boolean)
      .sort(stableNodeCompare);
    // rebuild filtered edges ordered by targetsNodes order
    const ordered: Array<{ edge: CanvasConnection; target: CanvasNode }> = [];
    for (const tn of targetsNodes) {
      const e = filtered.find(x => x.to === tn.id)!;
      ordered.push({ edge: e, target: tn });
    }

    const outTargets: LinkTarget[] = [];
    for (const { edge, target } of ordered) {
      assignedTo.set(target.id, anchorId);
      const nextVisited = new Set(localVisited);
      nextVisited.add(target.id);
      const childExpansion = buildExpansion(target.id, anchorId, nextVisited, depth + 1);
      outTargets.push({
        id: target.id,
        label: commonLabel ? undefined : ((edge.label || '').trim() || undefined),
        expansion: childExpansion || undefined
      });
    }
    return { sourceId, commonLabel, targets: outTargets };
  };

  for (const anchorId of anchors) {
    // Pre-assign anchor to itself to avoid re-including anchor node as a target deeper in the tree
    assignedTo.set(anchorId, anchorId);
    const exp = buildExpansion(anchorId, anchorId, new Set<string>([anchorId]), 0);
    if (exp) expansions.set(anchorId, exp);
  }
  return expansions;
}
