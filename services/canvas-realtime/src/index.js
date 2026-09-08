import { Server } from "@hocuspocus/server";
import { Redis as RedisExtension } from "@hocuspocus/extension-redis";
import IORedis from "ioredis";
import { config } from "./config.js";
import { authenticateConnection, AuthenticationError } from "./auth.js";
import { logger } from "./logger.js";
import { ensureWorkspaceMembership } from "./services/access-control.js";
import {
  CanvasRepositoryError,
  fetchCanvasDocument,
  persistCanvasDocument,
} from "./services/canvasRepository.js";
import {
  createYDocFromCanvas,
  exportCanvasFromDocument,
  applyOpsToYDoc,
  updateDocFromCanvas,
} from "./ydoc/canvasDoc.js";
import { createWorkspaceVersioning } from "./services/workspaceVersioning.js";
import { createCanvasVersioning } from "./services/canvasVersioning.js";
import { applyCanvasOps } from "./ops/applyCanvasOps.js";
import { normalizeCanvasError } from "./ops/errors.js";
import {
  assignNextServerVersion,
  persistThenCommitVersion,
  withCanvasApplyLock,
} from "./ops/applyPipeline.js";
import {
  closeCollaborationSession,
  startCollaborationSession,
} from "./services/collaborationSessions.js";
import { createCollaborationSessionTracker } from "./services/collaborationSessionTracker.js";

const buildRedisUrl = () => {
  const protocol = config.redis.ssl ? "rediss" : "redis";
  const authSegment = config.redis.password
    ? `:${encodeURIComponent(config.redis.password)}@`
    : "";
  return `${protocol}://${authSegment}${config.redis.host}:${config.redis.port}`;
};

