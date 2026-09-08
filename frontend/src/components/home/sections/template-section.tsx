'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowRight, LayoutTemplate, Sparkles } from 'lucide-react';
import posthog from 'posthog-js';
import { cn } from '@/lib/utils';
import { fetchPublicCanvases } from '@/lib/backend-api';

type PublicCanvas = {
  id: string;
  title: string;
  listed_at?: string | null;
  updated_at?: string | null;
  author_display_name?: string | null;
  author_avatar_url?: string | null;
};

export function TemplateSection() {
  const t = useTranslations();
  const locale = useLocale();
  const [items, setItems] = useState<PublicCanvas[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const MAX_ITEMS = 6;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // 走后端 /public-canvases（匿名可读），后端已统一按 listed_at 倒序
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

  const buildShareHref = (id: string) => {
    const base = `/share/canvas/${encodeURIComponent(id)}`;
    return locale === 'zh' ? `/zh${base}` : base;
  };

  const buildExploreHref = () => {
    const base = `/explore`;
    return locale === 'zh' ? `/zh${base}` : base;
  };

  if (!loading && items.length === 0) return null;

return (
    <section id="templates" className="relative w-full py-24 bg-transparent">
      <div className="max-w-6xl mx-auto px-6 relative z-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-4">
          <div className="space-y-4 max-w-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.3em] text-blue-600 dark:text-blue-400">
              <LayoutTemplate size={14} />
              {t('home.templates.label', { default: 'Community' })}
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white">
              {t('home.templates.title', { default: 'Start with a template' })}
            </h2>
            <p className="text-lg text-slate-500 dark:text-slate-400">
              {t('home.templates.subtitle', { default: 'Jumpstart your workflow with community-created canvases for research, planning, and design.' })}
            </p>
          </div>
          <Link
            href={buildExploreHref()}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            onClick={() => posthog.capture('landing_template_more_click', { locale, source: 'landing' })}
          >
            {t('home.templates.viewMore', { default: 'View all templates' })}
            <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {(loading ? Array.from({ length: MAX_ITEMS }) : items).map((item: any, idx: number) => (
            <motion.div
              key={item?.id || idx}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              viewport={{ once: true }}
            >
              {loading ? (
                <div className="aspect-[16/6] w-full rounded-2xl border border-border bg-card/70 p-1 shadow-sm">
                  <div className="relative h-full w-full overflow-hidden rounded-xl bg-muted animate-pulse">
                    <div className="absolute left-1/2 top-3 h-8 w-5/6 -translate-x-1/2 rounded-full bg-foreground/10 blur-md" />
                  </div>
                </div>
              ) : (
                <Link
                  href={buildShareHref(item.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block h-full"
                  onClick={() => posthog.capture('landing_template_click', { canvasId: item.id, index: idx, locale, source: 'landing' })}
                >
                  <div className="relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all duration-300 hover:border-foreground/10 hover:shadow-md">
                    <div className="relative aspect-[16/6] w-full overflow-hidden border-b border-border bg-muted/70">
                      <div className="absolute inset-0 flex items-start justify-center transition-transform duration-500 group-hover:scale-105">
                        <div className="mt-3 h-8 w-5/6 rounded-full bg-foreground/10 blur-md" />
                      </div>
                    </div>
                    
                    <div className="flex flex-1 flex-col justify-between p-4">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground line-clamp-1">
                          {item.title || t('canvas.untitled', { default: 'Untitled' })}
                        </h3>
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <Image
                            src={item.author_avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(item.author_display_name || 'User')}&backgroundType=solid&backgroundColor=e5e7eb`}
                            alt={item.author_display_name || 'Author'}
                            width={16}
                            height={16}
                            unoptimized
                            loader={({ src }) => src}
                            className="h-4 w-4 rounded-full object-cover"
                          />
                          <span className="truncate max-w-[100px]">
                            {item.author_display_name || 'User'}
                          </span>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{new Date(item.updated_at || Date.now()).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
