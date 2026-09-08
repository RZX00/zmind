import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { getFileStorageUsage } from '@/lib/api/files';

export const fileStorageUsageKey = ['files', 'storage-usage'] as const;

export function useFileStorageUsage(enabled = true) {
  const { session, isLoading } = useAuth();
  const hasSession = !!session?.access_token;
  return useQuery({
    queryKey: fileStorageUsageKey,
    queryFn: () => getFileStorageUsage(session?.access_token),
    enabled: enabled && hasSession && !isLoading,
    staleTime: 1000 * 60,
  });
}
