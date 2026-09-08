'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { ObsidianImportJob } from '@/types/obsidian';

interface ImportJobStatusProps {
  job: ObsidianImportJob | null;
  className?: string;
}

export default function ImportJobStatus({ job, className }: ImportJobStatusProps) {
  const t = useTranslations('obsidianIntegration.importJobStatus');

  if (!job) {
    return (
      <div className={cn('rounded-lg border border-border/70 bg-card px-3 py-2 text-xs text-muted-foreground', className)}>
        {t('empty')}
      </div>
    );
  }

  const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));

  return (
    <div className={cn('rounded-lg border border-border/70 bg-card px-3 py-3', className)}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">{t('jobLabel', { id: job.id })}</div>
        <div className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {job.status}
        </div>
      </div>

      <div className="mb-2 h-2 w-full rounded-full bg-muted">
        <div className="h-2 rounded-full bg-foreground/80 transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        <div>{t('totalFiles', { count: job.stats.total_files })}</div>
        <div>{t('importedDocs', { count: job.stats.imported_docs })}</div>
        <div>{t('references', { count: job.stats.created_references })}</div>
        <div>{t('unresolved', { count: job.stats.unresolved_links })}</div>
      </div>

      {job.errorMessage && (
        <div className="mt-2 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-600 dark:text-rose-400">
          {job.errorMessage}
        </div>
      )}
    </div>
  );
}
