import type { Canvas } from '../types/canvas';

type MigrateRequest = { type: 'migrate'; payload: { nodes: any[]; connections: any[] } };
type MigrateResponse = { type: 'migrated'; payload: { nodes: any[]; connections: any[]; migrated: number; groupsCleaned: number } };

class MigrationWorkerService {
  private worker: Worker | null = null;
  private pendingResolve: ((value: { nodes: any[]; connections: any[]; migrated: number; groupsCleaned: number }) => void) | null = null;
  private pendingReject: ((reason?: any) => void) | null = null;
  private busy = false;

  private ensure() {
    if (typeof window === 'undefined') return;
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/data-migration.worker.ts', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (ev: MessageEvent<MigrateResponse>) => {
        this.busy = false;
        const payload = ev.data?.payload || { nodes: [], connections: [], migrated: 0, groupsCleaned: 0 };
        if (this.pendingResolve) this.pendingResolve(payload);
        this.pendingResolve = null;
        this.pendingReject = null;
      });
      this.worker.addEventListener('error', (e) => {
        this.busy = false;
        if (this.pendingReject) this.pendingReject(e);
        this.pendingResolve = null;
        this.pendingReject = null;
      });
    }
  }

  async migrate(canvas: Canvas): Promise<{ nodes: any[]; connections: any[]; migrated: number; groupsCleaned: number }> {
    this.ensure();
    if (!this.worker) {
      // Fallback: return original
      return { nodes: canvas.nodes || [], connections: canvas.connections || [], migrated: 0, groupsCleaned: 0 };
    }
    const payload: MigrateRequest = { type: 'migrate', payload: { nodes: canvas.nodes || [], connections: canvas.connections || [] } };
    return new Promise((resolve, reject) => {
      if (this.busy) {
        // If busy, just resolve with original; migration will be retried on next open
        return resolve({ nodes: canvas.nodes || [], connections: canvas.connections || [], migrated: 0, groupsCleaned: 0 });
      }
      this.busy = true;
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.worker!.postMessage(payload);
    });
  }
}

export const migrationWorkerService = new MigrationWorkerService();

