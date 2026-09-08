import React, { useMemo, useState, useCallback, useEffect } from 'react';
import type { Canvas, CanvasConnection, CanvasNode } from '../../../../types/canvas';
import { calculateGroupBounds } from '../../core/systems/CoordinateSystem';
import {
  generateSelectionInfographic,
  streamCanvasSelectionChat,
} from '@/lib/api';
import { buildSelectionOutlineMarkdown } from '@/canvas/utils/selectionOutline';
import { calculateTextNodeHeight, createConnection, mergeConnectionAppearance } from '@/canvas/utils/canvasUtils';
import { NodeFactory } from '../../core/systems/NodeFactory';
import { useCanvasStore } from '@/canvas/stores/canvas.store';
import { useSettingsStore } from '@/canvas/stores/settings.store';
import { Button } from '@/components/ui/button';
import {
  ArrowUp,
  Image as ImageIcon,
  Loader2,
  Settings2,
  Sparkles,
  Square as StopSquare,
} from 'lucide-react';
import { VoiceRecorder } from '@/components/thread/chat-input/voice-recorder';
import { useModelSelection } from '@/hooks/use-model-selection';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { InfographicStyleStudioDialog, type InfographicStyleDraft } from './infographic';

interface SelectionChatOverlayProps {
  canvas: Canvas;
  selectedIds: string[];
  containerScale: number;
}

