import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { ensureInviteActive } from "./services/invite-access.js";

class AuthenticationError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "AuthenticationError";
    this.code = options.code;
    this.cause = options.cause;
  }
}

const readHeader = (headers, name) => {
  if (!headers) {
    return undefined;
  }
  const lower = name.toLowerCase();
  if (typeof headers.get === "function") {
    return headers.get(lower) ?? headers.get(name);
  }
  if (typeof headers === "object") {
    return headers[lower] ?? headers[name];
  }
  return undefined;
};

const getQueryParam = (params, key) => {
  if (!params) {
    return undefined;
  }
  if (typeof params.get === "function") {
    return params.get(key);
  }
  return params[key];
};

const extractBearerToken = (headers) => {
  const headerValue = readHeader(headers, "authorization");
  if (!headerValue || typeof headerValue !== "string") {
    return undefined;
  }
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
};

const ensureOriginAllowed = (headers) => {
  const { allowedOrigins } = config.cors;
  if (!allowedOrigins.length) {
    return;
  }
  const origin = readHeader(headers, "origin");
  if (origin && allowedOrigins.includes(origin)) {
    return;
  }
  throw new AuthenticationError("Origin is not allowed", {
    code: "origin_not_allowed",
  });
};

const verifySupabaseToken = (token) => {
  try {
    // Parity with the Python backend (`_decode_jwt_safely` in
    // backend/core/utils/auth_utils.py): HS256 shared secret, verify
    // signature + expiry, but NOT audience or issuer. Passing `audience`
    // to jwt.verify made the WS layer stricter than REST and rejected
    // otherwise-valid Supabase tokens, so we do not constrain on aud here.
    return jwt.verify(token, config.jwt.secret, {
      algorithms: ["HS256"],
    });
  } catch (error) {
    logger.warn("Supabase JWT verification failed", {
      errorCode: error?.code,
      errorName: error?.name,
      errorMessage: error?.message,
      tokenAud: (() => {
        try {
          return jwt.decode(token)?.aud;
        } catch {
          return undefined;
        }
      })(),
    });
    throw new AuthenticationError("Invalid Supabase JWT token", {
      code: "invalid_token",
      cause: error,
    });
  }
};

const resolveWorkspaceId = (params, payload) => {
  const candidates = [
    getQueryParam(params, "workspaceId"),
    payload?.workspace_id,
    payload?.workspaceId,
    payload?.user_metadata?.workspaceId,
    payload?.user_metadata?.workspace_id,
    payload?.app_metadata?.workspaceId,
    payload?.app_metadata?.workspace_id,
  ];
  return candidates.find((value) => Boolean(value)) ?? payload?.sub;
};

const resolveCanvasId = (params, fallback) =>
  getQueryParam(params, "canvasId") ?? fallback;

const resolveUserEmail = (payload) =>
  payload?.email ??
  payload?.user_metadata?.email ??
  payload?.user_metadata?.email_address ??
  payload?.app_metadata?.email;

const resolveActorType = (params, payload) =>
  getQueryParam(params, "actor") ??
  payload?.app_metadata?.actor ??
  payload?.user_metadata?.actor ??
  "user";

const resolveInviteScope = (payload) => ({
  canvasId: payload?.canvasId ?? payload?.canvas_id,
  workspaceId: payload?.workspaceId ?? payload?.workspace_id,
  inviteId: payload?.inviteId ?? payload?.invite_id,
  invited: payload?.invited === true,
});

const authenticateConnection = async ({
  requestParameters,
  headers,
  documentName,
  token: incomingToken,
}) => {
  const queryToken = getQueryParam(requestParameters, "token");
  const token = incomingToken || queryToken || extractBearerToken(headers);
  if (!token) {
    throw new AuthenticationError("Missing Supabase JWT token", {
      code: "token_missing",
    });
  }

  const payload = verifySupabaseToken(token);
  const userId = payload?.sub;
  if (!userId) {
    throw new AuthenticationError("Token payload missing `sub` claim", {
      code: "token_missing_sub",
    });
  }

  const workspaceId = resolveWorkspaceId(requestParameters, payload);
  if (!workspaceId) {
    throw new AuthenticationError("Unable to resolve workspaceId", {
      code: "workspace_missing",
    });
  }

  const inviteScope = resolveInviteScope(payload);
  const roles = []
    .concat(payload?.role ?? [])
    .concat(payload?.app_metadata?.roles ?? [])
    .filter(Boolean);
  const actor = resolveActorType(requestParameters, payload);
  const isService = roles.includes("service") || actor === "service";
  if (!isService) {
    ensureOriginAllowed(headers);
  }
  const isInvited =
    roles.includes("invited") ||
    inviteScope.invited ||
    roles.some((r) => r === "invited");

  const canvasId = resolveCanvasId(requestParameters, documentName);

  if (isInvited) {
    if (inviteScope.canvasId && canvasId && inviteScope.canvasId !== canvasId) {
      throw new AuthenticationError("Invite token does not match canvas", {
        code: "canvas_mismatch",
      });
    }
    if (
      inviteScope.workspaceId &&
      workspaceId &&
      inviteScope.workspaceId !== workspaceId
    ) {
      throw new AuthenticationError("Invite token does not match workspace", {
        code: "workspace_mismatch",
      });
    }
    await ensureInviteActive({
      inviteId: inviteScope.inviteId,
      canvasId: inviteScope.canvasId || canvasId,
      workspaceId: inviteScope.workspaceId || workspaceId,
    });
  }

  return {
    token,
    userId,
    workspaceId: inviteScope.workspaceId || workspaceId,
    email: resolveUserEmail(payload),
    actor,
    roles,
    canvasId: inviteScope.canvasId || canvasId,
    payload,
    inviteId: inviteScope.inviteId,
    invited: isInvited,
  };
};

export { AuthenticationError, authenticateConnection };
