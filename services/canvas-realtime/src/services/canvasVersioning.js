import { logger } from "../logger.js";

const CANVAS_VERSION_KEY = (canvasId) => `canvas:server-version:${canvasId}`;

const parseNumeric = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const createCanvasVersioning = (redisClient) => {
  const get = async (canvasId) => {
    if (!redisClient || !canvasId) {
      return null;
    }
    try {
      const value = await redisClient.get(CANVAS_VERSION_KEY(canvasId));
      return parseNumeric(value);
    } catch (error) {
      logger.warn("Failed to read canvas version", {
        canvasId,
        error: error.message,
      });
      return null;
    }
  };

  const ensure = async (canvasId, version) => {
    if (!redisClient || !canvasId) {
      return null;
    }
    const numeric = parseNumeric(version);
    if (numeric === null) {
      return null;
    }
    try {
      await redisClient.setnx(CANVAS_VERSION_KEY(canvasId), numeric);
    } catch (error) {
      logger.warn("Failed to ensure canvas version key", {
        canvasId,
        error: error.message,
      });
    }
    return numeric;
  };

  const bump = async (canvasId, fallbackBase = null) => {
    if (!redisClient || !canvasId) {
      const base = parseNumeric(fallbackBase);
      return base !== null ? base + 1 : Date.now();
    }
    try {
      const value = await redisClient.incr(CANVAS_VERSION_KEY(canvasId));
      return Number(value);
    } catch (error) {
      logger.warn("Failed to bump canvas version", {
        canvasId,
        error: error.message,
      });
      const base = parseNumeric(fallbackBase);
      return base !== null ? base + 1 : Date.now();
    }
  };

  const set = async (canvasId, version) => {
    if (!redisClient || !canvasId) {
      return null;
    }
    const numeric = parseNumeric(version);
    if (numeric === null) {
      return null;
    }
    try {
      await redisClient.set(CANVAS_VERSION_KEY(canvasId), numeric);
    } catch (error) {
      logger.warn("Failed to set canvas version key", {
        canvasId,
        error: error.message,
      });
    }
    return numeric;
  };

  return {
    get,
    ensure,
    bump,
    set,
  };
};
