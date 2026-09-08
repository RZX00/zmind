'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History, Loader2, Sparkles, SquarePen, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  addUserMessage,
  ensureDocThread,
  getAgentRuns,
  getMessages,
  listThreadSessions,
  peekDocThread,
  resetThread,
  resumeThreadSession,
  startAgent,
  type MessageAttachmentInput,
} from '@/lib/api';
import { useAgentStream } from '@/hooks/useAgentStream';
import { ThreadContent } from '@/components/thread/content/ThreadContent';
import { ChatInput } from '@/components/thread/chat-input/chat-input';
import type { UnifiedMessage, CtaAction } from '@/components/thread/types';
import { safeJsonParse, isFinalAssistantMeta, isStreamingChunkMeta } from '@/components/thread/utils';
import type { RunMode } from '@/lib/run-mode';
import { useModelSelection } from '@/hooks/use-model-selection';

export interface DocEditorBridge {
  hasSelection: () => boolean;
  getSelectionMarkdown: () => string;
  getDocumentMarkdown: () => string;
}

interface DocAIPanelProps {
  itemId: string;
  docTitle?: string;
  editorBridge: DocEditorBridge | null;
  className?: string;
  onClosePanel?: () => void;
  onBeforeAgentRun?: () => Promise<void> | void;
  onDocMutationApplied?: (event: {
    toolName: 'doc_apply_ops' | 'doc_undo_revision' | 'doc_update_title' | 'doc_generate_image_and_insert';
    revisionId?: string;
    version?: number;
    summary?: string;
    idempotentReplay?: boolean;
    title?: string;
  }) => void;
}

interface ThreadSessionItem {
  index: number;
  title: string;
  started_at?: string;
  ended_at?: string;
  preview?: string;
}

interface ParsedDocToolEvent {
  eventKey: string;
  toolName: string;
  success: boolean;
  error?: string;
  revisionId?: string;
  version?: number;
  summary?: string;
  idempotentReplay?: boolean;
  title?: string;
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const sortByCreatedAt = (messages: UnifiedMessage[]) =>
  [...messages].sort((a, b) => {
    const at = a?.created_at ? Date.parse(a.created_at) : 0;
    const bt = b?.created_at ? Date.parse(b.created_at) : 0;
    return at - bt;
  });

const toUnifiedMessages = (
  messages: any[],
  fallbackThreadId: string,
): UnifiedMessage[] =>
  (messages || []).map((item) => ({
    message_id: item?.message_id || null,
    thread_id: item?.thread_id || fallbackThreadId,
    type: (item?.type || 'system') as UnifiedMessage['type'],
    is_llm_message: Boolean(item?.is_llm_message),
    content: typeof item?.content === 'string' ? item.content : JSON.stringify(item?.content || {}),
    metadata: typeof item?.metadata === 'string' ? item.metadata : JSON.stringify(item?.metadata || {}),
    created_at: item?.created_at || new Date().toISOString(),
    updated_at: item?.updated_at || item?.created_at || new Date().toISOString(),
    agent_id: item?.agent_id,
    agents: item?.agents,
  }));

const resolveSessionIndex = (rawMeta: unknown): number => {
  const meta = typeof rawMeta === 'string' ? safeJsonParse<any>(rawMeta, {}) : (rawMeta || {});
  const value: any = meta && (meta as any).session_index;
  const parsed = typeof value === 'number' ? value : (value ? parseInt(String(value), 10) || 0 : 0);
  return parsed || 0;
};

const getMessageSessionIndex = (message: UnifiedMessage): number => resolveSessionIndex((message as any)?.metadata);

const asObject = (value: unknown): Record<string, any> | null =>
  value && typeof value === 'object' ? (value as Record<string, any>) : null;

const parseUnknown = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
};

