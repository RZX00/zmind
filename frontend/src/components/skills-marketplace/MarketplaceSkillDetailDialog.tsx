"use client";

import { useTranslations } from "next-intl";
import {
  Download,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Star,
  CheckCheck,
  Calendar,
  Tag,
  FileText,
  Wrench,
  Shield,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { motion } from "motion/react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useMarketplaceSkillDetail,
  useInstallFromMarketplace,
} from "@/hooks/react-query/skills-marketplace/use-skills-marketplace";
import type { MarketplaceSkill } from "@/lib/api/skills-marketplace";
import { cn } from "@/lib/utils";

interface MarketplaceSkillDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillId: string;
  preloadedData?: MarketplaceSkill;
}

export function MarketplaceSkillDetailDialog({
  open,
  onOpenChange,
  skillId,
  preloadedData,
}: MarketplaceSkillDetailDialogProps) {
  const t = useTranslations();
  const {
    data: skillDetail,
    isLoading,
    error,
  } = useMarketplaceSkillDetail(
    skillId,
    {
      source_url: preloadedData?.source_url || undefined,
      name: preloadedData?.name || undefined,
      description: preloadedData?.description || undefined,
    },
    open,
  );
  const installMutation = useInstallFromMarketplace();

  const skill = skillDetail || preloadedData;

  const compatibilityConfig = {
    compatible: {
      label: t("skillsMarketplace.compatibility.compatible"),
      dotColor: "bg-emerald-500",
      textColor: "text-emerald-700 dark:text-emerald-400",
      icon: CheckCircle2,
    },
    partial: {
      label: t("skillsMarketplace.compatibility.partial"),
      dotColor: "bg-amber-500",
      textColor: "text-amber-700 dark:text-amber-400",
      icon: AlertTriangle,
    },
    incompatible: {
      label: t("skillsMarketplace.compatibility.incompatible"),
      dotColor: "bg-rose-500",
      textColor: "text-rose-700 dark:text-rose-400",
      icon: AlertCircle,
    },
    unknown: {
      label: t("skillsMarketplace.compatibility.unknown"),
      dotColor: "bg-muted-foreground/40",
      textColor: "text-muted-foreground",
      icon: AlertCircle,
    },
  };

  const compatStatus = skill?.compatibility_status || "unknown";
  const compatConfig = compatibilityConfig[compatStatus];

  const handleInstall = () => {
    installMutation.mutate(
      {
        skillId,
        request: {
          force: false,
          source_url: skill?.source_url || undefined,
          name: skill?.name || undefined,
          description: skill?.description || undefined,
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden rounded-2xl border-border/50 p-0 shadow-[var(--shadow-elev-7)]">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="flex h-full flex-col"
        >
          {/* Gradient accent bar */}
          <div className="h-1 w-full bg-gradient-to-r from-brand-500 via-brand-600 to-brand-700" />

          <DialogHeader className="border-b border-border/40 px-8 pb-5 pt-6">
            {isLoading && !skill ? (
              <div className="space-y-3">
                <Skeleton className="h-7 w-3/4 rounded-lg" />
                <Skeleton className="h-4 w-1/2 rounded-lg" />
              </div>
            ) : error ? (
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <DialogTitle>
                  {t("skillsMarketplace.marketplaceDetail.errorTitle")}
                </DialogTitle>
              </div>
            ) : skill ? (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <DialogTitle className="text-xl font-semibold tracking-tight sm:text-2xl">
                      {skill.name}
                    </DialogTitle>
                    {skill.author && (
                      <DialogDescription className="text-sm">
                        {t("skillsMarketplace.marketplaceDetail.byAuthor", {
                          author: skill.author,
                        })}
                      </DialogDescription>
                    )}
                  </div>

                  {/* Compatibility — dot style */}
                  <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/50 px-2.5 py-1">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        compatConfig.dotColor,
                      )}
                    />
                    <span
                      className={cn(
                        "text-xs font-medium",
                        compatConfig.textColor,
                      )}
                    >
                      {compatConfig.label}
                    </span>
                  </div>
                </div>

                {/* Stats Row */}
                <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
                  {skill.rating && (
                    <div className="flex items-center gap-1">
                      <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                      <span>{skill.rating.toFixed(1)}</span>
                    </div>
                  )}
                  {skill.install_count && (
                    <div className="flex items-center gap-1">
                      <Download className="h-3.5 w-3.5" />
                      <span>
                        {t(
                          "skillsMarketplace.marketplaceDetail.installs",
                          { count: skill.install_count },
                        )}
                      </span>
                    </div>
                  )}
                  {skillDetail?.version && (
                    <div className="flex items-center gap-1">
                      <Tag className="h-3.5 w-3.5" />
                      <span className="font-mono text-xs">
                        v{skillDetail.version}
                      </span>
                    </div>
                  )}
                </div>

                {/* Tags */}
                {skill.tags && skill.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {skill.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="rounded bg-muted/50 px-2 py-0.5 text-xs font-normal"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </>
            ) : null}
          </DialogHeader>

          <div className="flex min-h-0 flex-1">
            {/* Main content */}
            <ScrollArea className="flex-1 px-8 py-6">
              {isLoading && !skill ? (
                <div className="space-y-4">
                  <Skeleton className="h-4 w-full rounded" />
                  <Skeleton className="h-4 w-5/6 rounded" />
                  <Skeleton className="h-4 w-4/6 rounded" />
                  <Skeleton className="mt-4 h-32 w-full rounded-lg" />
                </div>
              ) : error ? (
                <div className="py-12 text-center text-muted-foreground">
                  <AlertCircle className="mx-auto mb-4 h-10 w-10 text-muted-foreground/40" />
                  <p>
                    {t("skillsMarketplace.marketplaceDetail.errorTitle")}
                  </p>
                  <p className="mt-2 text-sm">
                    {error instanceof Error
                      ? error.message
                      : t(
                          "skillsMarketplace.marketplaceDetail.unknownError",
                        )}
                  </p>
                </div>
              ) : skill ? (
                <div className="space-y-7">
                  {/* Description */}
                  <div>
                    <h3 className="mb-2.5 flex items-center gap-2 text-sm font-medium text-foreground">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {t("skillsMarketplace.marketplaceDetail.description")}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {skill.description}
                    </p>
                  </div>

                  {/* Compatibility Information */}
                  {compatStatus !== "compatible" &&
                    skill.compatibility_reason && (
                      <div className="rounded-xl border border-border/40 bg-muted/30 p-4">
                        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                          <Shield className="h-4 w-4 text-muted-foreground" />
                          {t(
                            "skillsMarketplace.marketplaceDetail.compatibilityNote",
                          )}
                        </h3>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          {skill.compatibility_reason}
                        </p>
                      </div>
                    )}

                  {/* Allowed Tools */}
                  {skillDetail?.allowed_tools &&
                    skillDetail.allowed_tools.length > 0 && (
                      <div>
                        <h3 className="mb-2.5 flex items-center gap-2 text-sm font-medium text-foreground">
                          <Wrench className="h-4 w-4 text-muted-foreground" />
                          {t(
                            "skillsMarketplace.marketplaceDetail.requiredTools",
                            {
                              count: skillDetail.allowed_tools.length,
                            },
                          )}
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {skillDetail.allowed_tools.map((tool) => (
                            <Badge
                              key={tool}
                              variant="outline"
                              className="rounded border-border/50 px-2 py-0.5 font-mono text-xs font-normal"
                            >
                              {tool}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* Markdown Content */}
                  {skillDetail?.markdown_content && (
                    <div>
                      <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        {t(
                          "skillsMarketplace.marketplaceDetail.documentation",
                        )}
                      </h3>
                      <div className="prose marketplace-skill-markdown max-w-none text-sm">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeRaw, rehypeSanitize]}
                        >
                          {skillDetail.markdown_content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </ScrollArea>

            {/* Sidebar metadata */}
            {skill &&
              (skillDetail?.license ||
                skillDetail?.created_at ||
                skillDetail?.updated_at) && (
                <div className="hidden w-[200px] shrink-0 border-l border-border/40 p-5 lg:block">
                  <div className="space-y-4 text-xs">
                    {skillDetail.license && (
                      <div>
                        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                          {t("skillsMarketplace.marketplaceDetail.license", {
                            license: "",
                          }).replace(":", "").trim() || "License"}
                        </span>
                        <div className="flex items-center gap-1.5 text-foreground">
                          <Shield className="h-3 w-3 text-muted-foreground" />
                          {skillDetail.license}
                        </div>
                      </div>
                    )}
                    {skillDetail.created_at && (
                      <div>
                        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                          Created
                        </span>
                        <div className="flex items-center gap-1.5 text-foreground">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          {new Date(
                            skillDetail.created_at,
                          ).toLocaleDateString()}
                        </div>
                      </div>
                    )}
                    {skillDetail.updated_at && (
                      <div>
                        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                          Updated
                        </span>
                        <div className="flex items-center gap-1.5 text-foreground">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          {new Date(
                            skillDetail.updated_at,
                          ).toLocaleDateString()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
          </div>

          <DialogFooter className="border-t border-border/40 px-8 py-4">
            {skill && (
              <div className="flex w-full items-center gap-3">
                {/* External Link */}
                {skill.marketplace_url && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(skill.marketplace_url!, "_blank")
                    }
                    className="rounded-lg border-border/50 text-sm"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {t(
                      "skillsMarketplace.marketplaceDetail.viewOnSkillsMp",
                    )}
                  </Button>
                )}

                <div className="flex-1" />

                {/* Install Button */}
                {skill.is_installed ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="rounded-lg px-5 text-sm"
                    disabled
                  >
                    <CheckCheck className="mr-2 h-4 w-4" />
                    {t("skillsMarketplace.marketplaceDetail.installed")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleInstall}
                    disabled={
                      installMutation.isPending ||
                      compatStatus === "incompatible"
                    }
                    className="rounded-lg bg-brand-600 px-6 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {installMutation.isPending
                      ? t(
                          "skillsMarketplace.marketplaceDetail.installing",
                        )
                      : t(
                          "skillsMarketplace.marketplaceDetail.installSkill",
                        )}
                  </Button>
                )}
              </div>
            )}
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
