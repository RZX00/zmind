"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Link2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { useInviteCodes } from "@/hooks/react-query/use-billing-v2";
import { useRouter } from "@/i18n/routing";

const buildInviteLink = (code: string) => {
  const base =
    (typeof window !== "undefined" && window.location.origin) ||
    process.env.NEXT_PUBLIC_URL ||
    "";
  return `${base}/invite?code=${encodeURIComponent(code)}`;
};

export function InviteCodesCard() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, refetch } = useInviteCodes();

  const eligible = data?.eligible ?? false;
  const codes = data?.codes ?? [];
  const remaining = data?.remaining ?? 0;
  const total = data?.total ?? 3;

  const handleCopyLink = async (code: string) => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        toast.error(t("sidebar.inviteCard.copyFailed", { default: "复制失败" }));
        return;
      }
      await navigator.clipboard.writeText(buildInviteLink(code));
      toast.success(
        t("sidebar.inviteCard.copySuccess", { default: "邀请链接已复制" })
      );
    } catch {
      toast.error(t("sidebar.inviteCard.copyFailed", { default: "复制失败" }));
    }
  };

  return (
    <>
      <div className="rounded-xl bg-card shadow-sm border border-border/60 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground">
            {t("sidebar.inviteCard.title", { default: "邀请码" })}
          </span>
          <Badge variant="secondary" className="text-[11px]">
            {eligible
              ? t("sidebar.inviteCard.remaining", {
                  default: "可用 {count}/3",
                  count: remaining,
                })
              : t("sidebar.inviteCard.inactive", { default: "未兑换" })}
          </Badge>
        </div>
        <Button
          className="w-full bg-transparent hover:bg-muted/40"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
        >
          {eligible
            ? t("sidebar.inviteCard.openCta", { default: "查看邀请码" })
            : t("sidebar.inviteCard.redeemCta", { default: "兑换邀请码" })}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {eligible
                ? t("sidebar.inviteCard.modalTitle", { default: "你的邀请码" })
                : t("sidebar.inviteCard.modalTitlePending", { default: "兑换邀请码" })}
            </DialogTitle>
            <DialogDescription>
              {eligible
                ? t("sidebar.inviteCard.modalDesc", {
                    default: "每个邀请码仅限一次，好友兑换后可用 30 天。",
                  })
                : t("sidebar.inviteCard.desc", {
                    default: "每个邀请码仅限一次，兑换后享 30 天使用权限。",
                  })}
            </DialogDescription>
          </DialogHeader>

          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("sidebar.inviteCard.loading", { default: "加载邀请码…" })}
            </div>
          )}

          {isError && !isLoading && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("sidebar.inviteCard.loadFailed", { default: "邀请码加载失败" })}</span>
              <Button variant="ghost" size="sm" onClick={() => refetch()}>
                <RefreshCcw className="h-3.5 w-3.5" />
                <span className="ml-1">{t("sidebar.inviteCard.retry", { default: "重试" })}</span>
              </Button>
            </div>
          )}

          {!isLoading && !isError && eligible && (
            <div className="space-y-2">
              {codes.map((code) => (
                <div
                  key={code.id}
                  className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1"
                >
                  <code className="text-xs font-mono tracking-wider">
                    {code.code}
                  </code>
                  {code.status === "available" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopyLink(code.code)}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      <span className="ml-1 text-[11px]">
                        {t("sidebar.inviteCard.copyLink", { default: "复制邀请链接" })}
                      </span>
                    </Button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      {t("sidebar.inviteCard.used", { default: "已使用" })}
                    </span>
                  )}
                </div>
              ))}
              {codes.length < total && (
                <div className="text-[11px] text-muted-foreground">
                  {t("sidebar.inviteCard.pending", {
                    default: "邀请码正在准备，稍后刷新即可。",
                  })}
                </div>
              )}
            </div>
          )}

          {!isLoading && !isError && !eligible && (
            <div className="flex flex-col gap-3">
              <span className="text-xs text-muted-foreground">
                {t("sidebar.inviteCard.redeemHint", {
                  default: "兑换邀请码后即可获得 3 个分享码。",
                })}
              </span>
              <Button size="sm" onClick={() => router.push("/invite")}>
                {t("sidebar.inviteCard.redeemGo", { default: "去兑换" })}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default InviteCodesCard;
