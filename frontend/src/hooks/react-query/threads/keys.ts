import { createQueryKeys } from "@/hooks/use-query";

export const threadKeys = createQueryKeys({
  all: ['threads'] as const,
  lists: (workspaceId?: string | null) => ['threads', 'list', workspaceId ?? 'personal'] as const,
  details: (threadId: string) => ['thread', threadId] as const,
  messages: (threadId: string) => ['thread', threadId, 'messages'] as const,
  project: (projectId: string) => ['project', projectId] as const,
  publicProjects: () => ['public-projects'] as const,
  agentRuns: (threadId: string) => ['thread', threadId, 'agent-runs'] as const,
  billingStatus: (workspaceId?: string | null) => ['billing', 'status', workspaceId ?? 'personal'] as const,
  byProject: (projectId: string, workspaceId?: string | null) =>
    ['project', projectId, 'threads', workspaceId ?? 'personal'] as const,
});
