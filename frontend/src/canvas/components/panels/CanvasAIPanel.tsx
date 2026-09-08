'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ensureCanvasThread, addUserMessage, startAgent, peekCanvasThread, getMessages, resetThread, listThreadSessions, resumeThreadSession, deleteThreadSession, getAgentRuns, type MessageAttachmentInput } from '@/lib/api';
import { getDownloadUrl } from '@/lib/api/files';
import { generateCanvasMedia } from '@/lib/api';
import { ReferenceImagePickerDialog } from '@/components/thread/ReferenceImagePickerDialog';
import type { ReferenceImageCandidate, ReferenceImagePickerPayload } from '@/components/thread/ReferenceImagePickerDialog';
import { useAgentStream } from '@/hooks/useAgentStream';
import { ThreadContent } from '@/components/thread/content/ThreadContent';
import { ChatInput, type ChatInputHandles } from '@/components/thread/chat-input/chat-input';
import type { UnifiedMessage, CtaAction } from '@/components/thread/types';
import { useModelSelection } from '@/hooks/use-model-selection';
import { Loader2, History, SquarePen, Maximize2, Minimize2, ListOrdered, ChevronDown, X, Trash2, Search } from 'lucide-react';
import {useTranslations} from 'next-intl';
import { useCanvasStore } from '@/canvas/stores/canvas.store';
import { buildSelectionContext } from '@/canvas/utils/selectionContext';
import { safeJsonParse, isFinalAssistantMeta, isStreamingChunkMeta } from '@/components/thread/utils';
import { useSearchParams } from 'next/navigation';
// canvasManager 和 areCanvasEqual 已移除 - 现在依赖 Yjs 实时同步
import { dispatchSetReferenceImages } from '@/lib/reference-images';
import { cn } from '@/lib/utils';
import { getStoredRunMode, type RunMode } from '@/lib/run-mode';
import { setAgentRunStatus } from '@/hooks/useAgentRunStatus';
import { getCurrentWorkspaceId } from '@/lib/workspace-session';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';

const resolveSessionIndex = (rawMeta: unknown): number => {
  const meta = typeof rawMeta === 'string' ? safeJsonParse<any>(rawMeta, {}) : (rawMeta || {});
  const value: any = meta && (meta as any).session_index;
  const parsed = typeof value === 'number' ? value : (value ? parseInt(String(value), 10) || 0 : 0);
  return parsed || 0;
};

const getMessageSessionIndex = (message: UnifiedMessage): number => resolveSessionIndex((message as any)?.metadata);

interface CanvasAIPanelProps {
  canvasId: string;
  className?: string;
  readOnly?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onClosePanel?: () => void;
  contextMode?: 'auto' | 'selection' | 'node';
  contextNodeId?: string | null;
}

type QueueItem = {
  id: string;
  text: string;
  attachments?: MessageAttachmentInput[];
  reference_images?: import('@/lib/reference-images').ReferenceImageInput[];
  context?: any;
  run_mode?: RunMode;
  model_name?: string;
  created_at: string;
};

