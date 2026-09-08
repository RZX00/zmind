"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Check, ChevronDown, ChevronUp, Copy, Link2Off, Loader2 } from "lucide-react";
import NextLink from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/contexts/workspace-context";
import { trackEvent } from "@/lib/telemetry";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface CanvasShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  canvasId: string;
}

type ShareHealth = {
  share_supported: boolean;
  listing_supported: boolean;
  timeline_supported: boolean;
  columns?: Record<string, boolean>;
  missing?: string[];
};

type ProxyResponse<T> = {
  ok: boolean;
  status: number;
  data: T | null;
};

const requestShareProxy = async <T,>(
  path: string,
  init?: RequestInit,
): Promise<ProxyResponse<T>> => {
  const response = await fetch(path, init);
  const text = await response.text();
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }
  return { ok: response.ok, status: response.status, data };
};

export function CanvasShareModal({ isOpen, onClose, canvasId }: CanvasShareModalProps) {
  const t = useTranslations();
  const { account } = useWorkspace();
  const workspaceHeaders = useMemo<Record<string, string>>(
    () => (account?.account_id ? { "X-Workspace-Id": account.account_id } : {}),
    [account?.account_id],
  );
  const canManageShare = Boolean(
    account?.personal_account || account?.role === "owner" || account?.is_primary_owner
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [isPublic, setIsPublic] = useState<boolean>(false);
  const [isListed, setIsListed] = useState<boolean>(false);
  const [shareLink, setShareLink] = useState<string>("");
  const [backendUnsupported, setBackendUnsupported] = useState<string | null>(null);
  const [shareHealth, setShareHealth] = useState<ShareHealth | null>(null);
  const [timelineEnabled, setTimelineEnabled] = useState<boolean>(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const shareSupported = shareHealth?.share_supported ?? true;
  const listingSupported = shareHealth?.listing_supported ?? true;
  const timelineSupported = shareHealth?.timeline_supported ?? true;

  const loadShareStatus = useCallback(async () => {
    if (!canvasId) return;
    setIsLoading(true);
    setLoadError(null);
    setBackendUnsupported(null);
    setShareLink(`${process.env.NEXT_PUBLIC_URL || window.location.origin}/share/canvas/${canvasId}`);
    try {
      const healthResp = await requestShareProxy<ShareHealth>("/api/canvases/share/health", {
        method: "GET",
        headers: workspaceHeaders,
      });
      if (!healthResp.ok || !healthResp.data) {
        throw new Error("share health failed");
      }
      setShareHealth(healthResp.data);
      if (!healthResp.data.share_supported) {
        setBackendUnsupported(
          t("canvas.share.missingSchema", { default: "Sharing is not available in this workspace yet. Please contact an admin." }) as string
        );
        if (healthResp.data.missing?.length) {
          console.info("[CanvasShareModal] Missing share columns:", healthResp.data.missing);
        }
        return;
      }

      const statusResp = await requestShareProxy<any>(`/api/canvases/${canvasId}/share`, {
        method: "GET",
        headers: workspaceHeaders,
      });
      if (!statusResp.ok || !statusResp.data) {
        throw new Error("share status failed");
      }
      const row = statusResp.data as any;
      const pub = Boolean(row?.is_public);
      setIsPublic(pub);
      setIsListed(Boolean(row?.is_listed));
      const timelineOn = typeof row?.timeline_enabled === "boolean"
        ? Boolean(row?.timeline_enabled)
        : Boolean(row?.public_shows_timeline);
      setTimelineEnabled(timelineOn);
    } catch (e) {
      const msg = t("canvas.share.unavailable", { default: "Sharing is temporarily unavailable. Please try again." }) as string;
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [canvasId, t, workspaceHeaders]);

  useEffect(() => {
    if (!canvasId || !isOpen) return;
    loadShareStatus();
  }, [canvasId, isOpen, loadShareStatus]);

  const getAuthorInfo = async () => {
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const meta: any = user.user_metadata || {};
        const nameCandidates = [meta.name, meta.full_name, meta.user_name, user.email?.split("@")[0]];
        const author_display_name = nameCandidates.find((v: any) => typeof v === "string" && v.trim().length > 0) || "User";
        let author_avatar_url = (meta.avatar_url as string) || "";
        if (!author_avatar_url) {
          const bg = "e5e7eb";
          author_avatar_url = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(author_display_name)}&backgroundType=solid&backgroundColor=${bg}`;
        }
        return { author_user_id: user.id, author_display_name, author_avatar_url };
      }
    } catch {}
    return {} as any;
  };

  const setPrivateEnabled = async (next: boolean) => {
    const payload: any = { is_public: next };
    if (!canvasId || !shareSupported) return;

    if (timelineSupported) {
      payload.timeline_enabled = !!timelineEnabled;
      payload.public_shows_timeline = next ? !!timelineEnabled : false;
    }
    if (!next && isListed && listingSupported) {
      payload.is_listed = false;
    }
    if (next) {
      const author = await getAuthorInfo();
      if (author?.author_display_name) payload.author_display_name = author.author_display_name;
      if (author?.author_avatar_url) payload.author_avatar_url = author.author_avatar_url;
    }

    const resp = await requestShareProxy<any>(`/api/canvases/${canvasId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...workspaceHeaders },
      body: JSON.stringify(payload),
    });
    if (!resp.ok || !resp.data) {
      if (resp.status === 409) {
        setBackendUnsupported(
          t("canvas.share.missingSchema", { default: "Sharing is not available in this workspace yet. Please contact an admin." }) as string
        );
      }
      trackEvent("canvas.share.failed", { canvasId, action: next ? "enable" : "disable" });
      throw new Error("Share update failed");
    }

    const row = resp.data as any;
    setIsPublic(Boolean(row?.is_public));
    setIsListed(Boolean(row?.is_listed));
    const timelineOn = typeof row?.timeline_enabled === "boolean"
      ? Boolean(row?.timeline_enabled)
      : Boolean(row?.public_shows_timeline);
    setTimelineEnabled(timelineOn);
    trackEvent("canvas.share.success", { canvasId, action: next ? "enable" : "disable" });
  };

  const setPublishEnabled = async (next: boolean) => {
    if (!canvasId || !listingSupported) return;
    const payload: any = {};
    if (next) {
      const author = await getAuthorInfo();
      if (author?.author_display_name) payload.author_display_name = author.author_display_name;
      if (author?.author_avatar_url) payload.author_avatar_url = author.author_avatar_url;
      payload.is_public = true;
      payload.is_listed = true;
      if (timelineSupported) {
        payload.timeline_enabled = true;
        payload.public_shows_timeline = true;
      }
    } else {
      payload.is_listed = false;
    }

    const resp = await requestShareProxy<any>(`/api/canvases/${canvasId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...workspaceHeaders },
      body: JSON.stringify(payload),
    });
    if (!resp.ok || !resp.data) {
      if (resp.status === 409) {
        setBackendUnsupported(
          t("canvas.share.missingSchema", { default: "Sharing is not available in this workspace yet. Please contact an admin." }) as string
        );
      }
      trackEvent("canvas.share.failed", { canvasId, action: next ? "list" : "unlist" });
      throw new Error("Share update failed");
    }

    const row = resp.data as any;
    setIsPublic(Boolean(row?.is_public));
    setIsListed(Boolean(row?.is_listed));
    const timelineOn = typeof row?.timeline_enabled === "boolean"
      ? Boolean(row?.timeline_enabled)
      : Boolean(row?.public_shows_timeline);
    setTimelineEnabled(timelineOn);
    trackEvent("canvas.share.success", { canvasId, action: next ? "list" : "unlist" });
  };

  const setTimeline = async (next: boolean) => {
    if (!canvasId || !timelineSupported) return;
    const payload: any = {
      timeline_enabled: next,
      public_shows_timeline: isPublic ? next : false,
    };
    const resp = await requestShareProxy<any>(`/api/canvases/${canvasId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...workspaceHeaders },
      body: JSON.stringify(payload),
    });
    if (!resp.ok || !resp.data) {
      if (resp.status === 409) {
        setBackendUnsupported(
          t("canvas.share.missingSchema", { default: "Sharing is not available in this workspace yet. Please contact an admin." }) as string
        );
      }
      trackEvent("canvas.share.failed", { canvasId, action: "timeline" });
      throw new Error("Share update failed");
    }
    const row = resp.data as any;
    setIsPublic(Boolean(row?.is_public));
    setIsListed(Boolean(row?.is_listed));
    const timelineOn = typeof row?.timeline_enabled === "boolean"
      ? Boolean(row?.timeline_enabled)
      : Boolean(row?.public_shows_timeline);
    setTimelineEnabled(timelineOn);
    trackEvent("canvas.share.success", { canvasId, action: "timeline" });
  };

  const createShareLink = async () => {
    if (!canManageShare || !shareSupported) return;
    setIsLoading(true);
    try {
      await setPrivateEnabled(true);
      toast.success(t("canvas.share.created", { default: "Shareable link created successfully" }));
    } catch (e) {
      toast.error(t("canvas.share.createFailed", { default: "Failed to create shareable link" }));
    } finally {
      setIsLoading(false);
    }
  };

  const removeShareLink = async () => {
    if (!canManageShare || !shareSupported) return;
    setIsLoading(true);
    try {
      await setPrivateEnabled(false);
      toast.success(t("canvas.share.removed", { default: "Shareable link removed" }));
    } catch (e) {
      toast.error(t("canvas.share.removeFailed", { default: "Failed to remove shareable link" }));
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (!shareLink) return;
    setIsCopying(true);
    navigator.clipboard
      .writeText(shareLink)
      .then(() => toast.success(t("canvas.share.copied", { default: "Link copied to clipboard" })))
      .finally(() => setTimeout(() => setIsCopying(false), 500));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md rounded-[var(--canvas-panel-radius)] border-border/60 bg-card/95">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{t("canvas.share.title", { default: "Share Canvas" })}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("canvas.share.subtitle", { default: "Share a public read-only link to this canvas" })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {!canManageShare && (
            <Alert>
              <AlertDescription className="text-xs text-muted-foreground">
                {t("canvas.share.ownerOnly", { default: "Only workspace owners can manage sharing settings." })}
              </AlertDescription>
            </Alert>
          )}
          {(loadError || backendUnsupported) && (
            <Alert>
              <AlertDescription className="flex items-center justify-between gap-3">
                <span className="text-xs text-destructive">
                  {loadError || t("canvas.share.unavailable", { default: "Sharing is temporarily unavailable. Please try again." })}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setLoadError(null);
                    setBackendUnsupported(null);
                    if (!isLoading) loadShareStatus();
                  }}
                >
                  {t("canvas.share.retry", { default: "Retry" })}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="border rounded-md p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{t("canvas.share.linkLabel", { default: "Share link" })}</div>
              {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            {isPublic ? (
              <>
                <div className="flex space-x-2">
                  <Input id="share-link" value={shareLink} readOnly className="font-mono text-sm" />
                  <Button variant="outline" size="icon" onClick={copyToClipboard} disabled={isCopying}>
                    {isCopying ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("canvas.share.note", { default: "Anyone with the link can view (read-only)." })}
                </p>
                <Button className="w-full" onClick={copyToClipboard} disabled={isCopying}>
                  {isCopying ? <Check className="h-4 w-4" /> : null}
                  {t("canvas.share.copy", { default: "Copy link" })}
                </Button>
                <Button
                  variant="outline"
                  className="w-full text-destructive hover:bg-destructive hover:text-muted"
                  onClick={removeShareLink}
                  disabled={!canManageShare || isLoading || !shareSupported}
                >
                  <Link2Off className="h-4 w-4" />
                  {isLoading
                    ? t("canvas.share.removing", { default: "Removing..." })
                    : t("canvas.share.disable", { default: "Turn off sharing" })}
                </Button>
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {t("canvas.share.disabledNote", { default: "Sharing is off. Turn it on to create a new link." })}
                </p>
                <Button onClick={createShareLink} disabled={!canManageShare || isLoading || !shareSupported} className="w-full">
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("canvas.share.creating", { default: "Creating..." })}
                    </>
                  ) : (
                    t("canvas.share.enable", { default: "Turn on sharing" })
                  )}
                </Button>
              </div>
            )}
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between">
                <span>{t("canvas.share.advanced", { default: "Advanced settings" })}</span>
                {advancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              <div className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{t("canvas.share.timeline", { default: "Show AI timeline on share page" })}</div>
                  <Switch
                    checked={timelineEnabled}
                    onCheckedChange={async (v) => {
                      setIsLoading(true);
                      try {
                        await setTimeline(!!v);
                      } finally {
                        setIsLoading(false);
                      }
                    }}
                    disabled={!canManageShare || !isPublic || isLoading || !timelineSupported}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("canvas.share.includeTimelineHelp", { default: "When enabled, visitors can view the AI conversation timeline on the shared page." })}
                </p>
                {!timelineSupported && (
                  <p className="text-xs text-muted-foreground">
                    {t("canvas.share.timelineUnavailable", { default: "Timeline sharing is unavailable in this workspace." })}
                  </p>
                )}
              </div>

              <div className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{t("canvas.share.publish.enable", { default: "Publish to Template" })}</div>
                  <Switch
                    checked={isListed}
                    onCheckedChange={async (v) => {
                      setIsLoading(true);
                      try {
                        await setPublishEnabled(!!v);
                      } finally {
                        setIsLoading(false);
                      }
                    }}
                    disabled={!canManageShare || isLoading || !listingSupported}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{t("canvas.share.publish.help", { default: "People can discover this canvas in the Template page." })}</p>
                  {isListed && (
                    <Button asChild variant="outline" size="sm">
                      <NextLink href="/explore">{t("canvas.share.goToPlaza", { default: "Go to Template" })}</NextLink>
                    </Button>
                  )}
                </div>
                {!listingSupported && (
                  <p className="text-xs text-muted-foreground">
                    {t("canvas.share.listingUnavailable", { default: "Template publishing is unavailable in this workspace." })}
                  </p>
                )}
                {isListed && (
                  <Button
                    variant="outline"
                    className="w-full text-destructive hover:bg-destructive hover:text-muted"
                    onClick={async () => {
                      setIsLoading(true);
                      try {
                        await setPublishEnabled(false);
                      } finally {
                        setIsLoading(false);
                      }
                    }}
                    disabled={!canManageShare || isLoading || !listingSupported}
                  >
                    <Link2Off className="h-4 w-4" />
                    {t("canvas.share.publish.unlist", { default: "Unlist from Template" })}
                  </Button>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CanvasShareModal;
