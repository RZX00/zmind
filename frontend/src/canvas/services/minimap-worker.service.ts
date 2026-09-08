import type { CanvasNode, CanvasConnection } from '../types/canvas';

export interface SimplifiedRect { x: number; y: number; width: number; height: number; id?: string }
export interface SimplifiedLine { x1: number; y1: number; x2: number; y2: number }
export interface MinimapGeometry { rects: SimplifiedRect[]; lines: SimplifiedLine[] }

type BuildMessage = { type: 'build'; payload: { nodes: CanvasNode[]; connections: CanvasConnection[] } };
type GeometryMessage = { type: 'geometry'; payload: MinimapGeometry };

class MinimapWorkerService {
  private worker: Worker | null = null;
  private pendingResolve: ((value: MinimapGeometry) => void) | null = null;
  private pendingReject: ((reason?: any) => void) | null = null;
  private lastRequest: BuildMessage['payload'] | null = null;
  private busy = false;

  private ensureWorker() {
    if (typeof window === 'undefined') return;
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/minimap.worker.ts', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (ev: MessageEvent<GeometryMessage>) => {
        this.busy = false;
        const payload = ev.data?.payload as MinimapGeometry;
        if (this.pendingResolve) {
          this.pendingResolve(payload);
        }
        this.pendingResolve = null;
        this.pendingReject = null;
        // If there is a queued request, process it now
        if (this.lastRequest) {
          const next = this.lastRequest;
          this.lastRequest = null;
          this.post(next);
        }
      });
      this.worker.addEventListener('error', (e) => {
        this.busy = false;
        if (this.pendingReject) this.pendingReject(e);
        this.pendingResolve = null;
        this.pendingReject = null;
      });
    }
  }

  private post(payload: BuildMessage['payload']) {
    if (!this.worker) return;
    this.busy = true;
    const msg: BuildMessage = { type: 'build', payload };
    this.worker.postMessage(msg);
  }

  buildGeometry(nodes: CanvasNode[], connections: CanvasConnection[]): Promise<MinimapGeometry> {
    this.ensureWorker();
    if (!this.worker) {
      // Fallback: build synchronously (SSR or worker not available)
      const rects = nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height, id: n.id }));
      const nodeMap = new Map(nodes.map((n) => [n.id, n] as const));
      const lines = connections.flatMap((c) => {
        const a = nodeMap.get(c.from);
        const b = nodeMap.get(c.to);
        return !a || !b ? [] : [{ x1: a.x + a.width / 2, y1: a.y + a.height / 2, x2: b.x + b.width / 2, y2: b.y + b.height / 2 }];
      });
      return Promise.resolve({ rects, lines });
    }

    const payload: BuildMessage['payload'] = { nodes, connections };
    return new Promise<MinimapGeometry>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      if (this.busy) {
        // overwrite queued request with the latest snapshot
        this.lastRequest = payload;
      } else {
        this.post(payload);
      }
    });
  }
}

export const minimapWorkerService = new MinimapWorkerService();
