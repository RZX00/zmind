'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { ObsidianImportReport } from '@/types/obsidian';

interface ImportReportProps {
  report: ObsidianImportReport | null;
  className?: string;
}

export default function ImportReport({ report, className }: ImportReportProps) {
  const t = useTranslations('obsidianIntegration.importReport');

  if (!report) {
    return (
      <div className={cn('rounded-lg border border-border/70 bg-card px-3 py-2 text-xs text-muted-foreground', className)}>
        {t('unavailable')}
      </div>
    );
  }

  const unresolvedLinks = report.unresolvedLinks || [];
  const unresolvedAssets = report.unresolvedAssets || [];
  const mappedCount = Object.keys(report.pathToItemId || {}).length;

  return (
    <div className={cn('rounded-lg border border-border/70 bg-card px-3 py-3', className)}>
      <div className="mb-2 text-sm font-medium">{t('title')}</div>
      <div className="mb-3 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
        <div>{t('mappedDocs', { count: mappedCount })}</div>
        <div>{t('unresolvedLinks', { count: unresolvedLinks.length })}</div>
        <div>{t('unresolvedAssets', { count: unresolvedAssets.length })}</div>
      </div>

      {unresolvedLinks.length > 0 && (
        <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 p-2">
          <div className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-300">{t('unresolvedLinksTitle')}</div>
          <div className="max-h-32 space-y-1 overflow-y-auto text-[11px] text-amber-700/90 dark:text-amber-300/90">
            {unresolvedLinks.map((item, idx) => (
              <div key={idx}>
                {(item.sourcePath as string) || t('unknown')}
                {' -> '}
                {(item.raw as string) || t('unknown')}
              </div>
            ))}
          </div>
        </div>
      )}

      {unresolvedAssets.length > 0 && (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 p-2">
          <div className="mb-1 text-xs font-medium text-rose-700 dark:text-rose-300">{t('unresolvedAssetsTitle')}</div>
          <div className="max-h-32 space-y-1 overflow-y-auto text-[11px] text-rose-700/90 dark:text-rose-300/90">
            {unresolvedAssets.map((item, idx) => (
              <div key={idx}>
                {(item.path as string) || t('unknown')}
                {' -> '}
                {(item.asset as string) || t('unknown')}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
