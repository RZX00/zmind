import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  streamAgent,
  getAgentStatus,
  stopAgent,
  AgentRun,
  getMessages,
} from '@/lib/api';
import { toast } from 'sonner';
import {
  UnifiedMessage,
  ParsedContent,
  ParsedMetadata,
} from '@/components/thread/types';
import { safeJsonParse, isFinalAssistantMeta, isStreamingChunkMeta } from '@/components/thread/utils';
import { composioKeys } from '@/hooks/react-query/composio/keys';
import { knowledgeBaseKeys } from '@/hooks/react-query/knowledge-base/keys';
import { fileQueryKeys } from '@/hooks/react-query/files/use-file-queries';
import { threadKeys } from '@/hooks/react-query/threads/keys';
import { debugLog, infoLog } from '@/canvas/utils/devLogger';

interface ApiMessageType {
  message_id?: string;
  thread_id?: string;
  type: string;
  is_llm_message?: boolean;
  content: string;
  metadata?: string;
  created_at?: string;
  updated_at?: string;
  agent_id?: string;
  agents?: {
    name: string;
  };
}

// Define the structure returned by the hook
export interface UseAgentStreamResult {
  status: string;
  reasoningText: string;
  toolCall: ParsedContent | null;
  error: string | null;
  agentRunId: string | null; // Expose the currently managed agentRunId
  hasStreamingAssistant: boolean;
  runStartedAt: string | null;
  startStreaming: (runId: string) => void;
  stopStreaming: () => Promise<void>;
}

// Define the callbacks the hook consumer can provide
export interface AgentStreamCallbacks {
  onMessage: (message: UnifiedMessage) => void; // Callback for complete messages
  onStatusChange?: (status: string) => void; // Optional: Notify on internal status changes
  onError?: (error: string) => void; // Optional: Notify on errors
  onClose?: (finalStatus: string) => void; // Optional: Notify when streaming definitively ends
  onAssistantStart?: () => void; // Optional: Notify when assistant starts streaming
  onAssistantChunk?: (chunk: { content: string }) => void; // Optional: Notify on each assistant message chunk
}

// Helper function to map API messages to UnifiedMessages
const mapApiMessagesToUnified = (
  messagesData: ApiMessageType[] | null | undefined,
  currentThreadId: string,
): UnifiedMessage[] => {
  return (messagesData || [])
    .filter((msg) => {
      if (msg.type !== 'status') return true;
      const parsed = safeJsonParse<ParsedContent>(msg.content, {});
      return parsed?.status_type === 'reasoning';
    })
    .map((msg: ApiMessageType) => ({
      message_id: msg.message_id || null,
      thread_id: msg.thread_id || currentThreadId,
      type: (msg.type || 'system') as UnifiedMessage['type'],
      is_llm_message: Boolean(msg.is_llm_message),
      content: msg.content || '',
      metadata: msg.metadata || '{}',
      created_at: msg.created_at || new Date().toISOString(),
      updated_at: msg.updated_at || new Date().toISOString(),
      agent_id: (msg as any).agent_id,
      agents: (msg as any).agents,
    }));
};

