"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from 'next-intl';
import { fetchPublicCanvases } from '@/lib/backend-api';

type PublicCanvas = {
  id: string;
  title: string;
  author_display_name: string | null;
  author_avatar_url: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const PAGE_SIZE = 24;

export default function ExplorePage() {
  const t = useTranslations();
  const [items, setItems] = useState<PublicCanvas[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const loadPage = async (pageIndex: number) => {
    const from = pageIndex * PAGE_SIZE;
    setLoading(true);
    try {
      // 走后端 /public-canvases（匿名可读）；原先的视图→表回退兜底已由后端统一处理
      let data: Awaited<ReturnType<typeof fetchPublicCanvases>> | null = null;
      try {
        data = await fetchPublicCanvases(PAGE_SIZE, from);
      } catch (error) {
        console.warn("[Explore] fetch error:", error);
        setHasMore(false);
        return;
      }
      const rows = Array.isArray(data) ? (data as PublicCanvas[]) : [];
      if (rows.length < PAGE_SIZE) setHasMore(false);
      if (pageIndex === 0) setItems(rows);
      else setItems((prev) => prev.concat(rows));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPage(0); }, []);

  const onLoadMore = async () => {
    const next = page + 1;
    setPage(next);
    await loadPage(next);
  };

  return (
    <div className="w-full h-screen overflow-y-auto scrollbar-none">
      <div className="dashboard-page">
        <div className="dashboard-container-wide space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight dashboard-title">
              {t('sidebar.template', { default: 'Template' })}
            </h1>
          </div>

          {items.length === 0 && !loading ? (
            <div className="text-muted-foreground">暂无公开画布</div>
          ) : (
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}
            >
              {items.map((c) => (
                <Link
                  key={c.id}
                  href={`/share/canvas/${encodeURIComponent(c.id)}`}
                  className="group block rounded-lg border border-border bg-card overflow-hidden shadow-sm transition-shadow hover:shadow-md"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="p-4 h-28 flex items-center bg-muted/30">
                    <h2 className="text-base md:text-lg font-semibold leading-snug line-clamp-3">
                      {c.title || 'Untitled'}
                    </h2>
                  </div>
                  <div className="p-3 flex items-center gap-3 border-t border-border/60">
                    <Image
                      src={c.author_avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(c.author_display_name || 'User')}&backgroundType=solid&backgroundColor=e5e7eb`}
                      alt={c.author_display_name || "Author"}
                      width={28}
                      height={28}
                      unoptimized
                      loader={({ src }) => src}
                      className="w-7 h-7 rounded-full object-cover border border-border/60 bg-muted"
                    />
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground truncate">{c.author_display_name || '作者'}</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          <div className="flex justify-center pt-2">
            {hasMore ? (
              <button
                className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                onClick={onLoadMore}
                disabled={loading}
              >
                {loading ? "加载中..." : "加载更多"}
              </button>
            ) : (
              <div className="text-xs text-muted-foreground">没有更多了</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
