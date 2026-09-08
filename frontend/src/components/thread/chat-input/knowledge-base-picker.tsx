'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { createClient } from '@/lib/supabase/client';
import { getCurrentWorkspaceId } from '@/lib/workspace-session';
import { toast } from 'sonner';

const formatBytes = (bytes: number) => {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
};

export interface KnowledgeBaseAttachmentSource {
  entryId: string;
  fileId?: string;
  name: string;
  size: number;
  type?: string | null;
  storagePath?: string | null;
  folderId?: string | null;
}

interface KnowledgeBasePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (file: KnowledgeBaseAttachmentSource) => void;
}

interface KnowledgeBaseEntry {
  entry_id: string;
  filename: string;
  summary?: string | null;
  file_size: number;
  created_at: string;
  folder_id?: string | null;
  mime_type?: string | null;
  file_path?: string | null;
  file_id?: string | null;
}

export function KnowledgeBasePickerDialog({
  open,
  onOpenChange,
  onSelect,
}: KnowledgeBasePickerDialogProps) {
  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>([]);
  const [folderNameMap, setFolderNameMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const loadEntries = async () => {
      if (!open) return;
      const workspaceId = getCurrentWorkspaceId();
      if (!workspaceId) {
        setEntries([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const supabase = createClient();
        const { data: folderRows, error: folderError } = await supabase
          .from('knowledge_base_folders')
          .select('folder_id, name')
          .eq('account_id', workspaceId);
        if (folderError) {
          console.error('Failed to load knowledge folders:', folderError);
        } else {
          setFolderNameMap(
            new Map((folderRows || []).map((folder) => [folder.folder_id, folder.name])),
          );
        }

        const { data: entryRows, error: entryError } = await supabase
          .from('knowledge_base_entries')
          .select('entry_id, filename, summary, file_size, created_at, folder_id, mime_type, file_path')
          .eq('account_id', workspaceId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(200);
        if (entryError) {
          throw entryError;
        }

        const entryIds = (entryRows || []).map((entry) => entry.entry_id);
        const linkMap = new Map<string, string>();
        if (entryIds.length > 0) {
          const { data: linkRows, error: linkError } = await supabase
            .from('file_links')
            .select('file_id, entity_id')
            .eq('entity_type', 'kb_entry')
            .in('entity_id', entryIds);
          if (linkError) {
            console.error('Failed to load knowledge file links:', linkError);
          } else {
            (linkRows || []).forEach((link) => {
              if (link.entity_id && link.file_id) {
                linkMap.set(link.entity_id, link.file_id);
              }
            });
          }
        }

        const hydrated = (entryRows || []).map((entry) => ({
          ...entry,
          file_id: linkMap.get(entry.entry_id) || null,
        }));
        setEntries(hydrated);
      } catch (error) {
        console.error('Failed to load knowledge base entries:', error);
        toast.error('Failed to load knowledge base files');
      } finally {
        setLoading(false);
      }
    };

    loadEntries();
  }, [open]);

  const filteredEntries = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return entries;
    return entries.filter((entry) => entry.filename.toLowerCase().includes(trimmed));
  }, [entries, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Choose from knowledge base</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            placeholder="Search files"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={`kb-skeleton-${index}`} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="text-sm text-muted-foreground border rounded-lg p-4 bg-card">
              No files available.
            </div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto">
              {filteredEntries.map((entry) => {
                const folderLabel = entry.folder_id
                  ? `${folderNameMap.get(entry.folder_id) || 'Unfiled'} /`
                  : 'Unfiled /';
                const isUnavailable = !entry.file_id;
                return (
                  <button
                    key={entry.entry_id}
                    type="button"
                    disabled={isUnavailable}
                    onClick={() =>
                      onSelect({
                        entryId: entry.entry_id,
                        fileId: entry.file_id || undefined,
                        name: entry.filename,
                        size: entry.file_size,
                        type: entry.mime_type,
                        storagePath: entry.file_path,
                        folderId: entry.folder_id,
                      })
                    }
                    className={`w-full text-left border rounded-lg px-3 py-2 transition ${
                      isUnavailable
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:border-foreground/20 hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground truncate">{folderLabel}</div>
                        <div className="text-sm font-medium text-foreground truncate">{entry.filename}</div>
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatBytes(entry.file_size)}
                      </div>
                    </div>
                    {isUnavailable && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        File unavailable
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
