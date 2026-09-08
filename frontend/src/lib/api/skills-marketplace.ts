/**
 * Skills Marketplace API Client
 *
 * Type-safe API client for Skills Marketplace Phase 1 endpoints.
 */

import { apiClient } from "../api-client";
import { resolveBackendBase } from "../backend";

const API_URL = resolveBackendBase();

// ============================================================================
// Types (matching backend Pydantic models)
// ============================================================================

export type SourceType = "github" | "manual" | "marketplace" | "builtin" | "user" | "file";
export type CompatibilityStatus = "compatible" | "partial" | "incompatible" | "unknown";

export interface CompatibilityDetails {
  incompatible_tools: string[];
  alternatives: Record<string, string[]>;
  warnings: string[];
  compatible_ratio: number;
}

export interface CompatibilityResult {
  status: CompatibilityStatus;
  reason: string;
  details: CompatibilityDetails;
  suggestions: string[];
}

export interface InstalledSkill {
  id: string;
  skill_id: string;
  name: string;
  description: string;
  prompt: string;
  allowed_tools: string[];
  enabled: boolean;

  // Marketplace-specific
  source_url?: string | null;
  source_type?: SourceType | null;
  compatibility_status?: CompatibilityStatus | null;
  compatibility_reason?: string | null;

  // Timestamps
  installed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;

  // Optional official fields
  model?: string | null;
  context?: "fork" | null;
  agent?: string | null;
  user_invocable?: boolean;
  argument_hint?: string | null;
  license?: string | null;
}

export interface InstalledSkillsResponse {
  skills: InstalledSkill[];
  total: number;
  by_source: Record<string, number>;
  by_compatibility: Record<string, number>;
}

export interface RegistrySkill {
  id: string;
  skill_id: string;
  name: string;
  description: string;
  allowed_tools: string[];
  enabled: boolean;
  source_type: SourceType;
  source_url?: string | null;
  compatibility_status?: CompatibilityStatus | null;
  compatibility_reason?: string | null;
  installed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  model?: string | null;
  context?: "fork" | null;
  agent?: string | null;
  user_invocable?: boolean;
  argument_hint?: string | null;
  license?: string | null;
  location?: string | null;
  editable?: boolean;
}

export interface SkillsRegistryResponse {
  skills: RegistrySkill[];
  total: number;
  by_source: Record<string, number>;
  by_compatibility: Record<string, number>;
}

export interface SkillImportRequest {
  source_type: "github" | "manual";
  github_url?: string;
  markdown_content?: string;
  force?: boolean;
}

export interface SkillImportResponse {
  success: boolean;
  skill?: InstalledSkill | null;
  compatibility?: CompatibilityResult | null;
  created: boolean;
  message: string;
}

export interface SkillToggleRequest {
  enabled: boolean;
}

export interface SkillToggleResponse {
  success: boolean;
  skill_id: string;
  enabled: boolean;
  message: string;
}

export interface SkillDeleteResponse {
  success: boolean;
  skill_id: string;
  message: string;
}

export interface SkillSource {
  type: "github" | "marketplace" | "builtin";
  name: string;
  description: string;
  url?: string | null;
  skill_count?: number | null;
  compatibility_rate?: number | null;
}

export interface SkillSourcesResponse {
  sources: SkillSource[];
  total: number;
}

// ============================================================================
// Phase 2: Marketplace Integration Types
// ============================================================================

export type SearchType = "keyword" | "ai_semantic";
export type SortBy = "stars" | "recent";

export interface MarketplaceSearchRequest {
  q?: string;
  page?: number;
  limit?: number;
  compatibility_filter?: boolean;
  search_type?: SearchType;
  sort_by?: SortBy;
}

export interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  author?: string | null;
  source_url?: string | null;
  marketplace_url?: string | null;
  install_count?: number | null;
  rating?: number | null;
  tags?: string[];
  category?: string | null;
  compatibility_status?: CompatibilityStatus | null;
  compatibility_reason?: string | null;
  is_installed: boolean;
}

