import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getInfographicPreferenceDefaults,
  listInfographicMarketListings,
  listInfographicRecipes,
  updateInfographicPreferenceDefaults,
  type InfographicPreferenceDefaultsResponse,
  type InfographicRecipe,
  type InfographicMarketListing,
  type InfographicMergeMode,
  type InfographicStyleLock,
} from '@/lib/api';

const baseKey = ['infographic'] as const;

export const infographicKeys = {
  all: baseKey,
  recipes: (query?: string) => [...baseKey, 'recipes', query || ''] as const,
  marketListings: (params?: { query?: string; limit?: number; offset?: number }) =>
    [...baseKey, 'market-listings', params || {}] as const,
  defaults: () => [...baseKey, 'defaults'] as const,
};

export function useInfographicRecipes(query?: string, enabled = true) {
  return useQuery<{ recipes: InfographicRecipe[]; count: number }>({
    queryKey: infographicKeys.recipes(query),
    queryFn: () => listInfographicRecipes({ query }),
    staleTime: 60_000,
    enabled,
  });
}

export function useInfographicMarketListings(
  params?: { query?: string; limit?: number; offset?: number },
  enabled = true,
) {
  return useQuery<{ listings: InfographicMarketListing[]; count: number }>({
    queryKey: infographicKeys.marketListings(params),
    queryFn: () => listInfographicMarketListings(params),
    staleTime: 60_000,
    enabled,
  });
}

export function useInfographicPreferenceDefaults(enabled = true) {
  return useQuery<InfographicPreferenceDefaultsResponse>({
    queryKey: infographicKeys.defaults(),
    queryFn: () => getInfographicPreferenceDefaults(),
    staleTime: 30_000,
    enabled,
  });
}

export function useUpdateInfographicPreferenceDefaults() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      scope?: 'user' | 'workspace';
      default_recipe_id?: string | null;
      default_custom_prompt?: string | null;
      default_merge_mode?: InfographicMergeMode;
      default_style_lock?: InfographicStyleLock;
      default_reference_image_file_id?: string | null;
    }) => updateInfographicPreferenceDefaults(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: infographicKeys.all });
    },
  });
}
