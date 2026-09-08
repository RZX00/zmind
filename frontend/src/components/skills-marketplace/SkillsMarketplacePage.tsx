"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRight,
  Compass,
  Download,
  Layers,
  Loader2,
  PackageCheck,
  Plus,
  Search,
  Star,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  useMarketplaceInfiniteSearch,
  useSkillRegistry,
} from "@/hooks/react-query/skills-marketplace/use-skills-marketplace";
import type { MarketplaceSkill } from "@/lib/api/skills-marketplace";
import { useInstallFromMarketplace } from "@/hooks/react-query/skills-marketplace/use-skills-marketplace";
import { ImportSkillDialog } from "./ImportSkillDialog";
import { MarketplaceSkillDetailDialog } from "./MarketplaceSkillDetailDialog";
import { SkillCard } from "./SkillCard";

type ViewMode = "marketplace" | "installed";
type InstalledFilter = "all" | "enabled";

interface PageCopy {
  title: string;
  subtitle: string;
  viewExplore: string;
  viewMine: string;
  newSkill: string;
  featured: string;
  all: string;
  more: string;
  searchPlaceholder: string;
  emptyGridTitle: string;
  emptyGridSubtitle: string;
  installedLabel: string;
  installLabel: string;
  miscCategory: string;
}

interface CategoryChip {
  id: string;
  label: string;
  count: number;
}

const FEATURED_GRADIENTS = [
  "from-violet-500/20 via-indigo-500/15 to-sky-500/10",
  "from-amber-500/20 via-orange-500/15 to-rose-500/10",
  "from-fuchsia-500/20 via-purple-500/15 to-indigo-500/10",
  "from-emerald-500/20 via-teal-500/15 to-cyan-500/10",
] as const;

const FEATURED_ORB_COLORS = [
  "bg-violet-400/30 dark:bg-violet-500/20",
  "bg-amber-400/30 dark:bg-amber-500/20",
  "bg-fuchsia-400/30 dark:bg-fuchsia-500/20",
  "bg-emerald-400/30 dark:bg-emerald-500/20",
] as const;

/* Subtle top-bar accent colors — muted, low saturation for card differentiation */
const CARD_ACCENT_COLORS = [
  "bg-stone-300/70 dark:bg-stone-600/40",
  "bg-slate-300/70 dark:bg-slate-600/40",
  "bg-zinc-300/70 dark:bg-zinc-600/40",
  "bg-neutral-300/70 dark:bg-neutral-600/40",
  "bg-gray-300/60 dark:bg-gray-600/40",
  "bg-stone-400/50 dark:bg-stone-500/30",
  "bg-slate-400/50 dark:bg-slate-500/30",
] as const;

