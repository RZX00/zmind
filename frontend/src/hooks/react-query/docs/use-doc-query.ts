import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { docsKeys } from './keys';
import type { DocBlocksResponse, DocContent } from '@/types/doc';

export function useDocQuery(itemId: string | null) {
  return useQuery<DocContent>({
    queryKey: docsKeys.detail(itemId),
    enabled: Boolean(itemId),
    staleTime: 60_000,
    queryFn: async () => {
      if (!itemId) {
        throw new Error('Missing doc item id');
      }
      const response = await apiClient.get<DocContent>(`/api/docs/${itemId}`, {
        showErrors: false,
      });
      if (!response.success || !response.data) {
        throw response.error || new Error('Failed to load doc');
      }
      return response.data;
    },
  });
}

export function useDocBlocksQuery(itemId: string | null) {
  return useQuery<DocBlocksResponse>({
    queryKey: docsKeys.blocks(itemId),
    enabled: Boolean(itemId),
    staleTime: 60_000,
    queryFn: async () => {
      if (!itemId) {
        throw new Error('Missing doc item id');
      }
      const response = await apiClient.get<DocBlocksResponse>(`/api/docs/${itemId}/blocks`, {
        showErrors: false,
      });
      if (!response.success || !response.data) {
        throw response.error || new Error('Failed to load doc blocks');
      }
      return response.data;
    },
  });
}