export function useAgentStream(
  callbacks: AgentStreamCallbacks,
  threadId: string,
  setMessages: React.Dispatch<React.SetStateAction<UnifiedMessage[]>>,
  agentId?: string, // Optional agent ID for invalidation
): UseAgentStreamResult {
  const queryClient = useQueryClient();
  const t = useTranslations('common');

  const [status, setStatus] = useState<string>('idle');
  const chunkBufferRef = useRef<{ content: string; sequence?: number }[]>([]);
  const streamingMessageIdRef = useRef<string | null>(null);
  const streamingThreadRunIdRef = useRef<string | null>(null);
  const streamingCreatedAtRef = useRef<string | null>(null);
  const streamingContentRef = useRef<string>('');
  const lastChunkSequenceRef = useRef<number | null>(null);
  const hasOutOfOrderChunksRef = useRef(false);
  const lastStreamingTextByRunRef = useRef<Map<string, string>>(new Map());
  const streamingMetaRef = useRef<ParsedMetadata | null>(null);
  const pendingLlmResponseEndRef = useRef<{
    text: string;
    toolCalls?: any[] | null;
    metadata: ParsedMetadata;
    llmResponseId?: string | null;
  } | null>(null);
  const processedLlmResponseIdsRef = useRef<Set<string>>(new Set());
  
  // Add throttled state updates for smoother streaming
  const throttleRef = useRef<NodeJS.Timeout | null>(null);
  const [toolCall, setToolCall] = useState<ParsedContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentRunId, setAgentRunId] = useState<string | null>(null);
  const [hasStreamingAssistant, setHasStreamingAssistant] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<string | null>(null);
  const hasFinalAssistantRef = useRef(false);
  const hasStreamingAssistantRef = useRef(false);

  // Reasoning (thinking) stream state + throttling
  const [reasoningText, setReasoningText] = useState('');
  const reasoningTextRef = useRef('');
  const reasoningChunksRef = useRef<{ content: string; sequence?: number }[]>([]);
  const reasoningLastSequenceRef = useRef<number | null>(null);
  const reasoningHasOutOfOrderRef = useRef(false);
  const reasonThrottleRef = useRef<NodeJS.Timeout | null>(null);
  const pendingReasoningRef = useRef<{ content: string; sequence?: number }[]>([]);
  const updateStreamingAssistantState = useCallback((next: boolean) => {
    if (hasStreamingAssistantRef.current === next) return;
    hasStreamingAssistantRef.current = next;
    setHasStreamingAssistant(next);
  }, []);
  const flushPendingReasoning = useCallback(() => {
    if (pendingReasoningRef.current.length === 0) return;

    const incomingChunks = [...pendingReasoningRef.current];
    pendingReasoningRef.current = [];

    let nextText = reasoningTextRef.current;
    for (let i = 0; i < incomingChunks.length; i++) {
      const chunk = incomingChunks[i];
      reasoningChunksRef.current.push(chunk);

      if (reasoningHasOutOfOrderRef.current) {
        continue;
      }

      const sequence = chunk.sequence;
      if (typeof sequence !== 'number' || !Number.isFinite(sequence)) {
        nextText += chunk.content;
        continue;
      }

      const lastSequence = reasoningLastSequenceRef.current;
      if (lastSequence === null || sequence === lastSequence + 1) {
        nextText += chunk.content;
        reasoningLastSequenceRef.current = sequence;
        continue;
      }

      reasoningHasOutOfOrderRef.current = true;
    }

    if (reasoningHasOutOfOrderRef.current) {
      const sorted = reasoningChunksRef.current
        .slice()
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      let rebuilt = '';
      for (let i = 0; i < sorted.length; i++) {
        rebuilt += sorted[i].content;
      }
      nextText = rebuilt;
    }

    reasoningTextRef.current = nextText;
    React.startTransition(() => {
      setReasoningText(nextText);
    });
  }, []);
  const resetReasoningBuffers = useCallback(() => {
    if (reasonThrottleRef.current) {
      clearTimeout(reasonThrottleRef.current);
      reasonThrottleRef.current = null;
    }
    pendingReasoningRef.current = [];
    reasoningChunksRef.current = [];
    reasoningTextRef.current = '';
    reasoningLastSequenceRef.current = null;
    reasoningHasOutOfOrderRef.current = false;
    setReasoningText('');
  }, []);
  const addReasoningThrottled = useCallback((content: { content: string; sequence?: number }) => {
    pendingReasoningRef.current.push(content);
    if (reasonThrottleRef.current) {
      clearTimeout(reasonThrottleRef.current);
    }
    reasonThrottleRef.current = setTimeout(flushPendingReasoning, 16);
  }, [flushPendingReasoning]);

  const streamCleanupRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const currentRunIdRef = useRef<string | null>(null); // Ref to track the run ID being processed
  const threadIdRef = useRef(threadId); // Ref to hold the current threadId
  const setMessagesRef = useRef<React.Dispatch<React.SetStateAction<UnifiedMessage[]>> | null>(
    setMessages,
  ); // Ref to hold the setMessages function
  const callbacksRef = useRef(callbacks);
  const syncInFlightRef = useRef(false);
  const terminalStatusRef = useRef<string | null>(null);
  const terminalStatusMessageRef = useRef<string | null>(null);
  const errorToastKeyRef = useRef<string | null>(null);
  const suppressErrorToastRef = useRef(false);

  // Refs to capture current state for persistence
  const statusRef = useRef(status);
  const agentRunIdRef = useRef(agentRunId);
  // Update refs whenever state changes
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    agentRunIdRef.current = agentRunId;
  }, [agentRunId]);

  // Clear throttles on unmount
  useEffect(() => {
    return () => {
      if (reasonThrottleRef.current) {
        clearTimeout(reasonThrottleRef.current);
        reasonThrottleRef.current = null;
      }
      flushPendingReasoning();
    };
  }, [flushPendingReasoning]);

  useEffect(() => {
    setMessagesRef.current = setMessages;
  }, [setMessages]);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  // Helper function to map backend status to frontend status string
  const mapAgentStatus = (backendStatus: string): string => {
    switch (backendStatus) {
      case 'completed':
        return 'completed';
      case 'stopped':
        return 'stopped';
      case 'failed':
        return 'failed';
      default:
        return 'error';
    }
  };

  const normalizeTerminalStatus = (status: string): string => {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'end_stream' || normalized === 'completed') return 'completed';
    if (normalized === 'stop' || normalized === 'stopped') return 'stopped';
    if (normalized === 'failed') return 'failed';
    return 'error';
  };

  const getThreadRunId = useCallback((meta?: ParsedMetadata | null) => {
    const raw = meta?.thread_run_id;
    return raw ? String(raw) : null;
  }, []);

  const resetStreamingBuffers = useCallback((threadRunId?: string | null) => {
    chunkBufferRef.current = [];
    streamingContentRef.current = '';
    lastChunkSequenceRef.current = null;
    hasOutOfOrderChunksRef.current = false;
    streamingMetaRef.current = null;
    streamingCreatedAtRef.current = null;
    streamingThreadRunIdRef.current = threadRunId || null;
    streamingMessageIdRef.current = threadRunId ? `stream-${threadRunId}` : null;
    if (throttleRef.current) {
      clearTimeout(throttleRef.current);
      throttleRef.current = null;
    }
  }, []);

  const buildStreamingMessage = useCallback(
    (content: string, meta: ParsedMetadata) => {
      const currentThreadId = threadIdRef.current;
      if (!currentThreadId) return null;
      const threadRunId = getThreadRunId(meta);
      if (threadRunId && threadRunId !== streamingThreadRunIdRef.current) {
        resetStreamingBuffers(threadRunId);
      }
      if (!streamingThreadRunIdRef.current) {
        streamingThreadRunIdRef.current = threadRunId || null;
      }
      if (!streamingMessageIdRef.current) {
        const fallbackId =
          threadRunId || currentRunIdRef.current || `temp-${Date.now()}`;
        streamingMessageIdRef.current = `stream-${fallbackId}`;
      }
      const now = new Date().toISOString();
      if (!streamingCreatedAtRef.current) {
        streamingCreatedAtRef.current = now;
      }
      const metadata: ParsedMetadata = {
        ...(meta || {}),
        stream_status: 'chunk',
        streaming: true,
      };
      if (threadRunId) {
        metadata.thread_run_id = threadRunId;
      }
      return {
        message_id: streamingMessageIdRef.current,
        thread_id: currentThreadId,
        type: 'assistant' as const,
        is_llm_message: true,
        content: JSON.stringify({ role: 'assistant', content }),
        metadata: JSON.stringify(metadata),
        created_at: streamingCreatedAtRef.current,
        updated_at: now,
      } as UnifiedMessage;
    },
    [getThreadRunId, resetStreamingBuffers],
  );

  const getBufferedStreamingText = useCallback(() => {
    if (!hasOutOfOrderChunksRef.current) {
      return streamingContentRef.current;
    }
    return chunkBufferRef.current
      .slice()
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
      .map((chunk) => chunk.content)
      .join('');
  }, []);

  const appendChunkIncrementally = useCallback((chunkText: string, sequence?: number) => {
    if (hasOutOfOrderChunksRef.current) {
      return;
    }

    if (typeof sequence !== 'number' || !Number.isFinite(sequence)) {
      streamingContentRef.current += chunkText;
      return;
    }

    const lastSequence = lastChunkSequenceRef.current;
    if (lastSequence === null || sequence === lastSequence + 1) {
      streamingContentRef.current += chunkText;
      lastChunkSequenceRef.current = sequence;
      return;
    }

    hasOutOfOrderChunksRef.current = true;
  }, []);

  const flushStreamingMessage = useCallback(() => {
    const meta = streamingMetaRef.current;
    if (!meta) return;
    const content = getBufferedStreamingText();
    if (!content) return;
    streamingContentRef.current = content;
    const threadRunId = getThreadRunId(meta);
    if (threadRunId) {
      const existing = lastStreamingTextByRunRef.current.get(threadRunId) || '';
      if (content.length >= existing.length) {
        lastStreamingTextByRunRef.current.set(threadRunId, content);
      }
    }
    const message = buildStreamingMessage(content, meta);
    if (message) {
      callbacksRef.current.onMessage(message);
    }
  }, [buildStreamingMessage, getBufferedStreamingText, getThreadRunId]);

  const scheduleStreamingFlush = useCallback(() => {
    if (throttleRef.current) {
      clearTimeout(throttleRef.current);
    }
    throttleRef.current = setTimeout(flushStreamingMessage, 16);
  }, [flushStreamingMessage]);

  // On thread change, ensure any existing stream is cleaned up to avoid stale subscriptions
  useEffect(() => {
    const previousThreadId = threadIdRef.current;
    if (
      previousThreadId &&
      previousThreadId !== threadId &&
      streamCleanupRef.current
    ) {
      // Close the existing stream for the previous thread
      streamCleanupRef.current();
      streamCleanupRef.current = null;
      setStatus('idle');
      setToolCall(null);
      setAgentRunId(null);
      setRunStartedAt(null);
      currentRunIdRef.current = null;
      resetStreamingBuffers(null);
      lastStreamingTextByRunRef.current.clear();
      pendingLlmResponseEndRef.current = null;
      processedLlmResponseIdsRef.current.clear();
      updateStreamingAssistantState(false);
    }
    threadIdRef.current = threadId;
  }, [threadId, resetStreamingBuffers, updateStreamingAssistantState]);

  const syncMessagesFromServer = useCallback(
    async (reason: string) => {
      const currentThreadId = threadIdRef.current;
      const currentSetMessages = setMessagesRef.current;

      if (!currentThreadId || !currentSetMessages) return;
      if (syncInFlightRef.current) return;

      syncInFlightRef.current = true;
      try {
        const serverMessages = await getMessages(currentThreadId);
        const unifiedServerMessages = mapApiMessagesToUnified(
          serverMessages,
          currentThreadId,
        );
        const serverAssistantRunIds = new Set<string>();
        const serverThreadRunIds = new Set<string>();
        unifiedServerMessages.forEach((msg) => {
          if (msg.type !== 'assistant') return;
          const meta = safeJsonParse<ParsedMetadata>(msg.metadata, {});
          const runId = getThreadRunId(meta);
          if (runId && isFinalAssistantMeta(meta)) {
            serverAssistantRunIds.add(runId);
            serverThreadRunIds.add(runId);
          }
        });

        const dedupedServerMessages: UnifiedMessage[] = [];
        const recentUserByText = new Map<string, number>();
        unifiedServerMessages.forEach((msg) => {
          if (msg.type === 'user') {
            const parsed = safeJsonParse<ParsedContent>(msg.content, {});
            const text =
              typeof parsed?.content === 'string'
                ? parsed.content
                : typeof msg.content === 'string'
                  ? msg.content
                  : '';
            const createdAt = msg.created_at ? Date.parse(msg.created_at) : 0;
            if (text) {
              const last = recentUserByText.get(text);
              if (last && createdAt && Math.abs(createdAt - last) <= 2000) {
                return;
              }
              if (createdAt) {
                recentUserByText.set(text, createdAt);
              }
            }
          }
          dedupedServerMessages.push(msg);
        });

        const serverUserMessagesByText = new Map<string, number[]>();
        dedupedServerMessages.forEach((msg) => {
          if (msg.type !== 'user') return;
          const parsed = safeJsonParse<ParsedContent>(msg.content, {});
          const text =
            typeof parsed?.content === 'string'
              ? parsed.content
              : typeof msg.content === 'string'
                ? msg.content
                : '';
          if (!text) return;
          const createdAt = msg.created_at ? Date.parse(msg.created_at) : 0;
          const bucket = serverUserMessagesByText.get(text) || [];
          if (createdAt) bucket.push(createdAt);
        serverUserMessagesByText.set(text, bucket);
      });

      currentSetMessages((currentMessages) => {
          const localStreamingByRun = new Map<string, string>();
          (currentMessages || []).forEach((msg) => {
            if (msg.type !== 'assistant') return;
            const meta = safeJsonParse<ParsedMetadata>(msg.metadata, {});
            const runId = getThreadRunId(meta);
            if (!runId) return;
            if (!isStreamingChunkMeta(meta) && !meta?.stream_fallback) return;
            const parsed = safeJsonParse<ParsedContent>(msg.content, {});
            const text =
              typeof parsed?.content === 'string' ? parsed.content.trim() : '';
            if (!text) return;
            const existing = localStreamingByRun.get(runId) || '';
            if (text.length >= existing.length) {
              localStreamingByRun.set(runId, text);
            }
          });

          const patchedServerMessages = dedupedServerMessages.map((serverMsg) => {
            if (serverMsg.type !== 'assistant') return serverMsg;
            const meta = safeJsonParse<ParsedMetadata>(serverMsg.metadata, {});
            const runId = getThreadRunId(meta);
            if (!runId || !isFinalAssistantMeta(meta)) return serverMsg;
            const parsed = safeJsonParse<ParsedContent>(serverMsg.content, {});
            const contentText =
              typeof parsed?.content === 'string' ? parsed.content.trim() : '';
            if (contentText) return serverMsg;
            const fallbackText = localStreamingByRun.get(runId);
            if (!fallbackText) return serverMsg;
            return {
              ...serverMsg,
              content: JSON.stringify({ ...parsed, content: fallbackText }),
            };
          });

          const serverIds = new Set(
            patchedServerMessages
              .map((msg) => msg.message_id)
              .filter(Boolean) as string[],
          );
          const currentById = new Map<string, UnifiedMessage>(
            (currentMessages || [])
              .filter((msg) => Boolean(msg.message_id))
              .map((msg) => [msg.message_id as string, msg]),
          );

          const mergedServer = patchedServerMessages.map((serverMsg) => {
            if (!serverMsg.message_id) return serverMsg;
            const existing = currentById.get(serverMsg.message_id);
            if (!existing) return serverMsg;
            const currentUpdated = existing.updated_at
              ? new Date(existing.updated_at).getTime()
              : 0;
            const serverUpdated = serverMsg.updated_at
              ? new Date(serverMsg.updated_at).getTime()
              : 0;
            return currentUpdated >= serverUpdated ? existing : serverMsg;
          });

          const localExtras = (currentMessages || []).filter((msg) => {
            const meta = safeJsonParse<ParsedMetadata>(msg.metadata, {});
            const runId = meta?.thread_run_id ? String(meta.thread_run_id) : null;
            const isStreaming = isStreamingChunkMeta(meta);
            if (meta?.stream_fallback && runId && serverAssistantRunIds.has(runId)) {
              return false;
            }
            if (isStreaming && runId && serverThreadRunIds.has(runId)) {
              return false;
            }
            if (msg.type === 'user' && msg.message_id && msg.message_id.startsWith('temp-')) {
              const parsed = safeJsonParse<ParsedContent>(msg.content, {});
              const text =
                typeof parsed?.content === 'string'
                  ? parsed.content
                  : typeof msg.content === 'string'
                    ? msg.content
                    : '';
              if (text) {
                const candidateTimes = serverUserMessagesByText.get(text) || [];
                if (candidateTimes.length > 0) {
                  const createdAt = msg.created_at ? Date.parse(msg.created_at) : 0;
                  const matched = candidateTimes.some((time) => {
                    if (!createdAt) return true;
                    const delta = Math.abs(time - createdAt);
                    return delta <= 2 * 60 * 1000;
                  });
                  if (matched) return false;
                }
              }
            }
            if (!msg.message_id) return true;
            return !serverIds.has(msg.message_id);
          });

          return [...mergedServer, ...localExtras].sort((a, b) => {
            const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
            const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
            return aTime - bTime;
          });
        });

        queryClient.setQueryData(
          threadKeys.messages(currentThreadId),
          serverMessages,
        );
      } catch (syncError) {
        console.warn(
          `[useAgentStream] Failed to sync messages after ${reason}:`,
          syncError,
        );
      } finally {
        syncInFlightRef.current = false;
      }
    },
    [getThreadRunId, queryClient],
  );

  // Internal function to update status and notify consumer
  const updateStatus = useCallback(
    (newStatus: string) => {
      if (isMountedRef.current) {
        setStatus(newStatus);
        callbacksRef.current.onStatusChange?.(newStatus);
        if (newStatus === 'error' && error) {
          callbacksRef.current.onError?.(error);
        }
        if (
          [
            'completed',
            'stopped',
            'failed',
            'error',
            'agent_not_running',
          ].includes(newStatus)
        ) {
          callbacksRef.current.onClose?.(newStatus);
        }
      }
    },
    [error],
  ); // Include error dependency

  // Function to handle finalization of a stream (completion, stop, error)
  const finalizeStream = useCallback(
    (finalStatus: string, runId: string | null = agentRunId) => {
      if (!isMountedRef.current) return;

      debugLog(
        `[useAgentStream] Finalizing stream with status: ${finalStatus}, runId: ${runId}`,
      );

      const currentThreadId = threadIdRef.current; // Get current threadId from ref

      // Only finalize if this is for the current run ID or if no specific run ID is provided
      if (
        runId &&
        currentRunIdRef.current &&
        currentRunIdRef.current !== runId
      ) {
        debugLog(
          `[useAgentStream] Ignoring finalization for old run ID ${runId}, current is ${currentRunIdRef.current}`,
        );
        return;
      }

      const toastKey = runId || currentRunIdRef.current || 'unknown';
      const suppressToast = suppressErrorToastRef.current;
      if (suppressToast) {
        suppressErrorToastRef.current = false;
      }
      if (
        (finalStatus === 'error' || finalStatus === 'failed') &&
        !suppressToast &&
        errorToastKeyRef.current !== toastKey
      ) {
        toast.error(t('requestFailed', {
          default: "We couldn't finish that request. Please try again.",
        }), {
          duration: 15000,
        });
        errorToastKeyRef.current = toastKey;
      }

      if (streamCleanupRef.current) {
        streamCleanupRef.current();
        streamCleanupRef.current = null;
      }

      const bufferedText = getBufferedStreamingText().trim();

      const pendingLlm = pendingLlmResponseEndRef.current;
      const pendingText = pendingLlm?.text ? pendingLlm.text.trim() : '';
      const pendingThreadRunIdRaw = pendingLlm?.metadata?.thread_run_id;
      const pendingThreadRunId = pendingThreadRunIdRaw
        ? String(pendingThreadRunIdRaw)
        : null;
      const cachedText = pendingThreadRunId
        ? lastStreamingTextByRunRef.current.get(pendingThreadRunId) || ''
        : '';
      const fallbackText =
        pendingText ||
        bufferedText ||
        cachedText.trim();

      if (!hasFinalAssistantRef.current && fallbackText) {
        const now = new Date().toISOString();
        const fallbackMetadata: Record<string, any> = {
          stream_status: 'complete',
          stream_fallback: true,
          final_status: finalStatus,
        };
        if (pendingLlm?.metadata?.thread_run_id) {
          fallbackMetadata.thread_run_id = pendingLlm.metadata.thread_run_id;
        }
        const llmResponseId =
          pendingLlm?.llmResponseId ||
          (pendingLlm?.metadata as any)?.llm_response_id;
        if (llmResponseId) {
          fallbackMetadata.llm_response_id = llmResponseId;
        }
        if (pendingText) {
          fallbackMetadata.stream_fallback_source = 'llm_response_end';
        }

        const contentObj: Record<string, any> = {
          role: 'assistant',
          content: fallbackText,
        };
        if (pendingLlm?.toolCalls) {
          contentObj.tool_calls = pendingLlm.toolCalls;
        }
        callbacksRef.current.onMessage({
          message_id: `stream-fallback-${Date.now()}`,
          thread_id: currentThreadId,
          type: 'assistant',
          is_llm_message: true,
          content: JSON.stringify(contentObj),
          metadata: JSON.stringify(fallbackMetadata),
          created_at: now,
          updated_at: now,
        });
      }

      // Reset streaming-specific state
      resetReasoningBuffers();
      setToolCall(null);
      resetStreamingBuffers(null);
      lastStreamingTextByRunRef.current.clear();
      pendingLlmResponseEndRef.current = null;
      processedLlmResponseIdsRef.current.clear();
      updateStreamingAssistantState(false);
      setRunStartedAt(null);

      // Update status and clear run ID
      updateStatus(finalStatus);
      setAgentRunId(null);
      currentRunIdRef.current = null;
      hasFinalAssistantRef.current = false;
      terminalStatusRef.current = null;
      terminalStatusMessageRef.current = null;

      if (
        ['completed', 'stopped', 'failed', 'error', 'agent_not_running'].includes(
          finalStatus,
        )
      ) {
        syncMessagesFromServer(`stream-${finalStatus}`);
      }

      queryClient.invalidateQueries({ 
        queryKey: fileQueryKeys.all,
      });

      if (agentId) {
        queryClient.invalidateQueries({ queryKey: ['agents', 'detail', agentId] });
        queryClient.invalidateQueries({ queryKey: ['agents', 'list'] });
        queryClient.invalidateQueries({ queryKey: ['agent-tools', agentId] });

        queryClient.invalidateQueries({
          queryKey: ['custom-mcp-tools', agentId],
        });
        queryClient.invalidateQueries({ queryKey: composioKeys.mcpServers() });

        queryClient.invalidateQueries({
          queryKey: composioKeys.profiles.all(),
        });
        queryClient.invalidateQueries({
          queryKey: composioKeys.profiles.credentials(),
        });

        queryClient.invalidateQueries({
          queryKey: knowledgeBaseKeys.agent(agentId),
        });

        // Invalidate versioning queries for agent config page
        queryClient.invalidateQueries({ queryKey: ['versions', 'list', agentId] });
        // Invalidate current version details if available
        queryClient.invalidateQueries({ 
          queryKey: ['versions', 'detail'], 
          predicate: (query) => {
            return query.queryKey.includes(agentId);
          }
        });
        
        debugLog(`[useAgentStream] Invalidated agent queries for refetch instead of page reload - Agent ID: ${agentId}`);
      }

      if (
        runId &&
        (finalStatus === 'completed' ||
          finalStatus === 'stopped' ||
          finalStatus === 'agent_not_running')
      ) {
        getAgentStatus(runId).catch((err) => {});
      }
    },
    [
      agentRunId,
      resetStreamingBuffers,
      resetReasoningBuffers,
      updateStatus,
      agentId,
      getBufferedStreamingText,
      queryClient,
      syncMessagesFromServer,
      updateStreamingAssistantState,
      t,
    ],
  );

  // --- Stream Callback Handlers ---

  const handleStreamMessage = useCallback(
    (rawData: string) => {
      if (!isMountedRef.current) return;
      (window as any).lastStreamMessage = Date.now(); // Keep track of last message time

      let processedData = rawData;
      if (processedData.startsWith('data: ')) {
        processedData = processedData.substring(6).trim();
      }
      if (!processedData) return;

      // --- Detect terminal status payloads (not full message objects) ---
      let preParsed: any = null;
      try {
        preParsed = JSON.parse(processedData);
      } catch (jsonError) {
        preParsed = null;
      }

      if (
        preParsed &&
        preParsed.type === 'status' &&
        typeof preParsed.status === 'string' &&
        !('content' in preParsed)
      ) {
        terminalStatusRef.current = normalizeTerminalStatus(preParsed.status);
        if (preParsed.message) {
          terminalStatusMessageRef.current = String(preParsed.message);
        }
        return;
      }

      if (
        processedData.includes('Run data not available for streaming') ||
        processedData.includes('Stream ended with status: completed')
      ) {
        terminalStatusRef.current = 'completed';
        return;
      }

      // --- Check for error messages first ---
      if (preParsed && preParsed.status === 'error' && preParsed.type !== 'status') {
        console.error(
          '[useAgentStream] Received error status message:',
          preParsed,
        );
        const errorMessage = preParsed.message || 'Unknown error occurred';
        setError(errorMessage);
        toast.error(errorMessage, { duration: 15000 });
        const runId = currentRunIdRef.current;
        errorToastKeyRef.current = runId || 'unknown';
        callbacksRef.current.onError?.(errorMessage);
        return;
      }

      // --- Process JSON messages ---
      const message = safeJsonParse(
        processedData,
        null,
      ) as UnifiedMessage | null;
      if (!message) {
        console.warn(
          '[useAgentStream] Failed to parse streamed message:',
          processedData,
        );
        return;
      }

      const parsedContent = safeJsonParse<ParsedContent>(message.content, {});
      const parsedMetadata = safeJsonParse<ParsedMetadata>(
        message.metadata,
        {},
      );

      // Update status to streaming if we receive a valid message
      if (status !== 'streaming') updateStatus('streaming');

      switch (message.type) {
        case 'assistant':
          if (parsedMetadata.stream_status === 'chunk' && parsedContent.content) {
            // routing: reasoning channel vs normal assistant content
            if ((parsedMetadata as any).channel === 'reasoning') {
              addReasoningThrottled({ sequence: message.sequence, content: parsedContent.content });
            } else {
              const threadRunId = getThreadRunId(parsedMetadata);
              if (threadRunId && threadRunId !== streamingThreadRunIdRef.current) {
                resetStreamingBuffers(threadRunId);
              }
              streamingMetaRef.current = parsedMetadata;
              const chunkText = String(parsedContent.content);
              chunkBufferRef.current.push({
                sequence: message.sequence,
                content: chunkText,
              });
              appendChunkIncrementally(chunkText, message.sequence);
              scheduleStreamingFlush();
              callbacksRef.current.onAssistantChunk?.({ content: chunkText });
              updateStreamingAssistantState(true);
            }
          } else if (parsedMetadata.stream_status === 'complete') {
            const threadRunId = getThreadRunId(parsedMetadata);
            const bufferedText = getBufferedStreamingText().trim();

            setToolCall(null);
            const contentText =
              typeof parsedContent.content === 'string'
                ? parsedContent.content.trim()
                : '';
            const hasToolCalls =
              Array.isArray((parsedContent as any).tool_calls) &&
              (parsedContent as any).tool_calls.length > 0;
            const cachedText = threadRunId
              ? lastStreamingTextByRunRef.current.get(threadRunId) || ''
              : '';
            const finalText =
              contentText ||
              bufferedText ||
              cachedText.trim();
            const shouldPersist = Boolean(finalText) || !hasToolCalls;
            if (shouldPersist && message.message_id) {
              if (!contentText && finalText) {
                const patchedContent = JSON.stringify({
                  ...parsedContent,
                  content: finalText,
                });
                callbacksRef.current.onMessage({
                  ...message,
                  content: patchedContent,
                });
              } else {
                callbacksRef.current.onMessage(message);
              }
              hasFinalAssistantRef.current = true;
            }
            if (threadRunId && threadRunId === streamingThreadRunIdRef.current) {
              resetStreamingBuffers(null);
            }
            if (threadRunId) {
              lastStreamingTextByRunRef.current.delete(threadRunId);
            }
          } else if (!parsedMetadata.stream_status) {
            // Handle non-chunked assistant messages if needed
            callbacksRef.current.onAssistantStart?.();
            const contentText =
              typeof parsedContent.content === 'string'
                ? parsedContent.content.trim()
                : '';
            if (contentText && message.message_id) {
              callbacksRef.current.onMessage(message);
              hasFinalAssistantRef.current = true;
            }
          }
          break;
        case 'llm_response_end': {
          const llmResponseIdRaw =
            (parsedMetadata as any)?.llm_response_id ||
            (parsedContent as any)?.llm_response_id ||
            message.message_id;
          const llmResponseId = llmResponseIdRaw
            ? String(llmResponseIdRaw)
            : null;
          if (
            llmResponseId &&
            processedLlmResponseIdsRef.current.has(llmResponseId)
          ) {
            break;
          }
          if (llmResponseId) {
            processedLlmResponseIdsRef.current.add(llmResponseId);
          }

          const choices = (parsedContent as any)?.choices;
          const assistantMessage = choices?.[0]?.message;
          const assistantText =
            typeof assistantMessage?.content === 'string'
              ? assistantMessage.content
              : '';
          pendingLlmResponseEndRef.current = {
            text: assistantText,
            toolCalls: assistantMessage?.tool_calls ?? null,
            metadata: parsedMetadata,
            llmResponseId,
          };
          break;
        }
        case 'tool':
          setToolCall(null); // Clear any streaming tool call
          if (message.message_id) callbacksRef.current.onMessage(message);
          break;
        case 'status':
          switch (parsedContent.status_type) {
            case 'tool_started':
              setToolCall({
                role: 'assistant',
                status_type: 'tool_started',
                name: parsedContent.function_name,
                arguments: parsedContent.arguments,
                xml_tag_name: parsedContent.xml_tag_name,
                tool_index: parsedContent.tool_index,
              });
              break;
            case 'tool_completed':
            case 'tool_failed':
            case 'tool_error':
              if (toolCall?.tool_index === parsedContent.tool_index) {
                setToolCall(null);
              }
              break;
            case 'thread_run_end':
              break;
            case 'finish':
              // Optional: Handle finish reasons like 'xml_tool_limit_reached'
              // Don't finalize here, wait for thread_run_end or completion message
              break;
            case 'run_completed':
              terminalStatusRef.current = 'completed';
              break;
            case 'run_stopped':
              terminalStatusRef.current = 'stopped';
              break;
            case 'run_max_iterations':
              setError(parsedContent.message || 'Agent run hit max iterations');
              terminalStatusRef.current = 'error';
              break;
            case 'error':
              setError(parsedContent.message || 'Agent run failed');
              terminalStatusRef.current = 'error';
              break;
            // Ignore thread_run_start, assistant_response_start etc. for now
            default:
              // console.debug('[useAgentStream] Received unhandled status type:', parsedContent.status_type);
              break;
          }
          break;
        case 'user':
        case 'system':
          // Handle other message types if necessary, e.g., if backend sends historical context
          if (message.message_id) callbacksRef.current.onMessage(message);
          break;
        default:
          console.warn(
            '[useAgentStream] Unhandled message type:',
            message.type,
          );
      }
    },
    [
      status,
      toolCall,
      updateStatus,
      addReasoningThrottled,
      appendChunkIncrementally,
      getBufferedStreamingText,
      getThreadRunId,
      resetStreamingBuffers,
      scheduleStreamingFlush,
      updateStreamingAssistantState,
    ],
  );

  const handleStreamError = useCallback(
    (err: Error | string | Event) => {
      if (!isMountedRef.current) return;

      // Extract error message
      let errorMessage = 'Unknown streaming error';
      if (typeof err === 'string') {
        errorMessage = err;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      } else if (err instanceof Event && err.type === 'error') {
        // Standard EventSource errors don't have much detail, might need status check
        errorMessage = 'Stream connection error';
      }

      const lower = errorMessage.toLowerCase();
      const isExpected =
        lower.includes('not found') || lower.includes('not running');
      const runId = currentRunIdRef.current;

      if (isExpected) {
        infoLog('[useAgentStream] Streaming skipped/ended:', errorMessage);
      } else {
        console.error('[useAgentStream] Streaming error:', errorMessage, err);
        setError(errorMessage);
        // Show error toast with longer duration
        toast.error(errorMessage, { duration: 15000 });
        errorToastKeyRef.current = runId || 'unknown';
      }
      if (!runId) {
        console.warn(
          '[useAgentStream] Stream error occurred but no agentRunId is active.',
        );
        finalizeStream('error'); // Finalize with generic error if no runId
        return;
      }
    },
    [finalizeStream],
  );

  const handleStreamClose = useCallback(() => {
    if (!isMountedRef.current) return;

    const runId = currentRunIdRef.current;
    debugLog(
      `[useAgentStream] Stream closed for run ID: ${runId}, status: ${status}`,
    );

    if (!runId) {
      console.warn('[useAgentStream] Stream closed but no active agentRunId.');
      // If status was streaming, something went wrong, finalize as error
      if (status === 'streaming' || status === 'connecting') {
        finalizeStream('error');
      } else if (
        status !== 'idle' &&
        status !== 'completed' &&
        status !== 'stopped' &&
        status !== 'agent_not_running'
      ) {
        // If in some other state, just go back to idle if no runId
        finalizeStream('idle');
      }
      return;
    }

    if (terminalStatusRef.current) {
      const finalStatus = terminalStatusRef.current;
      terminalStatusRef.current = null;
      terminalStatusMessageRef.current = null;
      finalizeStream(finalStatus, runId);
      return;
    }

    // Immediately check the agent status when the stream closes unexpectedly
    // This covers cases where the agent finished but the final message wasn't received,
    // or if the agent errored out on the backend.
    debugLog(`[useAgentStream] Checking final status for run ID: ${runId}`);
    getAgentStatus(runId)
      .then((agentStatus) => {
        if (!isMountedRef.current) return; // Check mount status again

        // Check if this is still the current run ID
        if (currentRunIdRef.current !== runId) {
          debugLog(
            `[useAgentStream] Run ID changed during status check in handleStreamClose, ignoring`,
          );
          return;
        }

        debugLog(
          `[useAgentStream] Final status for run ID ${runId}: ${agentStatus.status}`,
        );

        if (agentStatus.status === 'running') {
          setError('Stream closed unexpectedly while agent was running.');
          finalizeStream('error', runId); // Finalize as error for now
          toast.warning('Stream disconnected. Agent might still be running.');
        } else {
          // Map backend terminal status to hook terminal status
          const finalStatus = mapAgentStatus(agentStatus.status);
          finalizeStream(finalStatus, runId);
        }
      })
      .catch((err) => {
        if (!isMountedRef.current) return;

        // Check if this is still the current run ID
        if (currentRunIdRef.current !== runId) {
          debugLog(
            `[useAgentStream] Run ID changed during error handling in handleStreamClose, ignoring`,
          );
          return;
        }

        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(
          `[useAgentStream] Error checking agent status for ${runId} after stream close: ${errorMessage}`,
        );

        const isNotFoundError =
          errorMessage.includes('not found') ||
          errorMessage.includes('404') ||
          errorMessage.includes('does not exist');

        if (isNotFoundError) {
          // Revert to agent_not_running for this specific case
          finalizeStream('agent_not_running', runId);
        } else {
          // For other errors checking status, finalize with generic error
          finalizeStream('error', runId);
        }
      });
  }, [status, finalizeStream]); // Include status

  // --- Effect to manage the stream lifecycle ---
  useEffect(() => {
    isMountedRef.current = true;

    // Cleanup function - be more conservative about stream cleanup
    return () => {
      isMountedRef.current = false;

      // Clean up throttle timeout
      if (throttleRef.current) {
        clearTimeout(throttleRef.current);
        throttleRef.current = null;
      }
      if (reasonThrottleRef.current) {
        clearTimeout(reasonThrottleRef.current);
        reasonThrottleRef.current = null;
      }
      
      // Flush any remaining pending content
      flushStreamingMessage();
      flushPendingReasoning();

      // Don't automatically cleanup streams on navigation
      // Only set mounted flag to false to prevent new operations
      // Streams will be cleaned up when they naturally complete or on explicit stop
    };
  }, [flushStreamingMessage, flushPendingReasoning]); // Include flushStreamingMessage dependency

  // --- Public Functions ---

  const startStreaming = useCallback(
    async (runId: string) => {
      if (!isMountedRef.current) return;

      debugLog(`[useAgentStream] Starting stream for run ID: ${runId}`);

      // Store previous stream cleanup for potential restoration
      const previousCleanup = streamCleanupRef.current;
      const previousRunId = currentRunIdRef.current;
      errorToastKeyRef.current = null;
      suppressErrorToastRef.current = false;

      try {
        // Reset reasoning content for new run
        resetReasoningBuffers();
        hasFinalAssistantRef.current = false;
        terminalStatusRef.current = null;
        terminalStatusMessageRef.current = null;
        resetStreamingBuffers(null);
        lastStreamingTextByRunRef.current.clear();
        pendingLlmResponseEndRef.current = null;
        processedLlmResponseIdsRef.current.clear();
        updateStreamingAssistantState(false);
        // *** Crucial check: Verify agent is running BEFORE cleaning up previous stream ***
        debugLog(`[useAgentStream] Checking status for run ID: ${runId}`);
        const agentStatus = await getAgentStatus(runId);
        if (!isMountedRef.current) return; // Check mount status after async call

        if (agentStatus.status !== 'running') {
          // Expected when opening an old conversation; don't surface as error/toast
          infoLog(
            `[useAgentStream] Stream not started for ${runId}: Agent run ${runId} is not running (status: ${agentStatus.status})`,
          );
          
          // DON'T clean up the previous stream if this new one can't start
          // Just finalize with the appropriate status but keep previous stream if it was working
          const final =
            agentStatus.status === 'completed' ||
            agentStatus.status === 'stopped'
              ? mapAgentStatus(agentStatus.status)
              : 'agent_not_running';
          
          // Only finalize if we don't have a working previous stream
          if (!previousRunId || previousRunId === runId) {
            suppressErrorToastRef.current = true;
            finalizeStream(final, runId);
          } else {
            debugLog(`[useAgentStream] Keeping previous stream ${previousRunId} active since new stream ${runId} can't start`);
          }
          return;
        }

        const startedAt = agentStatus.startedAt ?? agentStatus.started_at ?? null;
        setRunStartedAt(startedAt);

        // New agent is running, now it's safe to clean up previous stream
        if (previousCleanup && previousRunId !== runId) {
          debugLog(`[useAgentStream] Cleaning up previous stream ${previousRunId} to start new stream ${runId}`);
          previousCleanup();
          streamCleanupRef.current = null;
        }

        // Reset state for the new stream
        resetStreamingBuffers(null);
        setToolCall(null);
        setError(null);
        updateStatus('connecting');
        setAgentRunId(runId);
        currentRunIdRef.current = runId; // Set the ref immediately

        debugLog(
          `[useAgentStream] Agent run ${runId} is running, creating stream`,
        );

        // Agent is running, proceed to create the stream
        const cleanup = streamAgent(runId, {
          onMessage: (data) => {
            // Only gate by runId; threadId may update after startStreaming
            if (currentRunIdRef.current !== runId) return;
            handleStreamMessage(data);
          },
          onError: (err) => {
            if (currentRunIdRef.current !== runId) return;
            handleStreamError(err);
          },
          onClose: () => {
            if (currentRunIdRef.current !== runId) return;
            handleStreamClose();
          },
        });
        streamCleanupRef.current = cleanup;
        debugLog(
          `[useAgentStream] Stream created successfully for run ID: ${runId}`,
        );

        // Status will be updated to 'streaming' by the first message received in handleStreamMessage
        // If for some reason no message arrives shortly, verify liveness again to avoid zombie state
        setTimeout(async () => {
          if (!isMountedRef.current) return;
          if (currentRunIdRef.current !== runId) return; // Another run started
          if (statusRef.current === 'streaming') return; // Already streaming
          try {
            const latest = await getAgentStatus(runId);
            if (!isMountedRef.current) return;
            if (currentRunIdRef.current !== runId) return;
            if (latest.status !== 'running') {
              finalizeStream(
                mapAgentStatus(latest.status) || 'agent_not_running',
                runId,
              );
            }
          } catch {
            // ignore
          }
        }, 1500);
      } catch (err) {
        if (!isMountedRef.current) return; // Check mount status after async call

        // Only handle error if this is still the current run ID
        if (currentRunIdRef.current !== runId) {
          debugLog(
            `[useAgentStream] Error occurred for old run ID ${runId}, ignoring`,
          );
          return;
        }

        const errorMessage = err instanceof Error ? err.message : String(err);
        const lower = errorMessage.toLowerCase();
        const isExpected =
          lower.includes('not found') ||
          lower.includes('404') ||
          lower.includes('does not exist') ||
          lower.includes('not running');

        if (isExpected) {
          infoLog(
            `[useAgentStream] Stream not started for ${runId}: ${errorMessage}`,
          );
          
          // Similar logic - don't finalize if we have a working previous stream
          if (!previousRunId || previousRunId === runId) {
            finalizeStream('agent_not_running', runId);
          } else {
            debugLog(`[useAgentStream] Keeping previous stream ${previousRunId} active since new stream ${runId} failed to start`);
          }
        } else {
          console.error(
            `[useAgentStream] Error initiating stream for ${runId}: ${errorMessage}`,
          );
          setError(errorMessage);
          
          // For unexpected errors, still preserve previous stream if possible
          if (!previousRunId || previousRunId === runId) {
            finalizeStream('error', runId);
          } else {
            debugLog(`[useAgentStream] Keeping previous stream ${previousRunId} active despite error starting new stream ${runId}`);
            // Reset current run ID back to previous to maintain stream continuity
            currentRunIdRef.current = previousRunId;
            setAgentRunId(previousRunId);
          }
        }
      }
    },
    [
      resetStreamingBuffers,
      resetReasoningBuffers,
      updateStatus,
      finalizeStream,
      handleStreamMessage,
      handleStreamError,
      handleStreamClose,
      updateStreamingAssistantState,
    ],
  ); // Add dependencies

  const stopStreaming = useCallback(async () => {
    if (!isMountedRef.current || !agentRunId) return;

    const runIdToStop = agentRunId;

    // Immediately update status and clean up stream
    finalizeStream('stopped', runIdToStop);

    try {
      await stopAgent(runIdToStop);
      toast.success('Agent stopped.');
      // finalizeStream already called getAgentStatus implicitly if needed
    } catch (err) {
      // Don't revert status here, as the user intended to stop. Just log error.
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[useAgentStream] Error sending stop request for ${runIdToStop}: ${errorMessage}`,
      );
      toast.error(`Failed to stop agent: ${errorMessage}`);
    }
  }, [agentRunId, finalizeStream]); // Add dependencies

  return {
    status,
    reasoningText,
    toolCall,
    error,
    agentRunId,
    hasStreamingAssistant,
    runStartedAt,
    startStreaming,
    stopStreaming,
  };
}
