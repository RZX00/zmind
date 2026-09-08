/**
 * MarketplaceSearchPage Component
 *
 * Main page for browsing and searching SkillsMP marketplace.
 * Integrates search filters, skill cards, detail modal, and pagination.
 */

"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  Search,
  AlertCircle,
  Package,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  MarketplaceSearchFilters,
  type UserSearchFilters,
} from "./MarketplaceSearchFilters";
import { MarketplaceSkillCard } from "./MarketplaceSkillCard";
import { MarketplaceSkillDetailDialog } from "./MarketplaceSkillDetailDialog";
import { MarketplaceSkillGridSkeleton } from "./MarketplaceSkillCardSkeleton";
import { useMarketplaceInfiniteSearch } from "@/hooks/react-query/skills-marketplace/use-skills-marketplace";
import type { MarketplaceSkill } from "@/lib/api/skills-marketplace";

const DEFAULT_FILTERS: UserSearchFilters = {
  q: "",
  search_type: "keyword", // default to keyword search when browsing
  compatibility_filter: false,
  sort_by: "stars",
};

export function MarketplaceSearchPage() {
  const t = useTranslations();
  const [filters, setFilters] = useState<UserSearchFilters>(DEFAULT_FILTERS);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<MarketplaceSkill | null>(null);

  // Use infinite query for progressive loading
  const {
    data,
    isLoading,
    error,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMarketplaceInfiniteSearch({
    q: filters.q.trim(), // empty query means browse all/popular skills
    compatibility_filter: filters.compatibility_filter,
    search_type: filters.search_type,
    sort_by: filters.sort_by,
  });

  // Flatten all pages into a single array
  const allSkills = data?.pages.flatMap(page => page.skills) ?? [];

  // Get total count from first page
  const totalCount = data?.pages[0]?.total ?? 0;

  const handleSearch = () => {
    // Query will automatically reset when filters change (due to queryKey change)
  };

  const handleFiltersChange = (newFilters: UserSearchFilters) => {
    setFilters(newFilters);
    // useInfiniteQuery will automatically reset to page 1 when queryKey changes
  };

  const handleViewDetails = (skill: MarketplaceSkill) => {
    setSelectedSkillId(skill.id);
    setSelectedSkill(skill);
  };

  const handleCloseDetails = () => {
    setSelectedSkillId(null);
    setSelectedSkill(null);
  };

  const handleLoadMore = () => {
    if (!isFetchingNextPage && hasNextPage) {
      fetchNextPage();
    }
  };

  const resultsLabel = filters.q.trim()
    ? t("skillsMarketplace.marketplaceSearch.results.found", { count: totalCount })
    : t("skillsMarketplace.marketplaceSearch.results.showing", { count: totalCount });

  const browsingSuffix = !filters.q.trim()
    ? ` ${t("skillsMarketplace.marketplaceSearch.results.browsingAll")}`
    : "";

  const compatibilitySuffix = filters.compatibility_filter
    ? ` ${t("skillsMarketplace.marketplaceSearch.results.compatibleOnly")}`
    : "";

  const displayingLabel = t("skillsMarketplace.marketplaceSearch.results.displaying", {
    shown: allSkills.length,
    total: totalCount,
  });

  const remainingCount = totalCount - allSkills.length > 100
    ? "100+"
    : Math.max(totalCount - allSkills.length, 0);

  return (
    <div className="space-y-6">
      {/* Description */}
      <p className="text-sm text-muted-foreground">
        {t("skillsMarketplace.marketplaceSearch.description")}
      </p>

      {/* Search Filters */}
      <div className="mb-8">
        <MarketplaceSearchFilters
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onSearch={handleSearch}
          isLoading={isLoading || isFetching}
        />
      </div>

      {/* Search Results */}
      <div className="space-y-6">
        {/* Loading State - Skeleton */}
        {isLoading && (
          <MarketplaceSkillGridSkeleton count={9} />
        )}

        {/* Error State */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t("skillsMarketplace.marketplaceSearch.error.title")}</AlertTitle>
            <AlertDescription>
              {error instanceof Error
                ? error.message
                : t("skillsMarketplace.marketplaceSearch.error.generic")}
              {error instanceof Error && error.message.includes("503") && (
                <p className="mt-2 text-sm">
                  {t("skillsMarketplace.marketplaceSearch.error.integration")}
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Empty State - No Results */}
        {!isLoading && !error && allSkills.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">{t("skillsMarketplace.marketplaceSearch.empty.title")}</h3>
            <p className="text-muted-foreground max-w-md">
              {filters.q.trim()
                ? t("skillsMarketplace.marketplaceSearch.empty.noMatch", { query: filters.q.trim() })
                : t("skillsMarketplace.marketplaceSearch.empty.noSkills")}
            </p>
            {filters.q.trim() && (
              <ul className="text-sm text-muted-foreground mt-2 space-y-1">
                <li>{t("skillsMarketplace.marketplaceSearch.empty.tips.keywords")}</li>
                <li>{t("skillsMarketplace.marketplaceSearch.empty.tips.compatibility")}</li>
                <li>{t("skillsMarketplace.marketplaceSearch.empty.tips.semantic")}</li>
              </ul>
            )}
          </div>
        )}

        {/* Results Grid */}
        {!isLoading && allSkills.length > 0 && (
          <>
            {/* Results Header */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">
                {resultsLabel}
                {browsingSuffix}
                {compatibilitySuffix}
                {isFetchingNextPage && (
                  <span className="ml-2 inline-flex items-center text-xs">
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                    {t("skillsMarketplace.marketplaceSearch.results.loadingMore")}
                  </span>
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {displayingLabel}
              </p>
            </div>

            {/* Skills Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {allSkills.map((skill) => (
                <MarketplaceSkillCard
                  key={skill.id}
                  skill={skill}
                  onViewDetails={handleViewDetails}
                />
              ))}
            </div>

            {/* Load More Button */}
            {hasNextPage && (
              <div className="flex flex-col items-center gap-3 mt-8">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={handleLoadMore}
                  disabled={isFetchingNextPage}
                  className="min-w-[200px]"
                >
                  {isFetchingNextPage ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {t("skillsMarketplace.marketplaceSearch.loadMore.loading")}
                    </>
                  ) : (
                    <>
                      {t("skillsMarketplace.marketplaceSearch.loadMore.label")}
                      {totalCount > allSkills.length && (
                        <span className="ml-2 text-muted-foreground">
                          {t("skillsMarketplace.marketplaceSearch.loadMore.remaining", { count: remainingCount })}
                        </span>
                      )}
                    </>
                  )}
                </Button>

                {/* Optional: Show skeleton for next batch */}
                {isFetchingNextPage && (
                  <div className="w-full">
                    <MarketplaceSkillGridSkeleton count={9} />
                  </div>
                )}
              </div>
            )}
          </>
        )}

      </div>

      {/* Skill Detail Modal */}
      {selectedSkillId && (
        <MarketplaceSkillDetailDialog
          open={!!selectedSkillId}
          onOpenChange={(open) => {
            if (!open) {
              handleCloseDetails();
            }
          }}
          skillId={selectedSkillId}
          preloadedData={selectedSkill || undefined}
        />
      )}
    </div>
  );
}
