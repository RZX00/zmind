'use client';
import { siteConfig } from '@/lib/home';
import { ChevronRightIcon } from '@radix-ui/react-icons';
import {Link} from '@/i18n/routing';
import Image from 'next/image';
import { useTheme } from 'next-themes';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {useTranslations} from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { getWechatQrPublic } from '@/lib/api/assets';
import { ContactDialog } from '@/components/home/contact-dialog';

export function FooterSection() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const t = useTranslations();
  const tl = useTranslations('landing.footer');
  const [wechatDialogOpen, setWechatDialogOpen] = useState(false);
  const fallbackWechatQr = process.env.NEXT_PUBLIC_WECHAT_QR_URL || null;
  const [wechatQrUrl, setWechatQrUrl] = useState<string | null>(fallbackWechatQr);
  const [, setWechatQrLoading] = useState(false);
  const [wechatQrError, setWechatQrError] = useState(false);
  const wechatQrInFlightRef = useRef(false);

  // After mount, we can access the theme
  useEffect(() => {
    setMounted(true);
  }, []);

  const loadWechatQr = useCallback(async () => {
    if (wechatQrInFlightRef.current) return;
    wechatQrInFlightRef.current = true;
    setWechatQrLoading(true);
    setWechatQrError(false);
    try {
      const res = await getWechatQrPublic();
      if (res?.public_url) {
        setWechatQrUrl(res.public_url);
        if (typeof window !== 'undefined') {
          try {
            window.sessionStorage.setItem('wechat-qr-url', res.public_url);
          } catch {}
        }
      } else if (fallbackWechatQr) {
        setWechatQrUrl(fallbackWechatQr);
      } else {
        setWechatQrError(true);
      }
    } catch (error) {
      if (fallbackWechatQr) {
        setWechatQrUrl(fallbackWechatQr);
      } else {
        setWechatQrError(true);
      }
    } finally {
      setWechatQrLoading(false);
      wechatQrInFlightRef.current = false;
    }
  }, [fallbackWechatQr]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = window.sessionStorage.getItem('wechat-qr-url');
        if (cached) {
          setWechatQrUrl(cached);
        }
      } catch {}
    }
    loadWechatQr();
  }, [loadWechatQr]);

  const qrToShow = useMemo(() => wechatQrUrl || fallbackWechatQr, [wechatQrUrl, fallbackWechatQr]);

  const logoSrc = !mounted
    ? '/zmind-logo.svg'
    : resolvedTheme === 'dark'
      ? '/zmind-logo-white.svg'
      : '/zmind-logo.svg';

  return (
    <footer id="footer" className="w-full pb-0 px-6">
        <div className="w-full mx-auto">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between p-10">
            <div className="flex flex-col items-start justify-start gap-y-5 max-w-xs mx-0 md:max-w-md md:flex-[0_0_40%]">
              <Link href="/" className="flex items-center gap-2">
                <Image
                  src={logoSrc}
                  alt="Zmind Logo"
                  width={122}
                  height={22}
                  priority
                />
              </Link>
              <p className="tracking-tight text-muted-foreground font-medium">
                {tl('description', { defaultMessage: siteConfig.hero.description })}
              </p>

              <div className="flex items-center gap-4">
                <a
                  href="https://x.com/Renzexi01"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('footer.aria.x')}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className="size-5 text-muted-foreground hover:text-primary transition-colors"
                  >
                    <path
                      fill="currentColor"
                      d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"
                    />
                  </svg>
                </a>
                <Link
                  href="/docs"
                  aria-label={t('footer.aria.docs')}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className="size-5 text-muted-foreground hover:text-primary transition-colors"
                  >
                    <path fill="currentColor" d="M6 2.75A2.75 2.75 0 0 0 3.25 5.5v13A2.75 2.75 0 0 0 6 21.25h9.5A3.25 3.25 0 0 0 18.75 18V8.06a.75.75 0 0 0-.22-.53l-4-4a.75.75 0 0 0-.53-.22H6Zm0 1.5h7.5V8.5h4.5V18c0 .966-.784 1.75-1.75 1.75H6c-.69 0-1.25-.56-1.25-1.25v-13c0-.69.56-1.25 1.25-1.25Zm2 6h6a.75.75 0 0 1 0 1.5H8a.75.75 0 0 1 0-1.5Zm0 3h6a.75.75 0 0 1 0 1.5H8a.75.75 0 0 1 0-1.5Zm0 3h6a.75.75 0 0 1 0 1.5H8a.75.75 0 0 1 0-1.5Z" />
                  </svg>
                </Link>
                <a
                  href="https://xhslink.com/m/4GQB5t7kIYH"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('footer.aria.xhs')}
                >
                  <Image
                    src="/xiao-hong-shu.svg"
                    alt={t('footer.aria.xhs')}
                    width={20}
                    height={20}
                    className="size-5 opacity-80 hover:opacity-100 transition-opacity"
                  />
                </a>
                <Dialog open={wechatDialogOpen} onOpenChange={setWechatDialogOpen}>
                  <DialogTrigger asChild>
                    <button
                      type="button"
                      aria-label={t('footer.aria.wechat')}
                      className="flex items-center justify-center"
                    >
                      <Image
                        src="/wechat.svg"
                        alt={t('footer.aria.wechat')}
                        width={20}
                        height={20}
                        className="size-5 opacity-80 hover:opacity-100 transition-opacity"
                      />
                    </button>
                  </DialogTrigger>
                  <DialogContent className="max-w-xs sm:max-w-sm">
                    <DialogHeader className="space-y-1">
                      <DialogTitle>{t('footer.wechatModal.title')}</DialogTitle>
                  <DialogDescription>{t('footer.wechatModal.desc')}</DialogDescription>
                </DialogHeader>
                <div className="flex justify-center">
                  <div className="w-48 h-48 rounded-lg border bg-muted/40 flex items-center justify-center overflow-hidden">
                    {qrToShow ? (
                      <Image
                        src={qrToShow}
                        alt={t('footer.wechatModal.alt')}
                        width={192}
                        height={192}
                        unoptimized
                        loader={({ src }) => src}
                        className="w-full h-full object-contain"
                        onError={() => {
                          setWechatQrError(true);
                          setWechatQrUrl(null);
                        }}
                      />
                    ) : wechatQrError ? (
                      <button
                        type="button"
                        onClick={() => {
                          setWechatQrUrl(fallbackWechatQr);
                          setWechatQrError(false);
                          loadWechatQr();
                        }}
                        className="text-sm text-primary hover:underline"
                      >
                        {t('footer.wechatModal.error')}
                      </button>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t('footer.wechatModal.loading')}</span>
                    )}
                  </div>
                </div>
                  </DialogContent>
                </Dialog>
              </div>
              {/* <div className="flex items-center gap-2 dark:hidden">
                <Icons.soc2 className="size-12" />
                <Icons.hipaa className="size-12" />
                <Icons.gdpr className="size-12" />
              </div>
              <div className="dark:flex items-center gap-2 hidden">
                <Icons.soc2Dark className="size-12" />
                <Icons.hipaaDark className="size-12" />
                <Icons.gdprDark className="size-12" />
              </div> */}
            </div>
            <div className="pt-5 md:flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 md:pl-10">
                {siteConfig.footerLinks.map((column, columnIndex) => (
                  <ul key={columnIndex} className="flex flex-col gap-y-2 text-left">
                    <li className="mb-2 text-sm font-semibold text-primary">
                      {t(`footer.columns.${column.title.toLowerCase()}`)}
                    </li>
                    {column.links.map((link) => (
                      <li key={link.id}>
                        {link.id === 3 ? (
                          <ContactDialog
                            trigger={
                              <button
                                type="button"
                                className="group inline-flex cursor-pointer items-center justify-start gap-1 text-[15px]/snug text-muted-foreground"
                              >
                                <span>{t(`footer.linkById.${link.id}`)}</span>
                                <div className="flex size-4 items-center justify-center border border-border rounded translate-x-0 transform opacity-0 transition-all duration-300 ease-out group-hover:translate-x-1 group-hover:opacity-100">
                                  <ChevronRightIcon className="h-4 w-4 " />
                                </div>
                              </button>
                            }
                          />
                        ) : (
                          <div className="group inline-flex cursor-pointer items-center justify-start gap-1 text-[15px]/snug text-muted-foreground">
                            <Link href={link.url}>{t(`footer.linkById.${link.id}`)}</Link>
                            <div className="flex size-4 items-center justify-center border border-border rounded translate-x-0 transform opacity-0 transition-all duration-300 ease-out group-hover:translate-x-1 group-hover:opacity-100">
                              <ChevronRightIcon className="h-4 w-4 " />
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Footer CTA dot grid removed to avoid duplicate backgrounds */}
    </footer>
  );
}
