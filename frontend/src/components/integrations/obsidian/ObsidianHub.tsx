'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  useCreateObsidianExportJob,
  useObsidianExportJob,
} from '@/hooks/react-query/integrations/use-obsidian-import';
import { cn } from '@/lib/utils';
import ImportWizard from './ImportWizard';

interface ObsidianHubProps {
  className?: string;
}

export default function ObsidianHub({ className }: ObsidianHubProps) {
  const t = useTranslations('obsidianIntegration.exportCard');
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const createExportJob = useCreateObsidianExportJob();
  const { data: exportJob } = useObsidianExportJob(exportJobId);

  const handleCreateExport = async () => {
    try {
      const job = await createExportJob.mutateAsync({ scopeType: 'workspace' });
      setExportJobId(job.id);
      toast.success(t('toasts.startSuccess'));
    } catch (error: any) {
      toast.error(error?.message || t('toasts.startFailed'));
    }
  };

  return (
    <div className={cn('space-y-4', className)}>
      <ImportWizard />

      <div className="rounded-2xl border border-border/70 bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">{t('title')}</h3>
            <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
          </div>
          <button
            className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm hover:bg-accent disabled:opacity-60"
            disabled={createExportJob.isPending}
            onClick={() => void handleCreateExport()}
          >
            {createExportJob.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t('createExport')}
          </button>
        </div>

        {!exportJob && (
          <div className="rounded-lg border border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground">
            {t('empty')}
          </div>
        )}

        {exportJob && (
          <div className="rounded-lg border border-border/70 bg-background px-3 py-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium">{t('jobLabel', { id: exportJob.id })}</div>
              <div className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {exportJob.status}
              </div>
            </div>
            <div className="mb-2 h-2 w-full rounded-full bg-muted">
              <div className="h-2 rounded-full bg-foreground/80" style={{ width: `${Math.max(0, Math.min(100, exportJob.progress || 0))}%` }} />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t('exportedDocs', { count: String((exportJob.stats || {}).exported_docs || 0) })}</span>
              {exportJob.downloadUrl ? (
                <a
                  href={`/api${exportJob.downloadUrl}`}
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                >
                  <Download className="h-3 w-3" />
                  {t('downloadZip')}
                </a>
              ) : (
                <span>{t('preparing')}</span>
              )}
            </div>
            {exportJob.errorMessage && (
              <div className="mt-2 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-600 dark:text-rose-400">
                {exportJob.errorMessage}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
