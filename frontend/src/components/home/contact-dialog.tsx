'use client';

import { useTranslations } from 'next-intl';
import Image from 'next/image';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useEffect, useMemo, useState } from 'react';
import { getWechatQrPublic } from '@/lib/api/assets';

interface ContactDialogProps {
  trigger: React.ReactNode;
}

/**
 * Shared contact dialog used across CTA and footer to keep the experience consistent.
 */
export function ContactDialog({ trigger }: ContactDialogProps) {
  const t = useTranslations();
  const fallbackWechatQr = process.env.NEXT_PUBLIC_WECHAT_QR_URL || null;
  const [qrUrl, setQrUrl] = useState<string | null>(fallbackWechatQr);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState(false);

  const loadQr = async () => {
    if (qrLoading) return;
    setQrLoading(true);
    setQrError(false);
    try {
      const res = await getWechatQrPublic();
      if (res?.public_url) {
        setQrUrl(res.public_url);
        if (typeof window !== 'undefined') {
          try {
            window.sessionStorage.setItem('wechat-qr-url', res.public_url);
          } catch {}
        }
      } else if (fallbackWechatQr) {
        setQrUrl(fallbackWechatQr);
      } else {
        setQrError(true);
      }
    } catch (error) {
      if (fallbackWechatQr) {
        setQrUrl(fallbackWechatQr);
      } else {
        setQrError(true);
      }
    } finally {
      setQrLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = window.sessionStorage.getItem('wechat-qr-url');
        if (cached) setQrUrl(cached);
      } catch {}
    }
    loadQr();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const qrToShow = useMemo(() => qrUrl || fallbackWechatQr, [qrUrl, fallbackWechatQr]);

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('home.cta.contactTitle')}</DialogTitle>
          <DialogDescription>{t('home.cta.contactDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t('home.cta.contactWeChatLabel')}</span>
              <span className="text-sm font-semibold text-foreground">RZX000-</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-28 h-28 rounded-md border bg-background flex items-center justify-center overflow-hidden">
                {qrToShow ? (
                  <Image
                    src={qrToShow}
                    alt={t('home.cta.contactQrAlt')}
                    width={112}
                    height={112}
                    unoptimized
                    loader={({ src }) => src}
                    className="w-full h-full object-contain"
                    onError={() => {
                      setQrError(true);
                      setQrUrl(null);
                    }}
                  />
                ) : qrError ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQrUrl(null);
                      setQrError(false);
                      loadQr();
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    {t('home.cta.contactQrError')}
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">{t('home.cta.contactQrLoading')}</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground leading-snug">
                {t('home.cta.contactQrNote')}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
            <span className="text-sm font-medium">{t('home.cta.contactEmailLabel')}</span>
            <a
              href="mailto:team@zmind.so"
              className="text-sm font-semibold text-primary hover:underline"
            >
              team@zmind.so
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
