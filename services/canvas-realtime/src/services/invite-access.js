import { supabase } from "../supabaseClient.js";
import { AuthenticationError } from "../auth.js";
import { logger } from "../logger.js";

export const ensureInviteActive = async ({ inviteId, canvasId, workspaceId }) => {
  if (!inviteId) {
    throw new AuthenticationError("Invite token missing invite id", {
      code: "invite_missing",
    });
  }

  const { data, error } = await supabase
    .from("canvas_invites")
    .select("id, canvas_id, workspace_id, status, expires_at")
    .eq("id", inviteId)
    .maybeSingle();

  if (error) {
    logger.error("Invite lookup failed", {
      inviteId,
      canvasId,
      workspaceId,
      error: error.message,
    });
    throw new AuthenticationError("Unable to verify invite", {
      code: "invite_lookup_failed",
      cause: error,
    });
  }

  if (!data) {
    throw new AuthenticationError("Invite not found", {
      code: "invite_not_found",
    });
  }

  if (canvasId && data.canvas_id && data.canvas_id !== canvasId) {
    throw new AuthenticationError("Invite token does not match canvas", {
      code: "canvas_mismatch",
    });
  }

  if (workspaceId && data.workspace_id && String(data.workspace_id) !== String(workspaceId)) {
    throw new AuthenticationError("Invite token does not match workspace", {
      code: "workspace_mismatch",
    });
  }

  if (data.status !== "active") {
    throw new AuthenticationError("Invite is not active", {
      code: "invite_inactive",
    });
  }

  if (data.expires_at) {
    const expMs = Date.parse(data.expires_at);
    if (Number.isFinite(expMs) && Date.now() > expMs) {
      throw new AuthenticationError("Invite has expired", {
        code: "invite_expired",
      });
    }
  }

  return true;
};
