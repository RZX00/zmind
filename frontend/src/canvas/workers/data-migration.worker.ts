/// <reference lib="webworker" />

// Data migration worker: performs heavy, one-off cleanup/migration for large canvases
// - Group cleanup: remove empty groups, fix invalid children/parent references
// - Anchor param backfill: derive {u,v} from legacy curveAnchor for node-to-node edges

import { computeAnchorParams, anchorFromParams } from '../utils/dynamicConnectionRenderer';

type CanvasNode = any;
type CanvasConnection = any;

type MigrateRequest = {
  type: 'migrate';
  payload: {
    nodes: CanvasNode[];
    connections: CanvasConnection[];
  };
};

type MigrateResponse = {
  type: 'migrated';
  payload: {
    nodes: CanvasNode[];
    connections: CanvasConnection[];
    migrated: number;
    groupsCleaned: number;
  };
};

const ctx: DedicatedWorkerGlobalScope = self as any;

function groupCleanup(inputNodes: CanvasNode[], connections: CanvasConnection[]): { nodes: CanvasNode[]; cleanedCount: number } {
  const now = Date.now();
  const nodes = Array.isArray(inputNodes) ? [...inputNodes] : [];
  const byId = new Map<string, CanvasNode>(nodes.map((n: any) => [n.id, n]));

  const groupsToRemove = new Set<string>();
  const updatedNodesStep1 = nodes.map((n: any) => {
    if ((n as any).type !== 'group') return n;
    const g: any = { ...(n as any) };
    const raw: string[] = Array.isArray(g.children) ? (g.children as string[]) : [];
    const seen = new Set<string>();
    const cleaned = raw.filter((cid) => {
      if (!cid || seen.has(cid)) return false;
      seen.add(cid);
      return byId.has(cid) && cid !== g.id;
    });
    if (cleaned.length === 0) {
      groupsToRemove.add(g.id);
      return g; // keep for now
    }
    if ((g as any).mindmap) {
      const meta = (g as any).mindmap as any;
      if (!cleaned.includes(meta?.rootId)) {
        const memberSet = new Set(cleaned);
        const edges = (connections || []).filter((e: any) => memberSet.has(e.from) && memberSet.has(e.to));
        const inDeg = new Map<string, number>();
        cleaned.forEach(id => inDeg.set(id, 0));
        edges.forEach((e: any) => inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1));
        const candidates = cleaned.filter(id => (inDeg.get(id) || 0) === 0);
        const pool = (candidates.length ? candidates : cleaned)
          .map(id => byId.get(id)!)
          .filter(Boolean);
        pool.sort((a: any, b: any) => {
          const ca = a.createdAt || 0, cb = b.createdAt || 0;
          if (ca !== cb) return ca - cb;
          if (a.x !== b.x) return a.x - b.x;
          if (a.y !== b.y) return a.y - b.y;
          return (a.title || a.content || '').localeCompare(b.title || b.content || '');
        });
        const newRoot = pool[0]?.id;
        (g as any).mindmap = { ...meta, rootId: newRoot };
        g.updatedAt = now;
      }
    }
    g.children = cleaned;
    return g;
  });

  const survivors = updatedNodesStep1.filter((n: any) => !(groupsToRemove.has(n.id) && (n as any).type === 'group'));
  const survivorGroupIds = new Set<string>(survivors.filter((n: any) => (n as any).type === 'group').map((n: any) => n.id));
  const updatedNodesStep2 = survivors.map((n: any) => {
    const p = (n as any).parentGroupId as string | undefined;
    if (!p) return n;
    if (!survivorGroupIds.has(p)) {
      const { parentGroupId: _omit, ...rest } = (n as any);
      return { ...(rest as any), updatedAt: now } as CanvasNode;
    }
    return n;
  });

  return { nodes: updatedNodesStep2, cleanedCount: groupsToRemove.size };
}

function getCenter(n: any) { return { x: n.x + n.width / 2, y: n.y + n.height / 2 }; }
function sidePoint(n: any, side: 'left'|'right'|'top'|'bottom') {
  const c = getCenter(n);
  switch (side) {
    case 'left': return { x: c.x - n.width / 2, y: c.y };
    case 'right': return { x: c.x + n.width / 2, y: c.y };
    case 'top': return { x: c.x, y: c.y - n.height / 2 };
    default: return { x: c.x, y: c.y + n.height / 2 };
  }
}

function migrateAnchors(nodes: CanvasNode[], connections: CanvasConnection[]): { connections: CanvasConnection[]; migrated: number } {
  const nodesById = new Map<string, CanvasNode>((nodes || []).map((n: any) => [n.id, n]));
  const H_TOL = 10;
  let migrated = 0;
  const nextConns = (connections || []).map((c: any) => {
    const anyC: any = c as any;
    if (!anyC.from || !anyC.to || anyC.fromPoint || anyC.toPoint) return c;
    if (anyC.anchorParams && typeof anyC.anchorParams.u === 'number' && typeof anyC.anchorParams.v === 'number') return c;
    const anchor = anyC.curveAnchor as { x:number;y:number } | undefined;
    if (!anchor) return c;
    const fromNode = nodesById.get(anyC.from);
    const toNode = nodesById.get(anyC.to);
    if (!fromNode || !toNode) return c;
    const cA = getCenter(fromNode);
    const cB = getCenter(toNode);
    // choose sides by gap
    const fromLeft = (fromNode as any).x, fromRight = (fromNode as any).x + (fromNode as any).width;
    const toLeft = (toNode as any).x, toRight = (toNode as any).x + (toNode as any).width;
    let gapX = 0;
    if (cB.x >= cA.x) gapX = Math.max(0, toLeft - fromRight); else gapX = Math.max(0, fromLeft - toRight);
    let fromSide: 'left'|'right'|'top'|'bottom';
    let toSide: 'left'|'right'|'top'|'bottom';
    if (gapX > H_TOL) {
      const dx = cB.x - cA.x; fromSide = dx >= 0 ? 'right' : 'left'; toSide = dx >= 0 ? 'left' : 'right';
    } else {
      const dy = cB.y - cA.y; fromSide = dy >= 0 ? 'bottom' : 'top'; toSide = dy >= 0 ? 'top' : 'bottom';
    }
    const P0 = sidePoint(fromNode, fromSide);
    const P3 = sidePoint(toNode, toSide);
    const ap = computeAnchorParams(P0, P3, anchor);
    const newAnchor = anchorFromParams(P0, P3, ap);
    migrated++;
    return { ...(c as any), anchorParams: ap, curveAnchor: newAnchor } as CanvasConnection;
  });
  return { connections: nextConns, migrated };
}

ctx.addEventListener('message', (event: MessageEvent<MigrateRequest>) => {
  const data = event.data;
  if (!data || data.type !== 'migrate') return;
  try {
    const nodes = data.payload.nodes || [];
    const connections = data.payload.connections || [];
    const { nodes: cleanedNodes, cleanedCount } = groupCleanup(nodes, connections);
    const { connections: migratedConns, migrated } = migrateAnchors(cleanedNodes, connections);
    const msg: MigrateResponse = { type: 'migrated', payload: { nodes: cleanedNodes, connections: migratedConns, migrated, groupsCleaned: cleanedCount } };
    ctx.postMessage(msg);
  } catch (e) {
    const msg: MigrateResponse = { type: 'migrated', payload: { nodes: data.payload.nodes, connections: data.payload.connections, migrated: 0, groupsCleaned: 0 } };
    ctx.postMessage(msg);
  }
});

export {};

