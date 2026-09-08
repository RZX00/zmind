'use client';

import { createQueryHook } from '@/hooks/use-query';
import { getThreads } from '@/lib/api';
import { threadKeys } from './keys';
import { useWorkspace } from '@/contexts/workspace-context';

export const useThreadsByProject = (projectId?: string) => {
  const { workspaceId, isReady } = useWorkspace();
  const workspaceKey = workspaceId ?? 'personal';

  return createQueryHook(
    threadKeys.byProject(projectId || '', workspaceKey),
    () => projectId ? getThreads(projectId) : Promise.resolve([]),
    {
      enabled: !!projectId && isReady,
      staleTime: 2 * 60 * 1000,
      refetchOnWindowFocus: false,
    }
  )();
};

export const useAllThreads = () => {
  const { workspaceId, isReady } = useWorkspace();
  const workspaceKey = workspaceId ?? 'personal';

  return createQueryHook(
    threadKeys.lists(workspaceKey),
    () => getThreads(),
    {
      staleTime: 2 * 60 * 1000,
      refetchOnWindowFocus: false,
      enabled: isReady,
    }
  )();
}; 
