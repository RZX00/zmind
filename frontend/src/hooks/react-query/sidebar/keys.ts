import { createQueryKeys } from "@/hooks/use-query";

const projectKeysBase = ['projects'] as const;
const threadKeysBase = ['threads'] as const;

export const projectKeys = createQueryKeys({
  all: projectKeysBase,
  lists: (workspaceId?: string | null) => [...projectKeysBase, 'list', workspaceId ?? 'personal'] as const,
  details: (projectId: string) => [...projectKeysBase, 'detail', projectId] as const,
  public: () => [...projectKeysBase, 'public'] as const,
});

export const threadKeys = createQueryKeys({
  all: threadKeysBase,
  lists: (workspaceId?: string | null) => [...threadKeysBase, 'list', workspaceId ?? 'personal'] as const,
  byProject: (projectId: string, workspaceId?: string | null) =>
    [...threadKeysBase, 'by-project', projectId, workspaceId ?? 'personal'] as const,
});