const parseDocToolEvent = (message: UnifiedMessage): ParsedDocToolEvent | null => {
  if (message.type !== 'tool') return null;

  const metadata = safeJsonParse<any>(message.metadata, {});
  const execution = metadata?.frontend_content?.tool_execution;
  const contentParsed = safeJsonParse<any>(message.content, {});

  const toolName = asText(
    execution?.function_name ||
      execution?.name ||
      contentParsed?.name ||
      contentParsed?.function_name,
  );
  if (!toolName.startsWith('doc_')) return null;

  const resultObj = asObject(execution?.result);
  const resultOutput = parseUnknown(resultObj?.output);
  const outputObj = asObject(resultOutput);
  const error = asText(
    resultObj?.error ||
      execution?.error ||
      outputObj?.error ||
      contentParsed?.error,
  );
  const success =
    typeof resultObj?.success === 'boolean'
      ? resultObj.success
      : error.length === 0;

  const rawVersion = outputObj?.version ?? outputObj?.newVersion ?? outputObj?.new_version;
  const parsedVersion =
    typeof rawVersion === 'number'
      ? rawVersion
      : typeof rawVersion === 'string'
        ? Number.parseInt(rawVersion, 10)
        : Number.NaN;
  const version = Number.isFinite(parsedVersion) ? parsedVersion : undefined;

  const revisionId = asText(
    outputObj?.revisionId ||
      outputObj?.revision_id ||
      outputObj?.revision?.revisionId ||
      outputObj?.revision?.id,
  ) || undefined;
  const summary = asText(outputObj?.summary) || undefined;
  const idempotentReplay =
    typeof outputObj?.idempotentReplay === 'boolean'
      ? outputObj.idempotentReplay
      : undefined;
  const title = asText(outputObj?.title || outputObj?.docTitle || outputObj?.doc_title) || undefined;

  const eventKey =
    asText(message.message_id) ||
    asText(resultObj?.tool_call_id) ||
    asText(execution?.tool_call_id) ||
    `${toolName}:${asText(message.created_at) || 'unknown'}`;

  return {
    eventKey,
    toolName,
    success,
    error: error || undefined,
    revisionId,
    version,
    summary,
    idempotentReplay,
    title,
  };
};