export const CanvasAIPanel: React.FC<CanvasAIPanelProps> = ({
  canvasId,
  className,
  readOnly = false,
  expanded = false,
  onToggleExpand,
  onClosePanel,
  contextMode = 'auto',
  contextNodeId = null,
}) => {
  const t = useTranslations();
  const store = useCanvasStore();
  const selectedNodeIds = useMemo(() => Array.from(store.selections?.nodeIds || []), [store.selections?.nodeIds]);
  const selectedMediaNodes = useMemo(() => {
    const nodes = store.canvas?.nodes || [];
    const idSet = new Set(selectedNodeIds);
    return nodes.filter(
      (node: any) => idSet.has(node.id) && node.type === 'media' && node.mediaType === 'image',
    );
  }, [store.canvas?.nodes, selectedNodeIds]);
  const referenceableMediaNodes = useMemo(
    () => selectedMediaNodes.filter((node: any) => !!(node.fileId || node.storagePath)),
    [selectedMediaNodes],
  );
  const searchParams = useSearchParams();
  // 乐观应用相关的 refs 已移除 - 现在依赖 Yjs 实时同步
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [currentSession, setCurrentSession] = useState<number>(0);
  const [sessions, setSessions] = useState<Array<{ index: number; title: string; started_at?: string; ended_at?: string }>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [agentStatus, setAgentStatus] = useState<'idle' | 'running' | 'connecting'>('idle');
  const [isCreatingSession, setIsCreatingSession] = useState<boolean>(false);
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [restoringSessionIndex, setRestoringSessionIndex] = useState<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [confirmStopOpen, setConfirmStopOpen] = useState<boolean>(false);
  const [pendingSessionIndex, setPendingSessionIndex] = useState<number | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState<boolean>(false);
  const [pendingDeleteSession, setPendingDeleteSession] = useState<{ index: number; title: string } | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState<boolean>(false);
  const [referencePicker, setReferencePicker] = useState<ReferenceImagePickerPayload | null>(null);
  const [isReferenceSubmitting, setIsReferenceSubmitting] = useState<boolean>(false);
  const lastStartedRunIdRef = useRef<string | null>(null);
  const lastStartedRunAtRef = useRef<number | null>(null);
  const chatInputRef = useRef<ChatInputHandles>(null);
  const [queuedMessages, setQueuedMessages] = useState<QueueItem[]>([]);
  const [queuePaused, setQueuePaused] = useState<boolean>(true);
  const [queueCollapsed, setQueueCollapsed] = useState<boolean>(true);
  const [historyQuery, setHistoryQuery] = useState<string>('');
  const queueRef = useRef<QueueItem[]>([]);
  const queueProcessingRef = useRef<boolean>(false);
  const queueStorageKey = useMemo(() => `zmind:ai-queue:${canvasId}`, [canvasId]);
  const agentRunsCheckedRef = useRef<boolean>(false);

  const updateScrollToBottomState = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isAtBottom = distance <= 24;
    setShowScrollToBottom(!isAtBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setShowScrollToBottom(false);
  }, []);

  useEffect(() => {
    queueRef.current = queuedMessages;
  }, [queuedMessages]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleScroll = () => updateScrollToBottomState();
    handleScroll();
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [updateScrollToBottomState]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(queueStorageKey);
    const stored = safeJsonParse<QueueItem[]>(raw, []);
    if (Array.isArray(stored)) {
      setQueuedMessages(
        stored.filter((item) => item && typeof item.text === 'string' && item.id),
      );
    } else {
      setQueuedMessages([]);
    }
    setQueuePaused(true);
  }, [queueStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raf = window.requestAnimationFrame(() => updateScrollToBottomState());
    return () => window.cancelAnimationFrame(raf);
  }, [messages, updateScrollToBottomState]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!queuedMessages.length) {
      window.localStorage.removeItem(queueStorageKey);
      return;
    }
    try {
      window.localStorage.setItem(queueStorageKey, JSON.stringify(queuedMessages));
    } catch {
      // Ignore storage errors (e.g., quota)
    }
  }, [queuedMessages, queueStorageKey]);

  const {
    status: streamStatus,
    reasoningText: streamingReasoningText,
    toolCall: streamingToolCall,
    agentRunId: hookAgentRunId,
    hasStreamingAssistant,
    runStartedAt,
    startStreaming,
    stopStreaming,
  } = useAgentStream(
    {
      onMessage: (msg) => {
        const incomingMeta = safeJsonParse<any>(msg.metadata, {});
        const incomingRunId = incomingMeta?.thread_run_id
          ? String(incomingMeta.thread_run_id)
          : null;
        const incomingIsFinal = isFinalAssistantMeta(incomingMeta);

        setMessages((prev) => {
          let nextMsg = msg;
          const meta = typeof incomingMeta === 'object' && incomingMeta ? { ...incomingMeta } : {};
          let metaChanged = false;
          if (meta.session_index == null) {
            meta.session_index = currentSession || 0;
            metaChanged = true;
          }

          const streamingIndex =
            msg.type === 'assistant' && incomingIsFinal && incomingRunId
              ? prev.findIndex((m) => {
                  if (m.type !== 'assistant') return false;
                  const meta = typeof m.metadata === 'string' ? safeJsonParse<any>(m.metadata, {}) : (m.metadata || {});
                  const runId = meta?.thread_run_id ? String(meta.thread_run_id) : null;
                  return (
                    runId &&
                    runId === incomingRunId &&
                    isStreamingChunkMeta(meta)
                  );
                })
              : -1;

          if (msg.type === 'assistant' && streamingIndex >= 0) {
            const streamingMsg = prev[streamingIndex];
            const streamingParsed = safeJsonParse<any>(streamingMsg.content, {});
            const streamingText =
              typeof streamingParsed?.content === 'string'
                ? streamingParsed.content
                : '';
            const incomingParsed = safeJsonParse<any>(nextMsg.content, {});
            const incomingText =
              typeof incomingParsed?.content === 'string'
                ? incomingParsed.content.trim()
                : '';
            if (!incomingText && streamingText) {
              nextMsg = {
                ...nextMsg,
                content: JSON.stringify({
                  ...incomingParsed,
                  content: streamingText,
                }),
              };
            }
          }

          if (metaChanged) {
            nextMsg = {
              ...nextMsg,
              metadata: JSON.stringify(meta),
            };
          }

          // Update if same id exists
          const exists = prev.some((m) => m.message_id === nextMsg.message_id);
          if (exists) {
            const next = prev.map((m) => (m.message_id === nextMsg.message_id ? nextMsg : m));
            if (
              streamingIndex >= 0 &&
              prev[streamingIndex].message_id !== nextMsg.message_id
            ) {
              next.splice(streamingIndex, 1);
            }
            return next;
          }
          if (streamingIndex >= 0) {
            const next = prev.slice();
            next[streamingIndex] = nextMsg;
            return next;
          }

          // Replace an optimistic user message (temp-*) with same content
          try {
            if (nextMsg.type === 'user') {
              const parsed = safeJsonParse<any>(nextMsg.content, {});
              const newText = parsed?.content ?? '';
              const idx = prev.findIndex((m) => {
                if (m.type !== 'user' || !m.message_id || !String(m.message_id).startsWith('temp-')) return false;
                const pm = safeJsonParse<any>(m.content, {});
                const oldText = pm?.content ?? '';
                return newText && oldText && String(newText) === String(oldText);
              });
              if (idx !== -1) {
                const next = prev.slice();
                next[idx] = nextMsg;
                return next;
              }
            }
          } catch {}

          return [...prev, nextMsg];
        });
      },
      onStatusChange: (s) => {
        if (s === 'streaming') setAgentStatus('running');
        else if (['idle', 'completed', 'stopped', 'agent_not_running'].includes(s)) setAgentStatus('idle');
        else if (s === 'connecting') setAgentStatus('connecting');
      },
      onError: (e) => {
        // Keep it quiet for now; console log only
        console.error('[CanvasAIPanel] stream error:', e);
      },
      onClose: () => {
        setAgentStatus('idle');
      },
    },
    // threadId is mandatory; use empty string while resolving to avoid re-init loops
    threadId || '',
    setMessages,
  );

  useEffect(() => {
    if (hookAgentRunId) {
      lastStartedRunIdRef.current = hookAgentRunId;
    }
  }, [hookAgentRunId]);

  useEffect(() => {
    agentRunsCheckedRef.current = false;
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    if (agentRunsCheckedRef.current) return;
    let cancelled = false;
    agentRunsCheckedRef.current = true;
    (async () => {
      try {
        const runs = await getAgentRuns(threadId);
        if (cancelled) return;
        const running = (runs || []).filter((run) => run.status === 'running');
        if (running.length === 0) return;
        const latestRunning = running[0];
        if (!latestRunning?.id) return;
        if (lastStartedRunIdRef.current !== latestRunning.id) {
          lastStartedRunIdRef.current = latestRunning.id;
        }
        setAgentStatus('connecting');
        startStreaming(latestRunning.id);
      } catch (err) {
        console.warn('[CanvasAIPanel] Failed to restore running agent:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, startStreaming]);

  const filteredMessages = useMemo(() => {
    const target = currentSession || 0;
    const activeRunId = lastStartedRunIdRef.current;

    return messages.filter((m) => {
      if (m.type === 'status') {
        const parsed = safeJsonParse<any>(m.content, {});
        return parsed?.status_type === 'reasoning';
      }
      const raw: any = (m as any).metadata;
      const meta = typeof raw === 'string' ? safeJsonParse<any>(raw, {}) : (raw || {});
      const isStreaming = meta?.stream_status === 'chunk' || meta?.streaming === true;
      if (isStreaming) {
        const streamRunId = meta?.agent_run_id || meta?.agentRunId || null;
        if (activeRunId && streamRunId) return String(streamRunId) === String(activeRunId);
        return true;
      }
      return resolveSessionIndex(meta) === target;
    });
  }, [messages, currentSession]);

  // Model selection (simple header)
  const {
    selectedModel,
    setSelectedModel,
    allModels
  } = useModelSelection();

  useEffect(() => { setIsLoading(false); }, [canvasId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const peek = await peekCanvasThread(canvasId);
        if (!cancelled && peek?.exists && peek.thread_id) {
          setThreadId(peek.thread_id);
          try {
            const hist = await getMessages(peek.thread_id);
            if (!cancelled && Array.isArray(hist)) {
              setMessages((prev) => {
                const serverList = (hist as any[]) || [];
                const serverIds = new Set(serverList.map((m: any) => m.message_id).filter(Boolean));
                const serverAssistantRunIds = new Set<string>();
                serverList.forEach((m: any) => {
                  if (!m || m.type !== 'assistant') return;
                  try {
                    const meta = typeof m.metadata === 'string' ? safeJsonParse<any>(m.metadata, {}) : (m.metadata || {});
                    const runId = meta?.thread_run_id;
                    if (runId) serverAssistantRunIds.add(String(runId));
                  } catch {}
                });
                const serverUserContents = new Set(
                  serverList
                    .filter((m: any) => m.type === 'user')
                    .map((m: any) => {
                      try {
                        const c = typeof m.content === 'string' ? m.content : '';
                        const j = JSON.parse(c || '{}');
                        return String(j?.content || '');
                      } catch { return ''; }
                    })
                    .filter((s: string) => !!s)
                );

                const localExtras = (prev || []).filter((m) => {
                  try {
                    const meta = typeof m.metadata === 'string' ? safeJsonParse<any>(m.metadata, {}) : (m.metadata || {});
                    const runId = meta?.thread_run_id ? String(meta.thread_run_id) : null;
                    if (meta?.stream_fallback && runId && serverAssistantRunIds.has(runId)) {
                      return false;
                    }
                  } catch {}
                  const isTemp = !m.message_id || String(m.message_id).startsWith('temp-');
                  if (isTemp) {
                    try {
                      const j = typeof m.content === 'string' ? JSON.parse(m.content || '{}') : {};
                      const txt = String(j?.content || '');
                      if (txt && serverUserContents.has(txt)) return false;
                    } catch {}
                  }
                  return !m.message_id || !serverIds.has(m.message_id as string);
                });

                const merged = [...serverList, ...localExtras].sort((a: any, b: any) => {
                  const at = a?.created_at ? Date.parse(a.created_at) : 0;
                  const bt = b?.created_at ? Date.parse(b.created_at) : 0;
                  return at - bt;
                });
                return merged as any;
              });
            }
            try {
              const sess = await listThreadSessions(peek.thread_id);
              if (!cancelled && sess) {
                setCurrentSession(sess.current_session_index || 0);
                setSessions((sess.sessions || []).map((s:any)=>({
                  index: s.index,
                  title: s.title,
                  started_at: s.started_at,
                  ended_at: s.ended_at,
                })));
              }
            } catch {}
          } catch (e) {
            console.warn('[CanvasAIPanel] failed to load history:', e);
          }
        }
      } catch (e) {
        // keep panel interactive even when history bootstrap fails
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true };
  }, [canvasId]);

  // Listen for agent run started from selection mini chat and attach stream
  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail || {};
        const runThreadId = String(detail.threadId || '');
        const runId = String(detail.agentRunId || '');
        if (!runId) return;
        // If threadId not set yet, adopt it; otherwise ensure matches
        if (!threadId) {
          setThreadId(runThreadId);
        }
        if (!threadId || threadId === runThreadId) {
          setAgentStatus('connecting');
          if (lastStartedRunIdRef.current !== runId) {
            lastStartedRunIdRef.current = runId;
            lastStartedRunAtRef.current = Date.now();
            startStreaming(runId);
          }
        }
      } catch {}
    };
    try { window.addEventListener('agent:run-started', handler as any); } catch {}
    return () => { try { window.removeEventListener('agent:run-started', handler as any); } catch {} };
  }, [threadId, startStreaming]);

  // Adopt any pending agent run info if set before panel mounted (e.g., mini chat opened panel after starting run)
  useEffect(() => {
    try {
      const pending = (window as any).__pendingAgentRun;
      if (!pending) return;
      const runThreadId = String(pending.threadId || '');
      const runId = String(pending.agentRunId || '');
      if (!runId) return;
      // clear pending regardless to avoid replays
      (window as any).__pendingAgentRun = null;
      if (!threadId) {
        setThreadId(runThreadId);
      }
      if (!threadId || threadId === runThreadId) {
        setAgentStatus('connecting');
        if (lastStartedRunIdRef.current !== runId) {
          lastStartedRunIdRef.current = runId;
          lastStartedRunAtRef.current = Date.now();
          startStreaming(runId);
        }
      }
    } catch {}
  }, [threadId, startStreaming]);

  // (moved) auto-submit effect defined after handleSubmit


  const tempIdCounterRef = useRef(0);
  const ensureThreadId = useCallback(async () => {
    if (threadId) return threadId;
    const res = await ensureCanvasThread(canvasId);
    const tid = res.thread_id;
    setThreadId(tid);
    return tid;
  }, [threadId, canvasId]);
  const buildSelectionSnapshot = useCallback(() => {
    const selectedNodeIds = Array.from(store.selections?.nodeIds || []);
    const preferredNodeId =
      (contextMode === 'node' || contextMode === 'auto') && contextNodeId
        ? contextNodeId
        : null;
    if (preferredNodeId) {
      const exists = (store.canvas?.nodes || []).some((node: any) => node.id === preferredNodeId);
      if (exists) {
        return buildSelectionContext(store.canvas, [preferredNodeId], []);
      }
    }
    const g = store.selections?.groupId;
    if (g) selectedNodeIds.push(g);
    const selectedConnectionIds = Array.from(store.selections?.connectionIds || []);
    if (selectedNodeIds.length === 0 && selectedConnectionIds.length === 0) {
      return null;
    }
    return buildSelectionContext(store.canvas, selectedNodeIds, selectedConnectionIds);
  }, [store, contextMode, contextNodeId]);
  const buildWorkspaceTarget = useCallback(
    () => ({
      workspace_id: getCurrentWorkspaceId() || undefined,
      canvas_id: canvasId,
    }),
    [canvasId],
  );

  const mergeAttachments = useCallback(
    (base: MessageAttachmentInput[] = [], incoming: MessageAttachmentInput[] = []) => {
    const merged: MessageAttachmentInput[] = [];
    const seen = new Set<string>();
    for (const att of [...base, ...incoming]) {
      if (!att?.file_id || seen.has(att.file_id)) continue;
      seen.add(att.file_id);
      merged.push(att);
    }
    return merged;
  }, []);

  const handleSubmit = useCallback(
    async (
      text: string,
      options?: {
        model_name?: string;
        enable_thinking?: boolean;
        reference_images?: import('@/lib/reference-images').ReferenceImageInput[];
        attachments?: MessageAttachmentInput[];
        run_mode?: RunMode;
        context?: any;
        response_mode?: 'auto' | 'preview' | 'confirm' | 'force_apply';
        resume_token?: string;
        selection_context?: Record<string, any> | null;
        workspace_target?: Record<string, any> | null;
        cta?: {
          action: string;
          payload?: any;
          label?: string;
        };
      },
      overrideThreadId?: string
    ): Promise<boolean> => {
      const t = overrideThreadId || threadId;
      if (!t) return false;
      const messageText = text.trim();
      const hasAttachments = Boolean(options?.attachments && options.attachments.length > 0);
      const hasReferenceImages = Boolean(options?.reference_images && options.reference_images.length > 0);
      if (!messageText && !hasAttachments && !hasReferenceImages) return false;
      const runMode = options?.run_mode ?? getStoredRunMode();

      // Optimistic append user message (temp id)
      const optimisticId = `temp-${Date.now()}-${(++tempIdCounterRef.current).toString(36)}`;
      const optimisticMetadata = options?.attachments && options.attachments.length > 0
        ? JSON.stringify({ session_index: currentSession || 0, attachments: options.attachments })
        : JSON.stringify({ session_index: currentSession || 0 });

      setMessages((prev) => [
        ...prev,
        {
          message_id: optimisticId,
          thread_id: t,
          type: 'user',
          is_llm_message: false,
          content: JSON.stringify({ role: 'user', content: messageText }),
          metadata: optimisticMetadata,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
      setTimeout(() => {
        scrollToBottom();
      }, 0);

      // Immediately show loader to provide instant feedback
      setAgentStatus('connecting');

      try {
        // Insert message with selection context (only if there is selection), then start agent
        const hasExplicitContext = options && Object.prototype.hasOwnProperty.call(options, 'context');
        const context = hasExplicitContext ? options?.context ?? null : buildSelectionSnapshot();
        const selectionContext =
          options && Object.prototype.hasOwnProperty.call(options, 'selection_context')
            ? options?.selection_context ?? null
            : context;
        const workspaceTarget =
          options?.workspace_target && typeof options.workspace_target === 'object'
            ? options.workspace_target
            : buildWorkspaceTarget();
        const reference_images = options?.reference_images?.filter(
          (img) => img && (img.file_id || img.storage_path || img.node_id),
        );
        const createdMessage = await addUserMessage(
          t,
          messageText,
          context || undefined,
          reference_images,
          options?.attachments,
          options?.cta?.action,
          options?.cta?.payload,
          options?.cta?.label,
        );

        const fallbackMeta: Record<string, any> = { session_index: currentSession || 0 };
        if (selectionContext) {
          fallbackMeta.selection_context = selectionContext;
        }
        if (workspaceTarget) {
          fallbackMeta.workspace_target = workspaceTarget;
        }
        if (reference_images && reference_images.length > 0) {
          fallbackMeta.reference_images = reference_images;
        }
        if (options?.attachments && options.attachments.length > 0) {
          fallbackMeta.attachments = options.attachments;
        }

        const clientMessageHint = createdMessage && createdMessage.message_id
          ? {
              message_id: createdMessage.message_id,
              content: createdMessage.content,
              metadata: createdMessage.metadata,
              type: createdMessage.type,
            }
          : {
              content: { role: 'user', content: messageText },
              metadata: fallbackMeta,
              role: 'user',
              type: 'user',
            };

        const res = await startAgent(t, {
          model_name: options?.model_name || selectedModel || undefined,
          stream: true,
          agent_id: runMode === 'chat' ? undefined : 'Zmind',
          run_mode: runMode,
          interaction_surface: 'canvas',
          response_mode: options?.response_mode,
          resume_token: options?.resume_token,
          selection_context: selectionContext || undefined,
          workspace_target: workspaceTarget || undefined,
          client_message: clientMessageHint,
        });
        startStreaming(res.agent_run_id);
        lastStartedRunIdRef.current = res.agent_run_id;
        lastStartedRunAtRef.current = Date.now();
        return true;
      } catch (e) {
        console.error('[CanvasAIPanel] submit failed:', e);
        // Rollback optimistic message
        setMessages((prev) => prev.filter((m) => m.message_id !== optimisticId));
        // Reset status to idle on failure
        setAgentStatus('idle');
        return false;
      }
    },
    [threadId, selectedModel, startStreaming, currentSession, buildSelectionSnapshot, buildWorkspaceTarget, scrollToBottom]
  );

  const sendQueuedItem = useCallback(
    async (item: QueueItem) => {
      let tid = threadId;
      if (!tid) {
        try {
          tid = await ensureThreadId();
        } catch (e) {
          console.error('[CanvasAIPanel] ensure thread for queue failed:', e);
          return false;
        }
      }
      return handleSubmit(
        item.text,
        {
          model_name: item.model_name,
          run_mode: item.run_mode,
          reference_images: item.reference_images,
          attachments: item.attachments,
          context: item.context,
        },
        tid,
      );
    },
    [threadId, ensureThreadId, handleSubmit],
  );

  const restoreQueueItemToInput = useCallback(
    (item: QueueItem) => {
      const draft = chatInputRef.current?.getDraftPayload();
      const existingText = draft?.text || '';
      const incomingText = item.text || '';
      const separator =
        existingText.trim().length > 0 && incomingText.trim().length > 0
          ? '\n\n---\n\n'
          : '';
      const nextText =
        existingText && incomingText
          ? `${existingText}${separator}${incomingText}`
          : existingText || incomingText;
      const mergedAttachments = mergeAttachments(
        draft?.attachments || [],
        item.attachments || [],
      );
      const mergedReferenceImages = [
        ...(draft?.reference_images || []),
        ...(item.reference_images || []),
      ];
      chatInputRef.current?.setDraftPayload({
        text: nextText,
        attachments: mergedAttachments,
        reference_images: mergedReferenceImages,
      });
    },
    [mergeAttachments],
  );

  const enqueueDraftFromInput = useCallback(
    (_submittedText: string, opts?: { model_name?: string; run_mode?: RunMode; reference_images?: import('@/lib/reference-images').ReferenceImageInput[]; attachments?: MessageAttachmentInput[] }) => {
      const draft = chatInputRef.current?.getDraftPayload();
      if (!draft) return;
      const restoreDraft = () => {
        const restore = {
          text: draft.text,
          attachments: draft.attachments,
        };
        setTimeout(() => chatInputRef.current?.setDraftPayload(restore), 0);
      };
      if (draft.hasPendingUploads) {
        toast.info('Files are still uploading. Please wait.');
        restoreDraft();
        return;
      }
      if (draft.hasUploadError) {
        toast.error('Upload failed. Please reattach your files.');
        restoreDraft();
        return;
      }
      if (queueRef.current.length >= 5) {
        toast.error('Queue is full (max 5).');
        restoreDraft();
        return;
      }
      const rawText = draft.text;
      const item: QueueItem = {
        id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: rawText,
        attachments: opts?.attachments || draft.attachments,
        reference_images: opts?.reference_images || draft.reference_images,
        context: buildSelectionSnapshot(),
        run_mode: opts?.run_mode || draft.run_mode,
        model_name: opts?.model_name || draft.model_name,
        created_at: new Date().toISOString(),
      };
      setQueuedMessages((prev) => [...prev, item]);
      setQueuePaused(false);
    },
    [buildSelectionSnapshot],
  );

  const handlePauseQueue = useCallback(async () => {
    setQueuePaused(true);
    if (agentStatus === 'running' || agentStatus === 'connecting') {
      try { await stopStreaming(); } catch {}
      setAgentStatus('idle');
    }
    const nextItem = queueRef.current[0];
    if (!nextItem) return;
    setQueuedMessages((prev) => prev.slice(1));
    restoreQueueItemToInput(nextItem);
  }, [agentStatus, stopStreaming, restoreQueueItemToInput]);

  useEffect(() => {
    if (agentStatus !== 'idle') return;
    if (queuePaused) return;
    if (queueProcessingRef.current) return;
    const nextItem = queueRef.current[0];
    if (!nextItem) return;
    queueProcessingRef.current = true;
    setQueuedMessages((prev) => prev.slice(1));
    (async () => {
      try {
        const ok = await sendQueuedItem(nextItem);
        if (!ok) {
          setQueuedMessages((prev) => [nextItem, ...prev]);
          setQueuePaused(true);
          toast.error('Queue paused after a send failure.');
        }
      } catch {
        setQueuedMessages((prev) => [nextItem, ...prev]);
        setQueuePaused(true);
        toast.error('Queue paused after a send failure.');
      }
    })()
      .finally(() => {
        queueProcessingRef.current = false;
      });
  }, [agentStatus, queuePaused, sendQueuedItem]);

  const handleCtaAction = useCallback(
    async (cta: CtaAction) => {
      if (!cta?.action) return;
      const label = (cta.label || cta.action || '').trim();
      if (!label) return;
      const action = (cta.action || '').trim();
      const payload =
        cta.payload && typeof cta.payload === 'object' ? cta.payload : {};
      if (action === 'image.select_reference') {
        setReferencePicker(payload as ReferenceImagePickerPayload);
        return;
      }
      const downloadUrl =
        (payload as any).download_url ||
        (payload as any).downloadUrl ||
        (payload as any).url;
      const fileId = (payload as any).file_id || (payload as any).fileId;
      const isDownload =
        action === 'download_file' || action === 'download' || action === 'open_url';
      if (isDownload) {
        if (downloadUrl && typeof window !== 'undefined') {
          window.open(String(downloadUrl), '_blank', 'noopener,noreferrer');
          return;
        }
        if (fileId) {
          try {
            const { url } = await getDownloadUrl(String(fileId));
            if (url && typeof window !== 'undefined') {
              window.open(url, '_blank', 'noopener,noreferrer');
              return;
            }
          } catch (err) {
            console.error('[CanvasAIPanel] Failed to get download url:', err);
          }
        }
        console.warn('[CanvasAIPanel] Download CTA missing url');
        return;
      }
      let tid = threadId;
      if (!tid) {
        try {
          tid = await ensureThreadId();
        } catch (e) {
          console.error('[CanvasAIPanel] ensure thread on CTA failed:', e);
          return;
        }
      }
      if (action === 'canvas_preview.confirm') {
        await handleSubmit(
          label,
          {
            context:
              (payload as any).selection_context && typeof (payload as any).selection_context === 'object'
                ? (payload as any).selection_context
                : undefined,
            response_mode:
              (payload as any).response_mode === 'confirm' ? 'confirm' : 'confirm',
            resume_token:
              typeof (payload as any).resume_token === 'string'
                ? (payload as any).resume_token
                : undefined,
            selection_context:
              (payload as any).selection_context && typeof (payload as any).selection_context === 'object'
                ? (payload as any).selection_context
                : undefined,
            workspace_target:
              (payload as any).workspace_target && typeof (payload as any).workspace_target === 'object'
                ? (payload as any).workspace_target
                : undefined,
            cta: {
              action: cta.action,
              payload: cta.payload,
              label: cta.label,
            },
          },
          tid,
        );
        return;
      }
      await handleSubmit(label, {
        cta: {
          action: cta.action,
          payload: cta.payload,
          label: cta.label,
        },
      }, tid);
    },
    [threadId, ensureThreadId, handleSubmit],
  );

  const handleReferenceSelection = useCallback(
    async (candidate: ReferenceImageCandidate) => {
      if (!referencePicker) return;
      if (isReferenceSubmitting) return;
      const targetCanvasId = referencePicker.canvas_id || canvasId;
      const targetThreadId = referencePicker.thread_id || threadId;
      if (!targetCanvasId || !targetThreadId) {
        toast.error('Missing canvas or thread context.');
        return;
      }
      if (!referencePicker.prompt) {
        toast.error('Missing prompt for retry.');
        return;
      }
      setIsReferenceSubmitting(true);
      try {
        await generateCanvasMedia(targetCanvasId, {
          thread_id: targetThreadId,
          prompt: referencePicker.prompt,
          aspect_ratio: referencePicker.aspect_ratio,
          quantity: referencePicker.quantity,
          model: referencePicker.model,
          reference_images: [
            {
              file_id: candidate.file_id,
              storage_path: candidate.storage_path,
              node_id: candidate.node_id,
              label: candidate.label,
              width: candidate.width,
              height: candidate.height,
              source: 'canvas-node',
            },
          ],
        });
        toast.success('Image generation restarted.');
        setReferencePicker(null);
      } catch (err) {
        console.error('[CanvasAIPanel] reference retry failed:', err);
        toast.error('Failed to generate image. Please try again.');
      } finally {
        setIsReferenceSubmitting(false);
      }
    },
    [referencePicker, canvasId, threadId, isReferenceSubmitting],
  );

  const handleConfirmDeleteSession = useCallback(async () => {
    if (!threadId || !pendingDeleteSession) return;
    if (readOnly) return;
    const isRunning = agentStatus === 'running' || agentStatus === 'connecting';
    if (isRunning) {
      toast.error(t('canvas.ai.historyDeleteBlocked', { default: 'Stop the current run before deleting.' }));
      return;
    }
    setIsDeletingSession(true);
    try {
      const res = await deleteThreadSession(threadId, pendingDeleteSession.index);
      try {
        const [hist, sess] = await Promise.all([
          getMessages(threadId),
          listThreadSessions(threadId),
        ]);
        if (Array.isArray(hist)) {
          const merged = [...hist].sort((a: any, b: any) => {
            const at = a?.created_at ? Date.parse(a.created_at) : 0;
            const bt = b?.created_at ? Date.parse(b.created_at) : 0;
            return at - bt;
          });
          setMessages(merged as any);
        } else {
          setMessages((prev) => prev.filter((m) => getMessageSessionIndex(m) !== pendingDeleteSession.index));
        }
        if (sess) {
          setCurrentSession(sess.current_session_index || res.current_session_index || 0);
          setSessions((sess.sessions || []).map((s: any) => ({
            index: s.index,
            title: s.title,
            started_at: s.started_at,
            ended_at: s.ended_at,
          })));
        } else {
          setCurrentSession(res.current_session_index || 0);
          setSessions((prev) => prev.filter((s) => s.index !== pendingDeleteSession.index));
        }
      } catch {
        setMessages((prev) => prev.filter((m) => getMessageSessionIndex(m) !== pendingDeleteSession.index));
        setCurrentSession(res.current_session_index || 0);
        setSessions((prev) => prev.filter((s) => s.index !== pendingDeleteSession.index));
      }
    } catch (e) {
      console.error('[CanvasAIPanel] delete session failed:', e);
      toast.error(t('canvas.ai.historyDeleteFailed', { default: 'Failed to delete session.' }));
    } finally {
      setIsDeletingSession(false);
      setConfirmDeleteOpen(false);
      setPendingDeleteSession(null);
    }
  }, [threadId, pendingDeleteSession, readOnly, agentStatus, t]);

  useEffect(() => {
    const images = referenceableMediaNodes.map((node: any) => ({
      id: `canvas-node-${node.id}`,
      storagePath: node.storagePath,
      fileId: node.fileId,
      label: node.fileName || node.content || node.id,
      width: node.width,
      height: node.height,
      nodeId: node.id,
      source: 'canvas-node' as const,
    }));
    dispatchSetReferenceImages(images);
  }, [referenceableMediaNodes]);

  const queueLabel =
    queuedMessages.length === 1
      ? '1 message queued'
      : `${queuedMessages.length} messages queued`;
  const closePanelLabel = t.has?.('canvas.ai.closePanel')
    ? t('canvas.ai.closePanel')
    : (t.has?.('canvas.ai.collapsePanel') ? t('canvas.ai.collapsePanel') : 'Close panel');
  const messageCountBySession = useMemo(() => {
    const counts = new Map<number, number>();
    messages.forEach((msg) => {
      if (msg.type === 'status') return;
      const index = getMessageSessionIndex(msg);
      counts.set(index, (counts.get(index) || 0) + 1);
    });
    return counts;
  }, [messages]);

  const groupedSessions = useMemo(() => {
    const getSessionTime = (session: { started_at?: string; ended_at?: string }) => {
      const stamp = session.ended_at || session.started_at;
      if (!stamp) return 0;
      const parsed = Date.parse(stamp);
      return Number.isNaN(parsed) ? 0 : parsed;
    };
    const sorted = [...(sessions || [])].sort((a, b) => {
      const at = getSessionTime(a);
      const bt = getSessionTime(b);
      if (bt !== at) return bt - at;
      return b.index - a.index;
    });
    const now = new Date();
    const day = now.getDay();
    const diff = (day + 6) % 7; // Monday as week start
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(now.getDate() - diff);
    const weekStartMs = weekStart.getTime();
    const recent: typeof sorted = [];
    const earlier: typeof sorted = [];
    sorted.forEach((s) => {
      const ts = getSessionTime(s);
      if (ts && ts >= weekStartMs) {
        recent.push(s);
      } else {
        earlier.push(s);
      }
    });
    return { recent, earlier };
  }, [sessions]);
  const filteredGroupedSessions = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    if (!query) return groupedSessions;
    const match = (session: { index: number; title: string }) => {
      const title = session.title?.trim();
      const fallbackTitle = t.has?.('canvas.ai.historyPanelChat')
        ? t('canvas.ai.historyPanelChat', { index: session.index })
        : `Chat #${session.index}`;
      const label = title || fallbackTitle;
      return label.toLowerCase().includes(query) || String(session.index).includes(query);
    };
    return {
      recent: groupedSessions.recent.filter(match),
      earlier: groupedSessions.earlier.filter(match),
    };
  }, [groupedSessions, historyQuery, t]);
  const hasHistoryResults =
    filteredGroupedSessions.recent.length > 0 || filteredGroupedSessions.earlier.length > 0;
  const formatSessionDate = useCallback((session: { started_at?: string; ended_at?: string }) => {
    const stamp = session.ended_at || session.started_at;
    if (!stamp) return '';
    const parsed = Date.parse(stamp);
    if (Number.isNaN(parsed)) return '';
    try {
      return new Date(parsed).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '';
    }
  }, []);
  const refreshSessions = useCallback(async () => {
    if (!threadId) return;
    const sess = await listThreadSessions(threadId);
    setSessions((sess.sessions || []).map((s: any) => ({
      index: s.index,
      title: s.title,
      started_at: s.started_at,
      ended_at: s.ended_at,
    })));
    setCurrentSession(sess.current_session_index || 0);
  }, [threadId]);
  const restoreSession = useCallback(async (sessionIndex: number) => {
    if (!threadId) return;
    setRestoringSessionIndex(sessionIndex);
    try {
      await resumeThreadSession(threadId, sessionIndex);
      setCurrentSession(sessionIndex);
      setHistoryOpen(false);
      setTimeout(() => {
        const el = scrollContainerRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      }, 0);
      try {
        await refreshSessions();
      } catch {}
    } finally {
      setRestoringSessionIndex(null);
      setPendingSessionIndex(null);
    }
  }, [refreshSessions, threadId]);
  const openHistoryMode = useCallback(async () => {
    if (!threadId) return;
    const next = !historyOpen;
    setHistoryOpen(next);
    if (!next) {
      setHistoryQuery('');
      return;
    }
    setHistoryLoading(true);
    try {
      await refreshSessions();
    } catch {
      // silent
    } finally {
      setHistoryLoading(false);
    }
  }, [historyOpen, refreshSessions, threadId]);

  const headerActionClass =
    'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60 disabled:cursor-not-allowed';
  const historyButtonLabel = t.has?.('canvas.ai.historyTitle')
    ? t('canvas.ai.historyTitle')
    : 'History';
  const historyAriaLabel = t.has?.('canvas.ai.historyAria')
    ? t('canvas.ai.historyAria')
    : 'History sessions';
  const renderSessionRow = (s: { index: number; title: string; started_at?: string; ended_at?: string }) => {
    const isActive = s.index === currentSession;
    const isRestoring = restoringSessionIndex === s.index;
    const label = s.title && s.title.trim()
      ? s.title
      : t('canvas.ai.historyPanelChat', { default: 'Chat #{index}', index: s.index });
    const dateLabel = formatSessionDate(s);
    const messageCount = messageCountBySession.get(s.index) || 0;
    const messageCountLabel = messageCount > 0
      ? (t.has?.('canvas.ai.historyMessageCount')
          ? t('canvas.ai.historyMessageCount', { count: messageCount })
          : `${messageCount} messages`)
      : '';
    const activeSessionLabel = t.has?.('canvas.ai.historyPanelBadge')
      ? t('canvas.ai.historyPanelBadge')
      : 'Current';

    return (
      <div
        key={s.index}
        role="button"
        tabIndex={0}
        className={cn(
          'group mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors border',
          isActive ? 'bg-muted/90 border-border/70' : 'bg-muted/50 border-transparent hover:bg-muted/80 hover:border-border/50',
          isRestoring ? 'opacity-70' : 'cursor-pointer',
        )}
        aria-disabled={isRestoring}
        onClick={async () => {
          if (!threadId || restoringSessionIndex !== null) return;
          const isRunning = agentStatus === 'running' || agentStatus === 'connecting';
          if (isRunning) {
            setPendingSessionIndex(s.index);
            setConfirmStopOpen(true);
            return;
          }
          await restoreSession(s.index);
        }}
        onKeyDown={async (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          if (!threadId || restoringSessionIndex !== null) return;
          const isRunning = agentStatus === 'running' || agentStatus === 'connecting';
          if (isRunning) {
            setPendingSessionIndex(s.index);
            setConfirmStopOpen(true);
            return;
          }
          await restoreSession(s.index);
        }}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{label}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {dateLabel && <span>{dateLabel}</span>}
            {dateLabel && messageCountLabel && <span aria-hidden>·</span>}
            {messageCountLabel && <span>{messageCountLabel}</span>}
            {isActive && (
              <>
                {(dateLabel || messageCountLabel) && <span aria-hidden>·</span>}
                <span className="rounded-full border border-border/60 px-1.5 py-0 text-[10px] leading-4 text-foreground/80">
                  {activeSessionLabel}
                </span>
              </>
            )}
          </div>
        </div>
        {isRestoring ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
            aria-label={t('common.delete', { default: 'Delete' })}
            disabled={readOnly}
            onClick={(e) => {
              e.stopPropagation();
              if (readOnly) return;
              const isRunning = agentStatus === 'running' || agentStatus === 'connecting';
              if (isRunning) {
                toast.error(t('canvas.ai.historyDeleteBlocked', { default: 'Stop the current run before deleting.' }));
                return;
              }
              setPendingDeleteSession({ index: s.index, title: label });
              setConfirmDeleteOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  };
  const historyPane = (
    <div className="h-full overflow-auto px-3 py-3 scrollbar-none">
      <div className="sticky top-0 z-10 -mx-3 mb-3 border-b border-border/60 bg-card/95 px-3 pb-3 pt-1 backdrop-blur-sm">
        <label htmlFor="ai-history-search" className="sr-only">
          {t.has?.('canvas.ai.historySearchAria')
            ? t('canvas.ai.historySearchAria')
            : 'Search history sessions'}
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/80" />
          <input
            id="ai-history-search"
            type="text"
            value={historyQuery}
            onChange={(event) => setHistoryQuery(event.target.value)}
            placeholder={
              t.has?.('canvas.ai.historySearchPlaceholder')
                ? t('canvas.ai.historySearchPlaceholder')
                : 'Search sessions'
            }
            className="h-8 w-full rounded-md border border-border/70 bg-background/80 pl-8 pr-8 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/50"
          />
          {historyQuery.trim() && (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
              aria-label={
                t.has?.('canvas.ai.historyClearSearch')
                  ? t('canvas.ai.historyClearSearch')
                  : 'Clear search'
              }
              onClick={() => setHistoryQuery('')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {historyLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-16 rounded-full" />
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-3 w-12 rounded-full mt-2" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      ) : (
        <div>
          {filteredGroupedSessions.recent.length > 0 && (
            <div className="pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
              {t('canvas.ai.historyGroupRecent', { default: 'This week' })}
            </div>
          )}
          {filteredGroupedSessions.recent.map((s) => renderSessionRow(s))}

          {filteredGroupedSessions.earlier.length > 0 && (
            <div className="pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
              {t('canvas.ai.historyGroupEarlier', { default: 'Earlier' })}
            </div>
          )}
          {filteredGroupedSessions.earlier.map((s) => renderSessionRow(s))}

          {!hasHistoryResults && historyQuery.trim().length > 0 && (
            <div className="py-5 text-center text-sm text-muted-foreground">
              {t.has?.('canvas.ai.historySearchEmpty')
                ? t('canvas.ai.historySearchEmpty')
                : 'No matching sessions'}
            </div>
          )}

          {!hasHistoryResults && historyQuery.trim().length === 0 && (
            <div className="py-5 text-center text-sm text-muted-foreground">
              {t('canvas.ai.noHistory', { default: 'No history yet' })}
            </div>
          )}
        </div>
      )}
    </div>
  );
  const header = (
    <div className="border-b border-border/60 px-3 py-2">
      <div className="flex items-center justify-end gap-1">
        {onToggleExpand && (
          <button
            className={headerActionClass}
            aria-label={
              expanded
                ? t('canvas.ai.collapsePanel', { default: 'Collapse panel' })
                : t('canvas.ai.expandPanel', { default: 'Expand panel' })
            }
            title={
              expanded
                ? t('canvas.ai.collapsePanel', { default: 'Collapse panel' })
                : t('canvas.ai.expandPanel', { default: 'Expand panel' })
            }
            aria-pressed={expanded}
            onClick={onToggleExpand}
          >
            {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        )}
        <button
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
            historyOpen ? 'bg-accent/70 text-foreground' : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
            !threadId ? 'opacity-60 cursor-not-allowed' : '',
          )}
          title={historyButtonLabel}
          aria-label={historyAriaLabel}
          aria-pressed={historyOpen}
          disabled={!threadId}
          onClick={openHistoryMode}
        >
          <History className="h-4 w-4" />
          <span>{historyButtonLabel}</span>
        </button>
        {threadId && (
          <button
            className={headerActionClass}
            aria-label={t('canvas.ai.newSession', { default: 'New session' })}
            title={t('canvas.ai.newSession', { default: 'New session' })}
            disabled={isCreatingSession || readOnly}
            onClick={async () => {
              if (!threadId || isCreatingSession) return;
              if (readOnly) return;
              setIsCreatingSession(true);
              try {
                const res = await resetThread(threadId);
                setCurrentSession(res.current_session_index || 0);
                setHistoryOpen(false);
                try {
                  await refreshSessions();
                } catch {}
              } catch (e) {
                console.error('Reset failed', e);
              } finally {
                setIsCreatingSession(false);
              }
            }}
          >
            {isCreatingSession ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <SquarePen className="w-4 h-4" />
            )}
          </button>
        )}
        {onClosePanel && (
          <button
            className={headerActionClass}
            aria-label={closePanelLabel}
            title={closePanelLabel}
            onClick={onClosePanel}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  const InitialEmptyState = (
    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
      <div className="text-center">
        <div className="text-foreground/80">Tell me anything on your mind — I’ll help structure and visualize it.</div>
      </div>
    </div>
  );

  // Broadcast agent run status to other UI parts (e.g., selection mini chat overlay)
  useEffect(() => {
    try {
      setAgentRunStatus(agentStatus);
    } catch {}
  }, [agentStatus]);

  // Listen to global stop requests (from selection mini chat overlay)
  useEffect(() => {
    const onRequestStop = async () => {
      try {
        if (agentStatus === 'running' || agentStatus === 'connecting') {
          await stopStreaming();
          setAgentStatus('idle');
        }
      } catch {}
    };
    try { window.addEventListener('agent:request-stop', onRequestStop as any); } catch {}
    return () => { try { window.removeEventListener('agent:request-stop', onRequestStop as any); } catch {} };
  }, [agentStatus, stopStreaming]);

  const LoadingState: React.FC = () => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [rowCount, setRowCount] = useState<number>(16);

    useEffect(() => {
      const compute = () => {
        const el = containerRef.current;
        if (!el) return;
        const h = el.clientHeight || 0;
        // 估算每个区块平均高度（段落/图块/工具块的混合）
        const avg = 72; // px
        const n = Math.max(12, Math.min(48, Math.ceil(h / avg)));
        setRowCount(n);
      };
      compute();
      const onResize = () => compute();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }, []);

    const Paragraph = ({ variant = 0 }: { variant?: number }) => (
      <div className="w-full max-w-[820px]">
        <div className="h-[14px] w-[96%] rounded bg-muted" />
        <div className="mt-2 h-[14px] rounded bg-muted/90" style={{ width: variant % 3 === 0 ? '82%' : variant % 3 === 1 ? '76%' : '88%' }} />
        <div className="mt-2 h-[14px] rounded bg-muted/80" style={{ width: variant % 3 === 0 ? '64%' : variant % 3 === 1 ? '58%' : '72%' }} />
        {variant % 2 === 0 && <div className="mt-2 h-[14px] w-[48%] rounded bg-muted/70" />}
      </div>
    );

    const ImageBlock = () => (
      <div className="w-full max-w-[860px]">
        <div className="h-48 w-full rounded-xl bg-muted/80 border" />
        <div className="mt-3 h-3 w-[44%] rounded bg-muted/70" />
      </div>
    );

    const ToolBlock = () => (
      <div className="w-full max-w-[760px] rounded-xl bg-muted/60 border p-3">
        <div className="flex items-center gap-1 mb-3">
          <div className="h-2.5 w-2.5 rounded-full bg-muted/90" />
          <div className="h-2.5 w-2.5 rounded-full bg-muted/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-muted/70" />
        </div>
        <div className="space-y-2">
          <div className="h-3 w-[92%] rounded bg-muted" />
          <div className="h-3 w-[66%] rounded bg-muted/80" />
          <div className="h-3 w-[78%] rounded bg-muted/90" />
        </div>
      </div>
    );

    const pattern = (i: number) => {
      // 稳定的层次：每 7 个为一组，包含 1 个图片 + 1 个工具块 + 多个段落
      if (i % 7 === 3) return <ImageBlock />;
      if (i % 7 === 5) return <ToolBlock />;
      return <Paragraph variant={i} />;
    };

    return (
      <div ref={containerRef} className="h-full w-full animate-pulse">
        {/* 顶部轻量工具/标签占位 */}
        <div className="flex items-center gap-2 mb-3">
          <div className="h-5 w-16 rounded-full bg-muted" />
          <div className="h-5 w-12 rounded-full bg-muted/80" />
          <div className="h-5 w-24 rounded-full bg-muted/70" />
        </div>
        <div className="h-[calc(100%-28px)] w-full space-y-4 overflow-hidden">
          {Array.from({ length: rowCount }).map((_, i) => (
            <div key={i} className="w-full">
              {pattern(i)}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Auto-submit initial prompt from URL or sessionStorage once (after handleSubmit is defined)
  const autoSubmittedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!canvasId || autoSubmittedRef.current) return;
    // Only auto-submit when no messages are present to avoid duplicates on reload
    if (messages && messages.length > 0) return;

    const urlPrompt = searchParams.get('prompt');
    let initialPrompt: string | null = null;
    if (urlPrompt && urlPrompt.trim()) {
      initialPrompt = urlPrompt;
    } else if (searchParams.get('p') === '1') {
      try { initialPrompt = sessionStorage.getItem(`canvas:initialPrompt:${canvasId}`); } catch {}
    }

    let initialAttachments: import('@/lib/api').MessageAttachmentInput[] = [];
    try {
      const raw = sessionStorage.getItem(`canvas:initialAttachments:${canvasId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          initialAttachments = parsed.filter(
            (item) => item && typeof item.file_id === 'string' && item.file_id.trim(),
          );
        }
      }
    } catch {}

    const hasPrompt = Boolean(initialPrompt && initialPrompt.trim());
    const hasAttachments = initialAttachments.length > 0;
    if (!hasPrompt && !hasAttachments) return;

    // Guard immediately to avoid race on dependency changes
    autoSubmittedRef.current = true;

    (async () => {
      try {
        const res = await ensureCanvasThread(canvasId);
        const tid = res.thread_id;
        setThreadId(tid);
        // Auto-run initial prompt: let backend decide model defaults
        await handleSubmit(initialPrompt?.trim() || '', {
          model_name: selectedModel || undefined,
          attachments: hasAttachments ? initialAttachments : undefined,
        }, tid);

        // Clean URL params and storage using history replace without Next router
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete('prompt');
          url.searchParams.delete('p');
          // Do not set any view/canvasId params; URL is /canvas/[id]
          window.history.replaceState({}, '', url.toString());
        } catch {}
        try { sessionStorage.removeItem(`canvas:initialPrompt:${canvasId}`); } catch {}
        try { sessionStorage.removeItem(`canvas:initialAttachments:${canvasId}`); } catch {}
      } catch (e) {
        console.warn('[CanvasAIPanel] Auto-submit initial prompt failed:', e);
      }
    })();
  }, [canvasId, searchParams, selectedModel, handleSubmit, messages]);

  // [已移除] 乐观应用逻辑 - 现在依赖 Yjs 实时同步
  // AI 编辑通过 Realtime 服务直接写入 Yjs 文档，前端通过 CanvasCollaborationManager 自动同步



  return (
    <div className={cn('relative h-full bg-card text-foreground', className)}>
      <div className="relative flex h-full flex-col">
        {header}
        {historyOpen ? (
          <div className="flex-1 min-h-0">{historyPane}</div>
        ) : (
          <div className="flex-1 overflow-auto px-3 py-2 scrollbar-none" ref={scrollContainerRef}>
            {isLoading ? (
              <LoadingState />
            ) : threadId ? (
              <ThreadContent
                messages={filteredMessages}
                streamingReasoningContent={streamingReasoningText}
                streamingToolCall={streamingToolCall}
                streamHookStatus={streamStatus}
                agentStatus={agentStatus}
                showStreamingTools={false}
                assistantMarkdownClassName="ai-markdown"
                forceShowLoader={
                  (agentStatus === 'running' || agentStatus === 'connecting') ||
                  Boolean(
                    streamingToolCall &&
                    (streamingToolCall.name === 'canvas_edit' ||
                     streamingToolCall.xml_tag_name === 'canvas_edit')
                  )
                }
                hasStreamingAssistant={hasStreamingAssistant}
                showResponseTime={true}
                runStartedAt={runStartedAt}
                handleToolClick={() => {}}
                handleOpenFileViewer={() => {}}
                onCtaAction={handleCtaAction}
                readOnly={readOnly}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                {InitialEmptyState}
              </div>
            )}
          </div>
        )}

        {/* 确认停止并切换会话的系统弹窗 */}
        <AlertDialog open={confirmStopOpen} onOpenChange={setConfirmStopOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>停止当前任务并切换会话？</AlertDialogTitle>
              <AlertDialogDescription>
                当前有任务正在运行。继续将停止当前任务，然后切换到所选历史会话。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setConfirmStopOpen(false); setPendingSessionIndex(null); }}>
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  try {
                    if (agentStatus === 'running' || agentStatus === 'connecting') {
                      try { await stopStreaming(); } catch {}
                    }
                    if (pendingSessionIndex !== null) {
                      const target = pendingSessionIndex;
                      setConfirmStopOpen(false);
                      await restoreSession(target);
                    } else {
                      setConfirmStopOpen(false);
                    }
                  } catch {
                    setConfirmStopOpen(false);
                  }
                }}
              >
                停止并切换
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={confirmDeleteOpen}
          onOpenChange={(open) => {
            setConfirmDeleteOpen(open);
            if (!open) setPendingDeleteSession(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('canvas.ai.historyDeleteTitle', { default: 'Delete session?' })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('canvas.ai.historyDeleteDescription', {
                  default: 'This will permanently remove all messages in this session.',
                  title: pendingDeleteSession?.title || '',
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeletingSession}>
                {t('common.cancel', { default: 'Cancel' })}
              </AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmDeleteSession} disabled={isDeletingSession}>
                {isDeletingSession ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t('common.delete', { default: 'Delete' })
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {!historyOpen && (
          <div className="px-3 py-3">
            {!readOnly && (
              <>
              {queuedMessages.length > 0 && (
                <div className="mx-auto mb-3 w-full max-w-4xl rounded-xl border border-border/60 bg-muted/30">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                    onClick={() => setQueueCollapsed((prev) => !prev)}
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <ListOrdered className="h-4 w-4 text-muted-foreground" />
                      <span>{queueLabel}</span>
                    </div>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 text-muted-foreground transition-transform',
                        queueCollapsed ? '-rotate-90' : 'rotate-0',
                      )}
                    />
                  </button>
                  {!queueCollapsed && (
                    <div className="px-3 pb-3">
                      {queuedMessages.map((item, index) => (
                        <div key={item.id} className="group flex items-start gap-2 py-1.5">
                          <span className="pt-1 text-xs text-muted-foreground">{index + 1}.</span>
                          <div className="flex-1">
                            <textarea
                              value={item.text}
                              onChange={(event) => {
                                const nextText = event.target.value;
                                setQueuedMessages((prev) =>
                                  prev.map((msg) =>
                                    msg.id === item.id ? { ...msg, text: nextText } : msg,
                                  ),
                                );
                              }}
                              rows={1}
                              placeholder={item.attachments?.length ? 'Message (optional)' : 'Message'}
                              className="min-h-[24px] w-full resize-none rounded-md border border-transparent bg-transparent px-1 text-sm text-foreground outline-none transition-colors focus:border-border/70"
                            />
                            {(item.attachments?.length || item.reference_images?.length) ? (
                              <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                {item.attachments?.length ? (
                                  <span>{item.attachments.length} attachment{item.attachments.length > 1 ? 's' : ''}</span>
                                ) : null}
                                {item.reference_images?.length ? (
                                  <span>{item.reference_images.length} reference image{item.reference_images.length > 1 ? 's' : ''}</span>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => setQueuedMessages((prev) => prev.filter((msg) => msg.id !== item.id))}
                            className="mt-1 rounded-md border border-transparent p-1 text-muted-foreground transition-colors hover:border-border/60 hover:bg-muted/40 hover:text-foreground"
                            aria-label="Remove queued message"
                            title="Remove"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <ChatInput
                ref={chatInputRef}
                bgColor="bg-background"
                selectionCount={Array.from(store.selections?.nodeIds || []).length}
                autoFocus={false}
                variant="panel"
                onSubmit={async (text, opts) => {
                  const isRunning = agentStatus === 'running' || agentStatus === 'connecting';
                  if (isRunning) {
                    enqueueDraftFromInput(text, opts);
                    return;
                  }
                  // Ensure stable thread id to avoid setState race
                  let tid = threadId;
                  if (!tid) {
                    try {
                      const res = await ensureCanvasThread(canvasId);
                      tid = res.thread_id;
                      setThreadId(tid);
                    } catch (e) {
                      console.error('[CanvasAIPanel] ensure thread on submit failed:', e);
                      return;
                    }
                  }
                  if (queuedMessages.length > 0 && queuePaused) {
                    setQueuePaused(false);
                  }
                  await handleSubmit(text, opts, tid);
                }}
                loading={agentStatus !== 'idle'}
                isAgentRunning={agentStatus === 'running' || agentStatus === 'connecting'}
                onStopAgent={async () => { try { await stopStreaming(); } catch {} setAgentStatus('idle'); }}
                allowSendWhileRunning={true}
                showPauseButton={true}
                onPauseQueue={handlePauseQueue}
                hideAgentSelection={false}
                enableAdvancedConfig={true}
                showScrollToBottomIndicator={showScrollToBottom}
                onScrollToBottom={scrollToBottom}
              />
              <ReferenceImagePickerDialog
                open={Boolean(referencePicker)}
                payload={referencePicker}
                onOpenChange={(open) => {
                  if (!open && !isReferenceSubmitting) setReferencePicker(null);
                }}
                onConfirm={handleReferenceSelection}
              />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CanvasAIPanel;
