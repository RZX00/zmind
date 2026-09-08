const crypto = require('crypto');

const { assertConfig, resolveRuntimeConfig } = require('./config');
const { ERROR_CODES, ZMindError } = require('./errors');
const { requestJson } = require('./http');
const { createFileSessionStore } = require('./store');

class ZMindClient {
  constructor(options = {}) {
    this.fetch = options.fetch || global.fetch;
    this.env = options.env || process.env;
    this.now = options.now || (() => Date.now());
    this.store = options.store || createFileSessionStore({ env: this.env });
    this.createRequestId = options.createRequestId || (() => crypto.randomUUID());
  }

  async readState() {
    return this.store.read();
  }

  async getStatus() {
    const state = await this.readState();
    return {
      loggedIn: Boolean(state.session && state.session.accessToken),
      session: state.session,
      workspace: state.workspace,
      config: state.config || {},
    };
  }

  async resolveConfig(overrides = {}) {
    const state = await this.readState();
    return resolveRuntimeConfig(state, overrides, this.env);
  }

  async loginWithPassword(options) {
    const { email, password } = options || {};
    if (!email || !password) {
      throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, 'Email and password are required');
    }

    const config = assertConfig(await this.resolveConfig(options), [
      'supabaseUrl',
      'supabaseAnonKey',
      'backendUrl',
    ]);

