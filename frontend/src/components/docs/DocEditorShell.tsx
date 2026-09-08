'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, PanelRight } from 'lucide-react';
import { marked } from 'marked';
import { toast } from 'sonner';
import {
  NovelRichTextEditor,
  getNovelSurfacePreset,
  type NovelAiRequest,
  type NovelAiOption,
} from '@/components/editor/novel';
import { useDocEditor } from '@/components/docs/hooks/useDocEditor';
import { useDocMutations } from '@/hooks/react-query/docs/use-doc-mutations';
import { uploadNovelEditorImage } from '@/canvas/infrastructure/expanded-editor/novel-image-upload.adapter';
import TopBar from '@/canvas/components/shared/toolbar/TopBar';
import DocAIPanel, { type DocEditorBridge } from '@/components/docs/DocAIPanel';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { EditorInstance } from 'novel';
import { addUserMessage, ensureDocThread, getAgentStatus, getMessages, startAgent } from '@/lib/api';
import { useModelSelection } from '@/hooks/use-model-selection';

const DOC_TITLE_AUTOSAVE_DELAY_MS = 450;
const DEFAULT_DOC_TITLE = 'Untitled Doc';
const RIGHT_PANEL_DEFAULT_WIDTH = 440;
const DOC_EDITOR_CONTENT_MAX_WIDTH = 980;
const DOC_INLINE_AI_TIMEOUT_MS = 90_000;
const DOC_INLINE_AI_POLL_INTERVAL_MS = 1200;
const DOC_INLINE_AI_MODEL = 'gemini-3-flash';

const DOC_INLINE_PROMPTS: Record<NovelAiOption, string> = {
  zap: 'Rewrite or generate text based on the instruction.',
  improve: 'Improve clarity, logic, and readability while preserving intent.',
  fix: 'Fix grammar and wording while preserving meaning.',
  shorter: 'Rewrite this to be shorter and more concise.',
  longer: 'Expand this with more details and stronger structure.',
  continue: 'Continue writing in the same tone and context.',
};

function toMarkdown(editor: EditorInstance): string {
  const markdownFromStorage = (editor as any)?.storage?.markdown?.getMarkdown?.();
  if (typeof markdownFromStorage === 'string') {
    return markdownFromStorage;
  }
  return editor.getText() || '';
}

function getSelectionMarkdown(editor: EditorInstance): string {
  try {
    const selection = editor.state.selection.content();
    const markdownSerializer = (editor as any)?.storage?.markdown?.serializer;
    if (markdownSerializer?.serialize) {
      return markdownSerializer.serialize(selection.content);
    }
  } catch {}
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, '\n');
}

function markdownToHtml(markdown: string): string {
  try {
    const rendered = marked.parse(markdown || '');
    return typeof rendered === 'string' ? rendered : String(rendered);
  } catch {
    return markdown;
  }
}

function buildInlinePrompt(request: NovelAiRequest): string {
  const instruction = DOC_INLINE_PROMPTS[request.option] || DOC_INLINE_PROMPTS.zap;
  const parts: string[] = [instruction];
  const command = request.command?.trim();
  if (command) {
    parts.push(`Additional instruction:\n${command}`);
  }
  if (request.previousCompletion?.trim()) {
    parts.push(`Previous draft:\n${request.previousCompletion.trim()}`);
  }
  return parts.join('\n\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractContentText(raw: unknown): string {
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return '';
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed?.content === 'string') return parsed.content.trim();
      return text;
    } catch {
      return text;
    }
  }
  if (raw && typeof raw === 'object') {
    const maybeContent = (raw as any).content;
    if (typeof maybeContent === 'string') return maybeContent.trim();
  }
  return '';
}

interface DocEditorShellProps {
  itemId: string;
  className?: string;
}

