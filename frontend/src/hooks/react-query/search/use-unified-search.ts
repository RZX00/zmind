'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  SearchIndexStatus,
  SuggestLinksResponse,
  UnifiedSearchResponse,
} from '@/types/search';

interface UseUnifiedSearchOptions {
  enabled?: boolean;
  limit?: number;
  cursor?: string | null;
}

interface SuggestLinksPayload {
  contextItemId?: string;
  contextText: string;
  limit?: number;
}

export function useUnifiedSearch(query: string, options?: UseUnifiedSearchOptions) {
  const normalizedQuery = query.trim();
  const limit = Math.min(Math.max(options?.limit || 12, 1), 50);
  const cursor = options?.cursor || null;
  const enabled = (options?.enabled ?? true) && normalizedQuery.length > 0;

  return useQuery({
    queryKey: ['search', 'unified', normalizedQuery, limit, cursor],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const response = await apiClient.post<UnifiedSearchResponse>(
        '/api/search/unified',
        {
          query: normalizedQuery,
          limit,
          cursor,
          includeDebug: true,
        },
        { showErrors: false },
      );
      if (!response.success || !response.data) {
        throw response.error || new Error('Failed to run unified search');
      }
      return response.data;
    },
  });
}

export function useSuggestLinks() {
  return useMutation({
    mutationFn: async (payload: SuggestLinksPayload) => {
      const response = await apiClient.post<SuggestLinksResponse>(
        '/api/search/suggest-links',
        {
          contextItemId: payload.contextItemId,
          contextText: payload.contextText,
          limit: payload.limit || 5,
        },
        { showErrors: false },
      );
      if (!response.success || !response.data) {
        throw response.error || new Error('Failed to suggest links');
      }
      return response.data;
    },
  });
}

export function useSearchIndexStatus(enabled = true) {
  return useQuery({
    queryKey: ['search', 'index-status'],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const response = await apiClient.get<SearchIndexStatus>('/api/search/index-status', {
        showErrors: false,
      });
      if (!response.success || !response.data) {
        throw response.error || new Error('Failed to fetch search index status');
      }
      return response.data;
    },
  });
}

