import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  NovelRichTextEditor,
  getNovelSurfacePreset,
  type NovelAiRequest,
  type NovelEditorSnapshot,
} from '@/components/editor/novel';
import type { CanvasNode, FontStyle, NodeStyles, CornerStyle } from '../../types/canvas';
import { useTextLayoutPreset } from '../../hooks/useTextNodePresets';
import { openExpandedEditorUseCase } from '../../application/expanded-editor/open-expanded-editor.usecase';
import { uploadExpandedEditorImage } from '../../infrastructure/expanded-editor/novel-image-upload.adapter';
import {
  buildInlineTypographyCssVariables,
  resolveTextTypographyTokens,
} from '../../domain/text-layout/textTypographyTokens';

const SNAPSHOT_PERSIST_DELAY_MS = 450;
const INLINE_CONTENT_COMMIT_DELAY_MS = 160;
const INLINE_HEIGHT_MEASURE_MIN_INTERVAL_MS = 50;

type TextNodeType = CanvasNode & { type: 'text' };

interface TextNodeEditorProps {
  node: TextNodeType;
  editing?: boolean;
  fontStyle?: FontStyle;
  nodeStyles?: NodeStyles;
  cornerStyle?: CornerStyle;
  onContentChange?: (nodeId: string, content: string) => void;
  onEditToggle?: (nodeId: string, editing: boolean) => void;
  onSizeChange?: (nodeId: string, size: { width: number; height: number }) => void;
  onRequestExpandedEdit?: (nodeId: string) => void;
  autoSizeEnabled?: boolean;
  onAutoSizeModeChange?: (nodeId: string, mode: 'auto' | 'manual') => void;
  onRichSnapshotPersist?: (nodeId: string, snapshot: NovelEditorSnapshot) => void;
  onAiGenerate?: (request: NovelAiRequest) => Promise<string>;
}

