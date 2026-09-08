import { supabase } from "../supabaseClient.js";
import { config } from "../config.js";
import { cleanCanvasDoc } from "../utils/canvasCleaner.js";
import { composeCanvasDoc } from "../utils/canvasNormalizer.js";
import { logger } from "../logger.js";

class CanvasRepositoryError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "CanvasRepositoryError";
    this.code = options.code;
    this.cause = options.cause;
  }
}

const CANVAS_COLUMNS =
  "id, account_id, title, version, doc, created_at, updated_at, is_deleted";

const ensureDocumentIdentity = (doc, canvasId) => {
  const normalized = { ...(doc || {}) };
  if (!normalized.id) {
    normalized.id = canvasId;
  }
  if (!normalized.version) {
    normalized.version = "1.0.0";
  }
  normalized.updatedAt = normalized.updatedAt || Date.now();
  return normalized;
};

const msToIso = (value) => {
  const ms = typeof value === "number" ? value : Date.now();
  return new Date(ms).toISOString();
};

export const fetchCanvasDocument = async (canvasId, workspaceId) => {
  const { data, error } = await supabase
    .schema(config.supabase.schema)
    .from("canvases")
    .select(CANVAS_COLUMNS)
    .eq("id", canvasId)
    .eq("account_id", workspaceId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) {
    throw new CanvasRepositoryError("Failed to load canvas", {
      code: "load_failed",
      cause: error,
    });
  }

  if (!data) {
    throw new CanvasRepositoryError("Canvas not found", {
      code: "not_found",
    });
  }

  const doc = composeCanvasDoc(data);
  return {
    canvasId,
    workspaceId,
    doc,
  };
};

export const persistCanvasDocument = async ({
  canvasId,
  workspaceId,
  doc,
}) => {
  if (!doc) {
    throw new CanvasRepositoryError("Cannot persist empty document", {
      code: "empty_doc",
    });
  }
  const withIdentity = ensureDocumentIdentity(doc, canvasId);
  const cleaned = cleanCanvasDoc(withIdentity);
  const payload = {
    doc: cleaned,
    title: cleaned.title || "Untitled Canvas",
    version: cleaned.version || "1.0.0",
    updated_at: msToIso(cleaned.updatedAt),
  };
  const { error } = await supabase
    .schema(config.supabase.schema)
    .from("canvases")
    .update(payload)
    .eq("id", canvasId)
    .eq("account_id", workspaceId)
    .eq("is_deleted", false);

  if (error) {
    logger.error("Failed to persist canvas snapshot", {
      canvasId,
      workspaceId,
      error: error.message,
    });
    throw new CanvasRepositoryError("Failed to update canvas", {
      code: "save_failed",
      cause: error,
    });
  }

  return cleaned;
};

export { CanvasRepositoryError };
