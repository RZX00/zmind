import { logger } from "../logger.js";

const WORKSPACE_VERSION_KEY = (workspaceId) =>
  `workspace:version:${workspaceId}`;
const WORKSPACE_AGG_KEY = (workspaceId) =>
  `workspace:agg:${workspaceId}`;
const WORKSPACE_UPDATES_CHANNEL = (workspaceId) =>
  `workspace:updates:${workspaceId}`;

export const createWorkspaceVersioning = (redisClient) => {
  const bump = async (workspaceId) => {
    if (!redisClient || !workspaceId) {
      return null;
    }
    let version = null;
    try {
      version = await redisClient.incr(WORKSPACE_VERSION_KEY(workspaceId));
    } catch (error) {
      logger.error("Failed to increment workspace version", {
        workspaceId,
        error: error.message,
      });
    }

    try {
      await redisClient.del(WORKSPACE_AGG_KEY(workspaceId));
    } catch (error) {
      logger.warn("Failed to invalidate workspace aggregate cache", {
        workspaceId,
        error: error.message,
      });
    }

    if (version !== null) {
      try {
        await redisClient.publish(
          WORKSPACE_UPDATES_CHANNEL(workspaceId),
          JSON.stringify({ type: "workspace_updated", version }),
        );
      } catch (error) {
        logger.warn("Failed to publish workspace update", {
          workspaceId,
          error: error.message,
        });
      }
    }

    return version;
  };

  return {
    bump,
  };
};