export interface MarketplaceSearchResponse {
  skills: MarketplaceSkill[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

export interface MarketplaceSkillDetail extends MarketplaceSkill {
  markdown_content: string;
  allowed_tools: string[];
  model?: string | null;
  context?: string | null;
  agent?: string | null;
  user_invocable?: boolean | null;
  argument_hint?: string | null;
  license?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  version?: string | null;
}

export interface MarketplaceInstallRequest {
  force?: boolean;
  source_url?: string;
  name?: string;
  description?: string;
}

export interface MarketplaceInstallResponse {
  success: boolean;
  skill?: InstalledSkill | null;
  compatibility?: CompatibilityResult | null;
  created: boolean;
  message: string;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Import a skill from GitHub or manual markdown paste
 */
export async function importSkill(
  request: SkillImportRequest
): Promise<SkillImportResponse> {
  const response = await apiClient.post<SkillImportResponse>(
    `${API_URL}/skills/import`,
    request
  );
  if (!response.success || !response.data) {
    throw response.error || new Error("Failed to import skill");
  }
  return response.data;
}

/**
 * Get list of installed skills with optional filters
 */
export async function getInstalledSkills(params?: {
  source_type?: SourceType;
  compatibility_status?: CompatibilityStatus;
  enabled_only?: boolean;
}): Promise<InstalledSkillsResponse> {
  const response = await apiClient.get<InstalledSkillsResponse>(
    `${API_URL}/skills/installed`,
    { params }
  );
  if (!response.success || !response.data) {
    throw response.error || new Error("Failed to fetch installed skills");
  }
  return response.data;
}

/**
 * Get unified registry of all skills (builtin + file + user)
 */
export async function getSkillRegistry(params?: {
  source_type?: SourceType;
  compatibility_status?: CompatibilityStatus;
  enabled_only?: boolean;
}): Promise<SkillsRegistryResponse> {
  const response = await apiClient.get<SkillsRegistryResponse>(
    `${API_URL}/skills/registry`,
    { params }
  );
  if (!response.success || !response.data) {
    throw response.error || new Error("Failed to fetch skills registry");
  }
  return response.data;
}

/**
 * Check compatibility of a specific skill
 */
export async function checkSkillCompatibility(
  skillName: string
): Promise<CompatibilityResult> {
  const response = await apiClient.get<CompatibilityResult>(
    `${API_URL}/skills/compatibility/${skillName}`
  );
  if (!response.success || !response.data) {
    throw response.error || new Error("Failed to check skill compatibility");
  }
  return response.data;
}

/**
 * Toggle skill enabled/disabled state
 */
export async function toggleSkill(
  skillName: string,
  enabled: boolean
): Promise<SkillToggleResponse> {
  const response = await apiClient.patch<SkillToggleResponse>(
    `${API_URL}/skills/${skillName}/toggle`,
    { enabled }
  );
  if (!response.success || !response.data) {
    throw response.error || new Error("Failed to toggle skill");
  }
  return response.data;
}

/**
 * Delete (uninstall) a skill permanently
 */
export async function deleteSkill(
  skillName: string
): Promise<SkillDeleteResponse> {
  const response = await apiClient.delete<SkillDeleteResponse>(
    `${API_URL}/skills/${skillName}`
  );
  if (!response.success || !response.data) {
    throw response.error || new Error("Failed to delete skill");
  }
  return response.data;
}

/**
 * Get list of available skill sources
 */
export async function getSkillSources(): Promise<SkillSourcesResponse> {
  const response = await apiClient.get<SkillSourcesResponse>(
    `${API_URL}/skills/sources`
  );
  if (!response.success || !response.data) {
    throw response.error || new Error("Failed to fetch skill sources");
  }
  return response.data;
}

// ============================================================================
// Phase 2: Marketplace API Functions
// ============================================================================

/**
 * Search SkillsMP marketplace for skills
 */
export async function searchMarketplace(
  params: MarketplaceSearchRequest
): Promise<MarketplaceSearchResponse> {
  const response = await apiClient.get<MarketplaceSearchResponse>(
    `${API_URL}/skills/marketplace/search`,
    { params }
  );
  if (!response.success || !response.data) {
    throw response.error || new Error("Failed to search marketplace");
  }
  return response.data;
}

/**
 * Get detailed information about a marketplace skill
 */
export async function getMarketplaceSkillDetail(
  skillId: string,
  params?: {
    source_url?: string;
    name?: string;
    description?: string;
  }
): Promise<MarketplaceSkillDetail> {
  const response = await apiClient.get<MarketplaceSkillDetail>(
    `${API_URL}/skills/marketplace/${skillId}`,
    { params }
  );
  if (!response.success || !response.data) {
    throw response.error || new Error("Failed to fetch skill details");
  }
  return response.data;
}

/**
 * Install a skill from SkillsMP marketplace
 */
export async function installFromMarketplace(
  skillId: string,
  request?: MarketplaceInstallRequest
): Promise<MarketplaceInstallResponse> {
  const response = await apiClient.post<MarketplaceInstallResponse>(
    `${API_URL}/skills/marketplace/${skillId}/install`,
    request || {}
  );
  if (!response.success || !response.data) {
    throw response.error || new Error("Failed to install skill from marketplace");
  }
  return response.data;
}
