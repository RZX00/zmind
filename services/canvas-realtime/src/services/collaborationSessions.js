import { config } from "../config.js";
import { logger } from "../logger.js";
import { supabase } from "../supabaseClient.js";

const table = () =>
  supabase.schema(config.supabase.schema).from("collaboration_sessions");

const nowIso = () => new Date().toISOString();

const hasRequiredFields = (payload) =>
  Boolean(payload?.sessionId && payload?.canvasId && payload?.workspaceId);

export const startCollaborationSession = async ({
  sessionId,
  canvasId,
  workspaceId,
  userId,
}) => {
  if (!hasRequiredFields({ sessionId, canvasId, workspaceId })) {
    return false;
  }
  const row = {
    session_id: sessionId,
    canvas_id: canvasId,
    workspace_id: workspaceId,
    user_id: userId ?? null,
    status: "active",
    started_at: nowIso(),
    ended_at: null,
  };
  const { error } = await table().upsert(row, { onConflict: "session_id" });
  if (error) {
    logger.warn("Failed to start collaboration session", {
      sessionId,
      canvasId,
      workspaceId,
      error: error.message,
    });
    throw error;
  }
  return true;
};

export const closeCollaborationSession = async ({
  sessionId,
  workspaceId,
  userId,
}) => {
  if (!sessionId) {
    return false;
  }
  let query = table().update({
    status: "closed",
    ended_at: nowIso(),
  });
  query = query.eq("session_id", sessionId);
  if (workspaceId) {
    query = query.eq("workspace_id", workspaceId);
  }
  const { error } = await query;
  if (error) {
    logger.warn("Failed to close collaboration session", {
      sessionId,
      workspaceId,
      userId,
      error: error.message,
    });
    throw error;
  }
  return true;
};