    const payload = await requestJson(
      this.fetch,
      `${config.supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: {
          apikey: config.supabaseAnonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
        }),
      }
    );

    const session = normalizeSession(payload, this.now);
    const nextState = await this.store.patch({
      config,
      session,
      workspace: null,
    });

    return {
      user: nextState.session.user,
      expiresAt: nextState.session.expiresAt,
    };
  }

  async refreshSession(overrides = {}) {
    const state = await this.readState();
    if (!state.session || !state.session.refreshToken) {
      throw new ZMindError(ERROR_CODES.AUTH_REQUIRED, 'No refreshable session found');
    }

    const config = assertConfig(await this.resolveConfig(overrides), [
      'supabaseUrl',
      'supabaseAnonKey',
    ]);

    const payload = await requestJson(
      this.fetch,
      `${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: {
          apikey: config.supabaseAnonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refresh_token: state.session.refreshToken,
        }),
      }
    );

    const session = normalizeSession(payload, this.now);
    await this.store.patch({
      config,
      session,
    });

    return session;
  }

  async ensureSession(overrides = {}) {
    const state = await this.readState();
    if (!state.session || !state.session.accessToken) {
      throw new ZMindError(ERROR_CODES.AUTH_REQUIRED, 'Please log in to ZMind first');
    }

    const expiresAt = Number(state.session.expiresAt || 0);
    const nearlyExpired = expiresAt > 0 && expiresAt <= this.now() + 30 * 1000;
    if (nearlyExpired) {
      return this.refreshSession(overrides);
    }

    return state.session;
  }

  async logout() {
    await this.store.clearSession();
    return {
      ok: true,
    };
  }

  async listWorkspaces(overrides = {}) {
    const config = assertConfig(await this.resolveConfig(overrides), [
      'supabaseUrl',
      'supabaseAnonKey',
    ]);

    const payload = await this.requestWithRefresh(
      async () => {
        const session = await this.ensureSession(overrides);
        return requestJson(
          this.fetch,
          `${config.supabaseUrl}/rest/v1/rpc/get_accounts`,
          {
            method: 'POST',
            headers: {
              apikey: config.supabaseAnonKey,
              Authorization: `Bearer ${session.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          }
        );
      },
      overrides
    );

    return Array.isArray(payload) ? payload.map(normalizeWorkspace) : [];
  }

  async useWorkspace(options = {}) {
    const workspaceId = String(options.workspaceId || '').trim();
    if (!workspaceId) {
      throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, 'workspaceId is required');
    }

    const workspaces = await this.listWorkspaces(options);
    const selected = workspaces.find((workspace) => workspace.id === workspaceId);
    if (!selected) {
      throw new ZMindError(ERROR_CODES.NOT_FOUND, `Workspace not found: ${workspaceId}`);
    }

    await this.store.patch({
      workspace: selected,
    });

    return selected;
  }

  async getWorkspaceContext(options = {}) {
    const explicit = String(options.workspaceId || '').trim();
    if (explicit) {
      return explicit;
    }

    const state = await this.readState();
    if (state.workspace && state.workspace.id) {
      return state.workspace.id;
    }

    const workspaces = await this.listWorkspaces(options);
    const fallback = workspaces.find((workspace) => workspace.personalAccount) || workspaces[0];
    if (!fallback) {
      throw new ZMindError(ERROR_CODES.NOT_FOUND, 'No available workspaces');
    }
    await this.store.patch({ workspace: fallback });
    return fallback.id;
  }

  async getWorkspaceMeta(options = {}) {
    return this.requestBackend('/api/workspace/meta', {
      ...options,
      method: 'GET',
      workspaceId: await this.getWorkspaceContext(options),
    });
  }

  async listCanvases(options = {}) {
    const workspaceId = await this.getWorkspaceContext(options);
    const params = new URLSearchParams();
    if (options.limit) {
      params.set('limit', String(options.limit));
    }
    if (options.offset) {
      params.set('offset', String(options.offset));
    }
    if (options.deleted !== undefined && options.deleted !== null) {
      params.set('deleted', String(options.deleted));
    }
    return this.requestBackend(`/api/canvases${params.size ? `?${params.toString()}` : ''}`, {
      ...options,
      method: 'GET',
      workspaceId,
    });
  }

  async getCanvas(options = {}) {
    const canvasId = String(options.canvasId || '').trim();
    if (!canvasId) {
      throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, 'canvasId is required');
    }
    return this.requestBackend(`/api/canvases/${encodeURIComponent(canvasId)}`, {
      ...options,
      method: 'GET',
      workspaceId: await this.getWorkspaceContext(options),
    });
  }

  async createCanvas(options = {}) {
    const title = String(options.title || '').trim();
    if (!title) {
      throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, 'title is required');
    }
    return this.requestBackend('/api/canvases', {
      ...options,
      method: 'POST',
      workspaceId: await this.getWorkspaceContext(options),
      body: {
        title,
        nodes: Array.isArray(options.nodes) ? options.nodes : [],
        connections: Array.isArray(options.connections) ? options.connections : [],
      },
      headers: {
        'X-Client-Request-Id': options.clientRequestId || this.createRequestId(),
      },
    });
  }

  async applyCanvasOperations(options = {}) {
    const canvasId = String(options.canvasId || '').trim();
    if (!canvasId) {
      throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, 'canvasId is required');
    }
    if (!Array.isArray(options.operations)) {
      throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, 'operations must be an array');
    }

    const headers = {
      'X-Client-Request-Id': options.clientRequestId || this.createRequestId(),
    };
    if (options.expectedVersion !== undefined && options.expectedVersion !== null && options.expectedVersion !== '') {
      headers['If-Match'] = String(options.expectedVersion);
    }

    return this.requestBackend(`/api/canvases/${encodeURIComponent(canvasId)}/apply`, {
      ...options,
      method: 'POST',
      workspaceId: await this.getWorkspaceContext(options),
      body: {
        operations: options.operations,
      },
      headers,
    });
  }

  async getDoc(options = {}) {
    const itemId = String(options.itemId || options.docId || '').trim();
    if (!itemId) {
      throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, 'itemId is required');
    }
    return this.requestBackend(`/api/docs/${encodeURIComponent(itemId)}`, {
      ...options,
      method: 'GET',
      workspaceId: await this.getWorkspaceContext(options),
    });
  }

  async listDocs(options = {}) {
    const workspaceId = await this.getWorkspaceContext(options);
    return this.requestBackend('/api/items?type=doc', {
      ...options,
      method: 'GET',
      workspaceId,
    });
  }

  async createDoc(options = {}) {
    const title = String(options.title || '').trim();
    if (!title) {
      throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, 'title is required');
    }
    return this.requestBackend('/api/docs', {
      ...options,
      method: 'POST',
      workspaceId: await this.getWorkspaceContext(options),
      body: {
        title,
        contentMd: options.contentMd || '',
        frontmatter: options.frontmatter || {},
        folderId: options.folderId || null,
        parentItemId: options.parentItemId || null,
      },
      headers: {
        'X-Client-Request-Id': options.clientRequestId || this.createRequestId(),
      },
    });
  }

  async applyDocOperations(options = {}) {
    const itemId = String(options.itemId || options.docId || '').trim();
    if (!itemId) {
      throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, 'itemId is required');
    }
    if (!Array.isArray(options.ops)) {
      throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, 'ops must be an array');
    }
    const baseVersion = Number(options.baseVersion);
    if (!Number.isInteger(baseVersion) || baseVersion < 1) {
      throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, 'baseVersion must be a positive integer');
    }

    return this.requestBackend(`/api/docs/${encodeURIComponent(itemId)}/agent/apply-ops`, {
      ...options,
      method: 'POST',
      workspaceId: await this.getWorkspaceContext(options),
      body: {
        baseVersion,
        idempotencyKey: options.idempotencyKey || this.createRequestId(),
        summary: options.summary || null,
        ops: options.ops,
        actorType: options.actorType || 'agent',
        actorId: options.actorId || null,
        agentRunId: options.agentRunId || null,
        threadId: options.threadId || null,
        metadata: options.metadata || null,
      },
      headers: {
        'X-Client-Request-Id': options.clientRequestId || this.createRequestId(),
      },
    });
  }

  async getCanvasShareStatus(options = {}) {
    const canvasId = String(options.canvasId || '').trim();
    if (!canvasId) {
      throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, 'canvasId is required');
    }
    return this.requestBackend(`/api/canvases/${encodeURIComponent(canvasId)}/share`, {
      ...options,
      method: 'GET',
      workspaceId: await this.getWorkspaceContext(options),
    });
  }

  async updateCanvasShare(options = {}) {
    const canvasId = String(options.canvasId || '').trim();
    if (!canvasId) {
      throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, 'canvasId is required');
    }
    return this.requestBackend(`/api/canvases/${encodeURIComponent(canvasId)}/share`, {
      ...options,
      method: 'POST',
      workspaceId: await this.getWorkspaceContext(options),
      body: {
        is_public: options.isPublic,
        is_listed: options.isListed,
        timeline_enabled: options.timelineEnabled,
        public_shows_timeline: options.publicShowsTimeline,
      },
    });
  }

  async requestBackend(path, options = {}) {
    const config = assertConfig(await this.resolveConfig(options), [
      'backendUrl',
    ]);
    const workspaceId = String(options.workspaceId || '').trim();
    const integrationSource = pickText(options.integrationSource, this.env.ZMIND_INTEGRATION_SOURCE);
    const integrationClient = pickText(options.integrationClient, this.env.ZMIND_INTEGRATION_CLIENT);
    const integrationTool = pickText(options.integrationTool, this.env.ZMIND_INTEGRATION_TOOL);

    return this.requestWithRefresh(
      async () => {
        const session = await this.ensureSession(options);
        return requestJson(
          this.fetch,
          `${config.backendUrl}${path}`,
          {
            method: options.method || 'GET',
            headers: {
              Authorization: `Bearer ${session.accessToken}`,
              'Content-Type': 'application/json',
              ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
              ...(integrationSource ? { 'X-ZMind-Integration-Source': integrationSource } : {}),
              ...(integrationClient ? { 'X-ZMind-Integration-Client': integrationClient } : {}),
              ...(integrationTool ? { 'X-ZMind-Integration-Tool': integrationTool } : {}),
              ...(options.headers || {}),
            },
            body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          }
        );
      },
      options
    );
  }

  async requestWithRefresh(callback, overrides = {}) {
    try {
      return await callback();
    } catch (error) {
      if (!(error instanceof ZMindError) || error.code !== ERROR_CODES.AUTH_REQUIRED) {
        throw error;
      }
      await this.refreshSession(overrides);
      return callback();
    }
  }
}

function normalizeSession(payload, now) {
  const expiresIn = Number(payload.expires_in || 0);
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenType: payload.token_type || 'bearer',
    expiresAt: expiresIn > 0 ? now() + expiresIn * 1000 : null,
    user: {
      id: payload.user && payload.user.id ? payload.user.id : null,
      email: payload.user && payload.user.email ? payload.user.email : null,
    },
  };
}

function normalizeWorkspace(payload) {
  return {
    id: String(payload.account_id || payload.id || ''),
    name: payload.name || 'Unnamed workspace',
    slug: payload.slug || null,
    personalAccount: Boolean(payload.personal_account || payload.personalAccount),
    role: payload.account_role || payload.role || null,
  };
}

function pickText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) {
      return text;
    }
  }
  return '';
}

module.exports = {
  ZMindClient,
  normalizeSession,
  normalizeWorkspace,
};
