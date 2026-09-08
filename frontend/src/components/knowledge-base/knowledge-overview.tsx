'use client';

import React from 'react';
import { createClient } from '@/lib/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/routing';
import {useTranslations, useFormatter} from 'next-intl';

type Entry = {
  entry_id: string;
  filename: string;
  summary?: string | null;
  file_size?: number | null;
  created_at: string;
};

function useRecentKbEntries(limit = 6) {
  const [entries, setEntries] = React.useState<Entry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('knowledge_base_entries')
          .select('entry_id, filename, summary, file_size, created_at')
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error) throw error;
        if (!cancelled) setEntries(data || []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    // 延迟到进入视窗再加载：由父组件负责 IntersectionObserver，也允许立即加载
    load();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  return { entries, loading, error };
}

export function KnowledgeOverview({ maxWidthClass = 'max-w-6xl', gridClassName = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4' }: { maxWidthClass?: string; gridClassName?: string }) {
  const router = useRouter();
  const { entries, loading } = useRecentKbEntries(6);
  const t = useTranslations();
  const format = useFormatter();

  return (
    <section className="px-4 py-10" aria-labelledby="kb-title">
      <div className={`${maxWidthClass} mx-auto`}>
        <div className="mb-6">
        <h2 id="kb-title" className="text-xl font-medium text-foreground">{t('knowledge.title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t('knowledge.subtitle')}</p>
        </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push('/knowledge')}>{t('knowledge.upload')}</Button>
          <Button
            variant="ghost"
            onClick={() => router.push('/knowledge')}
          >
            {t('knowledge.connect')}
          </Button>
        </div>
        <Button variant="link" className="text-sm" onClick={() => router.push('/knowledge')}>{t('knowledge.viewAll')}</Button>
      </div>

      {loading ? (
        <div className={gridClassName}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-sm text-muted-foreground border rounded-lg p-6">{t('knowledge.empty')}</div>
      ) : (
        <div className={gridClassName}>
          {entries.map((e) => (
            <div
              key={e.entry_id}
              className="border rounded-lg p-4 bg-card hover:bg-accent/30 transition-colors"
            >
              <div className="text-sm font-medium truncate" title={e.filename}>{e.filename}</div>
              <div className="text-xs text-muted-foreground mt-1 truncate">{e.summary || t('knowledge.noSummary')}</div>
              <div className="text-xs text-muted-foreground mt-2">
                {format.dateTime(new Date(e.created_at), {year: 'numeric', month: 'short', day: 'numeric'})}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </section>
  );
}

export default KnowledgeOverview;
