"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Github, FileText, Loader2, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { useImportSkill } from "@/hooks/react-query/skills-marketplace/use-skills-marketplace";
import type { SkillImportRequest } from "@/lib/api/skills-marketplace";

interface ImportSkillDialogProps {
  children?: React.ReactNode;
  onSuccess?: () => void;
}

export function ImportSkillDialog({
  children,
  onSuccess,
}: ImportSkillDialogProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [sourceType, setSourceType] = useState<"github" | "manual">("github");
  const [githubUrl, setGithubUrl] = useState("");
  const [markdownContent, setMarkdownContent] = useState("");
  const [forceOverwrite, setForceOverwrite] = useState(false);

  const importMutation = useImportSkill();

  const handleImport = async () => {
    const request: SkillImportRequest = {
      source_type: sourceType,
      force: forceOverwrite,
    };

    if (sourceType === "github") {
      if (!githubUrl.trim()) {
        return;
      }
      request.github_url = githubUrl.trim();
    } else {
      if (!markdownContent.trim()) {
        return;
      }
      request.markdown_content = markdownContent.trim();
    }

    importMutation.mutate(request, {
      onSuccess: () => {
        setGithubUrl("");
        setMarkdownContent("");
        setForceOverwrite(false);

        setTimeout(() => {
          setOpen(false);
          onSuccess?.();
        }, 1500);
      },
    });
  };

  const isGitHubUrlValid = (url: string): boolean => {
    return (
      url.includes("github.com") &&
      url.includes("/blob/") &&
      url.endsWith(".md")
    );
  };

  const canSubmit =
    sourceType === "github"
      ? githubUrl.trim() && isGitHubUrlValid(githubUrl)
      : markdownContent.trim();

  const compatibilityLabels: Record<string, string> = {
    compatible: t("skillsMarketplace.compatibility.compatible"),
    partial: t("skillsMarketplace.compatibility.partial"),
    incompatible: t("skillsMarketplace.compatibility.incompatible"),
    unknown: t("skillsMarketplace.compatibility.unknown"),
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button>
            <Github className="mr-2 h-4 w-4" />
            {t("skillsMarketplace.importDialog.trigger")}
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-2xl border-border/50 p-0 shadow-[var(--shadow-elev-7)]">
        <DialogHeader className="border-b border-border/40 px-6 pb-4 pt-6">
          <DialogTitle className="text-lg font-semibold tracking-tight">
            {t("skillsMarketplace.importDialog.title")}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t("skillsMarketplace.importDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          <Tabs
            value={sourceType}
            onValueChange={(v) => setSourceType(v as "github" | "manual")}
          >
            <TabsList className="grid w-full grid-cols-2 rounded-xl bg-muted/50 p-1">
              <TabsTrigger
                value="github"
                className="flex items-center gap-2 rounded-lg text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Github className="h-3.5 w-3.5" />
                {t("skillsMarketplace.importDialog.tabs.github")}
              </TabsTrigger>
              <TabsTrigger
                value="manual"
                className="flex items-center gap-2 rounded-lg text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <FileText className="h-3.5 w-3.5" />
                {t("skillsMarketplace.importDialog.tabs.manual")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="github" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label
                  htmlFor="github-url"
                  className="text-sm font-medium"
                >
                  {t("skillsMarketplace.importDialog.github.label")}
                </Label>
                <Input
                  id="github-url"
                  placeholder={t(
                    "skillsMarketplace.importDialog.github.placeholder",
                  )}
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  className={`h-10 rounded-lg border-border/60 bg-muted/30 text-sm transition-all duration-200 focus-visible:border-border focus-visible:bg-background focus-visible:ring-0 ${
                    githubUrl && !isGitHubUrlValid(githubUrl)
                      ? "border-destructive"
                      : ""
                  }`}
                />
                <p className="text-xs text-muted-foreground/70">
                  {t("skillsMarketplace.importDialog.github.hint")}
                </p>

                {githubUrl && !isGitHubUrlValid(githubUrl) && (
                  <p className="text-xs text-destructive">
                    {t("skillsMarketplace.importDialog.github.invalid")}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-border/40 bg-muted/20 p-3.5">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {t(
                      "skillsMarketplace.importDialog.github.exampleLabel",
                    )}
                  </span>
                  <br />
                  <code className="mt-1 inline-block font-mono text-[11px] text-muted-foreground/80">
                    https://github.com/anthropics/skills/blob/main/example-skill/SKILL.md
                  </code>
                </p>
              </div>
            </TabsContent>

            <TabsContent value="manual" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label
                  htmlFor="markdown-content"
                  className="text-sm font-medium"
                >
                  {t("skillsMarketplace.importDialog.manual.label")}
                </Label>
                <Textarea
                  id="markdown-content"
                  placeholder={t(
                    "skillsMarketplace.importDialog.manual.placeholder",
                  )}
                  value={markdownContent}
                  onChange={(e) => setMarkdownContent(e.target.value)}
                  rows={10}
                  className="rounded-lg border-border/60 bg-muted/30 font-mono text-sm transition-all duration-200 focus-visible:border-border focus-visible:bg-background focus-visible:ring-0"
                />
                <p className="text-xs text-muted-foreground/70">
                  {t("skillsMarketplace.importDialog.manual.hint")}
                </p>
              </div>

              <div className="rounded-xl border border-border/40 bg-muted/20 p-3.5">
                <p className="text-xs text-muted-foreground">
                  {t("skillsMarketplace.importDialog.manual.alert")}
                </p>
              </div>
            </TabsContent>
          </Tabs>

          {/* Force overwrite option */}
          <div className="flex items-center justify-between rounded-xl border border-border/40 bg-muted/20 p-4">
            <div className="space-y-0.5">
              <Label
                htmlFor="force-overwrite"
                className="text-sm font-medium"
              >
                {t("skillsMarketplace.importDialog.overwrite.label")}
              </Label>
              <p className="text-xs text-muted-foreground/70">
                {t("skillsMarketplace.importDialog.overwrite.hint")}
              </p>
            </div>
            <Switch
              id="force-overwrite"
              checked={forceOverwrite}
              onCheckedChange={setForceOverwrite}
              className="data-[state=checked]:bg-brand-600"
            />
          </div>

          {/* Import result */}
          {importMutation.isSuccess && importMutation.data && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 dark:border-brand-800/50 dark:bg-brand-950/30">
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-brand-600" />
                  <p className="text-sm font-medium text-brand-900 dark:text-brand-200">
                    {t(
                      "skillsMarketplace.importDialog.result.success",
                      { message: importMutation.data.message },
                    )}
                  </p>
                </div>

                {importMutation.data.compatibility && (
                  <div className="space-y-1.5 pl-6">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          importMutation.data.compatibility.status ===
                          "compatible"
                            ? "default"
                            : importMutation.data.compatibility.status ===
                                "partial"
                              ? "secondary"
                              : "destructive"
                        }
                        className="rounded text-xs"
                      >
                        {compatibilityLabels[
                          importMutation.data.compatibility.status
                        ] ?? importMutation.data.compatibility.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {importMutation.data.compatibility.reason}
                      </span>
                    </div>

                    {importMutation.data.compatibility.suggestions.length >
                      0 && (
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {importMutation.data.compatibility.suggestions.map(
                          (suggestion, idx) => (
                            <p key={idx}>{suggestion}</p>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2.5 border-t border-border/40 px-6 py-4">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={importMutation.isPending}
            className="rounded-lg border-border/50 text-sm"
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleImport}
            disabled={!canSubmit || importMutation.isPending}
            className="rounded-lg bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700"
          >
            {importMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("skillsMarketplace.importDialog.actions.importing")}
              </>
            ) : (
              t("skillsMarketplace.importDialog.actions.import")
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
