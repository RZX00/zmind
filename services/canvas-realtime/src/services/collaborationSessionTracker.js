const CLIENT_SESSION_QUERY_KEYS = [
  "clientSessionId",
  "client_session_id",
  "sessionId",
  "session_id",
];

const CLIENT_SESSION_HEADER_KEYS = [
  "x-client-session-id",
  "x-canvas-session-id",
];

const safePart = (value, maxLength = 96) =>
  String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, "_")
    .slice(0, maxLength);

const readHeaderValue = (headers, name) => {
  if (!headers || !name) {
    return undefined;
  }
  const key = name.toLowerCase();
  const value = headers[key] ?? headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

const firstTruthy = (values) => values.find((value) => Boolean(value));

export const resolveClientSessionId = ({ requestParameters, requestHeaders }) =>
  firstTruthy([
    ...CLIENT_SESSION_QUERY_KEYS.map((key) => requestParameters?.get?.(key)),
    ...CLIENT_SESSION_HEADER_KEYS.map((key) => readHeaderValue(requestHeaders, key)),
  ]);

export const buildRealtimeSessionId = ({
  canvasId,
  socketId,
  clientSessionId,
}) => {
  const canvasPart = safePart(canvasId) || "unknown_canvas";
  const socketPart = safePart(socketId) || "unknown_socket";
  const clientPart = safePart(clientSessionId);
  if (clientPart) {
    return `rt:${canvasPart}:${clientPart}:${socketPart}`;
  }
  return `rt:${canvasPart}:${socketPart}`;
};

const buildConnectionKey = ({ documentName, socketId }) =>
  `${String(documentName || "")}:${String(socketId || "")}`;

const resolveCanvasId = ({ context, documentName }) =>
  context?.canvasId || documentName;

const resolveWorkspaceId = ({ context }) => context?.workspaceId;

const resolveUserId = ({ context }) => context?.userId || null;

export const createCollaborationSessionTracker = ({
  startSession,
  closeSession,
  logger,
}) => {
  const sessions = new Map();

  const closeEntry = async (entry, reason = "disconnect") => {
    if (!entry) {
      return;
    }
    if (entry.closePromise) {
      await entry.closePromise;
      return;
    }
    entry.closePromise = (async () => {
      try {
        await entry.startPromise;
      } catch (error) {
        logger?.warn?.("Collaboration session start failed before close", {
          sessionId: entry.sessionId,
          canvasId: entry.canvasId,
          workspaceId: entry.workspaceId,
          reason,
          error: error?.message || String(error),
        });
      }
      try {
        await closeSession({
          sessionId: entry.sessionId,
          workspaceId: entry.workspaceId,
          userId: entry.userId,
        });
      } catch (error) {
        logger?.warn?.("Collaboration session close failed", {
          sessionId: entry.sessionId,
          canvasId: entry.canvasId,
          workspaceId: entry.workspaceId,
          reason,
          error: error?.message || String(error),
        });
      } finally {
        sessions.delete(entry.connectionKey);
      }
    })();
    await entry.closePromise;
  };

  const handleConnected = async (payload) => {
    const canvasId = resolveCanvasId(payload);
    const workspaceId = resolveWorkspaceId(payload);
    const userId = resolveUserId(payload);
    const socketId = payload?.socketId;
    const connectionKey = buildConnectionKey(payload);

    if (!canvasId || !workspaceId || !socketId) {
      logger?.warn?.("Skip collaboration session start due to missing context", {
        canvasId,
        workspaceId,
        socketId,
      });
      return;
    }

    const existing = sessions.get(connectionKey);
    if (existing) {
      return existing.startPromise;
    }

    const clientSessionId = resolveClientSessionId(payload);
    const sessionId = buildRealtimeSessionId({
      canvasId,
      socketId,
      clientSessionId,
    });

    const entry = {
      connectionKey,
      sessionId,
      canvasId,
      workspaceId,
      userId,
      startPromise: Promise.resolve(),
      closePromise: null,
    };

    entry.startPromise = (async () => {
      await startSession({
        sessionId,
        canvasId,
        workspaceId,
        userId,
      });
    })();

    sessions.set(connectionKey, entry);
    try {
      await entry.startPromise;
    } catch (error) {
      logger?.warn?.("Collaboration session start failed", {
        sessionId,
        canvasId,
        workspaceId,
        error: error?.message || String(error),
      });
    }
  };

  const handleDisconnect = async (payload) => {
    const connectionKey = buildConnectionKey(payload);
    const entry = sessions.get(connectionKey);
    if (!entry) {
      return;
    }
    await closeEntry(entry, "disconnect");
  };

  const closeAll = async (reason = "shutdown") => {
    const entries = Array.from(sessions.values());
    if (!entries.length) {
      return;
    }
    await Promise.all(entries.map((entry) => closeEntry(entry, reason)));
  };

  const getActiveCount = () => sessions.size;

  return {
    handleConnected,
    handleDisconnect,
    closeAll,
    getActiveCount,
  };
};