function formatInstallCount(value?: number | null): string {
  if (!value || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function normalizeCategory(
  skill: MarketplaceSkill,
  copy: PageCopy,
  isZh: boolean,
): string {
  const base = (skill.category || skill.tags?.[0] || "").trim();
  if (!base) return copy.miscCategory;

  const lower = base.toLowerCase();
  if (isZh) {
    if (lower.includes("learn") || lower.includes("study")) return "学习";
    if (lower.includes("write") || lower.includes("blog") || lower.includes("copy")) {
      return "写作";
    }
    if (lower.includes("image") || lower.includes("photo") || lower.includes("visual")) {
      return "图片";
    }
    if (lower.includes("slide") || lower.includes("ppt") || lower.includes("presentation")) {
      return "Slides";
    }
    if (lower.includes("web") || lower.includes("site") || lower.includes("html")) {
      return "网页";
    }
    return base;
  }

  if (lower.includes("learn") || lower.includes("study")) return "Learning";
  if (lower.includes("write") || lower.includes("blog") || lower.includes("copy")) {
    return "Writing";
  }
  if (lower.includes("image") || lower.includes("photo") || lower.includes("visual")) {
    return "Images";
  }
  if (lower.includes("slide") || lower.includes("ppt") || lower.includes("presentation")) {
    return "Slides";
  }
  if (lower.includes("web") || lower.includes("site") || lower.includes("html")) {
    return "Web";
  }

  return base;
}

/* ─── Featured Skill Card ─── */

interface FeaturedSkillCardProps {
  skill: MarketplaceSkill;
  index: number;
  onOpenDetails: (skill: MarketplaceSkill) => void;
}

function FeaturedSkillCard({ skill, index, onOpenDetails }: FeaturedSkillCardProps) {
  const gradient = FEATURED_GRADIENTS[index % FEATURED_GRADIENTS.length];
  const orbColor = FEATURED_ORB_COLORS[index % FEATURED_ORB_COLORS.length];

  return (
    <motion.button
      type="button"
      onClick={() => onOpenDetails(skill)}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.08, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileHover={{ y: -3 }}
      className="group relative flex h-full min-h-[220px] flex-col justify-between overflow-hidden rounded-2xl border border-border/40 bg-card p-6 text-left transition-shadow duration-300 hover:border-border hover:shadow-[var(--shadow-elev-5)]"
    >
      {/* Gradient background */}
      <div className={cn("absolute inset-0 bg-gradient-to-br opacity-60 transition-opacity duration-500 group-hover:opacity-80", gradient)} />

      {/* Abstract orb */}
      <div className={cn("absolute -right-8 -top-8 h-32 w-32 rounded-full blur-2xl transition-transform duration-700 group-hover:scale-110", orbColor)} />

      <div className="relative z-10 flex flex-col justify-between h-full">
        <div className="space-y-2.5">
          <h3 className="line-clamp-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {skill.name}
          </h3>
          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {skill.description}
          </p>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {skill.author && (
              <span className="line-clamp-1 text-xs font-medium text-muted-foreground">
                {skill.author}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {skill.rating ? (
              <span className="inline-flex items-center gap-1">
                <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                {skill.rating.toFixed(1)}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Download className="h-3 w-3" />
              {formatInstallCount(skill.install_count)}
            </span>
          </div>
        </div>
      </div>
    </motion.button>
  );
}

/* ─── Marketplace Grid Card ─── */

interface MarketplaceGridCardProps {
  skill: MarketplaceSkill;
  copy: PageCopy;
  index: number;
  onOpenDetails: (skill: MarketplaceSkill) => void;
}

function MarketplaceGridCard({ skill, copy, index, onOpenDetails }: MarketplaceGridCardProps) {
  const t = useTranslations();
  const installMutation = useInstallFromMarketplace();

  const handleInstall = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    installMutation.mutate({
      skillId: skill.id,
      request: {
        force: false,
        source_url: skill.source_url || undefined,
        name: skill.name,
        description: skill.description,
      },
    });
  };

  const accentColor = CARD_ACCENT_COLORS[index % CARD_ACCENT_COLORS.length];

  return (
    <motion.button
      type="button"
      onClick={() => onOpenDetails(skill)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.4), ease: [0.25, 0.46, 0.45, 0.94] }}
      whileHover={{ y: -2 }}
      className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-border/40 bg-card text-left transition-all duration-200 hover:border-border/80 hover:shadow-[var(--shadow-elev-3)]"
    >
      {/* Subtle top accent bar */}
      <div className={cn("h-1 w-full", accentColor)} />

      <div className="flex flex-1 flex-col p-5 pt-4">
      {/* Name */}
      <h3 className="line-clamp-1 text-[15px] font-medium tracking-tight text-foreground">
        {skill.name}
      </h3>

      {/* Description */}
      <p className="mt-3 line-clamp-2 min-h-[40px] flex-1 text-[13px] leading-relaxed text-muted-foreground/80">
        {skill.description}
      </p>

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/20 pt-3.5">
        <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
          {skill.rating ? (
            <span className="inline-flex items-center gap-1">
              <Star className="h-3 w-3 fill-muted-foreground/30 text-muted-foreground/40" />
              {skill.rating.toFixed(1)}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Download className="h-3 w-3" />
            {formatInstallCount(skill.install_count)}
          </span>
        </div>

        {skill.is_installed ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
            {copy.installedLabel}
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleInstall}
            disabled={installMutation.isPending}
            className="h-7 rounded-full border-border/50 px-3.5 text-xs font-medium text-foreground/80 hover:bg-muted/60 hover:text-foreground"
          >
            {installMutation.isPending
              ? t("skillsMarketplace.marketplaceCard.installing")
              : copy.installLabel}
          </Button>
        )}
      </div>
      </div>
    </motion.button>
  );
}

/* ─── Main Page Component ─── */

export function SkillsMarketplacePage() {
  const t = useTranslations();
  const locale = useLocale();
  const isZh = locale.toLowerCase().startsWith("zh");

  const copy: PageCopy = useMemo(
    () =>
      isZh
        ? {
            title: "技能",
            subtitle: "发现、安装和管理 AI 技能",
            viewExplore: "探索",
            viewMine: "我的",
            newSkill: "新技能",
            featured: "推荐",
            all: "全部",
            more: "更多",
            searchPlaceholder: "搜索技能…",
            emptyGridTitle: "没有找到匹配的技能",
            emptyGridSubtitle: "尝试调整搜索词或浏览其他分类",
            installedLabel: "已添加",
            installLabel: "安装",
            miscCategory: "其他",
          }
        : {
            title: "Skills",
            subtitle: "Discover, install, and manage AI skills",
            viewExplore: "Explore",
            viewMine: "My Skills",
            newSkill: "New Skill",
            featured: "Featured",
            all: "All",
            more: "More",
            searchPlaceholder: "Search skills…",
            emptyGridTitle: "No matching skills",
            emptyGridSubtitle: "Try adjusting your search or browsing a different category",
            installedLabel: "Added",
            installLabel: "Install",
            miscCategory: "Other",
          },
    [isZh],
  );

  const [viewMode, setViewMode] = useState<ViewMode>("marketplace");
  const [marketInput, setMarketInput] = useState("");
  const [marketQuery, setMarketQuery] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("all");
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<MarketplaceSkill | null>(null);

  const [installedQuery, setInstalledQuery] = useState("");
  const [installedFilter, setInstalledFilter] = useState<InstalledFilter>("all");

  useEffect(() => {
    const timer = setTimeout(() => {
      setMarketQuery(marketInput.trim());
    }, 260);

    return () => clearTimeout(timer);
  }, [marketInput]);

  const {
    data: registryData,
    isLoading: installedLoading,
    error: installedError,
  } = useSkillRegistry();

  const installedSkills = useMemo(() => {
    const query = installedQuery.trim().toLowerCase();

    return (registryData?.skills ?? []).filter((skill) => {
      if (installedFilter === "enabled" && !skill.enabled) {
        return false;
      }

      if (!query) {
        return true;
      }

      return (
        skill.name.toLowerCase().includes(query) ||
        (skill.description || "").toLowerCase().includes(query)
      );
    });
  }, [registryData?.skills, installedQuery, installedFilter]);

  const {
    data: marketplaceData,
    isLoading: marketplaceLoading,
    error: marketplaceError,
    isFetching,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useMarketplaceInfiniteSearch({
    q: marketQuery || undefined,
    compatibility_filter: false,
    search_type: "keyword",
    sort_by: "stars",
  });

  const marketplaceSkills = useMemo(
    () => marketplaceData?.pages.flatMap((page) => page.skills) ?? [],
    [marketplaceData],
  );

  const marketplaceAvailableSkills = useMemo(
    () => marketplaceSkills.filter((skill) => !skill.is_installed),
    [marketplaceSkills],
  );

  const marketplaceTotal = marketplaceAvailableSkills.length;

  const featuredSkills = useMemo(() => {
    const sortedByPopularity = [...marketplaceAvailableSkills].sort((a, b) => {
      const installsA = a.install_count ?? 0;
      const installsB = b.install_count ?? 0;
      if (installsA !== installsB) {
        return installsB - installsA;
      }
      return a.name.localeCompare(b.name);
    });
    return sortedByPopularity.slice(0, 4);
  }, [marketplaceAvailableSkills]);

  const { marketplaceCategories, hasMoreCategories } = useMemo(() => {
    const counter = new Map<string, CategoryChip>();

    for (const skill of marketplaceAvailableSkills) {
      const label = normalizeCategory(skill, copy, isZh);
      const id = label.toLowerCase();
      const existing = counter.get(id);

      if (existing) {
        existing.count += 1;
      } else {
        counter.set(id, { id, label, count: 1 });
      }
    }

    const dynamic = [...counter.values()].sort((a, b) => b.count - a.count);
    const capped = dynamic.slice(0, 6);

    return {
      marketplaceCategories: [
        { id: "all", label: copy.all, count: marketplaceAvailableSkills.length },
        ...capped,
      ],
      hasMoreCategories: dynamic.length > 6,
    };
  }, [marketplaceAvailableSkills, copy, isZh]);

  useEffect(() => {
    if (!marketplaceCategories.some((item) => item.id === selectedCategoryId)) {
      setSelectedCategoryId("all");
    }
  }, [marketplaceCategories, selectedCategoryId]);

  const filteredMarketplaceSkills = useMemo(() => {
    if (selectedCategoryId === "all") {
      return marketplaceAvailableSkills;
    }

    return marketplaceAvailableSkills.filter((skill) => {
      const category = normalizeCategory(skill, copy, isZh).toLowerCase();
      return category === selectedCategoryId;
    });
  }, [marketplaceAvailableSkills, selectedCategoryId, copy, isZh]);

  const resultsLabel = marketQuery
    ? t("skillsMarketplace.marketplaceSearch.results.found", { count: marketplaceTotal })
    : t("skillsMarketplace.marketplaceSearch.results.showing", { count: marketplaceTotal });

  const shownLabel = t("skillsMarketplace.marketplaceSearch.results.displaying", {
    shown: filteredMarketplaceSkills.length,
    total: marketplaceTotal,
  });

  const handleOpenSkillDetail = (skill: MarketplaceSkill) => {
    setSelectedSkillId(skill.id);
    setSelectedSkill(skill);
  };

  const handleCloseSkillDetail = () => {
    setSelectedSkillId(null);
    setSelectedSkill(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/10">
      <div className="mx-auto w-full max-w-[1280px] px-4 py-10 sm:px-6 lg:px-8">

        {/* ─── Header ─── */}
        <header className="mb-10">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="space-y-2">
              <motion.h1
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
              >
                {copy.title}
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.05 }}
                className="text-sm text-muted-foreground"
              >
                {copy.subtitle}
              </motion.p>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <ImportSkillDialog>
                <Button
                  type="button"
                  className="h-9 rounded-full bg-foreground px-4 text-sm font-medium text-background hover:bg-foreground/90"
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  {copy.newSkill}
                </Button>
              </ImportSkillDialog>
            </motion.div>
          </div>

          {/* Tab switcher */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.12 }}
            className="mt-6 inline-flex items-center rounded-full border border-border/60 bg-muted/50 p-1"
          >
            {(["marketplace", "installed"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={cn(
                  "relative inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-200",
                  viewMode === mode
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {viewMode === mode && (
                  <motion.div
                    layoutId="skills-tab-indicator"
                    className="absolute inset-0 rounded-full bg-background shadow-sm"
                    transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                  />
                )}
                <span className="relative z-10 inline-flex items-center gap-1.5">
                  {mode === "marketplace" ? (
                    <Compass className="h-3.5 w-3.5" />
                  ) : (
                    <PackageCheck className="h-3.5 w-3.5" />
                  )}
                  {mode === "marketplace" ? copy.viewExplore : copy.viewMine}
                </span>
              </button>
            ))}
          </motion.div>
        </header>

        {/* ─── Marketplace View ─── */}
        <AnimatePresence mode="wait">
          {viewMode === "marketplace" ? (
            <motion.div
              key="marketplace"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* Featured Section */}
              <section className="mb-10">
                <h2 className="mb-4 text-lg font-medium tracking-tight text-foreground">
                  {copy.featured}
                </h2>

                {marketplaceLoading ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <Skeleton key={index} className="h-[220px] rounded-2xl" />
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {featuredSkills.map((skill, index) => (
                      <FeaturedSkillCard
                        key={skill.id}
                        skill={skill}
                        index={index}
                        onOpenDetails={handleOpenSkillDetail}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* Category chips + Search — single row */}
              <section className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {/* Category chips — left */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {marketplaceCategories.map((category) => {
                    const active = selectedCategoryId === category.id;

                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setSelectedCategoryId(category.id)}
                        className={cn(
                          "relative rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-200",
                          active
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {active && (
                          <motion.div
                            layoutId="skills-category-indicator"
                            className="absolute inset-0 rounded-full bg-foreground/[0.06] dark:bg-foreground/10"
                            transition={{ type: "spring", bounce: 0.15, duration: 0.45 }}
                          />
                        )}
                        <span className="relative z-10">
                          {category.label}
                          {category.count > 0 && (
                            <span className="ml-1 text-xs text-muted-foreground/50">
                              {category.count}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                  {hasMoreCategories && (
                    <span className="rounded-full px-3 py-1.5 text-sm text-muted-foreground/50">
                      {copy.more}
                    </span>
                  )}
                </div>

                {/* Search — right */}
                <div className="relative w-full shrink-0 sm:w-[360px]">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={marketInput}
                    onChange={(event) => setMarketInput(event.target.value)}
                    placeholder={copy.searchPlaceholder}
                    className="h-9 rounded-full border-border/50 bg-muted/40 pl-9 pr-4 text-sm text-foreground transition-all duration-200 placeholder:text-muted-foreground/60 focus-visible:border-border focus-visible:bg-background focus-visible:shadow-[var(--shadow-elev-3)] focus-visible:ring-0"
                  />
                </div>
              </section>

              {/* Error state */}
              {marketplaceError && (
                <Alert variant="destructive" className="mb-6 rounded-xl">
                  <AlertTitle>{t("skillsMarketplace.marketplaceSearch.error.title")}</AlertTitle>
                  <AlertDescription>
                    {marketplaceError instanceof Error
                      ? marketplaceError.message
                      : t("skillsMarketplace.marketplaceSearch.error.generic")}
                  </AlertDescription>
                </Alert>
              )}

              {/* Results meta */}
              {!marketplaceError && (
                <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground/70">
                  <span>{resultsLabel}</span>
                  <span className="text-muted-foreground/30">/</span>
                  <span>{shownLabel}</span>
                  {(isFetching || isFetchingNextPage) && (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t("skillsMarketplace.marketplaceSearch.loadMore.loading")}
                    </span>
                  )}
                </div>
              )}

              {/* Loading skeletons */}
              {marketplaceLoading ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <Skeleton key={index} className="h-[200px] rounded-2xl" />
                  ))}
                </div>
              ) : null}

              {/* Empty state */}
              {!marketplaceLoading && !marketplaceError && filteredMarketplaceSkills.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="rounded-2xl border border-dashed border-border/50 bg-muted/20 py-20 text-center"
                >
                  <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60">
                    <Layers className="h-6 w-6 text-muted-foreground/50" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">{copy.emptyGridTitle}</h3>
                  <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                    {marketQuery
                      ? t("skillsMarketplace.marketplaceSearch.empty.noMatch", {
                          query: marketQuery,
                        })
                      : copy.emptyGridSubtitle}
                  </p>
                </motion.div>
              )}

              {/* Skills grid — 4 columns */}
              {!marketplaceLoading && filteredMarketplaceSkills.length > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filteredMarketplaceSkills.map((skill, index) => (
                    <MarketplaceGridCard
                      key={skill.id}
                      skill={skill}
                      copy={copy}
                      index={index}
                      onOpenDetails={handleOpenSkillDetail}
                    />
                  ))}
                </div>
              )}

              {/* Load more */}
              {hasNextPage && !marketplaceLoading && (
                <div className="mt-10 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="h-10 rounded-full border-border/60 px-6 text-sm font-medium transition-all duration-200 hover:border-border hover:shadow-[var(--shadow-elev-3)]"
                  >
                    {isFetchingNextPage ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t("skillsMarketplace.marketplaceSearch.loadMore.loading")}
                      </>
                    ) : (
                      <>
                        {t("skillsMarketplace.marketplaceSearch.loadMore.label")}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              )}
            </motion.div>
          ) : (
            /* ─── Installed View ─── */
            <motion.section
              key="installed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* Installed filter bar */}
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="inline-flex items-center rounded-full border border-border/60 bg-muted/50 p-1">
                  {(["all", "enabled"] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setInstalledFilter(filter)}
                      className={cn(
                        "relative rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-200",
                        installedFilter === filter
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {installedFilter === filter && (
                        <motion.div
                          layoutId="installed-filter-indicator"
                          className="absolute inset-0 rounded-full bg-background shadow-sm"
                          transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                        />
                      )}
                      <span className="relative z-10">
                        {filter === "all"
                          ? copy.all
                          : t("skillsMarketplace.filters.toggle.enabledOnly")}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="relative w-full lg:w-[280px]">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={installedQuery}
                    onChange={(event) => setInstalledQuery(event.target.value)}
                    placeholder={copy.searchPlaceholder}
                    className="h-10 rounded-full border-border/60 bg-muted/40 pl-9 text-sm text-foreground shadow-sm placeholder:text-muted-foreground/60 focus-visible:border-border focus-visible:bg-background focus-visible:ring-0"
                  />
                </div>
              </div>

              {/* Error */}
              {installedError && (
                <Alert variant="destructive" className="rounded-xl">
                  <AlertDescription>{t("skillsMarketplace.errors.loadSkills")}</AlertDescription>
                </Alert>
              )}

              {/* Loading */}
              {installedLoading && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-[200px] rounded-2xl" />
                  ))}
                </div>
              )}

              {/* Installed skills grid */}
              {!installedLoading && installedSkills.length > 0 && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {installedSkills.map((skill, index) => (
                    <motion.div
                      key={skill.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.3) }}
                    >
                      <SkillCard skill={skill} />
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Empty installed state */}
              {!installedLoading && installedSkills.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="rounded-2xl border border-dashed border-border/50 bg-muted/20 py-20 text-center"
                >
                  <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60">
                    <Layers className="h-6 w-6 text-muted-foreground/50" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">
                    {t("skillsMarketplace.empty.title")}
                  </h3>
                  <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                    {installedQuery.trim() || installedFilter === "enabled"
                      ? t("skillsMarketplace.empty.description.filtered")
                      : t("skillsMarketplace.empty.description.noSkills")}
                  </p>
                  {!installedQuery.trim() && installedFilter !== "enabled" && (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-6 rounded-full border-border/60 px-5 text-sm font-medium hover:border-border"
                      onClick={() => setViewMode("marketplace")}
                    >
                      {t("skillsMarketplace.empty.actions.browseMarketplace")}
                    </Button>
                  )}
                </motion.div>
              )}
            </motion.section>
          )}
        </AnimatePresence>

        {/* Detail dialog */}
        {selectedSkillId && (
          <MarketplaceSkillDetailDialog
            open={Boolean(selectedSkillId)}
            onOpenChange={(open) => {
              if (!open) {
                handleCloseSkillDetail();
              }
            }}
            skillId={selectedSkillId}
            preloadedData={selectedSkill || undefined}
          />
        )}
      </div>
    </div>
  );
}
