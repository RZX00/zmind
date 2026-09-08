import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { Canvas } from '../types/canvas';
import type { CanvasStore } from '../stores/canvas.store';
import { NodeIds } from '../utils/nodeIdUtils';
import type { UseBoundStore, StoreApi } from 'zustand';
import type { CanvasPresenceMetadata, CanvasPresenceUpdate } from '@/lib/canvas/realtime/CanvasRealtimeTypes';
import { createClient } from '@/lib/supabase/client';
import { buildRealtimeWsUrl, CANVAS_REALTIME_ENABLED } from '@/lib/canvas/realtime/config';
import { createYDocFromCanvas, exportCanvasFromDocument } from '@/lib/canvas/realtime/canvasYDoc';
import {
  applyMetadataToCanvas,
  applyMermaidThemeDefaults,
  migrateAnchorParams,
  shouldMigrateAnchors,
} from '@/canvas/utils/canvasNormalization';
import { setCanvasRealtimeAdapter, setCanvasRealtimeLive } from '../stores/canvasRealtimeBridge';
import { getCanvasClientSessionId } from '../services/client-session-id';

type PresenceMap = Record<string, CanvasPresenceMetadata>;

const INVITE_TOKEN_PREFIX = 'canvas_invite_token:';

// How long to keep buffering edits in the Y.Doc after a disconnect before falling back to
// the REST persistence path. Prevents transient reconnect blips from flapping the store into
// REST mode (which routes concurrent edits onto the conflicting /apply optimistic-concurrency
// path and produces 409 storms).
const PERSISTENCE_GRACE_MS = 6000;

let sharedRestModeTimer: ReturnType<typeof setTimeout> | null = null;
let sharedRestModeStore: UseBoundStore<StoreApi<CanvasStore>> | null = null;

const cancelCanvasRestMode = () => {
  if (sharedRestModeTimer) {
    clearTimeout(sharedRestModeTimer);
    sharedRestModeTimer = null;
  }
};

const enterRestPersistence = (store: UseBoundStore<StoreApi<CanvasStore>> | null) => {
  setCanvasRealtimeLive(false);
  store?.setState({ persistenceDisabled: false }, false);
  try {
    void store?.getState().saveCanvas?.();
  } catch {}
};

const scheduleCanvasRestMode = (store: UseBoundStore<StoreApi<CanvasStore>>) => {
  sharedRestModeStore = store;
  if (sharedRestModeTimer) return;
  sharedRestModeTimer = setTimeout(() => {
    sharedRestModeTimer = null;
    enterRestPersistence(sharedRestModeStore);
  }, PERSISTENCE_GRACE_MS);
};

export interface CanvasCollaborationManagerOptions {
  canvasId: string;
  initialCanvas: Canvas;
  store: UseBoundStore<StoreApi<CanvasStore>>;
  workspaceId?: string | null;
  presence: CanvasPresenceMetadata;
  onPresenceUpdate?: (presence: PresenceMap) => void;
  onStatusChange?: (connected: boolean) => void;
}

/**
 * 负责协调 Yjs Doc、Hocuspocus Provider 与 Zustand Store 之间的同步。
 * 所有编辑均写入 Y.Doc，Realtime 服务负责广播与持久化。
 */
export class CanvasCollaborationManager {
  private readonly doc: Y.Doc;
  private readonly awareness: Awareness;
  private provider: HocuspocusProvider | null = null;
  private readonly store: UseBoundStore<StoreApi<CanvasStore>>;
  private readonly onPresenceUpdate?: (presence: PresenceMap) => void;
  private readonly onStatusChange?: (connected: boolean) => void;

  private readonly canvasId: string;
  private readonly workspaceId?: string | null;

  private lastSerialized: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private localPresence: CanvasPresenceMetadata;
  private lastEditPresenceAt = 0;

  constructor(options: CanvasCollaborationManagerOptions) {
    this.canvasId = options.canvasId;
    this.workspaceId = options.workspaceId ?? null;
    this.store = options.store;
    this.onPresenceUpdate = options.onPresenceUpdate;
    this.onStatusChange = options.onStatusChange;
    this.localPresence = options.presence;

    this.doc = createYDocFromCanvas(options.initialCanvas);
    this.awareness = new Awareness(this.doc);
    this.lastSerialized = JSON.stringify(options.initialCanvas);
    this.doc.on('update', () => {
      this.applyDocSnapshot();
    });

    setCanvasRealtimeAdapter({
      doc: this.doc,
      transact: (fn, origin) => {
        this.doc.transact(() => {
          fn(this.doc);
        }, origin);
      },
      notifyLocalEdit: this.notifyLocalEdit,
    });
    setCanvasRealtimeLive(true);

    this.setPresence({ ...options.presence, lastActiveAt: Date.now() });
  }

