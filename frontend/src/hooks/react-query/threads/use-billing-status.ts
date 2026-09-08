import { createQueryHook } from "@/hooks/use-query";
import { threadKeys } from "./keys";
import { checkBillingStatus } from "@/lib/api";
import { useWorkspace } from "@/contexts/workspace-context";

export const useBillingStatusQuery = (enabled = true) => {
  const { workspaceId, isReady } = useWorkspace();
  const workspaceKey = workspaceId ?? 'personal';

  return createQueryHook(
    threadKeys.billingStatus(workspaceKey),
    () => checkBillingStatus(),
    {
      enabled: enabled && isReady,
      retry: 1,
      staleTime: 1000 * 60 * 10, // 10 minutes - increased stale time
      gcTime: 1000 * 60 * 15, // 15 minutes cache time
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchInterval: (query: any) => {
        // Only refetch if billing is in a problematic state and at a slower rate
        if (query.state.data && !query.state.data.can_run) {
          return 1000 * 60 * 5; // 5 minutes instead of 1 minute
        }
        return false;
      },
    }
  )();
};
