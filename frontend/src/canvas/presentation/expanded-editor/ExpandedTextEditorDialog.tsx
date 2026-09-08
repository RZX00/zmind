'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Expand, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  NovelRichTextEditor,
  getNovelSurfacePreset,
  type NovelAiRequest,
  type NovelEditorSnapshot,
} from '@/components/editor/novel';
import type { CanvasNode } from '../../types/canvas';
import { openExpandedEditorUseCase } from '../../application/expanded-editor/open-expanded-editor.usecase';
import {
  saveExpandedEditorUseCase,
  type SaveExpandedEditorResult,
} from '../../application/expanded-editor/save-expanded-editor.usecase';
import { CanvasSelectionAiAdapter } from '../../infrastructure/expanded-editor/canvas-selection-ai.adapter';
import { uploadExpandedEditorImage } from '../../infrastructure/expanded-editor/novel-image-upload.adapter';
import { requestExpandedEditorAiCompletionUseCase } from '../../application/expanded-editor/request-ai-completion.usecase';

const EXPANDED_EDITOR_CONTENT_MAX_WIDTH = 980;

interface ExpandedTextEditorDialogProps {
  open: boolean;
  node: CanvasNode | null;
  canvasId?: string;
  onOpenChange: (open: boolean) => void;
  onSave: (nodeId: string, result: SaveExpandedEditorResult) => void;
}

export function ExpandedTextEditorDialog({
  open,
  node,
  canvasId,
  onOpenChange,
  onSave,
}: ExpandedTextEditorDialogProps) {
  const t = useTranslations();
  const [latestSnapshot, setLatestSnapshot] = useState<NovelEditorSnapshot | null>(null);
  const initializedRef = useRef(false);
  const latestSnapshotRef = useRef<NovelEditorSnapshot | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSignatureRef = useRef<string>('');

  const openState = useMemo(() => {
    if (!node) return null;
    return openExpandedEditorUseCase(node);
  }, [node]);

  useEffect(() => {
    initializedRef.current = false;
    setLatestSnapshot(null);
    latestSnapshotRef.current = null;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    lastSavedSignatureRef.current = '';
  }, [openState?.nodeId, open]);

  useEffect(() => {
    latestSnapshotRef.current = latestSnapshot;
  }, [latestSnapshot]);

  const aiGateway = useMemo(() => {
    if (!canvasId) return null;
    return new CanvasSelectionAiAdapter(canvasId);
  }, [canvasId]);

  const handleAiGenerate = useCallback(
    async (request: NovelAiRequest) => {
      if (!aiGateway) {
        throw new Error(t('canvas.node.text.expanded.aiUnavailable', { default: 'AI is unavailable: missing canvas context' }));
      }
      return await requestExpandedEditorAiCompletionUseCase(aiGateway, request);
    },
    [aiGateway, t],
  );

  const persistSnapshot = useCallback(
    (snapshot: NovelEditorSnapshot | null) => {
      if (!node || !snapshot) return;
      const signature = `${snapshot.markdown}\u0000${snapshot.html}\u0000${JSON.stringify(snapshot.json || null)}`;
      if (signature === lastSavedSignatureRef.current) {
        return;
      }
      const result = saveExpandedEditorUseCase(node, {
        markdown: snapshot.markdown,
        html: snapshot.html,
        json: snapshot.json,
      });
      onSave(node.id, result);
      lastSavedSignatureRef.current = signature;
    },
    [node, onSave],
  );

  const flushAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    persistSnapshot(latestSnapshotRef.current);
  }, [persistSnapshot]);

  useEffect(() => {
    if (!open) return;
    if (!latestSnapshot) return;
    if (!initializedRef.current) return;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    autoSaveTimerRef.current = setTimeout(() => {
      persistSnapshot(latestSnapshot);
      autoSaveTimerRef.current = null;
    }, 600);
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [latestSnapshot, open, persistSnapshot]);

  const handleManualSave = useCallback(() => {
    flushAutoSave();
  }, [flushAutoSave]);

  const requestClose = useCallback(() => {
    flushAutoSave();
    onOpenChange(false);
  }, [flushAutoSave, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, requestClose]);

  if (!open || !node || !openState) return null;

  return (
    <div className="absolute inset-0 z-[80]">
      <div className="absolute inset-0 bg-black/35 backdrop-blur-sm" />
      <div className="absolute inset-0 flex flex-col bg-background text-foreground shadow-2xl">
        <header className="border-b border-border/60 bg-background/82 px-6 py-4 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-border/70 bg-card/80 p-2">
                <Expand className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold">{openState.title}</h2>
                <p className="text-xs text-muted-foreground">
                  {t('canvas.node.text.expanded.subtitle', {
                    default: 'Write with full focus. Changes are saved automatically.',
                  })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground md:inline">
                {t('canvas.node.text.expanded.autosave', { default: 'Auto save on' })}
              </span>
              <Button variant="ghost" size="sm" onClick={requestClose}>
                <X className="h-4 w-4" />
                {t('canvas.node.text.expanded.close', { default: 'Close' })}
              </Button>
            </div>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(148,163,184,0.10),transparent_48%)] px-4 py-3 md:px-5 md:py-4 dark:bg-[radial-gradient(circle_at_top,rgba(148,163,184,0.14),transparent_54%)]">
          <div
            className="mx-auto h-full w-full"
            style={{ maxWidth: `${EXPANDED_EDITOR_CONTENT_MAX_WIDTH}px` }}
          >
            <div className="h-full overflow-hidden rounded-2xl border border-border/70 bg-card/95">
              <NovelRichTextEditor
                {...getNovelSurfacePreset('document')}
                contentKey={openState.nodeId}
                initialContent={{
                  markdown: openState.markdown,
                  html: openState.html,
                  json: openState.json,
                }}
                autoFocus
                onChange={(snapshot) => {
                  setLatestSnapshot(snapshot);
                  if (!initializedRef.current) {
                    initializedRef.current = true;
                    return;
                  }
                }}
                onSaveHotkey={handleManualSave}
                onAiGenerate={aiGateway ? handleAiGenerate : undefined}
                onUploadImage={uploadExpandedEditorImage}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
