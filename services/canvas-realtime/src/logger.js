import { config } from "./config.js";

const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const CURRENT_LEVEL = LEVELS[config.logLevel] ?? LEVELS.info;

const formatMeta = (meta) => {
  if (!meta || typeof meta !== "object" || !Object.keys(meta).length) {
    return "";
  }
  return ` ${JSON.stringify(meta)}`;
};

const baseLog = (level, message, meta) => {
  if ((LEVELS[level] ?? LEVELS.info) > CURRENT_LEVEL) {
    return;
  }
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [canvas-realtime] [${level.toUpperCase()}] ${message}${formatMeta(meta)}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
};

const buildLogger = (scopeMeta = {}) => ({
  error: (message, meta) => baseLog("error", message, { ...scopeMeta, ...meta }),
  warn: (message, meta) => baseLog("warn", message, { ...scopeMeta, ...meta }),
  info: (message, meta) => baseLog("info", message, { ...scopeMeta, ...meta }),
  debug: (message, meta) => baseLog("debug", message, { ...scopeMeta, ...meta }),
  child: (meta = {}) => buildLogger({ ...scopeMeta, ...meta }),
});

export const logger = buildLogger();