const SelectionChatOverlay: React.FC<SelectionChatOverlayProps> = ({ canvas, selectedIds, containerScale }) => {
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(false);
  const [generatingInfographic, setGeneratingInfographic] = useState(false);
  const [text, setText] = useState('');

  const [styleDialogOpen, setStyleDialogOpen] = useState(false);
  const [styleDraft, setStyleDraft] = useState<InfographicStyleDraft | null>(null);

  const t = useTranslations();
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const { selectedModel } = useModelSelection();
  const addNode = useCanvasStore((s) => s.addNode);
  const addConnection = useCanvasStore((s) => s.addConnection);
  const updateNode = useCanvasStore((s) => s.updateNode);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const streamAbortRef = React.useRef<null | (() => void)>(null);
  const streamingNodeIdRef = React.useRef<string | null>(null);
  const streamingTextRef = React.useRef<string>('');
  const flushTimerRef = React.useRef<number | null>(null);

  const selectionBounds = useMemo(() => {
    const nodes = (canvas.nodes || []) as CanvasNode[];
    const idSet = new Set(selectedIds);
    const selNodes = nodes.filter((n) => idSet.has(n.id));
    return calculateGroupBounds(selNodes);
  }, [canvas.nodes, selectedIds]);

  const selectedStyleLabel = useMemo(() => {
    if (!styleDraft) {
      return t('canvas.selectionOverlay.styleUseResolvedDefault', {
        default: 'Use resolved default (user/workspace/system)',
      });
    }
    if (styleDraft.recipeName) return styleDraft.recipeName;
    if (styleDraft.recipeId) return t('canvas.selectionOverlay.styleCustom', { default: 'Custom style' });
    if (styleDraft.customPrompt.trim()) {
      return t('canvas.selectionOverlay.stylePromptOnly', { default: 'Custom prompt override' });
    }
    return t('canvas.selectionOverlay.styleCustom', { default: 'Custom style' });
  }, [styleDraft, t]);

  const NODE_WIDTH = 600;
  const MAX_NODE_HEIGHT = 700;
  const placementGap = 24;
  const placementTries = 48;

  const findAvailablePosition = useCallback(
    (nodeWidth: number, nodeHeight: number) => {
      const nodes = (canvas.nodes || []) as CanvasNode[];
      const overlaps = (x: number, y: number) => {
        const x1 = x + nodeWidth;
        const y1 = y + nodeHeight;
        return nodes.some((n) => {
          const nX1 = n.x + n.width;
          const nY1 = n.y + n.height;
          return !(x1 <= n.x || x >= nX1 || y1 <= n.y || y >= nY1);
        });
      };
      const rightX = selectionBounds.x + selectionBounds.width + placementGap;
      let y = selectionBounds.y;
      for (let i = 0; i < placementTries; i += 1) {
        if (!overlaps(rightX, y)) return { x: Math.round(rightX), y: Math.round(y) };
        y += nodeHeight + placementGap;
      }
      const belowY = selectionBounds.y + selectionBounds.height + placementGap;
      let x = selectionBounds.x;
      for (let i = 0; i < placementTries; i += 1) {
        if (!overlaps(x, belowY)) return { x: Math.round(x), y: Math.round(belowY) };
        x += nodeWidth + placementGap;
      }
      return { x: Math.round(rightX), y: Math.round(belowY) };
    },
    [canvas.nodes, selectionBounds],
  );

  const finalizeRun = useCallback(
    (status: 'done' | 'stopped' | 'error') => {
      const nodeId = streamingNodeIdRef.current;
      if (!nodeId) return;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      const content = streamingTextRef.current;
      const height = Math.min(
        calculateTextNodeHeight(content, NODE_WIDTH, { layoutPresetId: canvas.textLayoutPreset }),
        MAX_NODE_HEIGHT,
      );
      updateNode(nodeId, { content, height, locked: false, ai: true });
      streamingNodeIdRef.current = null;
      streamAbortRef.current = null;
      setRunning(false);
      setTimeout(() => {
        setExpanded(false);
      }, 450);
      if (status === 'done') {
        toast.success('生成完成');
      } else if (status === 'stopped') {
        toast.info('已停止');
      } else {
        toast.error('生成失败');
      }
    },
    [canvas.textLayoutPreset, NODE_WIDTH, MAX_NODE_HEIGHT, updateNode],
  );

  const handleOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(true);
  }, []);

  const handleOpenStyleDialog = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setStyleDialogOpen(true);
    },
    [],
  );

  const scheduleStreamFlush = useCallback(
    (force = false) => {
      const applyUpdate = () => {
        const nodeId = streamingNodeIdRef.current;
        if (!nodeId) return;
        const content = streamingTextRef.current;
        const height = Math.min(
          calculateTextNodeHeight(content, NODE_WIDTH, { layoutPresetId: canvas.textLayoutPreset }),
          MAX_NODE_HEIGHT,
        );
        updateNode(nodeId, { content, height });
      };
      if (force) {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        applyUpdate();
        return;
      }
      if (flushTimerRef.current != null) return;
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        applyUpdate();
      }, 50);
    },
    [canvas.textLayoutPreset, NODE_WIDTH, MAX_NODE_HEIGHT, updateNode],
  );

  const findBestSourceNode = useCallback(() => {
    const selectedNodes = (canvas.nodes || []).filter((n) => selectedIds.includes(n.id));
    if (selectedNodes.length === 0) return null;
    if (selectedNodes.length === 1) return selectedNodes[0].id;
    let best = selectedNodes[0];
    let bestRight = best.x + best.width;
    for (const n of selectedNodes.slice(1)) {
      const right = n.x + n.width;
      if (right > bestRight || (right === bestRight && n.y < best.y)) {
        best = n;
        bestRight = right;
      }
    }
    return best.id;
  }, [canvas.nodes, selectedIds]);

  const connectToSource = useCallback(
    (targetNodeId: string) => {
      const sourceId = findBestSourceNode();
      if (!sourceId) return;
      const base = createConnection(sourceId, targetNodeId, canvas.id);
      const appearanceDefault = useSettingsStore.getState()?.connection?.appearanceDefault;
      const appearance = mergeConnectionAppearance((base as any).appearance, appearanceDefault || undefined);
      const connection: CanvasConnection = appearance ? { ...base, appearance } : base;
      addConnection(connection);
    },
    [addConnection, canvas.id, findBestSourceNode],
  );

  const handleSubmit = useCallback(async () => {
    if (submitting || running) return;
    const message = text.trim();
    const outline = buildSelectionOutlineMarkdown(canvas, selectedIds);
    if (!message && !outline) {
      toast.error(t('canvas.selectionOverlay.noContent', { default: 'Selection has no usable content' }));
      return;
    }
    setSubmitting(true);
    try {
      const initialHeight = calculateTextNodeHeight('', NODE_WIDTH, { layoutPresetId: canvas.textLayoutPreset });
      const pos = findAvailablePosition(NODE_WIDTH, initialHeight);
      const node = NodeFactory.create('text', pos, canvas.id, {
        width: NODE_WIDTH,
        height: initialHeight,
        content: '',
      });
      addNode(node);
      connectToSource(node.id);
      updateNode(node.id, { locked: true, ai: false });
      streamingNodeIdRef.current = node.id;
      streamingTextRef.current = '';
      setRunning(true);
      setText('');
      streamAbortRef.current = streamCanvasSelectionChat(
        canvas.id,
        {
          prompt: message,
          selection_markdown: outline || undefined,
          model_name: selectedModel || undefined,
        },
        {
          onChunk: (chunk) => {
            streamingTextRef.current += chunk;
            scheduleStreamFlush(false);
          },
          onDone: () => {
            finalizeRun('done');
          },
          onError: (err) => {
            console.warn('[SelectionChatOverlay] stream failed:', err);
            finalizeRun('error');
          },
        },
      );
    } catch (e) {
      console.warn('[SelectionChatOverlay] submit failed:', e);
      finalizeRun('error');
    } finally {
      setSubmitting(false);
    }
  }, [
    addNode,
    canvas,
    connectToSource,
    finalizeRun,
    findAvailablePosition,
    NODE_WIDTH,
    running,
    scheduleStreamFlush,
    selectedIds,
    selectedModel,
    submitting,
    t,
    text,
    updateNode,
  ]);

  const handleStop = useCallback(() => {
    if (!running) return;
    try {
      streamAbortRef.current?.();
    } catch {}
    finalizeRun('stopped');
  }, [finalizeRun, running]);

  const handleGenerateInfographic = useCallback(async () => {
    if (generatingInfographic || running) return;
    const outline = buildSelectionOutlineMarkdown(canvas, selectedIds);
    if (!outline) {
      toast.error(t('canvas.selectionOverlay.noContent', { default: 'Selection has no usable content' }));
      return;
    }
    setGeneratingInfographic(true);

    const placeholderW = 400;
    const placeholderH = 530;
    const pos = findAvailablePosition(placeholderW, placeholderH);
    const node = NodeFactory.create('media', pos, canvas.id, {
      width: placeholderW,
      height: placeholderH,
      content: '',
      mediaType: 'image',
      fileName: 'infographic.png',
      fileType: 'image/png',
      fileExtension: 'png',
      fileSize: 0,
      uploadStatus: 'pending' as const,
    } as any);
    addNode(node);
    connectToSource(node.id);

    try {
      const result = await generateSelectionInfographic(canvas.id, {
        selection_markdown: outline,
        model_name: selectedModel || undefined,
        aspect_ratio: '3:4',
        recipe_id: styleDraft?.recipeId,
        custom_prompt: styleDraft ? styleDraft.customPrompt : undefined,
        reference_image_file_id: styleDraft?.referenceImageFileId,
      });

      const MAX_DIM = 800;
      const rawW = result.width || 600;
      const rawH = result.height || 800;
      const scale = Math.min(1, MAX_DIM / rawW, MAX_DIM / rawH);
      const nodeWidth = Math.round(rawW * scale);
      const nodeHeight = Math.round(rawH * scale);

      updateNode(node.id, {
        width: nodeWidth,
        height: nodeHeight,
        content: result.image_prompt?.slice(0, 200) || '',
        storagePath: result.storage_path,
        fileId: result.file_id,
        uploadStatus: 'uploaded',
        fileName: result.storage_path.split('/').pop() || 'infographic.png',
        fileType: result.mime_type,
        fileExtension: result.mime_type === 'image/png' ? 'png' : 'jpg',
        fileSize: result.byte_size,
      });
      toast.success(t('canvas.selectionOverlay.infographicGenerated', { default: 'Infographic generated' }));
    } catch (e: any) {
      console.warn('[SelectionChatOverlay] infographic generation failed:', e);
      removeNode(node.id);
      toast.error(e?.message || t('canvas.selectionOverlay.infographicFailed', { default: 'Failed to generate infographic' }));
    } finally {
      setGeneratingInfographic(false);
    }
  }, [
    generatingInfographic,
    running,
    canvas,
    selectedIds,
    selectedModel,
    findAvailablePosition,
    addNode,
    connectToSource,
    removeNode,
    updateNode,
    t,
    styleDraft,
  ]);

  useEffect(() => {
    const onDocPointer = (ev: MouseEvent | TouchEvent) => {
      const el = inputRef.current;
      if (!el) return;
      if (document.activeElement !== el) return;
      const box = boxRef.current;
      const target = ev.target as Node | null;
      if (box && target && !box.contains(target)) {
        try {
          el.blur();
        } catch {}
      }
    };
    document.addEventListener('mousedown', onDocPointer, true);
    document.addEventListener('touchstart', onDocPointer, true);
    return () => {
      document.removeEventListener('mousedown', onDocPointer, true);
      document.removeEventListener('touchstart', onDocPointer, true);
    };
  }, []);

  useEffect(() => {
    const onTabOpen = (ev: KeyboardEvent) => {
      if (expanded) return;
      if (ev.key !== 'Tab' || ev.shiftKey) return;
      const target = ev.target as any;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      setExpanded(true);
      ev.preventDefault();
    };
    try {
      window.addEventListener('keydown', onTabOpen);
    } catch {}
    return () => {
      try {
        window.removeEventListener('keydown', onTabOpen);
      } catch {}
    };
  }, [expanded]);

  if (!selectedIds?.length || !selectionBounds || selectionBounds.width === 0 || selectionBounds.height === 0) {
    return null;
  }

  const scale = Math.max(containerScale || 1, 0.01);
  const strokeBase = 1 / scale;
  const BASE_BTN_HEIGHT = 40;
  const BASE_COLLAPSED_WIDTH = 346;
  const BASE_INPUT_WIDTH = NODE_WIDTH;
  const gap = 8 * strokeBase;
  const halfWidth = ((expanded ? BASE_INPUT_WIDTH : BASE_COLLAPSED_WIDTH) / 2) * strokeBase;
  const overlayWidth = (expanded ? BASE_INPUT_WIDTH : BASE_COLLAPSED_WIDTH) * strokeBase;
  const centerX = selectionBounds.x + selectionBounds.width / 2;
  const left = centerX - halfWidth;
  const top = selectionBounds.y + selectionBounds.height + gap;

  return (
    <>
      <div
        className="selection-chat-overlay absolute z-50"
        data-selection-chat-overlay="true"
        style={{ left, top, width: overlayWidth, pointerEvents: 'auto' }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div style={{ transform: `scale(${strokeBase})`, transformOrigin: 'top left' }}>
          {!expanded ? (
            <div className="flex w-[346px] items-center gap-2">
              <button
                type="button"
                onClick={handleOpen}
                className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-md border border-border/60 bg-card/95 px-4 text-foreground shadow-sm backdrop-blur-sm hover:shadow-md active:scale-[0.985]"
                style={{ height: BASE_BTN_HEIGHT, borderWidth: 1 }}
              >
                <span className="whitespace-nowrap text-sm font-medium tracking-[0.01em]">
                  {t('canvas.selectionOverlay.chat', { default: 'Chat' })}
                </span>
                <kbd className="ml-1 h-[22px] rounded border border-border/60 bg-muted/60 px-1.5 leading-[22px] text-[11px] text-muted-foreground">
                  Tab
                </kbd>
              </button>
              <button
                type="button"
                onClick={handleGenerateInfographic}
                disabled={generatingInfographic}
                className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-md border border-border/60 bg-card/95 px-4 text-foreground shadow-sm backdrop-blur-sm hover:shadow-md active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50"
                style={{ height: BASE_BTN_HEIGHT, borderWidth: 1 }}
                title={t('canvas.selectionOverlay.generateInfographic', {
                  default: 'Generate infographic from selection',
                })}
              >
                {generatingInfographic ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImageIcon size={16} />
                )}
                <span className="whitespace-nowrap text-sm font-medium tracking-[0.01em]">
                  {t('canvas.selectionOverlay.infographic', { default: 'Infographic' })}
                </span>
              </button>
              <button
                type="button"
                onClick={handleOpenStyleDialog}
                className="grid h-[40px] w-[40px] place-items-center rounded-md border border-border/60 bg-card/95 text-foreground shadow-sm backdrop-blur-sm hover:shadow-md active:scale-[0.985]"
                title={t('canvas.selectionOverlay.styleSettings', {
                  default: 'Infographic style settings',
                })}
              >
                <Settings2 className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div
              className="rounded-xl border border-border/60 bg-card/95 p-3 text-foreground shadow-lg backdrop-blur-sm"
              style={{ width: `${BASE_INPUT_WIDTH}px`, borderWidth: 1 }}
              ref={boxRef}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[15px] font-medium">Chat</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 px-2 text-xs text-muted-foreground hover:bg-muted/60"
                    onClick={handleOpenStyleDialog}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {t('canvas.selectionOverlay.style', { default: 'Style' })}
                  </button>
                  <button
                    type="button"
                    className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-muted/60"
                    aria-label="Close"
                    onClick={() => setExpanded(false)}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <textarea
                autoFocus
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                  if (e.key === 'Escape') {
                    setExpanded(false);
                    setText('');
                  }
                }}
                placeholder={t('canvas.selectionOverlay.chatPlaceholder', { default: 'Tell me your request.' })}
                className="min-h-[64px] w-full resize-none rounded-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-muted-foreground" title={selectedStyleLabel}>
                  {selectedStyleLabel}
                </span>
                <div className="flex items-center gap-2">
                  <VoiceRecorder
                    onTranscription={(value) => setText((prev) => (prev ? `${prev} ${value}` : value))}
                    disabled={submitting || running}
                  />
                  <Button
                    type="button"
                    onClick={running ? handleStop : handleSubmit}
                    size="sm"
                    variant="ghost"
                    className={[
                      'h-8 w-8 flex-shrink-0 rounded-lg text-muted-foreground hover:bg-accent/60',
                      running ? 'bg-accent text-foreground' : 'bg-muted/60',
                      submitting ? 'opacity-50' : '',
                    ].join(' ')}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : running ? (
                      <StopSquare className="h-5 w-5" />
                    ) : (
                      <ArrowUp className="h-5 w-5" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <InfographicStyleStudioDialog
        open={styleDialogOpen}
        onOpenChange={setStyleDialogOpen}
        value={styleDraft}
        onApply={setStyleDraft}
      />
    </>
  );
};

export default SelectionChatOverlay;
