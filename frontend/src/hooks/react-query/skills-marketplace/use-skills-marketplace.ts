/**
 * React Query hooks for Skills Marketplace
 *
 * TanStack Query hooks for managing skills installation and state.
 */

import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  importSkill,
  getInstalledSkills,
  getSkillRegistry,
  checkSkillCompatibility,
  toggleSkill,
  deleteSkill,
  getSkillSources,
  searchMarketplace,
  getMarketplaceSkillDetail,
  installFromMarketplace,
  type SkillImportRequest,
  type InstalledSkillsResponse,
  type SkillsRegistryResponse,
  type CompatibilityResult,
  type SkillSourcesResponse,
  type SourceType,
  type CompatibilityStatus,
  type MarketplaceSearchRequest,
  type MarketplaceSearchResponse,
  type MarketplaceSkillDetail,
  type MarketplaceInstallRequest,
} from "@/lib/api/skills-marketplace";

// ============================================================================
// Query Keys
// ============================================================================

const baseKey = ["skills-marketplace"] as const;

export const skillsMarketplaceKeys = {
  all: baseKey,
  installed: (filters?: {
    source_type?: SourceType;
    compatibility_status?: CompatibilityStatus;
    enabled_only?: boolean;
  }) => [...baseKey, "installed", filters] as const,
  registry: (filters?: {
    source_type?: SourceType;
    compatibility_status?: CompatibilityStatus;
    enabled_only?: boolean;
  }) => [...baseKey, "registry", filters] as const,
  compatibility: (skillName: string) =>
    [...baseKey, "compatibility", skillName] as const,
  sources: () => [...baseKey, "sources"] as const,

  // Phase 2: Marketplace query keys
  marketplace: {
    all: [...baseKey, "marketplace"] as const,
    search: (params: MarketplaceSearchRequest) =>
      [...baseKey, "marketplace", "search", params] as const,
    infiniteSearch: (filters: Omit<MarketplaceSearchRequest, 'page' | 'limit'>) =>
      [...baseKey, "marketplace", "infinite-search", filters] as const,
    detail: (skillId: string) =>
      [...baseKey, "marketplace", "detail", skillId] as const,
  },
};

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Get list of installed skills
 */
export function useInstalledSkills(params?: {
  source_type?: SourceType;
  compatibility_status?: CompatibilityStatus;
  enabled_only?: boolean;
}) {
  return useQuery<InstalledSkillsResponse>({
    queryKey: skillsMarketplaceKeys.installed(params),
    queryFn: () => getInstalledSkills(params),
  });
}

/**
 * Get unified skills registry list
 */
export function useSkillRegistry(params?: {
  source_type?: SourceType;
  compatibility_status?: CompatibilityStatus;
  enabled_only?: boolean;
}) {
  return useQuery<SkillsRegistryResponse>({
    queryKey: skillsMarketplaceKeys.registry(params),
    queryFn: () => getSkillRegistry(params),
  });
}

/**
 * Check compatibility of a specific skill
 */
export function useSkillCompatibility(skillName: string, enabled = true) {
  return useQuery<CompatibilityResult>({
    queryKey: skillsMarketplaceKeys.compatibility(skillName),
    queryFn: () => checkSkillCompatibility(skillName),
    enabled: enabled && !!skillName,
  });
}

/**
 * Get list of available skill sources
 */
export function useSkillSources() {
  return useQuery<SkillSourcesResponse>({
    queryKey: skillsMarketplaceKeys.sources(),
    queryFn: () => getSkillSources(),
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Import a skill from GitHub or manual paste
 */
export function useImportSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: SkillImportRequest) => importSkill(request),
    onSuccess: (data) => {
      // Invalidate installed skills to refetch
      queryClient.invalidateQueries({
        queryKey: skillsMarketplaceKeys.all,
      });

      // Show success toast
      const compatibilityEmoji = {
        compatible: "✅",
        partial: "⚠️",
        incompatible: "❌",
        unknown: "❓",
      };

      const emoji = data.compatibility
        ? compatibilityEmoji[data.compatibility.status]
        : "✅";

      toast.success(`${emoji} ${data.message}`);
    },
    onError: (error: any) => {
      const errorMessage =
        error.response?.data?.detail || error.message || "Failed to import skill";
      toast.error(errorMessage);
    },
  });
}