export default function DocEditorShell({ itemId, className }: DocEditorShellProps) {
  const isMobileView = useIsMobile();
  const { selectedModel } = useModelSelection();
  const { renameDoc, renamingDoc } = useDocMutations();
  const {
    doc,
    loading,
    error,
    isSaving,
    lastSavedAt,
    hasUnsavedChanges,
    saveError,
    editorSeed,
    handleSnapshotChange,
    handleSnapshotBlur,
    flushSave,
    refreshFromServer,
  } = useDocEditor(itemId);
  const editorRef = useRef<EditorInstance | null>(null);

  const [titleDraft, setTitleDraft] = useState<string>(DEFAULT_DOC_TITLE);
  const [isTitleDirty, setIsTitleDirty] = useState(false);
  const [titleSaveError, setTitleSaveError] = useState<string | null>(null);
  const titleSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleDraftRef = useRef<string>(DEFAULT_DOC_TITLE);
  const lastSavedTitleRef = useRef<string>(DEFAULT_DOC_TITLE);

  const [mobileRightPanelOpen, setMobileRightPanelOpen] = useState(false);
  const [desktopRightPanelCollapsed, setDesktopRightPanelCollapsed] = useState(false);

  useEffect(() => {
    const normalized = (doc?.title || '').trim() || DEFAULT_DOC_TITLE;
    setTitleDraft(normalized);
    titleDraftRef.current = normalized;
    lastSavedTitleRef.current = normalized;
    setIsTitleDirty(false);
    setTitleSaveError(null);
    if (titleSaveTimerRef.current) {
      clearTimeout(titleSaveTimerRef.current);
      titleSaveTimerRef.current = null;
    }
  }, [doc?.title, itemId]);

  const persistDocTitle = useCallback(async (rawTitle: string) => {
    const normalized = rawTitle.trim() || DEFAULT_DOC_TITLE;
    titleDraftRef.current = normalized;
    setTitleDraft(normalized);
    if (normalized === lastSavedTitleRef.current) {
      setIsTitleDirty(false);
      setTitleSaveError(null);
      return;
    }
    try {
      await renameDoc({ itemId, title: normalized });
      lastSavedTitleRef.current = normalized;
      setIsTitleDirty(false);
      setTitleSaveError(null);
    } catch (err: any) {
      const message = err?.message || 'Failed to update title';
      setTitleSaveError(message);
      toast.error(message);
      setTitleDraft(lastSavedTitleRef.current || DEFAULT_DOC_TITLE);
      setIsTitleDirty(false);
    }
  }, [itemId, renameDoc]);

  const scheduleTitleSave = useCallback((nextTitle: string) => {
    if (titleSaveTimerRef.current) {
      clearTimeout(titleSaveTimerRef.current);
    }
    titleSaveTimerRef.current = setTimeout(() => {
      titleSaveTimerRef.current = null;
      void persistDocTitle(nextTitle);
    }, DOC_TITLE_AUTOSAVE_DELAY_MS);
  }, [persistDocTitle]);

  const flushTitleSave = useCallback(async () => {
    if (titleSaveTimerRef.current) {
      clearTimeout(titleSaveTimerRef.current);
      titleSaveTimerRef.current = null;
    }
    await persistDocTitle(titleDraftRef.current);
  }, [persistDocTitle]);

  const handleTitleCommit = useCallback((title: string) => {
    titleDraftRef.current = title;
    setTitleDraft(title);
    setIsTitleDirty(true);
    setTitleSaveError(null);
    scheduleTitleSave(title);
  }, [scheduleTitleSave]);

  const requestFlushTitleSave = useCallback(() => {
    void flushTitleSave();
  }, [flushTitleSave]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        requestFlushTitleSave();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', requestFlushTitleSave);
    window.addEventListener('beforeunload', requestFlushTitleSave);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', requestFlushTitleSave);
      window.removeEventListener('beforeunload', requestFlushTitleSave);
      requestFlushTitleSave();
    };
  }, [requestFlushTitleSave]);

  const flushPendingSaves = useCallback(async () => {
    await flushTitleSave();
    await flushSave();
  }, [flushSave, flushTitleSave]);

  const handleRetrySave = useCallback(() => {
    void flushPendingSaves();
  }, [flushPendingSaves]);

  const handleTopBarRightPanelToggle = useCallback(() => {
    if (isMobileView) {
      setMobileRightPanelOpen((prev) => !prev);
      return;
    }
    setDesktopRightPanelCollapsed((prev) => !prev);
  }, [isMobileView]);

  const openMobileRightPanel = useCallback(() => {
    setMobileRightPanelOpen(true);
  }, []);

  const handleEditorReady = useCallback((editor: EditorInstance | null) => {
    editorRef.current = editor;
  }, []);

  const editorBridge = useMemo<DocEditorBridge>(() => ({
    hasSelection: () => {
      const editor = editorRef.current;
      if (!editor) return false;
      return !editor.state.selection.empty;
    },
    getSelectionMarkdown: () => {
      const editor = editorRef.current;
      if (!editor) return '';
      return getSelectionMarkdown(editor);
    },
    getDocumentMarkdown: () => {
      const editor = editorRef.current;
      if (!editor) return '';
      return toMarkdown(editor);
    },
  }), []);

  const handleBeforeAgentRun = useCallback(async () => {
    await flushPendingSaves();
  }, [flushPendingSaves]);

  const handleDocMutationApplied = useCallback(async (event: {
    toolName: 'doc_apply_ops' | 'doc_undo_revision' | 'doc_update_title' | 'doc_generate_image_and_insert';
    version?: number;
  }) => {
    try {
      const isTitleMutation = event.toolName === 'doc_update_title';
      const result = await refreshFromServer({
        preserveUnsaved: !isTitleMutation,
        minVersion: isTitleMutation ? undefined : event.version,
      });
      if (!result.refreshed && result.reason === 'unsaved_local_changes') {
        toast.info('AI updated this document. Save your local draft to sync latest changes.');
        return;
      }
      if (!result.refreshed && result.reason === 'stale_after_retry') {
        toast.warning('AI update completed, but latest version is still syncing. Please retry in a moment.');
        return;
      }
      if (isTitleMutation) {
        return;
      }

      const editor = editorRef.current;
      const latestMarkdown = result.doc?.contentMd;
      if (!editor || typeof latestMarkdown !== 'string') {
        return;
      }

      const currentMarkdown = toMarkdown(editor);
      if (currentMarkdown === latestMarkdown) {
        return;
      }

      const nextHtml = markdownToHtml(latestMarkdown);
      editor.commands.setContent(nextHtml, false);
    } catch (error) {
      console.error('[DocEditorShell] failed to refresh doc after AI mutation:', error);
      toast.error('AI update succeeded, but the document refresh failed. Please reload.');
    }
  }, [refreshFromServer]);

  const handleInlineAiGenerate = useCallback(async (request: NovelAiRequest): Promise<string> => {
    const thread = await ensureDocThread(itemId);
    const threadId = thread.thread_id;
    const existingMessages = await getMessages(threadId);
    const existingMessageIds = new Set(
      (existingMessages as any[])
        .map((message: any) => (typeof message?.message_id === 'string' ? message.message_id : ''))
        .filter(Boolean),
    );

    const selectionMarkdown = (request.selectionMarkdown || '').trim() || editorBridge.getSelectionMarkdown().trim();
    const documentMarkdown = editorBridge.getDocumentMarkdown();
    const documentExcerpt = documentMarkdown.slice(0, 12000);
    const docContext = {
      surface: 'doc',
      mode: selectionMarkdown ? 'selection' : 'document',
      doc_item_id: itemId,
      doc_title: titleDraft || DEFAULT_DOC_TITLE,
      ...(selectionMarkdown
        ? {
            selection: {
              markdown: selectionMarkdown.slice(0, 8000),
              char_count: selectionMarkdown.length,
              truncated: selectionMarkdown.length > 8000,
            },
          }
        : {}),
      ...(documentExcerpt
        ? {
            document: {
              excerpt: documentExcerpt,
              char_count: documentExcerpt.length,
              truncated: documentMarkdown.length > documentExcerpt.length,
            },
          }
        : {}),
    };

    const prompt = buildInlinePrompt(request);
    await addUserMessage(
      threadId,
      prompt,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      docContext,
    );

    const run = await startAgent(threadId, {
      model_name: selectedModel || DOC_INLINE_AI_MODEL,
      stream: false,
      run_mode: 'chat',
      interaction_surface: 'doc',
      agent_id: undefined,
    });

    const deadline = Date.now() + DOC_INLINE_AI_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const status = await getAgentStatus(run.agent_run_id);
      const normalizedStatus = String(status.status || '').toLowerCase();
      if (normalizedStatus === 'completed' || normalizedStatus === 'stopped') {
        break;
      }
      if (normalizedStatus === 'error' || normalizedStatus === 'failed') {
        throw new Error(status.error || 'AI generation failed');
      }
      await sleep(DOC_INLINE_AI_POLL_INTERVAL_MS);
    }

    if (Date.now() >= deadline) {
      throw new Error('AI generation timeout');
    }

    const finalMessages = await getMessages(threadId);
    const newAssistants = (finalMessages as any[])
      .filter((message: any) => message?.type === 'assistant' && !existingMessageIds.has(String(message?.message_id || '')))
      .sort((a: any, b: any) => {
        const at = a?.created_at ? Date.parse(a.created_at) : 0;
        const bt = b?.created_at ? Date.parse(b.created_at) : 0;
        return bt - at;
      });

    for (const message of newAssistants) {
      const text = extractContentText(message?.content);
      if (text) return text;
    }

    const fallbackAssistants = (finalMessages as any[])
      .filter((message: any) => message?.type === 'assistant')
      .sort((a: any, b: any) => {
        const at = a?.created_at ? Date.parse(a.created_at) : 0;
        const bt = b?.created_at ? Date.parse(b.created_at) : 0;
        return bt - at;
      });
    for (const message of fallbackAssistants) {
      const text = extractContentText(message?.content);
      if (text) return text;
    }

    throw new Error('AI returned empty response');
  }, [itemId, editorBridge, titleDraft, selectedModel]);

  const combinedSaveError = titleSaveError || saveError || null;
  const effectiveDirty = hasUnsavedChanges || isTitleDirty;
  const effectiveSaveState: 'idle' | 'saving' | 'error' =
    isSaving || renamingDoc
      ? 'saving'
      : combinedSaveError
        ? 'error'
        : 'idle';

  const desktopPanelWidth = `${RIGHT_PANEL_DEFAULT_WIDTH}px`;
  const desktopPanelOpen = !desktopRightPanelCollapsed;

  if (loading) {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <div className="rounded-xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground">
          Failed to load doc.
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative flex h-full min-h-0 gap-1.5 overflow-hidden p-1.5', className)}>
      <div
        className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm transition-[margin-right] duration-[340ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          marginRight: !isMobileView && desktopPanelOpen ? `calc(${desktopPanelWidth} + 6px)` : '0px',
        }}
      >
        <TopBar
          className="playback-hideable"
          documentTitle={titleDraft}
          isDirty={effectiveDirty}
          saveState={effectiveSaveState}
          saveError={combinedSaveError}
          lastDraftSavedAt={lastSavedAt}
          onRetrySave={handleRetrySave}
          onDocumentTitleChange={handleTitleCommit}
          rightPanelCollapsed={isMobileView ? !mobileRightPanelOpen : desktopRightPanelCollapsed}
          onRightPanelToggle={handleTopBarRightPanelToggle}
        />

        <div className="relative flex flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 min-w-0 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(148,163,184,0.10),transparent_48%)] px-3 py-3 md:px-5 md:py-4 dark:bg-[radial-gradient(circle_at_top,rgba(148,163,184,0.14),transparent_54%)]">
            <div
              className="mx-auto h-full w-full"
              style={{ maxWidth: `${DOC_EDITOR_CONTENT_MAX_WIDTH}px` }}
            >
              <div className="h-full overflow-hidden rounded-2xl border border-border/70 bg-card/95">
                <NovelRichTextEditor
                  {...getNovelSurfacePreset('document')}
                  contentKey={itemId}
                  initialContent={editorSeed}
                  autoFocus
                  onEditorReady={handleEditorReady}
                  onChange={handleSnapshotChange}
                  onBlur={handleSnapshotBlur}
                  onAiGenerate={handleInlineAiGenerate}
                  onSaveHotkey={() => {
                    void flushPendingSaves();
                  }}
                  onUploadImage={(file) => uploadNovelEditorImage(file, 'doc')}
                />
              </div>
            </div>
          </div>

          {isMobileView && !mobileRightPanelOpen && (
            <button
              type="button"
              className="absolute right-3 top-3 z-[53] inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/85 text-foreground shadow-md backdrop-blur-sm"
              aria-label="Open side panel"
              onClick={openMobileRightPanel}
            >
              <PanelRight className="h-4 w-4" />
            </button>
          )}

          {isMobileView && (
            <Sheet open={mobileRightPanelOpen} onOpenChange={setMobileRightPanelOpen}>
              <SheetContent
                side="bottom"
                className="h-[72vh] max-h-[calc(100vh-80px)] rounded-t-3xl border-t border-border bg-background/95 backdrop-blur-sm p-0 gap-0"
              >
                <SheetHeader className="px-4 pb-2 pt-4">
                  <SheetTitle className="text-sm font-semibold">Workspace Side Panel</SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-hidden px-3 pb-3 pt-1">
                  <div className="h-full rounded-[var(--canvas-panel-radius)] border border-border/60 bg-card overflow-hidden">
                    <DocAIPanel
                      itemId={itemId}
                      docTitle={titleDraft}
                      editorBridge={editorBridge}
                      onBeforeAgentRun={handleBeforeAgentRun}
                      onDocMutationApplied={handleDocMutationApplied}
                      className="h-full"
                      onClosePanel={() => setMobileRightPanelOpen(false)}
                    />
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </div>

      {!isMobileView && (
        <div
          className="pointer-events-none absolute inset-y-1.5 right-1.5 z-[56]"
          style={{ width: desktopPanelWidth }}
        >
          <aside
            className={`pointer-events-auto absolute inset-y-0 right-0 flex h-full flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm transform-gpu transition-transform duration-[340ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
              desktopPanelOpen
                ? 'translate-x-0'
                : 'translate-x-[calc(100%+12px)] pointer-events-none'
            }`}
            style={{ width: desktopPanelWidth }}
            aria-hidden={!desktopPanelOpen}
          >
            <div className="min-h-0 flex-1 px-2 pb-2 pt-1">
              <div className="h-full overflow-hidden rounded-[var(--canvas-panel-radius)] bg-card">
                <DocAIPanel
                  itemId={itemId}
                  docTitle={titleDraft}
                  editorBridge={editorBridge}
                  onBeforeAgentRun={handleBeforeAgentRun}
                  onDocMutationApplied={handleDocMutationApplied}
                  className="h-full"
                  onClosePanel={() => setDesktopRightPanelCollapsed(true)}
                />
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
