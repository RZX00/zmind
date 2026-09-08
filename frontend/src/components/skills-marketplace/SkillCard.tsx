"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Trash2,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import {
  useToggleSkill,
  useDeleteSkill,
} from "@/hooks/react-query/skills-marketplace/use-skills-marketplace";
import type { RegistrySkill } from "@/lib/api/skills-marketplace";
import { cn } from "@/lib/utils";

interface SkillCardProps {
  skill: RegistrySkill;
}

export function SkillCard({ skill }: SkillCardProps) {
  const t = useTranslations();
  const [showDetails, setShowDetails] = useState(false);

  const toggleSkillMutation = useToggleSkill();
  const deleteSkillMutation = useDeleteSkill();

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

  const compatStatus = skill.compatibility_status || "unknown";
  const config = compatibilityConfig[compatStatus];

  const sourceTypeLabels = {
    github: t("skillsMarketplace.source.github"),
    manual: t("skillsMarketplace.source.manual"),
    marketplace: t("skillsMarketplace.source.marketplace"),
    builtin: t("skillsMarketplace.source.builtin"),
    user: t("skillsMarketplace.source.user"),
    file: t("skillsMarketplace.source.file"),
  };

  const isEditable =
    skill.editable ??
    ["user", "github", "manual", "marketplace"].includes(
      skill.source_type || "user",
    );

  const handleToggle = (checked: boolean) => {
    if (!isEditable) return;
    toggleSkillMutation.mutate({
      skillName: skill.skill_id,
      enabled: checked,
    });
  };

  const handleDelete = () => {
    if (!isEditable) return;
    deleteSkillMutation.mutate(skill.skill_id);
  };

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-2xl border border-border/50 bg-card p-5 transition-all duration-200",
        "hover:border-border hover:shadow-[var(--shadow-elev-5)]",
        !skill.enabled && "opacity-60",
      )}
    >
      {/* Top Row: Name + Source Badge + Toggle */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold tracking-tight text-foreground">
              {skill.name}
            </h3>
            <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70">
              {sourceTypeLabels[skill.source_type || "user"]}
            </span>
          </div>
        </div>

        <Switch
          checked={skill.enabled}
          onCheckedChange={handleToggle}
          disabled={!isEditable || toggleSkillMutation.isPending}
          className="shrink-0 data-[state=checked]:bg-brand-600"
        />
      </div>

      {/* Description */}
      <p className="mb-3 line-clamp-2 min-h-[40px] text-sm leading-relaxed text-muted-foreground">
        {skill.description || t("skillsMarketplace.skillCard.noDescription")}
      </p>

      {/* Compatibility indicator — dot + text style */}
      <div className="mb-4 flex items-center gap-2">
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", config.dotColor)}
        />
        <span className={cn("text-xs font-medium", config.textColor)}>
          {config.label}
        </span>
        {skill.compatibility_reason && (
          <span className="truncate text-xs text-muted-foreground/60">
            — {skill.compatibility_reason}
          </span>
        )}
      </div>

      {/* Footer: Source link + Details + Delete */}
      <div className="flex items-center justify-between border-t border-border/30 pt-3">
        <div className="flex items-center gap-1">
          {skill.source_url && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              asChild
            >
              <a
                href={skill.source_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="mr-1 h-3 w-3" />
                {t("skillsMarketplace.skillCard.sourceLink")}
              </a>
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails
              ? t("skillsMarketplace.skillCard.hide")
              : t("skillsMarketplace.skillCard.details")}
            <ChevronDown
              className={cn(
                "ml-1 h-3 w-3 transition-transform duration-200",
                showDetails && "rotate-180",
              )}
            />
          </Button>

          {isEditable && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                  disabled={deleteSkillMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-2xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("skillsMarketplace.skillCard.deleteTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("skillsMarketplace.skillCard.deleteDescription", {
                      name: skill.name,
                    })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-lg">
                    {t("common.cancel")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="rounded-lg bg-destructive hover:bg-destructive/90"
                  >
                    {t("common.delete")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Details Expansion */}
      <AnimatePresence>
        {showDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            <div className="mt-4 border-t border-border/30 pt-4">
              <div className="space-y-4 text-sm">
                {/* Tools */}
                {skill.allowed_tools && skill.allowed_tools.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                      {t("skillsMarketplace.skillCard.allowedTools")}
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {skill.allowed_tools.map((tool) => (
                        <Badge
                          key={tool}
                          variant="secondary"
                          className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] font-normal"
                        >
                          {tool}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Metadata Grid */}
                <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/30 p-3.5 text-xs">
                  {skill.model && (
                    <div>
                      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                        {t("skillsMarketplace.skillCard.model")}
                      </span>
                      <span className="text-foreground">{skill.model}</span>
                    </div>
                  )}
                  {skill.license && (
                    <div>
                      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                        {t("skillsMarketplace.skillCard.license")}
                      </span>
                      <span className="text-foreground">{skill.license}</span>
                    </div>
                  )}
                  {skill.installed_at && (
                    <div>
                      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                        {t("skillsMarketplace.skillCard.installed")}
                      </span>
                      <span className="text-foreground">
                        {new Date(skill.installed_at).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  {skill.updated_at && (
                    <div>
                      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                        {t("skillsMarketplace.skillCard.updated")}
                      </span>
                      <span className="text-foreground">
                        {new Date(skill.updated_at).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