export const TextNodeEditor: React.FC<TextNodeEditorProps> = ({
  node,
  editing = false,
  fontStyle,
  nodeStyles,
  onContentChange,
  onSizeChange,
  autoSizeEnabled,
  onAutoSizeModeChange,
  onRichSnapshotPersist,
  onAiGenerate,
}) => {
  const textLayoutPreset = useTextLayoutPreset();
  const layoutPadding = textLayoutPreset.metrics.padding;
  const textStyles = nodeStyles?.textStyles || {};
  const bgColor = (textStyles as any).backgroundColor || 'transparent';
  const typography = useMemo(
    () => resolveTextTypographyTokens({ fontStyle, nodeStyles }),
    [fontStyle, nodeStyles],
  );
  const inlineTypographyVars = useMemo(
    () => buildInlineTypographyCssVariables(typography),
    [typography],
  );
  const latestSnapshotRef = useRef<NovelEditorSnapshot | null>(null);
  const lastSyncedMarkdownRef = useRef('');
  const initializedRef = useRef(false);
  const autoModeRaisedRef = useRef(false);
  const onRichSnapshotPersistRef = useRef<typeof onRichSnapshotPersist>(onRichSnapshotPersist);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMarkdownRef = useRef<string | null>(null);
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const measureRafRef = useRef<number | null>(null);
  const lastHeightMeasureAtRef = useRef(0);
  const lastMeasuredHeightRef = useRef(node.height);
  const initialSeedRef = useRef<{
    nodeId: string;
    state: ReturnType<typeof openExpandedEditorUseCase>;
  } | null>(null);

  // Seed editor content once per editing session (node id).
  // Do not re-derive from live node updates, otherwise EditorContent may reinitialize
  // and cause update loops while typing.
  if (!initialSeedRef.current || initialSeedRef.current.nodeId !== node.id) {
    initialSeedRef.current = {
      nodeId: node.id,
      state: openExpandedEditorUseCase(node),
    };
  }
  const openState = initialSeedRef.current.state;

  useEffect(() => {
    onRichSnapshotPersistRef.current = onRichSnapshotPersist;
  }, [onRichSnapshotPersist]);

  useEffect(() => {
    initializedRef.current = false;
    autoModeRaisedRef.current = false;
    latestSnapshotRef.current = null;
    lastSyncedMarkdownRef.current = openState.markdown || '';
    pendingMarkdownRef.current = null;
    lastHeightMeasureAtRef.current = 0;
  }, [node.id, openState.markdown]);

  useEffect(() => {
    lastMeasuredHeightRef.current = node.height;
  }, [node.height, node.id]);

  const persistSnapshot = useCallback(
    (snapshot: NovelEditorSnapshot | null) => {
      if (!snapshot) return;
      const persist = onRichSnapshotPersistRef.current;
      if (!persist) return;
      persist(node.id, snapshot);
    },
    [node.id],
  );

  const commitMarkdown = useCallback(
    (markdown: string) => {
      if (markdown === lastSyncedMarkdownRef.current) return;
      lastSyncedMarkdownRef.current = markdown;
      onContentChange?.(node.id, markdown);
    },
    [node.id, onContentChange],
  );

  const flushMarkdownCommit = useCallback(
    (fallbackMarkdown?: string) => {
      if (contentCommitTimerRef.current) {
        clearTimeout(contentCommitTimerRef.current);
        contentCommitTimerRef.current = null;
      }
      const markdown = pendingMarkdownRef.current ?? fallbackMarkdown;
      pendingMarkdownRef.current = null;
      if (typeof markdown === 'string') {
        commitMarkdown(markdown);
      }
    },
    [commitMarkdown],
  );

  const scheduleMarkdownCommit = useCallback(
    (markdown: string) => {
      pendingMarkdownRef.current = markdown;
      if (contentCommitTimerRef.current) {
        clearTimeout(contentCommitTimerRef.current);
      }
      contentCommitTimerRef.current = setTimeout(() => {
        contentCommitTimerRef.current = null;
        const pending = pendingMarkdownRef.current;
        pendingMarkdownRef.current = null;
        if (typeof pending === 'string') {
          commitMarkdown(pending);
        }
      }, INLINE_CONTENT_COMMIT_DELAY_MS);
    },
    [commitMarkdown],
  );

  const measureInlineEditorHeightNow = useCallback(() => {
    if (!editing || autoSizeEnabled === false || !onSizeChange) return;
    const rootEl = editorRootRef.current;
    if (!rootEl) return;
    const contentEl = rootEl.querySelector('.novel-editor-content') as HTMLElement | null;
    if (!contentEl) return;

    const contentHeight = Math.ceil(contentEl.scrollHeight);
    const minHeight = textLayoutPreset.metrics.minHeight;
    const maxHeight = typeof window !== 'undefined' ? Math.floor(window.innerHeight * 0.9) : 1000;
    const targetHeight = Math.max(
      minHeight,
      Math.min(maxHeight, Math.ceil(4 + layoutPadding * 2 + contentHeight)),
    );

    if (Math.abs(targetHeight - node.height) <= 1 && Math.abs(targetHeight - lastMeasuredHeightRef.current) <= 1) {
      return;
    }

    lastMeasuredHeightRef.current = targetHeight;
    onSizeChange(node.id, { width: node.width, height: targetHeight });
  }, [
    autoSizeEnabled,
    editing,
    layoutPadding,
    node.height,
    node.id,
    node.width,
    onSizeChange,
    textLayoutPreset.metrics.minHeight,
  ]);

  const scheduleInlineHeightMeasure = useCallback(
    (force = false) => {
      if (measureRafRef.current != null) return;
      measureRafRef.current = requestAnimationFrame(() => {
        measureRafRef.current = null;
        const now =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        if (!force && now - lastHeightMeasureAtRef.current < INLINE_HEIGHT_MEASURE_MIN_INTERVAL_MS) {
          return;
        }
        lastHeightMeasureAtRef.current = now;
        measureInlineEditorHeightNow();
      });
    },
    [measureInlineEditorHeightNow],
  );

  const flushSnapshot = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    persistSnapshot(latestSnapshotRef.current);
  }, [persistSnapshot]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      if (contentCommitTimerRef.current) {
        clearTimeout(contentCommitTimerRef.current);
        contentCommitTimerRef.current = null;
      }
      if (measureRafRef.current != null) {
        cancelAnimationFrame(measureRafRef.current);
        measureRafRef.current = null;
      }
      flushMarkdownCommit();
      persistSnapshot(latestSnapshotRef.current);
    };
  }, [flushMarkdownCommit, persistSnapshot]);

  useEffect(() => {
    if (editing) return;
    flushMarkdownCommit();
    flushSnapshot();
  }, [editing, flushMarkdownCommit, flushSnapshot]);

  useEffect(() => {
    if (!editing || autoSizeEnabled === false) return;
    const rootEl = editorRootRef.current;
    if (!rootEl) return;
    const contentEl = rootEl.querySelector('.novel-editor-content') as HTMLElement | null;
    if (!contentEl) {
      const timer = window.setTimeout(() => scheduleInlineHeightMeasure(true), 0);
      return () => window.clearTimeout(timer);
    }

    const observer = new ResizeObserver(() => {
      scheduleInlineHeightMeasure();
    });
    observer.observe(contentEl);
    scheduleInlineHeightMeasure(true);

    return () => {
      observer.disconnect();
    };
  }, [autoSizeEnabled, editing, node.id, scheduleInlineHeightMeasure]);

  const scheduleSnapshotPersist = useCallback(
    (snapshot: NovelEditorSnapshot) => {
      latestSnapshotRef.current = snapshot;
      if (!onRichSnapshotPersistRef.current) return;
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        persistSnapshot(snapshot);
      }, SNAPSHOT_PERSIST_DELAY_MS);
    },
    [persistSnapshot],
  );

  const handleSnapshotChange = useCallback(
    (snapshot: NovelEditorSnapshot) => {
      latestSnapshotRef.current = snapshot;

      // Skip bootstrap emission to avoid feedback loops on editor mount.
      if (!initializedRef.current) {
        initializedRef.current = true;
        return;
      }

      if (!autoModeRaisedRef.current) {
        autoModeRaisedRef.current = true;
        onAutoSizeModeChange?.(node.id, 'auto');
      }

      if (snapshot.markdown !== lastSyncedMarkdownRef.current) {
        scheduleMarkdownCommit(snapshot.markdown);
      }

      scheduleInlineHeightMeasure();
      scheduleSnapshotPersist(snapshot);
    },
    [node.id, onAutoSizeModeChange, scheduleInlineHeightMeasure, scheduleMarkdownCommit, scheduleSnapshotPersist],
  );

  const handleSnapshotBlur = useCallback(
    (snapshot: NovelEditorSnapshot) => {
      latestSnapshotRef.current = snapshot;
      flushMarkdownCommit(snapshot.markdown);
      scheduleInlineHeightMeasure(true);
      flushSnapshot();
    },
    [flushMarkdownCommit, flushSnapshot, scheduleInlineHeightMeasure],
  );

  if (!editing) return null;

  return (
    <div
      ref={editorRootRef}
      className="relative h-full w-full overflow-visible"
      style={{ ...inlineTypographyVars, backgroundColor: bgColor }}
    >
      <div className="h-full w-full overflow-visible" style={{ padding: layoutPadding, boxSizing: 'border-box' }}>
        <div
          className="h-full w-full overflow-y-auto overflow-x-hidden scrollbar-none relative"
          data-scroll-container
        >
          <NovelRichTextEditor
            {...getNovelSurfacePreset('canvas-inline')}
            contentKey={`canvas-inline-${node.id}`}
            initialContent={{
              markdown: openState.markdown,
              html: openState.html,
              json: openState.json,
            }}
            className="h-full w-full"
            placeholder=""
            autoFocus
            showStats={false}
            bubbleAppendToBody
            inlineTypography={{
              fontSize: typography.fontSize,
              lineHeight: typography.lineHeight,
              fontFamily: typography.fontFamily,
              fontWeight: typography.fontWeight,
              color: typography.color,
              textAlign: typography.textAlign,
              letterSpacing: typography.letterSpacing,
            }}
            onChange={handleSnapshotChange}
            onBlur={handleSnapshotBlur}
            onSaveHotkey={flushSnapshot}
            onUploadImage={uploadExpandedEditorImage}
            onAiGenerate={onAiGenerate}
          />
        </div>
      </div>
    </div>
  );
};

export default TextNodeEditor;
