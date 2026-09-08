import { supabase } from "../supabaseClient.js";
import { AuthenticationError } from "../auth.js";
import { logger } from "../logger.js";

const PERSONAL_WORKSPACE_SENTINEL = new Set(["personal", "self"]);

const isPersonalWorkspace = (workspaceId, userId) => {
  if (!workspaceId || !userId) {
    return false;
  }
  if (workspaceId === userId) {
    return true;
  }
  return PERSONAL_WORKSPACE_SENTINEL.has(workspaceId);
};

export const ensureWorkspaceMembership = async ({
  workspaceId,
  userId,
}) => {
  if (!workspaceId) {
    throw new AuthenticationError("Missing workspaceId in request context", {
      code: "workspace_missing",
    });
  }
  if (!userId) {
    throw new AuthenticationError("Missing userId in request context", {
      code: "user_missing",
    });
  }

  if (isPersonalWorkspace(workspaceId, userId)) {
    return true;
  }

  const { data, error } = await supabase
    .schema("basejump")
    .from("account_user")
    .select("account_id")
    .eq("account_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logger.error("Workspace membership check failed", {
      workspaceId,
      userId,
      error: error.message,
    });
    throw new AuthenticationError("Unable to verify workspace membership", {
      code: "workspace_lookup_failed",
      cause: error,
    });
  }

  if (!data) {
    throw new AuthenticationError(
      "User is not a member of the requested workspace",
      { code: "workspace_forbidden" },
    );
  }

  return true;
};
