'use client';

import { useMemo, useState } from 'react';
import { Loader2, UploadCloud } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  useCommitObsidianImportJob,
  useCreateObsidianImportJob,
  useObsidianImportJob,
  useObsidianImportReport,
  useUploadObsidianImportPayload,
} from '@/hooks/react-query/integrations/use-obsidian-import';
import { cn } from '@/lib/utils';
import ImportJobStatus from './ImportJobStatus';
import ImportReport from './ImportReport';
import type { ObsidianImportSourceType } from '@/types/obsidian';

interface ImportWizardProps {
  className?: string;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

async function readFilesAsPayload(
  files: FileList,
  includeAssets: boolean,
): Promise<{
  markdownFiles: Array<{ path: string; content: string }>;
  assets: Array<{ path: string; base64: string; contentType?: string; originalFilename?: string }>;
}> {
  const list = Array.from(files);
  const markdownFiles: Array<{ path: string; content: string }> = [];
  const assets: Array<{ path: string; base64: string; contentType?: string; originalFilename?: string }> = [];
  for (const file of list) {
    const path = (file as any).webkitRelativePath || file.name;
    if (path.toLowerCase().endsWith('.md')) {
      const content = await file.text();
      markdownFiles.push({ path, content });
      continue;
    }
    if (!includeAssets) continue;
    const base64 = await fileToBase64(file);
    assets.push({
      path,
      base64,
      contentType: file.type || undefined,
      originalFilename: file.name,
    });
  }
  return { markdownFiles, assets };
}

async function readZipBase64(file: File): Promise<string> {
  return fileToBase64(file);
}

export default function ImportWizard({ className }: ImportWizardProps) {
  const t = useTranslations('obsidianIntegration.importWizard');
  const [sourceType, setSourceType] = useState<ObsidianImportSourceType>('zip');
  const [jobId, setJobId] = useState<string | null>(null);
  const [isPreparingUpload, setIsPreparingUpload] = useState(false);

  const createJob = useCreateObsidianImportJob();
  const uploadPayload = useUploadObsidianImportPayload();
  const commitJob = useCommitObsidianImportJob();
  const { data: job } = useObsidianImportJob(jobId);
  const { data: report } = useObsidianImportReport(jobId);

  const busy = createJob.isPending || uploadPayload.isPending || commitJob.isPending || isPreparingUpload;

  const canCommit = useMemo(() => {
    if (!job) return false;
    return job.status === 'pending' || job.status === 'partially_completed' || job.status === 'failed';
  }, [job]);
  const directoryPickerProps: any =
    sourceType === 'directory' ? { webkitdirectory: 'true', directory: 'true' } : {};

  const handleCreateJob = async () => {
    try {
      const next = await createJob.mutateAsync(sourceType);
      setJobId(next.id);
      toast.success(t('toasts.createJobSuccess'));
    } catch (error: any) {
      toast.error(error?.message || t('toasts.createJobFailed'));
    }
  };

  const handleUploadMarkdownFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!jobId) {
      toast.warning(t('toasts.createJobFirst'));
      return;
    }
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsPreparingUpload(true);
    try {
      const includeAssets = sourceType === 'directory';
      const { markdownFiles, assets } = await readFilesAsPayload(files, includeAssets);
      if (markdownFiles.length === 0) {
        toast.warning(t('toasts.noMarkdownFiles'));
        return;
      }
      await uploadPayload.mutateAsync({
        jobId,
        upload: {
          files: markdownFiles,
          assets: includeAssets ? assets : [],
        },
      });
      if (includeAssets) {
        toast.success(t('toasts.uploadMixedSuccess', { docCount: markdownFiles.length, assetCount: assets.length }));
      } else {
        toast.success(t('toasts.uploadMarkdownSuccess', { count: markdownFiles.length }));
      }
    } catch (error: any) {
      toast.error(error?.message || t('toasts.uploadMarkdownFailed'));
    } finally {
      setIsPreparingUpload(false);
      event.target.value = '';
    }
  };

  const handleUploadZipFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!jobId) {
      toast.warning(t('toasts.createJobFirst'));
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;

    setIsPreparingUpload(true);
    try {
      const zipBase64 = await readZipBase64(file);
      await uploadPayload.mutateAsync({ jobId, upload: { files: [], zipBase64 } });
      toast.success(t('toasts.uploadZipSuccess', { name: file.name }));
    } catch (error: any) {
      toast.error(error?.message || t('toasts.uploadZipFailed'));
    } finally {
      setIsPreparingUpload(false);
      event.target.value = '';
    }
  };

  const handleCommit = async () => {
    if (!jobId) return;
    try {
      await commitJob.mutateAsync(jobId);
      toast.success(t('toasts.commitSuccess'));
    } catch (error: any) {
      toast.error(error?.message || t('toasts.commitFailed'));
    }
  };

  return (
    <div className={cn('rounded-2xl border border-border/70 bg-card p-4', className)}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">{t('title')}</h3>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          value={sourceType}
          onChange={(event) => setSourceType(event.target.value as ObsidianImportSourceType)}
          disabled={busy}
        >
          <option value="zip">{t('sourceTypeZip')}</option>
          <option value="directory">{t('sourceTypeDirectory')}</option>
        </select>

        <button
          className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm hover:bg-accent disabled:opacity-60"
          disabled={busy}
          onClick={() => void handleCreateJob()}
        >
          {createJob.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {t('createJob')}
        </button>

        <button
          className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm hover:bg-accent disabled:opacity-60"
          disabled={!canCommit || busy}
          onClick={() => void handleCommit()}
        >
          {commitJob.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t('commitImport')}
        </button>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-2">
        <label className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs">
          <div className="mb-1 font-medium">
            {sourceType === 'directory' ? t('selectVaultDirectory') : t('uploadMarkdownFiles')}
          </div>
          <input
            type="file"
            accept={sourceType === 'directory' ? undefined : '.md'}
            multiple
            {...directoryPickerProps}
            onChange={handleUploadMarkdownFiles}
            disabled={busy}
          />
        </label>
        <label className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs">
          <div className="mb-1 font-medium">{t('uploadVaultZip')}</div>
          <input type="file" accept=".zip" onChange={handleUploadZipFile} disabled={busy} />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ImportJobStatus job={job || null} />
        <ImportReport report={report || null} />
      </div>
    </div>
  );
}
