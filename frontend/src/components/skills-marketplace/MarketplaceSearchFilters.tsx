"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Search, Sparkles, SlidersHorizontal, ArrowUpDown, CheckCircle2, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { SearchType } from "@/lib/api/skills-marketplace";

export interface SearchFilters {
  q: string;
  search_type: SearchType;
  compatibility_filter: boolean;
  limit: number;
  sort_by?: "stars" | "recent";
}

// For infinite loading mode, limit is managed internally by the hook
export type UserSearchFilters = Omit<SearchFilters, 'limit'>;

interface MarketplaceSearchFiltersProps {
  filters: UserSearchFilters;
  onFiltersChange: (filters: UserSearchFilters) => void;
  onSearch: () => void;
  isLoading?: boolean;
}

export function MarketplaceSearchFilters({
  filters,
  onFiltersChange,
  onSearch,
  isLoading = false,
}: MarketplaceSearchFiltersProps) {
  const t = useTranslations();
  // Local state for input value
  const [localQuery, setLocalQuery] = useState(filters.q);

  useEffect(() => {
    setLocalQuery(filters.q);
  }, [filters.q]);

  const handleQueryChange = (value: string) => {
    setLocalQuery(value);
  };

  const handleSearchClick = () => {
    onFiltersChange({ ...filters, q: localQuery });
    onSearch();
  };

  const handleSearchTypeChange = (value: SearchType) => {
    onFiltersChange({ ...filters, q: localQuery, search_type: value });
  };

  const handleCompatibilityToggle = (checked: boolean) => {
    onFiltersChange({ ...filters, q: localQuery, compatibility_filter: checked });
  };

  const handleSortByChange = (value: "stars" | "recent") => {
    onFiltersChange({ ...filters, q: localQuery, sort_by: value });
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isLoading) {
      handleSearchClick();
    }
  };

  const isAiSearch = filters.search_type === "ai_semantic";

  return (
    <div className="space-y-4">
      {/* 1. Hero Search Input */}
      <div className="relative group">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          {isAiSearch ? (
             <Sparkles className="h-5 w-5 text-indigo-500 animate-pulse" />
          ) : (
             <Search className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <Input
          type="text"
          placeholder={
            isAiSearch
              ? t("skillsMarketplace.marketplaceFilters.placeholder.ai")
              : t("skillsMarketplace.marketplaceFilters.placeholder.keyword")
          }
          value={localQuery}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyPress={handleKeyPress}
          className="pl-11 pr-32 h-12 text-base shadow-sm border-muted-foreground/20 focus-visible:ring-primary/20 transition-all rounded-lg"
          disabled={isLoading}
        />
        <div className="absolute inset-y-0 right-1.5 flex items-center">
          <Button 
            onClick={handleSearchClick} 
            disabled={isLoading} 
            size="sm" 
            className="h-9 px-4 font-medium bg-[#2c3e2d] hover:bg-[#3d563e] text-white transition-colors duration-200 shadow-sm border-none"
          >
            {isLoading
              ? t("skillsMarketplace.marketplaceFilters.searchButton.loading")
              : t("skillsMarketplace.marketplaceFilters.searchButton.label")}
          </Button>
        </div>
      </div>

      {/* 2. Filter Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-1">
        
        {/* Left: Search Type Toggle */}
        <div className="flex items-center bg-[#f1f3f1] p-1 rounded-lg border border-[#e2e8e2]">
          <button
            onClick={() => handleSearchTypeChange("ai_semantic")}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
              isAiSearch 
                ? "bg-white text-[#2c3e2d] shadow-sm" 
                : "text-[#6b7c70] hover:text-[#2c3e2d]"
            )} 
          >
            <Sparkles className="w-3.5 h-3.5" />
            {t("skillsMarketplace.marketplaceFilters.searchType.ai")}
          </button>
          <button
            onClick={() => handleSearchTypeChange("keyword")}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
              !isAiSearch 
                ? "bg-white text-[#2c3e2d] shadow-sm" 
                : "text-[#6b7c70] hover:text-[#2c3e2d]"
            )} 
          >
            <Search className="w-3.5 h-3.5" />
            {t("skillsMarketplace.marketplaceFilters.searchType.keyword")}
          </button>
        </div>

        {/* Right: Secondary Filters */}
        <div className="flex items-center gap-3 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          
          {/* Sort (Only for Keyword) */}
          <div className={cn("transition-opacity duration-200", isAiSearch ? "opacity-40 pointer-events-none" : "opacity-100")}>
            <Select
              value={filters.sort_by || "stars"}
              onValueChange={(value) => handleSortByChange(value as any)}
              disabled={isAiSearch}
            >
              <SelectTrigger className="h-9 w-[145px] text-xs border-border/60 bg-transparent text-[#2c3e2d] font-medium">
                <ArrowUpDown className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                <SelectValue placeholder={t("skillsMarketplace.marketplaceFilters.sort.placeholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stars">{t("skillsMarketplace.marketplaceFilters.sort.stars")}</SelectItem>
                <SelectItem value="recent">{t("skillsMarketplace.marketplaceFilters.sort.recent")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Compatibility Toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id="compat-mode"
              checked={filters.compatibility_filter}
              onCheckedChange={handleCompatibilityToggle}
              className="scale-90"
            />
            <Label htmlFor="compat-mode" className="text-xs font-medium cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
              {t("skillsMarketplace.marketplaceFilters.compatibilityOnly")}
            </Label>
          </div>
          

        </div>
      </div>
      
      {/* Search Tips (Subtle) */}
      <div className="text-[10px] text-muted-foreground/60 px-1 flex items-center gap-2">
         <span className="font-semibold uppercase tracking-wider">{t("skillsMarketplace.marketplaceFilters.tip.label")}</span>
         {isAiSearch 
           ? t("skillsMarketplace.marketplaceFilters.tip.ai")
           : t("skillsMarketplace.marketplaceFilters.tip.keyword")
         }
      </div>
    </div>
  );
}