const parseClusterNodes = (nodes) => {
  const fallback = [`${config.redis.host}:${config.redis.port}`];
  const rawNodes = nodes?.length ? nodes : fallback;
  return rawNodes
    .map((node) => {
      const normalized = node.replace(/^rediss?:\/\//, "");
      const [host, port] = normalized.split(":");
      const parsedPort = Number.parseInt(port ?? "", 10);
      if (!host) {
        return null;
      }
      return {
        host: host.trim(),
        port: Number.isFinite(parsedPort) ? parsedPort : 6379,
      };
    })
    .filter(Boolean);
};

const createReconnectHandler = () => (error) => {
  const message = error?.message ?? "";
  if (message.includes("READONLY") || message.includes("ETIMEDOUT")) {
    logger.warn("Redis reconnect triggered after error", { message });
    return true;
  }
  return false;
};

const createRedisClient = () => {
  const baseOptions = {
    lazyConnect: true,
    enableReadyCheck: true,
    retryStrategy: (attempt) => Math.min(attempt * 100, 5_000),
    reconnectOnError: createReconnectHandler(),
  };

  const clusterEnabledExplicit =
    config.redis.clusterEnabledRaw !== undefined &&
    config.redis.clusterEnabledRaw !== null &&
    String(config.redis.clusterEnabledRaw).trim() !== "";
  const useCluster =
    config.redis.clusterEnabled ||
    (!clusterEnabledExplicit && config.redis.clusterNodes.length > 0);
  if (!useCluster && config.redis.clusterNodes.length > 0) {
    logger.warn(
      "REDIS_CLUSTER_NODES set but REDIS_CLUSTER_ENABLED is false; falling back to standalone Redis.",
    );
  }

  if (useCluster) {
    const clusterNodes = parseClusterNodes(config.redis.clusterNodes);
    const redisClient = new IORedis.Cluster(clusterNodes, {
      redisOptions: {
        ...baseOptions,
        password: config.redis.password,
        tls: config.redis.ssl ? {} : undefined,
      },
      clusterRetryStrategy: (attempt) => Math.min(attempt * 100, 5_000),
    });
    return { redisClient, redisUrl: null, isCluster: true, clusterNodes };
  }

  const redisUrl = buildRedisUrl();
  const redisClient = new IORedis(redisUrl, baseOptions);
  return { redisClient, redisUrl, isCluster: false, clusterNodes: [] };
};

const { redisClient: redis, redisUrl, isCluster, clusterNodes } =
  createRedisClient();

redis.on("error", (error) => {
  logger.error("Redis connection error", { error: error.message });
});

redis.on("connect", () => {
  if (isCluster) {
    logger.info("Redis cluster connected", { nodes: clusterNodes });
    return;
  }
  logger.info("Redis connected", {
    host: config.redis.host,
    port: config.redis.port,
  });
});

const redisExtensionOptions = {
  redis,
  prefix: config.redis.prefix,
};

const redisExtension = new RedisExtension(redisExtensionOptions);

const workspaceVersioning = createWorkspaceVersioning(redis);
const canvasVersioning = createCanvasVersioning(redis);
const collaborationSessionTracker = createCollaborationSessionTracker({
  startSession: startCollaborationSession,
  closeSession: closeCollaborationSession,
  logger,
});
const persistDebounceMs = Math.max(0, config.persistence?.debounceMs ?? 0);
// Debounce snapshot persistence per canvas to reduce write amplification.
const pendingPersists = new Map();

const schedulePersistFlush = (canvasId, entry, options = {}) => {
  if (!entry) {
    return;
  }
  if (options.immediate || persistDebounceMs <= 0) {
    void flushPendingPersist(canvasId, entry.revision, {
      force: true,
      reason: options.reason ?? "immediate",
    });
    return;
  }
  if (entry.timerId) {
    clearTimeout(entry.timerId);
  }
  const revision = entry.revision;
  entry.timerId = setTimeout(() => {
    flushPendingPersist(canvasId, revision, {
      reason: options.reason ?? "debounced",
    }).catch((error) => {
      logger.error("Failed to flush pending canvas persist", {
        canvasId,
        error: error.message,
      });
    });
  }, persistDebounceMs);
};

const persistCanvasSnapshot = async ({
  canvasId,
  workspaceId,
  doc,
  updatedBy,
  skipVersionBump = false,
  alreadyLocked = false,
  reason = "persist",
}) => {
  const run = async () => {
    const snapshot = { ...doc };
    snapshot.id = snapshot.id || canvasId;
    snapshot.updatedAt = snapshot.updatedAt || Date.now();
    let persistedDoc = snapshot;
    if (!skipVersionBump) {
      const currentVersion = await canvasVersioning.get(canvasId);
      const nextVersion = assignNextServerVersion(
        currentVersion,
        snapshot.serverVersion ?? snapshot.updatedAt,
      );
      persistedDoc = await persistThenCommitVersion({
        persist: async (nextDoc) =>
          persistCanvasDocument({
            canvasId,
            workspaceId,
            doc: nextDoc,
          }),
        commitVersion: async (version) => canvasVersioning.set(canvasId, version),
        snapshot,
        nextVersion,
      });
    } else {
      persistedDoc = await persistCanvasDocument({
        canvasId,
        workspaceId,
        doc: snapshot,
      });
    }
    await workspaceVersioning.bump(workspaceId);
    await publishCanvasUpdate({
      workspaceId,
      canvasId,
      updatedBy,
      updatedAt: persistedDoc.updatedAt,
      serverVersion: persistedDoc.serverVersion,
    });
    return persistedDoc;
  };

  if (alreadyLocked) {
    return run();
  }
  return withCanvasApplyLock(redis, canvasId, run, {
    prefix: config.redis.prefix,
  });
};

const flushPendingPersist = async (canvasId, revision, options = {}) => {
  const entry = pendingPersists.get(canvasId);
  if (!entry || entry.inFlight) {
    return;
  }
  if (!options.force && revision != null && entry.revision !== revision) {
    return;
  }
  entry.inFlight = true;
  entry.pending = false;
  if (entry.timerId) {
    clearTimeout(entry.timerId);
    entry.timerId = null;
  }
  if (entry.cancelled && !options.force) {
    entry.inFlight = false;
    pendingPersists.delete(canvasId);
    return;
  }
  const snapshot = entry.doc;
  const workspaceId = entry.workspaceId;
  const updatedBy = entry.updatedBy;
  const currentRevision = entry.revision;

  if (!snapshot || !workspaceId) {
    entry.inFlight = false;
    pendingPersists.delete(canvasId);
    return;
  }

  let success = false;
  try {
    if (entry.cancelled && !options.force) {
      throw new Error("pending persist cancelled");
    }
    const persisted = await persistCanvasSnapshot({
      canvasId,
      workspaceId,
      doc: snapshot,
      updatedBy,
      reason: options.reason ?? "debounced",
    });
    entry.doc = persisted;
    success = true;
  } catch (error) {
    if (!(error instanceof CanvasRepositoryError)) {
      logger.error("Failed to persist debounced canvas snapshot", {
        canvasId,
        workspaceId,
        error: error.message,
      });
    }
    entry.pending = true;
  } finally {
    entry.inFlight = false;
  }

  if (entry.cancelled && !options.force) {
    pendingPersists.delete(canvasId);
    return;
  }

  if (!success || entry.pending || entry.revision !== currentRevision) {
    schedulePersistFlush(canvasId, entry);
    pendingPersists.set(canvasId, entry);
    return;
  }
  pendingPersists.delete(canvasId);
};

const scheduleCanvasPersist = async ({
  canvasId,
  workspaceId,
  doc,
  updatedBy,
}) => {
  if (!canvasId || !workspaceId || !doc) {
    return;
  }
  if (persistDebounceMs <= 0) {
    await persistCanvasSnapshot({
      canvasId,
      workspaceId,
      doc,
      updatedBy,
      reason: "immediate",
    });
    return;
  }
  const entry =
    pendingPersists.get(canvasId) ??
    {
      revision: 0,
      inFlight: false,
      pending: false,
      cancelled: false,
      timerId: null,
      doc: null,
      workspaceId: null,
      updatedBy: null,
    };
  entry.revision += 1;
  entry.doc = doc;
  entry.workspaceId = workspaceId;
  entry.updatedBy = updatedBy;
  entry.cancelled = false;
  if (entry.inFlight) {
    entry.pending = true;
    pendingPersists.set(canvasId, entry);
    return;
  }
  schedulePersistFlush(canvasId, entry);
  pendingPersists.set(canvasId, entry);
};

const cancelPendingPersist = (canvasId, reason = "cancelled") => {
  const entry = pendingPersists.get(canvasId);
  if (!entry) {
    return;
  }
  if (entry.timerId) {
    clearTimeout(entry.timerId);
    entry.timerId = null;
  }
  entry.pending = false;
  entry.cancelled = true;
  if (!entry.inFlight) {
    pendingPersists.delete(canvasId);
    logger.debug("Cleared pending canvas persist", { canvasId, reason });
  }
};

const flushAllPendingPersists = async (reason = "shutdown") => {
  const entries = Array.from(pendingPersists.keys());
  if (!entries.length) {
    return;
  }
  await Promise.all(
    entries.map((canvasId) => {
      const entry = pendingPersists.get(canvasId);
      if (entry?.cancelled) {
        return Promise.resolve();
      }
      return flushPendingPersist(canvasId, entry?.revision, {
        force: true,
        reason,
      });
    }),
  );
};

const readRequestBody = async (request) =>
  new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });

const readHeaderValue = (headers, name) => {
  if (!headers) return undefined;
  const key = name.toLowerCase();
  const value = headers[key] ?? headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
};

const parseJsonBody = (body) => {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

const parseExpectedVersion = (payload, headers) =>
  payload?.expectedVersion ??
  payload?.expected_version ??
  readHeaderValue(headers, "if-match");

const resolveClientRequestId = (headers) =>
  readHeaderValue(headers, "x-client-request-id") ||
  readHeaderValue(headers, "idempotency-key");

const resolveClientSessionId = (headers) =>
  readHeaderValue(headers, "x-client-session-id") ||
  readHeaderValue(headers, "x-canvas-session-id");

// Hocuspocus sends a default 200 unless onRequest rejects (with a falsy error).
const stopDefaultResponse = () => Promise.reject(null);

const sendResponse = (response, status, body, headers = {}) => {
  if (!response.headersSent && !response.destroyed) {
    response.writeHead(status, headers);
  }
  if (!response.writableEnded && !response.destroyed) {
    response.end(body);
  }
  return stopDefaultResponse();
};

const sendJson = (response, status, payload) =>
  sendResponse(response, status, JSON.stringify(payload), {
    "Content-Type": "application/json",
  });

const buildErrorPayload = (code, message, options = {}) => {
  const error = { code, message };
  if (options.field) {
    error.field = options.field;
  }
  if (options.hint) {
    error.hint = options.hint;
  }
  const payload = { error, code, message };
  const extras = options.extras;
  if (extras && typeof extras === "object") {
    Object.entries(extras).forEach(([key, value]) => {
      if (!(key in payload)) {
        payload[key] = value;
      }
    });
  }
  return payload;
};

const sendError = (response, status, code, message, options = {}) =>
  sendJson(response, status, buildErrorPayload(code, message, options));

const sendText = (response, status, text) =>
  sendResponse(response, status, text, { "Content-Type": "text/plain" });

const sendEmpty = (response, status) => sendResponse(response, status);

const IDEMPOTENCY_TTL_SECONDS = 60;

const logApplyWarnings = ({
  canvasId,
  workspaceId,
  requestId,
  sessionId,
  ifMatch,
  warnings,
}) => {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return;
  }
  const tracked = warnings.filter((item) =>
    ["missing_node_id", "missing_connection_id"].includes(item),
  );
  if (!tracked.length) {
    return;
  }
  const counts = tracked.reduce((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
  logger.warn("Apply ops missing client ids", {
    canvasId,
    workspaceId,
    requestId,
    sessionId,
    ifMatch,
    ...counts,
  });
};

const publishCanvasUpdate = async ({
  workspaceId,
  canvasId,
  updatedBy,
  updatedAt,
  serverVersion,
}) => {
  if (!workspaceId || !canvasId) {
    return;
  }
  const channel = `workspace:updates:${workspaceId}`;
  const payload = {
    type: "canvas_updated",
    workspaceId,
    canvasId,
    updatedBy,
    updatedAt,
    serverVersion,
    status: "updated",
  };
  try {
    await redis.publish(channel, JSON.stringify(payload));
  } catch (error) {
    logger.warn("Failed to publish canvas update", {
      workspaceId,
      canvasId,
      error: error.message,
    });
  }
};

const server = Server.configure({
  name: "canvas-realtime",
  address: config.host,
  port: config.port,
  debounce: 200,
  extensions: [redisExtension],
  async onAuthenticate(data) {
    try {
      const headers =
        data.connection?.request?.headers ?? data.requestHeaders ?? {};
      const context = await authenticateConnection({
        requestParameters: data.requestParameters,
        headers,
        documentName: data.documentName,
        token: data.token,
      });
      const isInvited =
        context?.invited || (context?.roles ?? []).includes("invited");
      if (!isInvited) {
        await ensureWorkspaceMembership({
          workspaceId: context.workspaceId,
          userId: context.userId,
        });
      } else {
        if (context.canvasId && data.documentName !== context.canvasId) {
          throw new AuthenticationError("Invite token does not match canvas", {
            code: "canvas_mismatch",
          });
        }
      }
      logger.debug("Realtime client authenticated", {
        canvasId: context.canvasId,
        workspaceId: context.workspaceId,
        userId: context.userId,
        actor: context.actor,
      });
      return context;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        logger.warn("Realtime authentication rejected", {
          reason: error.message,
          canvasId: data.documentName,
        });
      } else {
        logger.error("Realtime authentication failed unexpectedly", {
          error: error.message,
          canvasId: data.documentName,
        });
      }
      throw error;
    }
  },
  async onConnect({ context, documentName, socketId }) {
    logger.info("Client connected to canvas", {
      canvasId: documentName,
      userId: context?.userId,
      actor: context?.actor,
      socketId,
    });
  },
  async connected(payload) {
    await collaborationSessionTracker.handleConnected(payload);
    logger.debug("Realtime collaboration session opened", {
      canvasId: payload?.documentName,
      userId: payload?.context?.userId,
      workspaceId: payload?.context?.workspaceId,
      socketId: payload?.socketId,
      activeSessions: collaborationSessionTracker.getActiveCount(),
    });
  },
  async onDisconnect(payload) {
    await collaborationSessionTracker.handleDisconnect(payload);
    logger.info("Client disconnected from canvas", {
      canvasId: payload?.documentName,
      userId: payload?.context?.userId,
      socketId: payload?.socketId,
      activeSessions: collaborationSessionTracker.getActiveCount(),
    });
  },
  async onLoadDocument({ context, documentName }) {
    const canvasId = context?.canvasId ?? documentName;
    const workspaceId = context?.workspaceId;
    if (!canvasId || !workspaceId) {
      throw new AuthenticationError("Missing canvas context for load", {
        code: "context_missing",
      });
    }
    try {
      const record = await fetchCanvasDocument(canvasId, workspaceId);
      await canvasVersioning.ensure(
        canvasId,
        record?.doc?.serverVersion ?? record?.doc?.updatedAt ?? Date.now(),
      );
      return createYDocFromCanvas(record.doc);
    } catch (error) {
      if (error instanceof CanvasRepositoryError) {
        logger.error("Failed to load canvas document", {
          canvasId,
          workspaceId,
          error: error.message,
        });
      }
      throw error;
    }
  },
  async onStoreDocument({ context, documentName, document }) {
    const canvasId = context?.canvasId ?? documentName;
    const workspaceId = context?.workspaceId;
    if (!canvasId || !workspaceId) {
      logger.warn("Skipped storing canvas due to missing context", {
        canvasId,
        workspaceId,
      });
      return;
    }
    try {
      const exported = exportCanvasFromDocument(document);
      exported.id = exported.id || canvasId;
      exported.updatedAt = exported.updatedAt || Date.now();
      await scheduleCanvasPersist({
        canvasId,
        workspaceId,
        doc: exported,
        updatedBy: context?.userId,
      });
    } catch (error) {
      if (error instanceof CanvasRepositoryError) {
        logger.error("Failed to store canvas document", {
          canvasId,
          workspaceId,
          error: error.message,
        });
      }
      throw error;
    }
  },
  async onRequest({ request, response }) {
    if (request.method === "GET" && request.url === "/healthz") {
      return sendText(response, 200, "ok");
    }

    if (request.method === "GET" && request.url?.startsWith("/snapshot")) {
      try {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const requestParameters = url.searchParams;

        const canvasId =
          requestParameters.get("canvasId") ?? requestParameters.get("canvas_id");
        if (!canvasId) {
          return sendError(response, 400, "missing_canvas_id", "canvasId is required", {
            field: "canvasId",
          });
        }

        const context = await authenticateConnection({
          requestParameters,
          headers: request.headers,
          documentName: canvasId,
          token: undefined,
        });
        const roles = context?.roles ?? [];
        const isInvited = context?.invited || roles.includes("invited");
        const isService =
          roles.includes("service") || context?.actor === "service";

        const rawWorkspaceId =
          requestParameters.get("workspaceId") ??
          requestParameters.get("workspace_id");
        const workspaceId = rawWorkspaceId || context?.workspaceId;

        if (!workspaceId) {
          return sendError(response, 400, "missing_workspace_id", "workspaceId is required", {
            field: "workspaceId",
          });
        }

        if (context?.workspaceId && workspaceId !== context.workspaceId) {
          return sendError(response, 403, "workspace_id_mismatch", "workspaceId mismatch");
        }

        if (context?.canvasId && canvasId !== context.canvasId) {
          return sendError(response, 403, "canvas_id_mismatch", "canvasId mismatch");
        }

        if (!isInvited && !isService) {
          await ensureWorkspaceMembership({
            workspaceId,
            userId: context.userId,
          });
        }

        const activeDoc = server.documents.get(canvasId);
        let baseDoc = null;
        let source = "db";
        if (activeDoc) {
          baseDoc = exportCanvasFromDocument(activeDoc);
          source = "memory";
        } else {
          const record = await fetchCanvasDocument(canvasId, workspaceId);
          baseDoc = record?.doc ?? null;
        }

        if (!baseDoc) {
          return sendError(response, 404, "canvas_not_found", "canvas not found");
        }

        await canvasVersioning.ensure(
          canvasId,
          baseDoc.serverVersion ?? baseDoc.updatedAt ?? Date.now(),
        );
        const serverVersion = await canvasVersioning.get(canvasId);

        const outputCanvas = {
          ...baseDoc,
          id: baseDoc.id || canvasId,
          serverVersion: serverVersion ?? baseDoc.serverVersion ?? null,
        };

        return sendJson(response, 200, {
          canvas: outputCanvas,
          serverVersion: outputCanvas.serverVersion,
          updatedAt: outputCanvas.updatedAt ?? null,
          source,
        });
      } catch (error) {
        if (error instanceof AuthenticationError) {
          return sendError(response, 401, "unauthorized", error.message);
        }
        logger.error("Snapshot endpoint failed", { error: error.message });
        return sendError(response, 500, "snapshot_failed", "snapshot failed");
      }
    }

    if (request.method === "POST" && request.url?.startsWith("/apply")) {
      if (!config.features.applyEnabled) {
        return sendEmpty(response, 404);
      }
      let applyEchoVersion = null;
      try {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const requestParameters = url.searchParams;
        const body = await readRequestBody(request);
        const payload = parseJsonBody(body);
        if (payload === null) {
          return sendError(response, 400, "invalid_json", "invalid json payload");
        }

        const rawCanvasId =
          payload?.canvasId ??
          payload?.canvas_id ??
          requestParameters.get("canvasId") ??
          requestParameters.get("canvas_id");
        const rawWorkspaceId =
          payload?.workspaceId ??
          payload?.workspace_id ??
          requestParameters.get("workspaceId") ??
          requestParameters.get("workspace_id");
        const operations = payload?.operations;

        if (!rawCanvasId) {
          return sendError(response, 400, "missing_canvas_id", "canvasId is required", {
            field: "canvasId",
          });
        }

        const context = await authenticateConnection({
          requestParameters,
          headers: request.headers,
          documentName: rawCanvasId,
          token: undefined,
        });
        const roles = context?.roles ?? [];
        const isInvited = context?.invited || roles.includes("invited");
        const isService = roles.includes("service") || context?.actor === "service";
        const workspaceId = rawWorkspaceId || context?.workspaceId;

        if (!workspaceId) {
          return sendError(response, 400, "missing_workspace_id", "workspaceId is required", {
            field: "workspaceId",
          });
        }

        if (context?.workspaceId && workspaceId !== context.workspaceId) {
          return sendError(response, 403, "workspace_id_mismatch", "workspaceId mismatch");
        }

        if (context?.canvasId && rawCanvasId !== context.canvasId) {
          return sendError(response, 403, "canvas_id_mismatch", "canvasId mismatch");
        }

        if (!isInvited && !isService) {
          await ensureWorkspaceMembership({
            workspaceId,
            userId: context.userId,
          });
        }

        if (!Array.isArray(operations) || operations.length === 0) {
          return sendError(response, 400, "invalid_operations", "operations must be a non-empty array", {
            field: "operations",
          });
        }

        const idempotencyKey = readHeaderValue(
          request.headers,
          "idempotency-key",
        );
        const clientRequestId = resolveClientRequestId(request.headers);
        const clientSessionId = resolveClientSessionId(request.headers);
        const ifMatch = readHeaderValue(request.headers, "if-match");
        const cacheKey = idempotencyKey
          ? `${config.redis.prefix}:apply:${rawCanvasId}:${idempotencyKey}`
          : null;

        if (cacheKey) {
          try {
            const cached = await redis.get(cacheKey);
            if (cached) {
              return sendResponse(response, 200, cached, {
                "Content-Type": "application/json",
              });
            }
          } catch (error) {
            logger.warn("Failed to read idempotency cache", {
              canvasId: rawCanvasId,
              workspaceId,
              requestId: clientRequestId,
              sessionId: clientSessionId,
              ifMatch,
              error: error.message,
            });
          }
        }

        return await withCanvasApplyLock(
          redis,
          rawCanvasId,
          async () => {
            if (cacheKey) {
              try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                  return sendResponse(response, 200, cached, {
                    "Content-Type": "application/json",
                  });
                }
              } catch (error) {
                logger.warn("Failed to read idempotency cache after lock", {
                  canvasId: rawCanvasId,
                  workspaceId,
                  error: error.message,
                });
              }
            }

            const activeDoc = server.documents.get(rawCanvasId);
            let baseDoc = null;
            if (activeDoc) {
              baseDoc = exportCanvasFromDocument(activeDoc);
            } else {
              const record = await fetchCanvasDocument(rawCanvasId, workspaceId);
              baseDoc = record?.doc ?? null;
            }

            if (!baseDoc) {
              return sendError(response, 404, "canvas_not_found", "canvas not found");
            }

            await canvasVersioning.ensure(
              rawCanvasId,
              baseDoc.serverVersion ?? baseDoc.updatedAt ?? Date.now(),
            );

            const currentServerVersion = await canvasVersioning.get(rawCanvasId);
            applyEchoVersion = currentServerVersion ?? baseDoc.serverVersion ?? null;
            const expectedVersion = parseExpectedVersion(payload, request.headers);
            if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== "") {
              const expectedNum = Number(String(expectedVersion));
              if (!Number.isFinite(expectedNum)) {
                return sendError(
                  response,
                  400,
                  "invalid_expected_version",
                  "If-Match must be a numeric serverVersion",
                  { field: "expected_version" },
                );
              }
              const actual = currentServerVersion ?? baseDoc.serverVersion;
              if (actual != null && Number(actual) !== expectedNum) {
                logger.info("Apply version conflict", {
                  canvasId: rawCanvasId,
                  workspaceId,
                  userId: context?.userId,
                  requestId: clientRequestId,
                  sessionId: clientSessionId,
                  ifMatch,
                  expectedVersion: expectedNum,
                  actualServerVersion: actual,
                  opCount: operations.length,
                });
                return sendError(response, 409, "version_conflict", "Version conflict", {
                  hint: "Reload the canvas and retry.",
                  extras: { serverVersion: actual },
                });
              }
            }

            let result;
            try {
              result = applyCanvasOps({
                doc: baseDoc,
                operations,
                now: Date.now(),
                enforceClientIds: config.features.enforceClientIds,
              });
            } catch (error) {
              const message = error?.message ?? "validation_error";
              const canvasError = normalizeCanvasError(error);
              if (
                message.includes("duplicate") ||
                message.includes("requires client-provided id")
              ) {
                logger.warn("Apply ops validation failed", {
                  canvasId: rawCanvasId,
                  workspaceId,
                  requestId: clientRequestId,
                  sessionId: clientSessionId,
                  ifMatch,
                  message,
                });
              }
              return sendError(response, 422, "validation_error", message, {
                extras: { canvasError, serverVersion: applyEchoVersion },
              });
            }

            logApplyWarnings({
              canvasId: rawCanvasId,
              workspaceId,
              requestId: clientRequestId,
              sessionId: clientSessionId,
              ifMatch,
              warnings: result.warnings,
            });

            const updatedDoc = result.doc;
            updatedDoc.id = updatedDoc.id || rawCanvasId;
            updatedDoc.updatedAt = updatedDoc.updatedAt || Date.now();
            cancelPendingPersist(rawCanvasId, "apply");

            const nextVersion = assignNextServerVersion(
              currentServerVersion ?? baseDoc.serverVersion,
              updatedDoc.serverVersion ?? updatedDoc.updatedAt,
            );
            updatedDoc.serverVersion = nextVersion;

            if (activeDoc) {
              try {
                activeDoc.transact(() => {
                  applyOpsToYDoc(activeDoc, operations, updatedDoc.updatedAt);
                  const root = activeDoc.getMap("canvas");
                  if (updatedDoc.updatedAt != null) {
                    root.set("updatedAt", updatedDoc.updatedAt);
                  }
                  root.set("serverVersion", nextVersion);
                }, "apply");
              } catch (error) {
                const message = error?.message ?? "ydoc_apply_failed";
                const canvasError = normalizeCanvasError(error);
                logger.warn("Apply ops Y.Doc replay failed", {
                  canvasId: rawCanvasId,
                  workspaceId,
                  requestId: clientRequestId,
                  message,
                });
                return sendError(response, 422, "validation_error", message, {
                  extras: { canvasError, serverVersion: applyEchoVersion },
                });
              }
            }

            let persistedDoc;
            try {
              persistedDoc = await persistCanvasSnapshot({
                canvasId: rawCanvasId,
                workspaceId,
                doc: updatedDoc,
                updatedBy: context.userId,
                skipVersionBump: true,
                alreadyLocked: true,
                reason: "apply",
              });
            } catch (error) {
              logger.error("Apply persist failed", {
                canvasId: rawCanvasId,
                workspaceId,
                requestId: clientRequestId,
                error: error.message,
              });
              return sendError(response, 503, "persist_failed", "persist failed", {
                extras: { serverVersion: applyEchoVersion },
              });
            }

            try {
              await canvasVersioning.set(rawCanvasId, nextVersion);
            } catch (error) {
              logger.warn("Failed to commit server version after persist", {
                canvasId: rawCanvasId,
                error: error.message,
              });
            }
            persistedDoc.serverVersion = nextVersion;
            const serverVersion = nextVersion;

            const responsePayload = {
              canvas: persistedDoc,
              applied: result.applied,
              id_map: result.idMap,
              idMap: result.idMap,
              warnings: result.warnings,
              serverVersion,
              updatedAt: persistedDoc.updatedAt,
            };

            if (cacheKey) {
              try {
                await redis.setex(
                  cacheKey,
                  IDEMPOTENCY_TTL_SECONDS,
                  JSON.stringify(responsePayload),
                );
              } catch (error) {
                logger.warn("Failed to persist idempotency cache", {
                  canvasId: rawCanvasId,
                  workspaceId,
                  requestId: clientRequestId,
                  sessionId: clientSessionId,
                  ifMatch,
                  error: error.message,
                });
              }
            }

            return sendJson(response, 200, responsePayload);
          },
          { prefix: config.redis.prefix },
        );
      } catch (error) {
        if (error == null) {
          return stopDefaultResponse();
        }
        if (error instanceof AuthenticationError) {
          return sendError(response, 401, "unauthorized", error.message);
        }
        if (error.code === "lock_timeout") {
          return sendError(response, 503, "lock_timeout", "canvas is busy", {
            extras: { serverVersion: applyEchoVersion },
          });
        }
        logger.error("Apply endpoint failed", {
          canvasId: request.url,
          requestId: resolveClientRequestId(request.headers),
          sessionId: resolveClientSessionId(request.headers),
          ifMatch: readHeaderValue(request.headers, "if-match"),
          error: error.message,
        });
        return sendError(response, 500, "apply_failed", "apply failed", {
          extras: { serverVersion: applyEchoVersion },
        });
      }
    }

    // Import endpoint: allow backend/AI to push snapshot into realtime pipeline
    if (request.method === "POST" && request.url?.startsWith("/import")) {
      let importEchoVersion = null;
      try {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const requestParameters = url.searchParams;

        const body = await readRequestBody(request);
        const payload = parseJsonBody(body);
        if (payload === null) {
          return sendError(response, 400, "invalid_json", "invalid json payload");
        }

        const canvasId =
          payload?.canvasId ??
          payload?.canvas_id ??
          requestParameters.get("canvasId") ??
          requestParameters.get("canvas_id");

        if (!canvasId) {
          return sendError(response, 400, "missing_canvas_id", "canvasId is required", {
            field: "canvasId",
          });
        }

        const context = await authenticateConnection({
          requestParameters,
          headers: request.headers,
          documentName: canvasId,
          token: undefined,
        });
        const roles = context?.roles ?? [];
        const isInvited = context?.invited || roles.includes("invited");
        const isService = roles.includes("service") || context?.actor === "service";
        const rawWorkspaceId =
          payload?.workspaceId ??
          payload?.workspace_id ??
          requestParameters.get("workspaceId") ??
          requestParameters.get("workspace_id");
        const workspaceId = rawWorkspaceId || context?.workspaceId;

        if (!workspaceId) {
          return sendError(response, 400, "missing_workspace_id", "workspaceId is required", {
            field: "workspaceId",
          });
        }

        if (context?.workspaceId && workspaceId !== context.workspaceId) {
          return sendError(response, 403, "workspace_id_mismatch", "workspaceId mismatch");
        }

        if (context?.canvasId && canvasId !== context.canvasId) {
          return sendError(response, 403, "canvas_id_mismatch", "canvasId mismatch");
        }

        if (!isInvited && !isService) {
          await ensureWorkspaceMembership({
            workspaceId,
            userId: context.userId,
          });
        }

        const idempotencyKey = readHeaderValue(
          request.headers,
          "idempotency-key",
        );
        const clientRequestId = resolveClientRequestId(request.headers);
        const clientSessionId = resolveClientSessionId(request.headers);
        const ifMatch = readHeaderValue(request.headers, "if-match");
        const cacheKey = idempotencyKey
          ? `${config.redis.prefix}:import:${canvasId}:${idempotencyKey}`
          : null;

        if (cacheKey) {
          try {
            const cached = await redis.get(cacheKey);
            if (cached) {
              return sendResponse(response, 200, cached, {
                "Content-Type": "application/json",
              });
            }
          } catch (error) {
            logger.warn("Failed to read import idempotency cache", {
              canvasId,
              workspaceId,
              requestId: clientRequestId,
              sessionId: clientSessionId,
              ifMatch,
              error: error.message,
            });
          }
        }

        return await withCanvasApplyLock(
          redis,
          canvasId,
          async () => {
            if (cacheKey) {
              try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                  return sendResponse(response, 200, cached, {
                    "Content-Type": "application/json",
                  });
                }
              } catch (error) {
                logger.warn("Failed to read import idempotency cache after lock", {
                  canvasId,
                  workspaceId,
                  error: error.message,
                });
              }
            }

            const activeDoc = server.documents.get(canvasId);
            let baseDoc = null;
            if (activeDoc) {
              baseDoc = exportCanvasFromDocument(activeDoc);
            } else {
              const record = await fetchCanvasDocument(canvasId, workspaceId);
              baseDoc = record?.doc ?? null;
            }

            if (!baseDoc) {
              return sendError(response, 404, "canvas_not_found", "canvas not found");
            }

            await canvasVersioning.ensure(
              canvasId,
              baseDoc.serverVersion ?? baseDoc.updatedAt ?? Date.now(),
            );

            const currentServerVersion = await canvasVersioning.get(canvasId);
            importEchoVersion = currentServerVersion ?? baseDoc.serverVersion ?? null;
            const expectedVersion = parseExpectedVersion(payload, request.headers);
            if (
              activeDoc &&
              (expectedVersion === undefined || expectedVersion === null || expectedVersion === "")
            ) {
              logger.info("Import missing If-Match for active canvas", {
                canvasId,
                workspaceId,
                userId: context?.userId,
                requestId: clientRequestId,
                sessionId: clientSessionId,
                ifMatch,
              });
              return sendError(
                response,
                409,
                "version_required",
                "If-Match is required when canvas is active",
                { hint: "Provide serverVersion in If-Match header." },
              );
            }
            if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== "") {
              const expectedNum = Number(String(expectedVersion));
              if (!Number.isFinite(expectedNum)) {
                return sendError(
                  response,
                  400,
                  "invalid_expected_version",
                  "If-Match must be a numeric serverVersion",
                  { field: "expected_version" },
                );
              }
              const actual = currentServerVersion ?? baseDoc.serverVersion;
              if (actual != null && Number(actual) !== expectedNum) {
                logger.info("Import version conflict", {
                  canvasId,
                  workspaceId,
                  userId: context?.userId,
                  requestId: clientRequestId,
                  sessionId: clientSessionId,
                  ifMatch,
                  expectedVersion: expectedNum,
                  actualServerVersion: actual,
                });
                return sendError(response, 409, "version_conflict", "Version conflict", {
                  hint: "Reload the canvas and retry.",
                  extras: { serverVersion: actual },
                });
              }
            }

            const doc = payload?.doc ?? payload;
            if (!doc || typeof doc !== "object") {
              return sendError(response, 400, "invalid_doc_payload", "invalid doc payload");
            }

            const exportedDoc = { ...doc, id: canvasId };
            if (!exportedDoc.title && baseDoc.title) {
              exportedDoc.title = baseDoc.title;
            }
            if (!exportedDoc.version && baseDoc.version) {
              exportedDoc.version = baseDoc.version;
            }
            if (!exportedDoc.createdAt && baseDoc.createdAt) {
              exportedDoc.createdAt = baseDoc.createdAt;
            }

            let snapshot;
            try {
              const ydoc = createYDocFromCanvas(exportedDoc);
              snapshot = exportCanvasFromDocument(ydoc);
            } catch (error) {
              const message = error?.message ?? "ydoc_import_failed";
              return sendError(response, 422, "validation_error", message, {
                extras: { serverVersion: importEchoVersion },
              });
            }
            snapshot.id = canvasId;
            snapshot.createdAt = snapshot.createdAt || baseDoc.createdAt;
            snapshot.updatedAt = snapshot.updatedAt || Date.now();
            cancelPendingPersist(canvasId, "import");
            const nextVersion = assignNextServerVersion(
              currentServerVersion ?? baseDoc.serverVersion,
              snapshot.serverVersion ?? snapshot.updatedAt,
            );
            snapshot.serverVersion = nextVersion;
            if (activeDoc) {
              try {
                activeDoc.transact(() => {
                  updateDocFromCanvas(activeDoc, snapshot);
                }, "import");
              } catch (error) {
                const message = error?.message ?? "ydoc_import_failed";
                return sendError(response, 422, "validation_error", message, {
                  extras: { serverVersion: importEchoVersion },
                });
              }
            }
            let persistedDoc;
            try {
              persistedDoc = await persistCanvasSnapshot({
                canvasId,
                workspaceId,
                doc: snapshot,
                updatedBy: context.userId,
                skipVersionBump: true,
                alreadyLocked: true,
                reason: "import",
              });
            } catch (error) {
              logger.error("Import persist failed", {
                canvasId,
                workspaceId,
                error: error.message,
              });
              return sendError(response, 503, "persist_failed", "persist failed", {
                extras: { serverVersion: importEchoVersion },
              });
            }
            try {
              await canvasVersioning.set(canvasId, nextVersion);
            } catch (error) {
              logger.warn("Failed to commit server version after import persist", {
                canvasId,
                error: error.message,
              });
            }
            persistedDoc.serverVersion = nextVersion;
            const responsePayload = {
              status: "ok",
              canvas: persistedDoc,
              serverVersion: nextVersion,
              updatedAt: persistedDoc.updatedAt,
            };

            if (cacheKey) {
              try {
                await redis.setex(
                  cacheKey,
                  IDEMPOTENCY_TTL_SECONDS,
                  JSON.stringify(responsePayload),
                );
              } catch (error) {
                logger.warn("Failed to persist import idempotency cache", {
                  canvasId,
                  workspaceId,
                  requestId: clientRequestId,
                  sessionId: clientSessionId,
                  ifMatch,
                  error: error.message,
                });
              }
            }

            return sendJson(response, 200, responsePayload);
          },
          { prefix: config.redis.prefix },
        );
      } catch (error) {
        if (error == null) {
          return stopDefaultResponse();
        }
        if (error instanceof AuthenticationError) {
          return sendError(response, 401, "unauthorized", error.message);
        }
        if (error.code === "lock_timeout") {
          return sendError(response, 503, "lock_timeout", "canvas is busy", {
            extras: { serverVersion: importEchoVersion },
          });
        }
        logger.error("Import endpoint failed", {
          canvasId: request.url,
          requestId: resolveClientRequestId(request.headers),
          sessionId: resolveClientSessionId(request.headers),
          ifMatch: readHeaderValue(request.headers, "if-match"),
          error: error.message,
        });
        return sendError(response, 500, "import_failed", "import failed", {
          extras: { serverVersion: importEchoVersion },
        });
      }
    }

    return sendEmpty(response, 404);
  },
  async onListen({ port, host }) {
    logger.info("Canvas realtime server listening", { host, port });
  },
});

