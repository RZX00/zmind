/**
 * MarketplaceSkillCard Component
 *
 * Displays a skill from SkillsMP marketplace with compatibility status,
 * install button, and view details action.
 */

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
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useInstallFromMarketplace } from "@/hooks/react-query/skills-marketplace/use-skills-marketplace";
import type { MarketplaceSkill } from "@/lib/api/skills-marketplace";
import { cn } from "@/lib/utils";

interface MarketplaceSkillCardProps {
  skill: MarketplaceSkill;
  onViewDetails?: (skill: MarketplaceSkill) => void;
}

export function MarketplaceSkillCard({ skill, onViewDetails }: MarketplaceSkillCardProps) {
  const t = useTranslations();
  const installMutation = useInstallFromMarketplace();

  // Refined compatibility styling
  const compatibilityConfig = {
    compatible: {
      label: t("skillsMarketplace.compatibility.compatible"),
      className: "bg-emerald-50 text-emerald-700 border-emerald-200/50 hover:bg-emerald-100",
      icon: CheckCircle2,
    },
    partial: {
      label: t("skillsMarketplace.compatibility.partial"),
      className: "bg-amber-50 text-amber-700 border-amber-200/50 hover:bg-amber-100",
      icon: AlertTriangle,
    },
    incompatible: {
      label: t("skillsMarketplace.compatibility.incompatible"),
      className: "bg-rose-50 text-rose-700 border-rose-200/50 hover:bg-rose-100",
      icon: AlertCircle,
    },
    unknown: {
      label: t("skillsMarketplace.compatibility.unknown"),
      className: "bg-slate-50 text-slate-700 border-slate-200/50 hover:bg-slate-100",
      icon: AlertCircle,
    },
  };

  const compatStatus = skill.compatibility_status || "unknown";
  const config = compatibilityConfig[compatStatus];
  const CompatIcon = config.icon;

  const handleInstall = (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleViewDetails = () => {
    if (onViewDetails) {
      onViewDetails(skill);
    }
  };

  return (
    <div
      onClick={handleViewDetails}
      className="group relative flex flex-col h-full bg-background border border-border/60 rounded-lg p-5 hover:border-primary/20 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 cursor-pointer"
    >
      {/* Top Row: Meta & Badge */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground/80">
          <div className="flex items-center gap-1.5 bg-muted/50 px-2 py-1 rounded-md">
            <User className="w-3 h-3" />
            <span className="truncate max-w-[120px]">{skill.author || t("skillsMarketplace.marketplaceCard.unknownAuthor")}</span>
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn("text-[10px] px-2 py-0.5 h-6 font-medium border", config.className)}
        >
          <CompatIcon className="w-3 h-3 mr-1" />
          {config.label}
        </Badge>
      </div>

      {/* Main Content */}
      <div className="flex-grow space-y-2 mb-4">
        <h3 className="font-semibold text-lg leading-tight group-hover:text-primary transition-colors">
          {skill.name}
        </h3>
        <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed h-[40px]">
          {skill.description}
        </p>
        
        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {skill.tags?.slice(0, 3).map((tag) => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/50 text-secondary-foreground/70">
              #{tag}
            </span>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="pt-4 border-t border-border/40 flex items-center justify-between mt-auto">
        {/* Stats */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground font-medium">
          {skill.rating && (
            <div className="flex items-center gap-1 text-amber-500/90">
              <Star className="w-3.5 h-3.5 fill-current" />
              <span>{skill.rating.toFixed(1)}</span>
            </div>
          )}
          {skill.install_count !== undefined && skill.install_count !== null && (
            <div className="flex items-center gap-1">
              <Download className="w-3.5 h-3.5" />
              <span>{skill.install_count > 1000 ? `${(skill.install_count / 1000).toFixed(1)}k` : skill.install_count}</span>
            </div>
          )}
        </div>

        {/* Action Button */}
        <div className="flex items-center gap-2">
          {skill.is_installed ? (
             <span className="flex items-center text-xs font-semibold text-[#2c3e2d] bg-[#f1f3f1] border border-[#e2e8e2] px-3 py-1.5 rounded-md">
                <CheckCheck className="w-3.5 h-3.5 mr-1" />
                {t("skillsMarketplace.marketplaceCard.added")}
             </span>
          ) : (
            <Button
              size="sm"
              variant="default"
              className="h-8 px-4 opacity-0 group-hover:opacity-100 transition-opacity duration-200 shadow-sm bg-[#2c3e2d] hover:bg-[#3d563e] text-white border-none"
              onClick={handleInstall}
              disabled={installMutation.isPending}
            >
              {installMutation.isPending ? (
                 t("skillsMarketplace.marketplaceCard.installing")
              ) : (
                <>
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  {t("skillsMarketplace.marketplaceCard.install")}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
