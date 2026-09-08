import type { Canvas, CanvasNode, CanvasConnection } from '../../../../types/canvas';
import { contentTimingAnalyzer } from './ContentTimingAnalyzer';

export interface PathNode {
  node: CanvasNode;
  focusPercentage: number;        // 0..1 视野占比
  duration: number;                // 停留时长(ms)
}

export interface AnalyzedPath {
  name: string;
  nodes: PathNode[];
}

type TransitionSpeed = 'slow' | 'medium' | 'fast' | 'adaptive';

const config = {
  focusPercentage: 0.7,
  transitionSpeed: 'adaptive' as TransitionSpeed,
};

let cached: { key: string; result: AnalyzedPath[] } | null = null;

type SortKey = { labelRank: number; createdAt: number; id: string };
type DirectedEdge = { from: string; to: string; label?: string };

function compareSortKey(a: SortKey, b: SortKey) {
  if (a.labelRank !== b.labelRank) return a.labelRank - b.labelRank;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

function extractLabelNumber(label?: string): number | null {
  if (!label) return null;
  const match = label.match(/-?\d+/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

function buildHiddenMindmapNodeIds(canvas: Canvas): Set<string> {
  const out = new Set<string>();
  const groups = (canvas.nodes || []).filter((n) => (n as any).type === 'group' && (n as any).mindmap);
  for (const g of groups as any[]) {
    const members = new Set<string>((g.children || []) as string[]);
    const edges = (canvas.connections || []).filter((e) => members.has(e.from) && members.has(e.to));
    const fromMap = new Map<string, string[]>();
    for (const e of edges) {
      if (!fromMap.has(e.from)) fromMap.set(e.from, []);
      fromMap.get(e.from)!.push(e.to);
    }
    const collapsed: Record<string, boolean> = (g.mindmap?.collapsed || {}) as any;
    const roots = Object.keys(collapsed).filter((id) => collapsed[id]);
    for (const rid of roots) {
      const q = [rid];
      const seen = new Set<string>([rid]);
      while (q.length) {
        const u = q.shift()!;
        const nexts = fromMap.get(u) || [];
        for (const v of nexts) {
          if (!seen.has(v)) {
            seen.add(v);
            q.push(v);
            if (v !== rid) out.add(v);
          }
        }
      }
    }
  }
  return out;
}

function buildHiddenNodeIds(canvas: Canvas): Set<string> {
  const hidden = buildHiddenMindmapNodeIds(canvas);
  (canvas.nodes || []).forEach((n) => {
    if ((n as any).type === 'column' && (n as any).isCollapsed) {
      (n.children || []).forEach((id) => hidden.add(id));
    }
  });
  return hidden;
}

function getVisibleNodesForPlayback(canvas: Canvas): CanvasNode[] {
  const hiddenIds = buildHiddenNodeIds(canvas);
  return (canvas.nodes || []).filter((node) => !hiddenIds.has(node.id));
}

function isMindmapInternalConnection(
  connection: CanvasConnection,
  fromNode: CanvasNode,
  toNode: CanvasNode,
  nodeById: Map<string, CanvasNode>
) {
  if (!fromNode.parentGroupId || fromNode.parentGroupId !== toNode.parentGroupId) return false;
  const group = nodeById.get(fromNode.parentGroupId);
  return Boolean(group && (group as any).type === 'group' && (group as any).mindmap);
}

function buildUndirectedAdjacency(nodeIds: string[]) {
  const adj = new Map<string, Set<string>>();
  nodeIds.forEach((id) => adj.set(id, new Set()));
  return adj;
}

function getConnectedComponents(nodeIds: string[], adj: Map<string, Set<string>>) {
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const id of nodeIds) {
    if (visited.has(id)) continue;
    const q = [id];
    const comp: string[] = [];
    visited.add(id);
    while (q.length) {
      const cur = q.shift()!;
      comp.push(cur);
      for (const nei of adj.get(cur) || []) {
        if (!visited.has(nei)) {
          visited.add(nei);
          q.push(nei);
        }
      }
    }
    components.push(comp);
  }
  return components;
}

function orderComponent(nodeIds: string[], directedEdges: DirectedEdge[], nodeById: Map<string, CanvasNode>) {
  const nodeSet = new Set(nodeIds);
  const indegree = new Map<string, number>();
  const outMap = new Map<string, string[]>();
  const incomingLabelRank = new Map<string, number>();
  nodeIds.forEach((id) => {
    indegree.set(id, 0);
    outMap.set(id, []);
    incomingLabelRank.set(id, Number.POSITIVE_INFINITY);
  });
  for (const edge of directedEdges) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) continue;
    outMap.get(edge.from)!.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
    const labelRank = extractLabelNumber(edge.label);
    if (labelRank !== null) {
      const current = incomingLabelRank.get(edge.to) ?? Number.POSITIVE_INFINITY;
      if (labelRank < current) incomingLabelRank.set(edge.to, labelRank);
    }
  }

  const getSortKey = (id: string): SortKey => {
    const node = nodeById.get(id);
    return {
      labelRank: incomingLabelRank.get(id) ?? Number.POSITIVE_INFINITY,
      createdAt: typeof node?.createdAt === 'number' ? node.createdAt : 0,
      id,
    };
  };

  const remaining = new Set(nodeIds);
  const available = new Set<string>(nodeIds.filter((id) => (indegree.get(id) || 0) === 0));
  const ordered: string[] = [];
  let componentKey: SortKey | null = null;

  while (remaining.size > 0) {
    const source = available.size > 0 ? available : remaining;
    let bestId: string | null = null;
    let bestKey: SortKey | null = null;
    for (const id of source) {
      const key = getSortKey(id);
      if (!bestKey || compareSortKey(key, bestKey) < 0) {
        bestKey = key;
        bestId = id;
      }
    }
    if (!bestId || !bestKey) break;
    if (!componentKey) componentKey = bestKey;
    ordered.push(bestId);
    remaining.delete(bestId);
    available.delete(bestId);
    for (const to of outMap.get(bestId) || []) {
      if (!remaining.has(to)) continue;
      indegree.set(to, (indegree.get(to) || 0) - 1);
      if ((indegree.get(to) || 0) === 0) available.add(to);
    }
  }

  return {
    ordered,
    componentKey: componentKey ?? getSortKey(nodeIds[0]),
  };
}