  async connect() {
    if (!CANVAS_REALTIME_ENABLED) {
      return;
    }
    if (this.provider) {
      return;
    }
    const token = await this.fetchAuthToken();
    if (!token) {
      console.warn('[CanvasCollaboration] Missing Supabase session token, skip realtime connect');
      cancelCanvasRestMode();
      enterRestPersistence(this.store);
      return;
    }
    const baseUrl = buildRealtimeWsUrl();
    const queryParts: string[] = [];
    if (this.workspaceId) {
      queryParts.push(`workspaceId=${encodeURIComponent(this.workspaceId)}`);
    }
    const clientSessionId = getCanvasClientSessionId();
    if (clientSessionId) {
      queryParts.push(`clientSessionId=${encodeURIComponent(clientSessionId)}`);
    }
    // 将 token 也放在 URL 上，作为认证消息的兜底，避免浏览器/库未发送 token 时后端报缺 token
    queryParts.push(`token=${encodeURIComponent(token)}`);
    const query = queryParts.length ? `${baseUrl.includes('?') ? '&' : '?'}${queryParts.join('&')}` : '';
    const url = `${baseUrl}${query}`;
    if (!url) {
      console.warn('[CanvasCollaboration] Missing realtime server URL');
      cancelCanvasRestMode();
      enterRestPersistence(this.store);
      return;
    }

    this.provider = new HocuspocusProvider({
      url,
      name: this.canvasId,
      document: this.doc,
      awareness: this.awareness,
      token: async () => (await this.fetchAuthToken()) ?? '',
      onAuthenticationFailed: () => {
        this.clearInviteToken();
        // Definitive failure (not a transient blip): fall back to REST immediately.
        cancelCanvasRestMode();
        enterRestPersistence(this.store);
      },
    });

    this.provider.on('status', (event) => {
      const connected = event.status === 'connected';
      this.onStatusChange?.(connected);
      if (connected) {
        cancelCanvasRestMode();
        setCanvasRealtimeLive(true);
        this.store.setState({ persistenceDisabled: true }, false);
        this.startHeartbeat();
      } else {
        this.stopHeartbeat();
        scheduleCanvasRestMode(this.store);
      }
    });

    this.awareness.on('change', this.handleAwarenessChange);
  }

  destroy() {
    this.awareness.off('change', this.handleAwarenessChange);
    this.stopHeartbeat();
    this.provider?.destroy();
    this.provider = null;
    setCanvasRealtimeAdapter(null);
    setCanvasRealtimeLive(false);
    // Fast Refresh / remount: keep buffering in the store for the grace window instead of
    // immediately firing REST /apply against a stale If-Match.
    scheduleCanvasRestMode(this.store);
    this.doc.destroy();
  }

  updatePresence(metadata: CanvasPresenceUpdate) {
    this.setPresence(metadata);
  }

  getCanvasId(): string {
    return this.canvasId;
  }

  private async fetchAuthToken(): Promise<string | null> {
    const inviteToken = this.loadInviteToken();
    if (inviteToken) {
      return inviteToken;
    }
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return session?.access_token ?? null;
    } catch (error) {
      console.error('[CanvasCollaboration] Failed to load Supabase session', error);
      return null;
    }
  }

  private setPresence(metadata: CanvasPresenceUpdate) {
    const userId = metadata.userId || this.localPresence?.userId;
    if (!userId) {
      return;
    }
    const name = metadata.name || this.localPresence?.name || 'Anonymous';
    this.localPresence = { ...(this.localPresence || {}), ...(metadata || {}), userId, name };
    const state: CanvasPresenceMetadata = {
      ...this.localPresence,
      userId,
      name,
      lastActiveAt: metadata.lastActiveAt || Date.now(),
    };
    this.awareness.setLocalState(state);
  }

  private applyDocSnapshot() {
    const exported = exportCanvasFromDocument(this.doc);
    const normalized = applyMetadataToCanvas(exported);
    const migrated = shouldMigrateAnchors(normalized) ? migrateAnchorParams(normalized).out : normalized;
    const themed = applyMermaidThemeDefaults(migrated);
    const serialized = JSON.stringify(themed);
    if (serialized === this.lastSerialized) {
      return;
    }
    this.lastSerialized = serialized;
    this.store.setState(
      (state) => ({
        ...state,
        canvas: themed,
        isDirty: false,
        lastSaved: new Date(themed.updatedAt || Date.now()),
      }),
      false,
    );
    NodeIds.initialize(themed.id, themed.nodes, themed.connections);
  }

  private handleAwarenessChange = () => {
    const snapshot: PresenceMap = {};
    this.awareness.getStates().forEach((value, key) => {
      if (!value) return;
      snapshot[String(key)] = { ...(value as CanvasPresenceMetadata) };
    });
    this.onPresenceUpdate?.(snapshot);
  };

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.setPresence({ lastActiveAt: Date.now() });
    }, 15000);
    this.setPresence({ lastActiveAt: Date.now() });
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private notifyLocalEdit = () => {
    const now = Date.now();
    if (now - this.lastEditPresenceAt < 2000) {
      return;
    }
    this.lastEditPresenceAt = now;
    this.setPresence({ lastEditAt: now, lastActiveAt: now });
  };

  private loadInviteToken(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(`${INVITE_TOKEN_PREFIX}${this.canvasId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const token = parsed?.token as string | undefined;
      const expiresAt = parsed?.expiresAt as string | undefined;
      if (expiresAt) {
        const expMs = new Date(expiresAt).getTime();
        if (Number.isFinite(expMs) && expMs < Date.now()) {
        window.sessionStorage.removeItem(`${INVITE_TOKEN_PREFIX}${this.canvasId}`);
          return null;
        }
      }
      return token || null;
    } catch {
      return null;
    }
  }

  private clearInviteToken() {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.removeItem(`${INVITE_TOKEN_PREFIX}${this.canvasId}`);
    } catch {}
  }
}
