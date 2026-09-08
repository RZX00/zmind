'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDocMutations } from '@/hooks/react-query/docs/use-doc-mutations';
import { useDocQuery } from '@/hooks/react-query/docs/use-doc-query';
import type { NovelEditorSnapshot } from '@/components/editor/novel';
import type { DocContent } from '@/types/doc';

const DOC_AUTOSAVE_DELAY_MS = 700;
const LOCAL_DRAFT_PREFIX = 'docs:local-draft:';

interface LocalDocDraft {
  markdown: string;
  updatedAt: number;
  baseVersion: number;
}

interface RefreshDocFromServerOptions {
  preserveUnsaved?: boolean;
  minVersion?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}

interface RefreshDocFromServerResult {
  refreshed: boolean;
  reason?: 'unsaved_local_changes' | 'stale_after_retry';
  doc?: DocContent;
}

function getDraftKey(itemId: string) {
  return `${LOCAL_DRAFT_PREFIX}${itemId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useDocEditor(itemId: string) {
  const { data, isLoading, error, refetch } = useDocQuery(itemId);
  const { updateDoc, updatingDoc } = useDocMutations();
  const [latestSnapshot, setLatestSnapshot] = useState<NovelEditorSnapshot | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSnapshotRef = useRef<NovelEditorSnapshot | null>(null);
  const currentVersionRef = useRef<number>(1);
  const lastSavedMarkdownRef = useRef<string>('');
  const hasUnsavedChangesRef = useRef(false);
  const [recoveredMarkdown, setRecoveredMarkdown] = useState<string | null>(null);
  const draftRecoveredForRef = useRef<string | null>(null);

  const persistLocalDraft = useCallback((markdown: string) => {
    if (typeof window === 'undefined') return;
    try {
      const payload: LocalDocDraft = {
        markdown,
        updatedAt: Date.now(),
        baseVersion: currentVersionRef.current,
      };
      window.localStorage.setItem(getDraftKey(itemId), JSON.stringify(payload));
    } catch {}
  }, [itemId]);

  const clearLocalDraft = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(getDraftKey(itemId));
    } catch {}
  }, [itemId]);

  useEffect(() => {
    latestSnapshotRef.current = latestSnapshot;
  }, [latestSnapshot]);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    currentVersionRef.current = data?.version || 1;
  }, [data?.version]);

  useEffect(() => {
    initializedRef.current = false;
    latestSnapshotRef.current = null;
    draftRecoveredForRef.current = null;
    setLatestSnapshot(null);
    setRecoveredMarkdown(null);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    lastSavedMarkdownRef.current = data?.contentMd || '';
    setHasUnsavedChanges(false);
    setSaveError(null);
  }, [itemId, data?.contentMd]);

  useEffect(() => {
    if (!data || typeof window === 'undefined') return;
    const draftKey = getDraftKey(itemId);
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as LocalDocDraft;
      const draftMarkdown = typeof parsed?.markdown === 'string' ? parsed.markdown : '';
      const draftUpdatedAt = typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : 0;
      if (!draftMarkdown) {
        window.localStorage.removeItem(draftKey);
        return;
      }
      if (draftMarkdown === data.contentMd) {
        window.localStorage.removeItem(draftKey);
        return;
      }
      if (draftUpdatedAt < (data.updatedAt || 0)) {
        return;
      }
      if (draftRecoveredForRef.current === draftMarkdown) {
        return;
      }
      draftRecoveredForRef.current = draftMarkdown;
      setRecoveredMarkdown(draftMarkdown);
      setHasUnsavedChanges(draftMarkdown !== data.contentMd);
      setSaveError(null);
      toast.info('Recovered unsaved local draft.');
    } catch {}
  }, [data, itemId]);

  const saveSnapshot = useCallback(
    async (snapshot: NovelEditorSnapshot | null) => {
      if (!snapshot) return;
      if (snapshot.markdown === lastSavedMarkdownRef.current) return;
      setIsSaving(true);
      const applySaveSuccess = (version: number) => {
        currentVersionRef.current = version;
        lastSavedMarkdownRef.current = snapshot.markdown;
        setRecoveredMarkdown(snapshot.markdown);
        setLastSavedAt(Date.now());
        setHasUnsavedChanges(false);
        setSaveError(null);
        clearLocalDraft();
      };
      try {
        const result = await updateDoc({
          itemId,
          contentMd: snapshot.markdown,
          ifMatchVersion: currentVersionRef.current,
        });
        applySaveSuccess(result.version);
      } catch (err: any) {
        const status = Number((err as any)?.status || 0);
        if (status === 409) {
          // Optimistic collaborative save:
          // rebase once to latest server version and retry silently.
          const refreshed = await refetch();
          const latest = refreshed.data;
          const latestVersion = Number(latest?.version || 0);
          if (latestVersion > 0) {
            currentVersionRef.current = latestVersion;
          }

          // Another in-flight save already persisted the same content.
          if (latest && latest.contentMd === snapshot.markdown) {
            applySaveSuccess(latestVersion || currentVersionRef.current);
            return;
          }

          if (latestVersion > 0) {
            try {
              const retryResult = await updateDoc({
                itemId,
                contentMd: snapshot.markdown,
                ifMatchVersion: latestVersion,
              });
              applySaveSuccess(retryResult.version);
              return;
            } catch (retryErr: any) {
              const retryStatus = Number((retryErr as any)?.status || 0);
              if (retryStatus === 409) {
                // Keep local draft and wait for next user edit/blur-triggered save.
                setSaveError(null);
                return;
              }
              const retryMessage = retryErr?.message || 'Failed to save document';
              setSaveError(retryMessage);
              toast.error(retryMessage);
              return;
            }
          }

          setSaveError(null);
          return;
        }
        const message = err?.message || 'Failed to save document';
        setSaveError(message);
        toast.error(message);
      } finally {
        setIsSaving(false);
      }
    },
    [clearLocalDraft, itemId, refetch, updateDoc],
  );

  const scheduleSave = useCallback(
    (snapshot: NovelEditorSnapshot) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void saveSnapshot(snapshot);
      }, DOC_AUTOSAVE_DELAY_MS);
    },
    [saveSnapshot],
  );

  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await saveSnapshot(latestSnapshotRef.current);
  }, [saveSnapshot]);

  const requestFlushSave = useCallback(() => {
    void flushSave();
  }, [flushSave]);

  const refreshFromServer = useCallback(
    async (
      options?: RefreshDocFromServerOptions,
    ): Promise<RefreshDocFromServerResult> => {
      const preserveUnsaved = options?.preserveUnsaved ?? true;
      const minVersion =
        typeof options?.minVersion === 'number' && Number.isFinite(options.minVersion)
          ? options.minVersion
          : undefined;
      const maxAttempts = Math.max(1, Math.min(10, options?.maxAttempts ?? 6));
      const retryDelayMs = Math.max(50, Math.min(2_000, options?.retryDelayMs ?? 250));
      const snapshot = latestSnapshotRef.current;
      const hasPendingLocalSnapshot = Boolean(
        snapshot && snapshot.markdown !== lastSavedMarkdownRef.current,
      );
      const hasPendingLocalChanges =
        hasUnsavedChangesRef.current || hasPendingLocalSnapshot;

      if (preserveUnsaved && hasPendingLocalChanges) {
        return {
          refreshed: false,
          reason: 'unsaved_local_changes',
          doc: data,
        };
      }

      let latestDoc: DocContent | undefined = data;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const queryResult = await refetch();
        latestDoc = queryResult.data ?? latestDoc;
        if (!latestDoc) {
          if (attempt < maxAttempts) {
            await sleep(retryDelayMs);
            continue;
          }
          return { refreshed: true };
        }
        if (minVersion == null || latestDoc.version >= minVersion) {
          return {
            refreshed: true,
            doc: latestDoc,
          };
        }
        if (attempt < maxAttempts) {
          await sleep(retryDelayMs);
        }
      }

      return {
        refreshed: false,
        reason: 'stale_after_retry',
        doc: latestDoc,
      };
    },
    [data, refetch],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        requestFlushSave();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', requestFlushSave);
    window.addEventListener('beforeunload', requestFlushSave);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', requestFlushSave);
      window.removeEventListener('beforeunload', requestFlushSave);
      requestFlushSave();
    };
  }, [requestFlushSave]);

  const handleSnapshotChange = useCallback(
    (snapshot: NovelEditorSnapshot) => {
      setLatestSnapshot(snapshot);
      latestSnapshotRef.current = snapshot;
      setHasUnsavedChanges(snapshot.markdown !== lastSavedMarkdownRef.current);
      setSaveError(null);
      if (!initializedRef.current) {
        initializedRef.current = true;
        return;
      }
      persistLocalDraft(snapshot.markdown);
      scheduleSave(snapshot);
    },
    [persistLocalDraft, scheduleSave],
  );

  const handleSnapshotBlur = useCallback(
    async (snapshot: NovelEditorSnapshot) => {
      setLatestSnapshot(snapshot);
      latestSnapshotRef.current = snapshot;
      setHasUnsavedChanges(snapshot.markdown !== lastSavedMarkdownRef.current);
      setSaveError(null);
      persistLocalDraft(snapshot.markdown);
      await flushSave();
    },
    [flushSave, persistLocalDraft],
  );

  const editorSeed = useMemo(
    () => ({
      markdown: recoveredMarkdown ?? data?.contentMd ?? '',
    }),
    [data?.contentMd, recoveredMarkdown],
  );

  return {
    doc: data,
    loading: isLoading,
    error,
    updatingDoc,
    isSaving,
    lastSavedAt,
    hasUnsavedChanges,
    saveError,
    editorSeed,
    handleSnapshotChange,
    handleSnapshotBlur,
    flushSave,
    refreshFromServer,
  };
}
