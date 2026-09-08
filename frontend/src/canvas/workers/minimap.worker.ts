/// <reference lib="webworker" />

// Minimap geometry worker (MVP): builds simplified AABB rects and center-to-center lines

type CanvasNode = {
  id: string;
  x: number; y: number; width: number; height: number;
};

type CanvasConnection = {
  id: string; from: string; to: string;
};

interface SimplifiedRect { x: number; y: number; width: number; height: number; id?: string }
interface SimplifiedLine { x1: number; y1: number; x2: number; y2: number }
interface MinimapGeometry { rects: SimplifiedRect[]; lines: SimplifiedLine[] }

interface BuildMessage {
  type: 'build';
  payload: { nodes: CanvasNode[]; connections: CanvasConnection[] };
}

interface GeometryMessage {
  type: 'geometry';
  payload: MinimapGeometry;
}

const ctx: DedicatedWorkerGlobalScope = self as any;

function buildGeometry(nodes: CanvasNode[], connections: CanvasConnection[]): MinimapGeometry {
  const rects: SimplifiedRect[] = new Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    rects[i] = { x: n.x, y: n.y, width: n.width, height: n.height, id: n.id };
  }
  const nodeMap = new Map<string, CanvasNode>();
  for (const n of nodes) nodeMap.set(n.id, n);
  const lines: SimplifiedLine[] = [];
  for (let i = 0; i < connections.length; i++) {
    const c = connections[i];
    const a = nodeMap.get(c.from);
    const b = nodeMap.get(c.to);
    if (!a || !b) continue;
    lines.push({
      x1: a.x + a.width / 2,
      y1: a.y + a.height / 2,
      x2: b.x + b.width / 2,
      y2: b.y + b.height / 2,
    });
  }
  return { rects, lines };
}

ctx.addEventListener('message', (event: MessageEvent<BuildMessage>) => {
  const data = event.data;
  if (!data || data.type !== 'build') return;
  try {
    const { nodes, connections } = data.payload || { nodes: [], connections: [] };
    const geometry = buildGeometry(nodes || [], connections || []);
    const message: GeometryMessage = { type: 'geometry', payload: geometry };
    ctx.postMessage(message);
  } catch (e) {
    // swallow errors; ideally post an error message type
  }
});

export {};