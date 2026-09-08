import dotenv from "dotenv";

const envFile = process.env.CANVAS_REALTIME_ENV?.trim();
dotenv.config(envFile ? { path: envFile } : undefined);

const parseBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
};

const parseInteger = (value, defaultValue) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const parseList = (value) =>
  value
    ?.split(",")
    .map((item) => item.trim())
    .filter((item) => Boolean(item)) ?? [];

const config = {
  env: process.env.NODE_ENV ?? "development",
  host: process.env.CANVAS_REALTIME_HOST ?? "0.0.0.0",
  port: parseInteger(process.env.CANVAS_REALTIME_PORT, 6020),
  logLevel: process.env.CANVAS_REALTIME_LOG_LEVEL ?? "info",
  redis: {
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: parseInteger(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    ssl: parseBoolean(process.env.REDIS_SSL, false),
    prefix: process.env.CANVAS_REALTIME_REDIS_PREFIX ?? "canvas-yjs",
    clusterEnabled: parseBoolean(process.env.REDIS_CLUSTER_ENABLED, false),
    clusterEnabledRaw: process.env.REDIS_CLUSTER_ENABLED,
    clusterNodes: parseList(process.env.REDIS_CLUSTER_NODES),
  },
  jwt: {
    secret: process.env.SUPABASE_JWT_SECRET,
    audience: process.env.CANVAS_REALTIME_JWT_AUDIENCE ?? "authenticated",
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    schema: process.env.CANVAS_REALTIME_SUPABASE_SCHEMA ?? "public",
  },
  cors: {
    allowedOrigins: parseList(process.env.CANVAS_REALTIME_ALLOWED_ORIGINS),
  },
  metrics: {
    logIntervalMs: parseInteger(
      process.env.CANVAS_REALTIME_METRICS_LOG_INTERVAL_MS,
      30_000,
    ),
  },
  persistence: {
    debounceMs: parseInteger(
      process.env.CANVAS_REALTIME_PERSIST_DEBOUNCE_MS,
      1500,
    ),
  },
  features: {
    applyEnabled: parseBoolean(process.env.CANVAS_REALTIME_APPLY_ENABLED, true),
    enforceClientIds: parseBoolean(process.env.CANVAS_ENFORCE_CLIENT_IDS, false),
  },
};

if (!config.jwt.secret) {
  throw new Error(
    "SUPABASE_JWT_SECRET is required for canvas realtime authentication.",
  );
}

if (!config.supabase.url) {
  throw new Error("SUPABASE_URL is required for canvas realtime persistence.");
}

if (!config.supabase.serviceRoleKey) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is required for canvas realtime persistence.",
  );
}

export { config };
