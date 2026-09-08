'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import {
  NovelRichTextEditor,
  getNovelSurfacePreset,
  type NovelEditorSnapshot,
  type NovelEditorContentSeed,
} from '@/components/editor/novel';
import { exportDocument, type ExportFormat } from '@/lib/utils/document-export';
import { ZmindLogo } from '../sidebar/zmind-logo';
import { useDocumentModalStore } from '@/lib/stores/use-document-modal-store';
import { requiredEnv } from '@/lib/env-utils';
import { uploadExpandedEditorImage } from '@/canvas/infrastructure/expanded-editor/novel-image-upload.adapter';

interface TipTapDocumentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string;
  documentData: {
    type?: string;
    version?: string;
    title?: string;
    content: string;
    metadata?: any;
    doc_id?: string;
    created_at?: string;
    updated_at?: string;
  };
  sandboxId: string;
  onSave?: () => void;
}

const SAVE_DEBOUNCE_MS = 700;
const EXPANDED_EDITOR_VERSION = '1.0.0';

function readInitialSeed(documentData: TipTapDocumentModalProps['documentData']): NovelEditorContentSeed {
  const metadata = (documentData.metadata || {}) as Record<string, any>;
  const expanded = metadata?.expandedEditor || {};
  const candidateJson = expanded?.json ?? metadata?.novel_json;
  const candidateMarkdown = expanded?.markdown ?? metadata?.markdown;

  return {
    html: documentData.content || '<p></p>',
    markdown: typeof candidateMarkdown === 'string' ? candidateMarkdown : undefined,
    json: candidateJson && typeof candidateJson === 'object' ? candidateJson : undefined,
  };
}

export function TipTapDocumentModal({
  open,
  onOpenChange,
  filePath,
  documentData,
  sandboxId,
  onSave,
}: TipTapDocumentModalProps) {
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'unsaved'>('saved');
  const [wordCount, setWordCount] = useState(0);
  const [characterCount, setCharacterCount] = useState(0);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const { setIsOpen } = useDocumentModalStore();
  const fileName = documentData.title || filePath.split('/').pop()?.replace('.json', '') || 'document';
  const initialSeed = useMemo(() => readInitialSeed(documentData), [documentData]);
  const latestSnapshotRef = useRef<NovelEditorSnapshot | null>(null);
  const pendingSnapshotRef = useRef<NovelEditorSnapshot | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUnsavedChanges = saveState !== 'saved' || !!pendingSnapshotRef.current;

  useEffect(() => {
    setIsOpen(open);
  }, [open, setIsOpen]);

  useEffect(() => {
    if (!open) {
      setSaveState('saved');
      pendingSnapshotRef.current = null;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const persistSnapshot = useCallback(
    async (snapshot: NovelEditorSnapshot) => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error('No access token available');
      }

      const updatedDocument = {
        ...documentData,
        content: snapshot.html,
        updated_at: new Date().toISOString(),
        metadata: {
          ...(documentData.metadata || {}),
          markdown: snapshot.markdown,
          novel_json: snapshot.json,
          expandedEditor: {
            version: EXPANDED_EDITOR_VERSION,
            markdown: snapshot.markdown,
            html: snapshot.html,
            json: snapshot.json,
            updatedAt: Date.now(),
          },
        },
      };

      const backendUrl = requiredEnv('NEXT_PUBLIC_BACKEND_URL');
      const response = await fetch(`${backendUrl}/runtime/${sandboxId}/files`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: filePath,
          content: JSON.stringify(updatedDocument, null, 2),
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || 'Failed to save document');
      }

      onSave?.();
    },
    [documentData, filePath, sandboxId, onSave],
  );

  const flushPendingSave = useCallback(async () => {
    const snapshot = pendingSnapshotRef.current;
    if (!snapshot) return;
    pendingSnapshotRef.current = null;
    setSaveState('saving');
    try {
      await persistSnapshot(snapshot);
      setSaveState('saved');
    } catch (error) {
      setSaveState('unsaved');
      toast.error(`Auto-save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }, [persistSnapshot]);

  const scheduleSave = useCallback(
    (snapshot: NovelEditorSnapshot) => {
      latestSnapshotRef.current = snapshot;
      pendingSnapshotRef.current = snapshot;
      setWordCount(snapshot.wordCount);
      setCharacterCount(snapshot.characterCount);
      setSaveState('unsaved');

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        void flushPendingSave();
      }, SAVE_DEBOUNCE_MS);
    },
    [flushPendingSave],
  );

  const closeModal = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (pendingSnapshotRef.current) {
      void flushPendingSave();
    }
    setIsOpen(false);
    onOpenChange(false);
  }, [flushPendingSave, onOpenChange, setIsOpen]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }
      if (hasUnsavedChanges) {
        setConfirmCloseOpen(true);
        return;
      }
      closeModal();
    },
    [closeModal, hasUnsavedChanges, onOpenChange],
  );

  const handleConfirmClose = useCallback(() => {
    setConfirmCloseOpen(false);
    closeModal();
  }, [closeModal]);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      const content = latestSnapshotRef.current?.html || initialSeed.html || documentData.content || '';
      await exportDocument({
        content,
        fileName,
        format,
      });
    },
    [documentData.content, fileName, initialSeed.html],
  );

  const SaveStateIndicator = () => {
    switch (saveState) {
      case 'saving':
        return (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving...
          </Badge>
        );
      case 'saved':
        return (
          <Badge variant="secondary" className="gap-1">
            <Check className="h-3 w-3" />
            Saved
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            Unsaved changes
          </Badge>
        );
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="h-screen w-screen max-w-[100vw] rounded-none p-0">
          <DialogHeader className="border-b px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2">
                <ZmindLogo size={24} />
                <DialogTitle className="truncate">{fileName}</DialogTitle>
                <SaveStateIndicator />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{wordCount} words</span>
                <span>{characterCount} chars</span>
                <Button size="sm" variant="outline" onClick={() => handleExport('pdf')}>
                  PDF
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleExport('docx')}>
                  DOCX
                </Button>
              </div>
            </div>
          </DialogHeader>
          <div className="h-[calc(100vh-78px)] overflow-hidden p-3">
            <NovelRichTextEditor
              {...getNovelSurfacePreset('document')}
              contentKey={`${filePath}-${documentData?.updated_at || ''}`}
              initialContent={initialSeed}
              autoFocus
              onChange={scheduleSave}
              onSaveHotkey={() => {
                void flushPendingSave();
              }}
              onUploadImage={uploadExpandedEditorImage}
            />
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Closing now may lose recent edits.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClose}>Close anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
