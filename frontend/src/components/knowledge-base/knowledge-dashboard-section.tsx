'use client';

import React from 'react';
import {useTranslations, useFormatter} from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { FileIcon } from 'lucide-react';
import { TextEntryModal } from '@/components/knowledge-base/text-entry-modal';
import { FileUploadModal } from '@/components/knowledge-base/file-upload-modal';
import { KBFilePreviewModal } from '@/components/knowledge-base/kb-file-preview-modal';
import { useRouter } from '@/i18n/routing';
import { useWorkspace } from '@/contexts/workspace-context';
import { buildTeamScopedPath } from '@/lib/workspace-path';

type Folder = {
  folder_id: string;
  name: string;
  description?: string;
  entry_count: number;
  created_at: string;
};

type Entry = {
  entry_id: string;
  filename: string;
  summary: string;
  file_size: number;
  created_at: string;
};

const getFileTypeInfo = (filename: string) => {
  const extension = filename.split('.').pop()?.toLowerCase() || '';
  const fileType = extension.toUpperCase();
  return { extension: fileType };
};

const useFormatDate = () => {
  const t = useTranslations();
  const format = useFormatter();
  return (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays === 1) return t('knowledge.today', {default: 'Today'});
    if (diffDays === 2) return t('knowledge.yesterday', {default: 'Yesterday'});
    if (diffDays <= 7) return t('knowledge.daysAgo', {count: diffDays, default: `${diffDays} days ago`});
    return format.dateTime(date, { month: 'short', day: 'numeric' });
  };
};

export function KnowledgeDashboardSection({
  maxWidthClass = 'max-w-7xl'
}: { maxWidthClass?: string }) {
  const t = useTranslations();
  const formatDate = useFormatDate();
  const router = useRouter();
  const { workspaceId, teamSlug, isReady } = useWorkspace();
  const knowledgePath = buildTeamScopedPath('/knowledge', teamSlug);

  const [folders, setFolders] = React.useState<Folder[]>([]);
  const [recentFiles, setRecentFiles] = React.useState<Entry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [preview, setPreview] = React.useState<{open: boolean; file: Entry | null}>({open: false, file: null});

  const refetch = React.useCallback(async () => {
    if (!isReady || !workspaceId) {
      setFolders([]);
      setRecentFiles([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      // Folders (for upload modal selection)
      const { data: foldersData } = await supabase
        .from('knowledge_base_folders')
        .select('folder_id, name, description, created_at')
        .eq('account_id', workspaceId)
        .order('created_at', { ascending: false });
      // Count entries per folder
      const foldersWithCounts: Folder[] = await Promise.all((foldersData || []).map(async (folder: any) => {
        const { count } = await supabase
          .from('knowledge_base_entries')
          .select('*', { count: 'exact', head: true })
          .eq('folder_id', folder.folder_id)
          .eq('account_id', workspaceId);
        return { ...folder, entry_count: count || 0 } as Folder;
      }));
      setFolders(foldersWithCounts);

      // Recent files
      const { data: recentData } = await supabase
        .from('knowledge_base_entries')
        .select('entry_id, filename, summary, file_size, created_at')
        .eq('account_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(6);
      setRecentFiles(recentData || []);
    } finally {
      setLoading(false);
    }
  }, [isReady, workspaceId]);

  React.useEffect(() => { refetch(); }, [refetch]);

  return (
    <div className={`${maxWidthClass} mx-auto px-6 py-6 dashboard-panel`}>
      {/* Top actions (no folders UI, reuse page style) */}
      <div className="flex justify-between items-start mb-8">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-foreground">{t('knowledge.title', {default: 'Knowledge Base'})}</h2>
          <p className="text-sm text-muted-foreground">{t('knowledge.subtitle', {default: 'Manage your documents and data sources in one place.'})}</p>
        </div>
        <div className="flex gap-3">
          <TextEntryModal folders={folders} onUploadComplete={refetch} />
          <FileUploadModal folders={folders} onUploadComplete={refetch} />
        </div>
      </div>

      {/* Recently Added */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-foreground">{t('knowledge.recent.title', {default: 'Recently Added'})}</h3>
          <Button variant="link" className="text-sm" onClick={() => router.push(knowledgePath)}>
            {t('knowledge.viewAll', {default: 'View All'})}
          </Button>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 border rounded-lg bg-muted/30" />
            ))}
          </div>
        ) : recentFiles.length === 0 ? (
          <div className="text-sm text-muted-foreground border rounded-lg p-6 bg-card">{t('knowledge.empty', {default: 'No items yet'})}</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {recentFiles.slice(0, 6).map((file) => {
              const info = getFileTypeInfo(file.filename);
              return (
                <div key={file.entry_id} className="group cursor-pointer" onClick={() => setPreview({open: true, file})}>
                  <div className="relative bg-card border border-border rounded-lg p-4 transition-all duration-200 hover:shadow-sm">
                    <div className="flex flex-col items-center space-y-3">
                      <div className="relative">
                        <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
                          <FileIcon className="h-6 w-6 text-foreground/60" />
                        </div>
                        <div className="absolute -bottom-1 -right-1 bg-background border border-border rounded px-1 py-0.5">
                          <span className="text-[8px] font-medium text-muted-foreground uppercase">{info.extension.slice(0, 3)}</span>
                        </div>
                      </div>
                      <div className="text-xs font-medium text-foreground/80 truncate w-full text-center" title={file.filename}>{file.filename}</div>
                      <div className="text-[10px] text-muted-foreground">{formatDate(file.created_at)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {preview.file && (
        <KBFilePreviewModal
          isOpen={preview.open}
          onClose={() => setPreview({open: false, file: null})}
          file={preview.file}
          onEditSummary={() => {}}
        />
      )}
    </div>
  );
}

export default KnowledgeDashboardSection;
