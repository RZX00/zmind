"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Check, Copy, Link2Off, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/workspace-context";

interface CanvasInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  canvasId: string;
}

type ActiveInvite = { inviteId: string; link: string; status: string };
type InviteConfirmAction = "regenerate" | "disable" | null;

export function CanvasInviteModal({ isOpen, onClose, canvasId }: CanvasInviteModalProps) {
  const t = useTranslations();
  const { account } = useWorkspace();
  const canManageInvites = Boolean(
    account?.personal_account || account?.role === "owner" || account?.is_primary_owner
  );
  const [activeInvite, setActiveInvite] = useState<ActiveInvite | null>(null);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCopying, setIsCopying] = useState(false);
  const [confirmAction, setConfirmAction] = useState<InviteConfirmAction>(null);
  const autoCreateRef = useRef(false);

  // Session-only store for owner to see code again (avoid persistent access on shared devices)
  const ownerCodeKey = useCallback(
    (inviteId: string) => `canvas_invite_owner:${canvasId}:${inviteId}`,
    [canvasId]
  );
  const persistOwnerCode = useCallback((inviteId: string, code: string) => {
    try { window.sessionStorage.setItem(ownerCodeKey(inviteId), code); } catch {}
  }, [ownerCodeKey]);
  const restoreOwnerCode = useCallback((inviteId: string): string | undefined => {
    if (typeof window === "undefined") return undefined;
    try {
      const v = window.sessionStorage.getItem(ownerCodeKey(inviteId));
      return v || undefined;
    } catch {
      return undefined;
    }
  }, [ownerCodeKey]);
  const clearOwnerCode = useCallback((inviteId: string) => {
    try { window.sessionStorage.removeItem(ownerCodeKey(inviteId)); } catch {}
  }, [ownerCodeKey]);

  const copyValue = async (value: string, message: string) => {
    try {
      setIsCopying(true);
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch {
      toast.error(t("canvas.share.copyFailed", { default: "复制失败" }));
    } finally {
      setTimeout(() => setIsCopying(false), 400);
    }
  };

  const buildInviteLink = useCallback((inviteId: string, code?: string) => {
    const base = process.env.NEXT_PUBLIC_URL || window.location.origin;
    const params = new URLSearchParams({ invite: inviteId });
    if (code) params.set("code", code);
    return `${base}/canvas/${canvasId}?${params.toString()}`;
  }, [canvasId]);

  const loadActiveInvite = useCallback(async () => {
    if (!canvasId) return;
    setInvitesLoading(true);
    setLoadError(null);
    try {
      const resp = await fetch(`/api/canvases/${canvasId}/invites`);
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      const active = (Array.isArray(data) ? data : []).find((x: any) => x?.status === "active");
      if (active) {
        const savedCode = restoreOwnerCode(active.id || active.inviteId);
        const link = buildInviteLink(active.id, savedCode);
        setActiveInvite({
          inviteId: active.id,
          link,
          status: active.status || "active",
        });
        return { inviteId: active.id, link, status: active.status || "active" } as ActiveInvite;
      } else {
        setActiveInvite(null);
        return null;
      }
    } catch (e) {
      console.error("[CanvasInviteModal] load invites failed", e);
      setActiveInvite(null);
      const msg = t("canvas.share.inviteLoadFailed", { default: "加载协作邀请失败" }) as string;
      setLoadError(msg);
      throw e;
    } finally {
      setInvitesLoading(false);
    }
  }, [canvasId, buildInviteLink, restoreOwnerCode, t]);

  const createInvite = useCallback(async ({ silent }: { silent?: boolean } = {}) => {
    if (!canManageInvites) return null;
    if (!canvasId) return null;
    setCreatingInvite(true);
    setLoadError(null);
    try {
      const resp = await fetch(`/api/canvases/${canvasId}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      if (data?.code) persistOwnerCode(data.id, data.code);
      const link = buildInviteLink(data.id, data?.code);
      const invite = { inviteId: data.id, link, status: "active" } as ActiveInvite;
      setActiveInvite(invite);
      if (!silent) {
        toast.success(t("canvas.share.inviteCreated", { default: "协作链接已生成，分享给伙伴即可。" }));
      }
      return invite;
    } catch (e) {
      if (!silent) {
        toast.error(t("canvas.share.inviteCreateFailed", { default: "创建协作链接失败" }));
      }
      setLoadError(t("canvas.share.inviteCreateFailed", { default: "创建协作链接失败" }) as string);
      return null;
    } finally {
      setCreatingInvite(false);
    }
  }, [canManageInvites, canvasId, t, persistOwnerCode, buildInviteLink]);

  useEffect(() => {
    if (!canvasId || !isOpen) return;
    if (!canManageInvites) return;
    autoCreateRef.current = false;
    (async () => {
      try {
        const existing = await loadActiveInvite();
        if (!existing && !autoCreateRef.current) {
          autoCreateRef.current = true;
          await createInvite({ silent: true });
        }
      } catch {
        // load error handled in state
      }
    })();
  }, [canvasId, isOpen, canManageInvites, loadActiveInvite, createInvite]);

  const revokeInvite = useCallback(async ({ silent }: { silent?: boolean } = {}) => {
    if (!canManageInvites) return;
    if (!activeInvite) return;
    setInvitesLoading(true);
    try {
      const resp = await fetch(`/api/canvases/${canvasId}/invites/${activeInvite.inviteId}/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!resp.ok) throw new Error(await resp.text());
      clearOwnerCode(activeInvite.inviteId);
      setActiveInvite(null);
      if (!silent) {
        toast.success(t("canvas.share.inviteRevoked", { default: "已关闭协作，链接失效" }));
      }
    } catch (e) {
      if (!silent) {
        toast.error(t("canvas.share.inviteRevokeFailed", { default: "关闭协作失败" }));
      }
    } finally {
      setInvitesLoading(false);
    }
  }, [activeInvite, canvasId, canManageInvites, clearOwnerCode, t]);

  const regenerateInvite = useCallback(async () => {
    await revokeInvite({ silent: true });
    const next = await createInvite({ silent: true });
    if (next) {
      toast.success(t("canvas.share.invite.regenerated", { default: "已生成新链接" }));
    } else {
      toast.error(t("canvas.share.inviteCreateFailed", { default: "创建协作链接失败" }));
    }
  }, [createInvite, revokeInvite, t]);

  const disableInvite = useCallback(async () => {
    await revokeInvite();
  }, [revokeInvite]);

  const requestRegenerateInvite = useCallback(() => {
    if (!canManageInvites) return;
    if (creatingInvite || invitesLoading) return;
    setConfirmAction("regenerate");
  }, [canManageInvites, creatingInvite, invitesLoading]);

  const requestDisableInvite = useCallback(() => {
    if (!canManageInvites) return;
    if (invitesLoading) return;
    setConfirmAction("disable");
  }, [canManageInvites, invitesLoading]);

  const handleConfirmAction = useCallback(async () => {
    const currentAction = confirmAction;
    setConfirmAction(null);
    if (currentAction === "regenerate") {
      await regenerateInvite();
      return;
    }
    if (currentAction === "disable") {
      await disableInvite();
    }
  }, [confirmAction, disableInvite, regenerateInvite]);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md rounded-[var(--canvas-panel-radius)] border-border/60 bg-card/95">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {t("canvas.share.invite.title", { default: "协作邀请" })}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("canvas.share.invite.desc", { default: "生成一个链接邀请伙伴，登录后即可一起编辑。" })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!canManageInvites && (
              <Alert>
                <AlertDescription className="text-xs text-muted-foreground">
                  {t("canvas.share.invite.ownerOnly", { default: "Only workspace owners can create or revoke collaboration invites." })}
                </AlertDescription>
              </Alert>
            )}
            {loadError && (
              <Alert>
                <AlertDescription className="flex items-center justify-between gap-3 text-xs text-destructive">
                  <span>{loadError}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (!canManageInvites || creatingInvite || invitesLoading) return;
                      loadActiveInvite().then((existing) => {
                        if (!existing) createInvite({ silent: true });
                      }).catch(() => {});
                    }}
                    disabled={!canManageInvites}
                  >
                    {t("canvas.share.retry", { default: "重试" })}
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {activeInvite ? (
              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Label className="text-xs">{t("canvas.share.invite.link", { default: "协作链接" })}</Label>
                  <Input value={activeInvite.link} readOnly className="font-mono text-xs" />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyValue(activeInvite.link, t("canvas.share.copied", { default: "链接已复制" }))}
                    disabled={isCopying}
                  >
                    {isCopying ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("canvas.share.invite.note", { default: "任何拿到链接的人都可以编辑" })}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("canvas.share.invite.limitNote", { default: "默认有效期 7 天 / 5 次，可随时关闭协作。" })}
                </p>
                <Button
                  className="w-full"
                  onClick={() => copyValue(activeInvite.link, t("canvas.share.copied", { default: "Link copied" }))}
                  disabled={isCopying}
                >
                  {isCopying ? <Check className="h-4 w-4" /> : null}
                  {t("canvas.share.invite.copy", { default: "Copy invite link" })}
                </Button>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={requestRegenerateInvite}
                    disabled={!canManageInvites || creatingInvite || invitesLoading}
                  >
                    {creatingInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    <span className="ml-2">{t("canvas.share.invite.regen", { default: "重新生成链接（旧链接失效）" })}</span>
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={requestDisableInvite}
                    disabled={!canManageInvites || invitesLoading}
                  >
                    {invitesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2Off className="h-4 w-4" />}
                    <span className="ml-2">{t("canvas.share.invite.stop", { default: "关闭协作" })}</span>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-md border p-4 text-xs text-muted-foreground flex items-center gap-2">
                {(creatingInvite || invitesLoading) ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("canvas.share.invite.preparing", { default: "正在准备协作链接..." })}
                  </>
                ) : (
                  <Button onClick={() => createInvite()} className="w-full" disabled={!canManageInvites}>
                    {t("canvas.share.inviteCreate", { default: "开启协作" })}
                  </Button>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "regenerate"
                ? t("canvas.share.invite.regen", { default: "重新生成链接（旧链接失效）" })
                : t("canvas.share.invite.stop", { default: "关闭协作" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "regenerate"
                ? t("canvas.share.invite.regenConfirm", { default: "重新生成会使旧链接失效，是否继续？" })
                : t("canvas.share.invite.stopConfirm", { default: "关闭协作后链接将失效，是否继续？" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", { default: "取消" })}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void handleConfirmAction(); }}>
              {confirmAction === "regenerate"
                ? t("canvas.share.invite.regen", { default: "重新生成链接（旧链接失效）" })
                : t("canvas.share.invite.stop", { default: "关闭协作" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default CanvasInviteModal;