export default function DocAIPanel({
  itemId,
  docTitle,
  editorBridge,
  className,
  onClosePanel,
  onBeforeAgentRun,
  onDocMutationApplied,
}: DocAIPanelProps) {
  const { selectedModel } = useModelSelection();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [currentSession, setCurrentSession] = useState(0);
  const [sessions, setSessions] = useState<ThreadSessionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [restoringSessionIndex, setRestoringSessionIndex] = useState<number | null>(null);
  const [agentStatus, setAgentStatus] = useState<'idle' | 'running' | 'connecting'>('idle');
  const lastStartedRunIdRef = useRef<string | null>(null);
  const agentRunsCheckedRef = useRef(false);
  const tempIdCounterRef = useRef(0);
  const handledDocToolEventsRef = useRef<Set<string>>(new Set());

  const handleDocToolEvent = useCallback(
    (message: UnifiedMessage) => {
      const parsed = parseDocToolEvent(message);
      if (!parsed) return;
      if (handledDocToolEventsRef.current.has(parsed.eventKey)) return;
      handledDocToolEventsRef.current.add(parsed.eventKey);

      if (
        parsed.toolName !== 'doc_apply_ops' &&
        parsed.toolName !== 'doc_generate_image_and_insert' &&
        parsed.toolName !== 'doc_undo_revision' &&
        parsed.toolName !== 'doc_update_title'
      ) {
        return;
      }

      if (!parsed.success) {
        toast.error(parsed.error || 'AI failed to update this document.');
        return;
      }

      onDocMutationApplied?.({
        toolName: parsed.toolName,
        revisionId: parsed.revisionId,
        version: parsed.version,
        summary: parsed.summary,
        idempotentReplay: parsed.idempotentReplay,
        title: parsed.title,
      });

      if (parsed.toolName === 'doc_undo_revision') {
        toast.success('Revision has been undone.');
        return;
      }
      if (parsed.toolName === 'doc_update_title') {
        toast.success('AI updated the document title.');
        return;
      }
      if (parsed.toolName === 'doc_generate_image_and_insert') {
        toast.success('AI generated image(s) and inserted them into the document.');
        return;
      }
      if (parsed.idempotentReplay) {
        toast.success('Document is already up to date.');
        return;
      }
      toast.success('AI changes were applied to the document.');
    },
    [onDocMutationApplied],
  );

  const {
    status: streamStatus,
    reasoningText: streamingReasoningText,
    toolCall: streamingToolCall,
    hasStreamingAssistant,
    runStartedAt,
    startStreaming,
    stopStreaming,
  } = useAgentStream(
    {
      onMessage: (msg) => {
        handleDocToolEvent(msg);
        const incomingMeta = safeJsonParse<any>(msg.metadata, {});
        const incomingRunId = incomingMeta?.thread_run_id ? String(incomingMeta.thread_run_id) : null;
        const incomingIsFinal = isFinalAssistantMeta(incomingMeta);

        setMessages((prev) => {
          let nextMessage = msg;
          const normalizedMeta = typeof incomingMeta === 'object' && incomingMeta ? { ...incomingMeta } : {};
          if (normalizedMeta.session_index == null) {
            normalizedMeta.session_index = currentSession || 0;
            nextMessage = {
              ...nextMessage,
              metadata: JSON.stringify(normalizedMeta),
            };
          }

          const streamingIndex =
            msg.type === 'assistant' && incomingIsFinal && incomingRunId
              ? prev.findIndex((item) => {
                  if (item.type !== 'assistant') return false;
                  const itemMeta = typeof item.metadata === 'string'
                    ? safeJsonParse<any>(item.metadata, {})
                    : (item.metadata || {});
                  const runId = itemMeta?.thread_run_id ? String(itemMeta.thread_run_id) : null;
                  return runId && runId === incomingRunId && isStreamingChunkMeta(itemMeta);
                })
              : -1;

          if (msg.type === 'assistant' && streamingIndex >= 0) {
            const streamingMessage = prev[streamingIndex];
            const streamingParsed = safeJsonParse<any>(streamingMessage.content, {});
            const streamingText = asText(streamingParsed?.content);
            const incomingParsed = safeJsonParse<any>(nextMessage.content, {});
            const incomingText = asText(incomingParsed?.content);
            if (!incomingText && streamingText) {
              nextMessage = {
                ...nextMessage,
                content: JSON.stringify({
                  ...incomingParsed,
                  content: streamingText,
                }),
              };
            }
          }

          const exists = prev.some((item) => item.message_id === nextMessage.message_id);
          if (exists) {
            const next = prev.map((item) => (item.message_id === nextMessage.message_id ? nextMessage : item));
            if (streamingIndex >= 0 && prev[streamingIndex].message_id !== nextMessage.message_id) {
              next.splice(streamingIndex, 1);
            }
            return next;
          }

          if (streamingIndex >= 0) {
            const next = prev.slice();
            next[streamingIndex] = nextMessage;
            return next;
          }

          if (nextMessage.type === 'user') {
            const incoming = safeJsonParse<any>(nextMessage.content, {});
            const incomingText = asText(incoming?.content);
            const optimisticIndex = prev.findIndex((item) => {
              if (item.type !== 'user' || !item.message_id?.startsWith('temp-')) return false;
              const parsed = safeJsonParse<any>(item.content, {});
              return asText(parsed?.content) === incomingText;
            });
            if (optimisticIndex >= 0) {
              const next = prev.slice();
              next[optimisticIndex] = nextMessage;
              return next;
            }
          }

          return [...prev, nextMessage];
        });
      },
      onStatusChange: (status) => {
        if (status === 'streaming') {
          setAgentStatus('running');
          return;
        }
        if (status === 'connecting') {
          setAgentStatus('connecting');
          return;
        }
        if (['idle', 'completed', 'stopped', 'agent_not_running', 'error', 'failed'].includes(status)) {
          setAgentStatus('idle');
        }
      },
      onError: (error) => {
        console.error('[DocAIPanel] stream error:', error);
      },
      onClose: () => {
        setAgentStatus('idle');
      },
    },
    threadId || '',
    setMessages,
  );

  const refreshSessions = useCallback(async (targetThreadId: string) => {
    const payload = await listThreadSessions(targetThreadId);
    const nextSessions = (payload.sessions || []).map((session: any) => ({
      index: session.index,
      title: session.title,
      started_at: session.started_at,
      ended_at: session.ended_at,
      preview: session.preview,
    }));
    setSessions(nextSessions);
    setCurrentSession(payload.current_session_index || 0);
  }, []);

  useEffect(() => {
    agentRunsCheckedRef.current = false;
  }, [threadId]);

  useEffect(() => {
    handledDocToolEventsRef.current.clear();
  }, [itemId, threadId]);

  useEffect(() => {
    if (!threadId || agentRunsCheckedRef.current) return;
    let cancelled = false;
    agentRunsCheckedRef.current = true;
    (async () => {
      try {
        const runs = await getAgentRuns(threadId);
        if (cancelled) return;
        const running = (runs || []).find((run) => run.status === 'running');
        if (!running?.id) return;
        lastStartedRunIdRef.current = running.id;
        setAgentStatus('connecting');
        startStreaming(running.id);
      } catch (error) {
        console.warn('[DocAIPanel] failed to restore running run:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, startStreaming]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setThreadId(null);
    setMessages([]);
    setCurrentSession(0);
    setSessions([]);
    setAgentStatus('idle');
    setHistoryOpen(false);

    (async () => {
      try {
        const peek = await peekDocThread(itemId);
        if (cancelled || !peek?.exists || !peek.thread_id) {
          return;
        }
        setThreadId(peek.thread_id);
        const history = await getMessages(peek.thread_id);
        if (cancelled || !Array.isArray(history)) {
          return;
        }
        setMessages(sortByCreatedAt(toUnifiedMessages(history as any[], peek.thread_id)));
        try {
          await refreshSessions(peek.thread_id);
        } catch (error) {
          console.warn('[DocAIPanel] failed to load sessions:', error);
        }
      } catch (error) {
        console.warn('[DocAIPanel] failed to bootstrap history:', error);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [itemId, refreshSessions]);

  const ensureThreadId = useCallback(async () => {
    if (threadId) return threadId;
    const result = await ensureDocThread(itemId);
    setThreadId(result.thread_id);
    return result.thread_id;
  }, [threadId, itemId]);

  const buildDocContext = useCallback(() => {
    const selectionMarkdown = asText(editorBridge?.getSelectionMarkdown());
    const fullMarkdown = asText(editorBridge?.getDocumentMarkdown());
    const excerpt = fullMarkdown.slice(0, 12000);
    return {
      surface: 'doc',
      mode: selectionMarkdown ? 'selection' : 'document',
      doc_item_id: itemId,
      doc_title: asText(docTitle) || 'Untitled Doc',
      ...(selectionMarkdown
        ? {
            selection: {
              markdown: selectionMarkdown.slice(0, 8000),
              char_count: selectionMarkdown.length,
              truncated: selectionMarkdown.length > 8000,
            },
          }
        : {}),
      ...(excerpt
        ? {
            document: {
              excerpt,
              char_count: excerpt.length,
              truncated: fullMarkdown.length > excerpt.length,
            },
          }
        : {}),
    };
  }, [editorBridge, itemId, docTitle]);

  const handleSubmit = useCallback(
    async (
      rawText: string,
      options?: {
        model_name?: string;
        run_mode?: RunMode;
        attachments?: MessageAttachmentInput[];
        cta?: {
          action: string;
          payload?: any;
          label?: string;
        };
      },
    ) => {
      const messageText = rawText.trim();
      const hasAttachments = Boolean(options?.attachments && options.attachments.length > 0);
      if (!messageText && !hasAttachments) return;

      try {
        await onBeforeAgentRun?.();
      } catch (error) {
        console.error('[DocAIPanel] pre-run sync failed:', error);
        toast.error('Please fix pending save errors before running AI.');
        return;
      }

      let resolvedThreadId = threadId;
      if (!resolvedThreadId) {
        try {
          resolvedThreadId = await ensureThreadId();
        } catch (error) {
          console.error('[DocAIPanel] ensure thread failed:', error);
          toast.error('Failed to open AI thread for this document.');
          return;
        }
      }

      const optimisticMessageId = `temp-${Date.now()}-${(++tempIdCounterRef.current).toString(36)}`;
      setMessages((prev) => [
        ...prev,
        {
          message_id: optimisticMessageId,
          thread_id: resolvedThreadId,
          type: 'user',
          is_llm_message: false,
          content: JSON.stringify({ role: 'user', content: messageText }),
          metadata: JSON.stringify({ session_index: currentSession || 0 }),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
      setAgentStatus('connecting');

      try {
        const docContext = buildDocContext();
        const createdMessage = await addUserMessage(
          resolvedThreadId,
          messageText,
          undefined,
          undefined,
          options?.attachments,
          options?.cta?.action,
          options?.cta?.payload,
          options?.cta?.label,
          docContext,
        );

        const fallbackMeta: Record<string, any> = { session_index: currentSession || 0 };
        if (docContext) {
          fallbackMeta.doc_context = docContext;
        }
        if (options?.attachments && options.attachments.length > 0) {
          fallbackMeta.attachments = options.attachments;
        }

        const runMode: RunMode = 'agent';
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

        const run = await startAgent(resolvedThreadId, {
          model_name: options?.model_name || selectedModel || undefined,
          stream: true,
          agent_id: 'Zmind',
          run_mode: runMode,
          interaction_surface: 'doc',
          client_message: clientMessageHint,
        });
        lastStartedRunIdRef.current = run.agent_run_id;
        startStreaming(run.agent_run_id);
      } catch (error) {
        console.error('[DocAIPanel] submit failed:', error);
        setMessages((prev) => prev.filter((item) => item.message_id !== optimisticMessageId));
        setAgentStatus('idle');
        toast.error('Failed to send message. Please retry.');
      }
    },
    [
      threadId,
      ensureThreadId,
      buildDocContext,
      startStreaming,
      selectedModel,
      currentSession,
      onBeforeAgentRun,
    ],
  );

  const filteredMessages = useMemo(() => {
    const targetSession = currentSession || 0;
    return messages.filter((message) => {
      if (message.type === 'status') return true;
      return getMessageSessionIndex(message) === targetSession;
    });
  }, [messages, currentSession]);

  const ensureThreadForSessionActions = useCallback(async (): Promise<string | null> => {
    if (threadId) return threadId;
    try {
      return await ensureThreadId();
    } catch (error) {
      console.error('[DocAIPanel] ensure thread for session actions failed:', error);
      toast.error('Failed to open AI history for this document.');
      return null;
    }
  }, [threadId, ensureThreadId]);

  const handleStop = useCallback(async () => {
    try {
      await stopStreaming();
      setAgentStatus('idle');
    } catch (error) {
      console.error('[DocAIPanel] stop failed:', error);
    }
  }, [stopStreaming]);

  const handleCtaAction = useCallback(
    async (cta: CtaAction) => {
      if (!cta?.action) return;
      const label = asText(cta.label || cta.action);
      if (!label) return;
      await handleSubmit(label, {
        cta: {
          action: cta.action,
          payload: cta.payload,
          label: cta.label,
        },
      });
    },
    [handleSubmit],
  );

  const openHistoryMode = useCallback(async () => {
    const targetThreadId = await ensureThreadForSessionActions();
    if (!targetThreadId) return;
    const next = !historyOpen;
    setHistoryOpen(next);
    if (!next) return;
    setHistoryLoading(true);
    try {
      await refreshSessions(targetThreadId);
    } catch (error) {
      console.warn('[DocAIPanel] failed to refresh sessions:', error);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyOpen, refreshSessions, ensureThreadForSessionActions]);

  const restoreSession = useCallback(
    async (sessionIndex: number) => {
      const targetThreadId = await ensureThreadForSessionActions();
      if (!targetThreadId) return;
      setRestoringSessionIndex(sessionIndex);
      try {
        await resumeThreadSession(targetThreadId, sessionIndex);
        setCurrentSession(sessionIndex);
        setHistoryOpen(false);
        try {
          const history = await getMessages(targetThreadId);
          if (Array.isArray(history)) {
            setMessages(sortByCreatedAt(toUnifiedMessages(history as any[], targetThreadId)));
          }
        } catch {}
        try {
          await refreshSessions(targetThreadId);
        } catch {}
      } catch (error) {
        console.error('[DocAIPanel] failed to restore session:', error);
        toast.error('Failed to open history session.');
      } finally {
        setRestoringSessionIndex(null);
      }
    },
    [refreshSessions, ensureThreadForSessionActions],
  );

  const handleNewSession = useCallback(async () => {
    if (isCreatingSession) return;
    setIsCreatingSession(true);
    try {
      const hadExistingThread = Boolean(threadId);
      const targetThreadId = await ensureThreadForSessionActions();
      if (!targetThreadId) return;

      if (!hadExistingThread) {
        setCurrentSession(0);
        setHistoryOpen(false);
        setMessages([]);
        try {
          await refreshSessions(targetThreadId);
        } catch {}
        return;
      }

      const reset = await resetThread(targetThreadId);
      setCurrentSession(reset.current_session_index || 0);
      setHistoryOpen(false);
      try {
        await refreshSessions(targetThreadId);
      } catch {}
      try {
        const history = await getMessages(targetThreadId);
        if (Array.isArray(history)) {
          setMessages(sortByCreatedAt(toUnifiedMessages(history as any[], targetThreadId)));
        }
      } catch {}
    } catch (error) {
      console.error('[DocAIPanel] failed to create new session:', error);
      toast.error('Failed to create a new session.');
    } finally {
      setIsCreatingSession(false);
    }
  }, [threadId, isCreatingSession, refreshSessions, ensureThreadForSessionActions]);

  const formatSessionDate = useCallback((session: ThreadSessionItem): string => {
    const stamp = session.ended_at || session.started_at;
    if (!stamp) return '';
    const parsed = Date.parse(stamp);
    if (Number.isNaN(parsed)) return '';
    try {
      return new Date(parsed).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }, []);

  const historyPane = (
    <div className="h-full overflow-auto px-3 py-2">
      {historyLoading ? (
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="h-9 animate-pulse rounded-md bg-muted/60" />
          <div className="h-9 animate-pulse rounded-md bg-muted/60" />
          <div className="h-9 animate-pulse rounded-md bg-muted/60" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">No history yet.</div>
      ) : (
        <div className="space-y-1">
          {sessions
            .slice()
            .sort((a, b) => b.index - a.index)
            .map((session) => {
              const isActive = session.index === currentSession;
              const isRestoring = restoringSessionIndex === session.index;
              const dateLabel = formatSessionDate(session);
              return (
                <button
                  key={session.index}
                  type="button"
                  className={cn(
                    'w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
                    isActive
                      ? 'border-foreground/30 bg-accent/70'
                      : 'border-border/60 hover:bg-accent/40',
                  )}
                  disabled={isRestoring}
                  onClick={() => {
                    void restoreSession(session.index);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {session.title || `Session ${session.index}`}
                      </div>
                      {(session.preview || dateLabel) && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {session.preview || dateLabel}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dateLabel && (
                        <span className="text-[11px] text-muted-foreground">{dateLabel}</span>
                      )}
                      {isRestoring && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                    </div>
                  </div>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-card', className)}>
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
          <Sparkles className="h-4 w-4 text-emerald-500" />
          <span>AI Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={cn(
              'inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors',
              historyOpen ? 'bg-accent/70 text-foreground' : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
              isLoading ? 'cursor-not-allowed opacity-60' : '',
            )}
            disabled={isLoading}
            title="History"
            onClick={() => {
              void openHistoryMode();
            }}
          >
            <History className="h-4 w-4" />
            <span>History</span>
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            title="New session"
            disabled={isCreatingSession || isLoading}
            onClick={() => {
              void handleNewSession();
            }}
          >
            {isCreatingSession ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SquarePen className="h-4 w-4" />
            )}
            <span>New</span>
          </button>
          {onClosePanel && (
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Close panel"
              onClick={onClosePanel}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading AI history...
          </div>
        ) : historyOpen ? (
          historyPane
        ) : (
          <div
            className="h-full overflow-y-auto overflow-x-hidden overscroll-contain"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            <ThreadContent
              messages={filteredMessages}
              streamingReasoningContent={streamingReasoningText}
              streamingToolCall={streamingToolCall}
              agentStatus={agentStatus}
              streamHookStatus={streamStatus}
              hasStreamingAssistant={hasStreamingAssistant}
              runStartedAt={runStartedAt}
              showResponseTime
              handleToolClick={() => {}}
              handleOpenFileViewer={() => {}}
              onCtaAction={handleCtaAction}
              showStreamingTools={false}
            />
          </div>
        )}
      </div>

      <div className="border-t border-border/60 px-3 pb-3 pt-2">
        <ChatInput
          variant="panel"
          placeholder="Ask AI to rewrite, summarize, expand, or translate this doc..."
          onSubmit={handleSubmit}
          loading={agentStatus === 'connecting'}
          isAgentRunning={agentStatus === 'running' || agentStatus === 'connecting'}
          allowSendWhileRunning={false}
          onStopAgent={() => {
            void handleStop();
          }}
          messages={filteredMessages}
          threadId={threadId || undefined}
          hideRunModeSwitch
          forcedRunMode="agent"
        />
      </div>
    </div>
  );
}