/**
 * Toggle skill enabled/disabled state
 */
export function useToggleSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ skillName, enabled }: { skillName: string; enabled: boolean }) =>
      toggleSkill(skillName, enabled),
    onSuccess: (data) => {
      // Invalidate ALL installed skills queries (including filtered ones)
      // Using the shared prefix to catch all filter combinations
      queryClient.invalidateQueries({
        queryKey: skillsMarketplaceKeys.all,
      });

      toast.success(data.message);
    },
    onError: (error: any) => {
      const errorMessage =
        error.response?.data?.detail || error.message || "Failed to toggle skill";
      toast.error(errorMessage);
    },
  });
}

/**
 * Delete (uninstall) a skill
 */
export function useDeleteSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (skillName: string) => deleteSkill(skillName),
    onSuccess: (data) => {
      // Invalidate queries
      queryClient.invalidateQueries({
        queryKey: skillsMarketplaceKeys.all,
      });

      toast.success(data.message);
    },
    onError: (error: any) => {
      const errorMessage =
        error.response?.data?.detail || error.message || "Failed to delete skill";
      toast.error(errorMessage);
    },
  });
}

// ============================================================================
// Phase 2: Marketplace Query & Mutation Hooks
// ============================================================================

/**
 * Search SkillsMP marketplace for skills
 * Empty query returns popular/all skills
 */
export function useMarketplaceSearch(params: MarketplaceSearchRequest) {
  return useQuery<MarketplaceSearchResponse>({
    queryKey: skillsMarketplaceKeys.marketplace.search(params),
    queryFn: () => searchMarketplace(params),
    // Always enabled - empty query shows popular/all skills
  });
}

/**
 * Infinite scroll search for SkillsMP marketplace
 * Loads 9 skills at a time with "Load More" button
 */
export function useMarketplaceInfiniteSearch(
  filters: Omit<MarketplaceSearchRequest, 'page' | 'limit'>
) {
  return useInfiniteQuery<MarketplaceSearchResponse>({
    queryKey: skillsMarketplaceKeys.marketplace.infiniteSearch(filters),
    queryFn: ({ pageParam = 1 }) => searchMarketplace({
      ...filters,
      page: pageParam as number,
      limit: 8, // 8 skills per load (4-col grid)
    }),
    getNextPageParam: (lastPage) => {
      // Return next page number if there are more results
      return lastPage.has_more ? lastPage.page + 1 : undefined;
    },
    initialPageParam: 1,
  });
}

/**
 * Get detailed information about a marketplace skill
 */
export function useMarketplaceSkillDetail(
  skillId: string,
  params?: { source_url?: string; name?: string; description?: string },
  enabled = true
) {
  return useQuery<MarketplaceSkillDetail>({
    queryKey: skillsMarketplaceKeys.marketplace.detail(skillId),
    queryFn: () => getMarketplaceSkillDetail(skillId, params),
    enabled: enabled && !!skillId,
  });
}

/**
 * Install a skill from SkillsMP marketplace
 */
export function useInstallFromMarketplace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      skillId,
      request,
    }: {
      skillId: string;
      request?: MarketplaceInstallRequest;
    }) => installFromMarketplace(skillId, request),
    onSuccess: (data) => {
      // Invalidate installed skills to refetch
      queryClient.invalidateQueries({
        queryKey: skillsMarketplaceKeys.all,
      });

      // Show success toast with compatibility emoji
      const compatibilityEmoji = {
        compatible: "✅",
        partial: "⚠️",
        incompatible: "❌",
        unknown: "❓",
      };

      const emoji = data.compatibility
        ? compatibilityEmoji[data.compatibility.status]
        : "✅";

      toast.success(`${emoji} ${data.message}`);
    },
    onError: (error: any) => {
      const errorMessage =
        error.response?.data?.detail ||
        error.message ||
        "Failed to install skill from marketplace";
      toast.error(errorMessage);
    },
  });
}