const waitForRedisReady = () =>
  new Promise((resolve, reject) => {
    const handleReady = () => {
      redis.off("error", handleError);
      resolve();
    };
    const handleError = (error) => {
      redis.off("ready", handleReady);
      reject(error);
    };
    redis.once("ready", handleReady);
    redis.once("error", handleError);
  });

const ensureRedisConnected = async () => {
  const status = redis.status;
  if (status === "ready") {
    return;
  }
  if (status === "connecting" || status === "reconnecting" || status === "connect") {
    await waitForRedisReady();
    return;
  }
  if (status === "wait" || status === "end" || status === "close") {
    await redis.connect();
  }
  if (redis.status !== "ready") {
    await waitForRedisReady();
  }
};

const start = async () => {
  await ensureRedisConnected();
  server.listen();
};

const shutdown = async (signal) => {
  logger.info("Shutdown signal received", { signal });
  await flushAllPendingPersists("shutdown");
  await server.destroy();
  await collaborationSessionTracker.closeAll("shutdown");
  await redis.quit();
  process.exit(0);
};

start().catch((error) => {
  logger.error("Failed to start canvas realtime server", {
    error: error.message,
  });
  process.exit(1);
});

["SIGTERM", "SIGINT"].forEach((signal) => {
  process.on(signal, () => {
    shutdown(signal).catch((error) => {
      logger.error("Error during shutdown", { error: error.message });
      process.exit(1);
    });
  });
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});
