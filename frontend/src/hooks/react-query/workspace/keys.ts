import { createQueryKeys } from '@/hooks/use-query';

const workspaceKeysBase = ['workspace'] as const;

export const workspaceKeys = createQueryKeys({
  all: workspaceKeysBase,
  detail: (workspaceId: string | null) => [...workspaceKeysBase, workspaceId] as const,
});