function buildOrderedNodes(canvas: Canvas): CanvasNode[] {
  const visibleNodes = getVisibleNodesForPlayback(canvas);
  if (visibleNodes.length === 0) return [];
  const nodeById = new Map<string, CanvasNode>(visibleNodes.map((n) => [n.id, n]));
  const nodeIds = visibleNodes.map((n) => n.id);
  const adj = buildUndirectedAdjacency(nodeIds);
  const directedEdges: DirectedEdge[] = [];
  const connections = canvas.connections || [];

  for (const c of connections) {
    if (c.fromPoint || c.toPoint) continue;
    const fromNode = nodeById.get(c.from);
    const toNode = nodeById.get(c.to);
    if (!fromNode || !toNode) continue;
    adj.get(fromNode.id)!.add(toNode.id);
    adj.get(toNode.id)!.add(fromNode.id);

    if (isMindmapInternalConnection(c, fromNode, toNode, nodeById)) continue;

    const arrow = (c as any).appearance?.arrow || {};
    const aStart = Boolean(arrow.start);
    const aEnd = arrow.end === undefined ? true : Boolean(arrow.end);
    if (!aStart && !aEnd) continue;
    if (aEnd) directedEdges.push({ from: fromNode.id, to: toNode.id, label: c.label });
    if (aStart) directedEdges.push({ from: toNode.id, to: fromNode.id, label: c.label });
  }

  const components = getConnectedComponents(nodeIds, adj);
  const orderedComponents = components.map((comp) => orderComponent(comp, directedEdges, nodeById));
  orderedComponents.sort((a, b) => compareSortKey(a.componentKey, b.componentKey));
  const orderedIds = orderedComponents.flatMap((comp) => comp.ordered);
  return orderedIds.map((id) => nodeById.get(id)).filter(Boolean) as CanvasNode[];
}

export const pathAnalyzer = {
  getConfig() { return { ...config }; },
  updateConfig(partial: Partial<typeof config>) {
    if (partial.focusPercentage !== undefined) config.focusPercentage = partial.focusPercentage;
    if (partial.transitionSpeed !== undefined) config.transitionSpeed = partial.transitionSpeed as TransitionSpeed;
    cached = null;
  },
  clearPathAnalysisCache() { cached = null; },

  analyzeCanvas(canvas: Canvas): AnalyzedPath[] {
    const key = `${canvas.id}:${canvas.updatedAt}:${canvas.nodes.length}:${canvas.connections?.length || 0}`;
    if (cached && cached.key === key) return cached.result;
    const order = buildOrderedNodes(canvas);
    const nodes: PathNode[] = order.map((n) => {
      const timing = contentTimingAnalyzer.analyze(n);
      return {
        node: n,
        focusPercentage: config.focusPercentage,
        duration: timing.recommendedDuration,
      };
    });
    const result = nodes.length ? [{ name: 'Auto Path', nodes }] : [];
    cached = { key, result };
    return result;
  }
};
