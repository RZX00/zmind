'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import posthog from 'posthog-js';
import { fetchPublicCanvases } from '@/lib/backend-api';

type PublicCanvas = {
  id: string;
  title: string;
  listed_at?: string | null;
  updated_at?: string | null;
  author_display_name?: string | null;
  author_avatar_url?: string | null;
};

export function CasesSection() {
  const t = useTranslations();
  const locale = useLocale();
  const [items, setItems] = useState<PublicCanvas[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const MAX_ITEMS = 6;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // 走后端 /public-canvases（匿名可读）。原先的「视图查不到就回退查 canvases 表」
        // 那层兜底已由后端统一处理，前端不再需要。
        const data = await fetchPublicCanvases(MAX_ITEMS);
        if (!mounted) return;
        setItems(Array.isArray(data) ? (data as PublicCanvas[]) : []);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // If no public items, hide the whole section
  if (!loading && items.length === 0) return null;

  const buildShareHref = (id: string) => {
    const base = `/share/canvas/${encodeURIComponent(id)}`;
    return locale === 'zh' ? `/zh${base}` : base;
  };

  const buildExploreHref = () => {
    const base = `/explore`;
    return locale === 'zh' ? `/zh${base}` : base;
  };

  return (
    <section className="w-full py-14 md:py-16 lg:py-20 border-t">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
              {t('landing.cases.title', { default: 'Case Studies' })}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t('landing.cases.subtitle', { default: 'See real canvases from our community' })}
            </p>
          </div>
          <div>
            <Link
              href={buildExploreHref()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
              onClick={() => posthog.capture('landing_case_more_click', { locale, source: 'landing' })}
            >
              {t('landing.cases.viewMore', { default: 'View more on Template' })}
            </Link>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {(loading ? Array.from({ length: MAX_ITEMS }) : items).map((item: any, idx: number) => (
            <div key={item?.id || idx} className="border rounded-lg overflow-hidden bg-background hover:shadow-sm transition-shadow">
              {loading ? (
                <>
                  <div className="p-4 h-32 flex items-center bg-muted/40 animate-pulse">
                    <div className="h-7 w-2/3 bg-muted rounded" />
                  </div>
                  <div className="p-3 flex items-center gap-3 border-t">
                    <div className="w-7 h-7 rounded-full bg-muted animate-pulse" />
                    <div className="h-3 w-24 bg-muted rounded" />
                  </div>
                </>
              ) : (
                <Link
                  href={buildShareHref(item.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block hover:shadow-sm transition-shadow"
                  onClick={() => posthog.capture('landing_case_click', { canvasId: item.id, index: idx, locale, source: 'landing' })}
                >
                  <div className="p-4 h-32 flex items-center bg-muted/40">
                    <h3 className="text-base md:text-xl font-semibold leading-snug line-clamp-3">
                      {item.title || t('canvas.untitled', { default: 'Untitled' })}
                    </h3>
                  </div>
                  <div className="p-3 flex items-center gap-3 border-t">
                    <Image
                      src={item.author_avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(item.author_display_name || 'User')}&backgroundType=solid&backgroundColor=e5e7eb`}
                      alt={item.author_display_name || 'Author'}
                      width={28}
                      height={28}
                      unoptimized
                      loader={({ src }) => src}
                      className="w-7 h-7 rounded-full object-cover border bg-muted"
                    />
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground truncate">{item.author_display_name || '作者'}</div>
                    </div>
                  </div>
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
