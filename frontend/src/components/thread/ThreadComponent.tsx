'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'next/navigation';
import {
  BillingError,
  AgentRunLimitError,
  ProjectLimitError,
  generateCanvasMedia,
  type ClientMessageHint,
  type ThreadMessageRecord,
} from '@/lib/api';
import { toast } from 'sonner';
import { ChatInput } from '@/components/thread/chat-input/chat-input';
import { useSidebar } from '@/components/ui/sidebar';
import { useAgentStream } from '@/hooks/useAgentStream';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { isLocalMode } from '@/lib/config';
import { ThreadContent } from '@/components/thread/content/ThreadContent';
import { ThreadSkeleton } from '@/components/thread/content/ThreadSkeleton';
import { safeJsonParse, isFinalAssistantMeta, isStreamingChunkMeta } from '@/components/thread/utils';
import { useAddUserMessageMutation } from '@/hooks/react-query/threads/use-messages';
import {
  useStartAgentMutation,
  useStopAgentMutation,
} from '@/hooks/react-query/threads/use-agent-run';
import { useSharedSubscription } from '@/contexts/SubscriptionContext';
export type SubscriptionStatus = 'no_subscription' | 'active';

import {
  ParsedMetadata,
  UnifiedMessage,
  CtaAction,
} from '@/components/thread/types';
import {
  ApiMessageType,
} from '@/app/(dashboard)/projects/[projectId]/thread/_types';
import { useThreadData, useBilling, useKeyboardShortcuts } from '@/app/(dashboard)/projects/[projectId]/thread/_hooks';
import { ThreadError, UpgradeDialog, ThreadLayout } from '@/app/(dashboard)/projects/[projectId]/thread/_components';
import { FileViewerModal } from './file-viewer-modal';
import { StorageFilePreviewModal } from './storage-file-preview-modal';
import { ReferenceImagePickerDialog } from '@/components/thread/ReferenceImagePickerDialog';
import type { ReferenceImageCandidate, ReferenceImagePickerPayload } from '@/components/thread/ReferenceImagePickerDialog';
import type { ReferenceImageInput } from '@/lib/reference-images';
import { getDownloadUrl } from '@/lib/api/files';

import {
  useThreadAgent,
  useAgents,
} from '@/hooks/react-query/agents/use-agents';
import { AgentRunLimitDialog } from '@/components/thread/agent-run-limit-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { threadKeys } from '@/hooks/react-query/threads/keys';
import { useProjectRealtime } from '@/hooks/useProjectRealtime';
import { handleGoogleSlidesUpload } from './tool-views/utils/presentation-utils';
import { getStoredRunMode, type RunMode } from '@/lib/run-mode';

interface ThreadComponentProps {
  projectId: string;
  threadId: string;
  compact?: boolean;
  configuredAgentId?: string; // When set, only allow selection of this specific agent
}

function normalizeThreadPayload(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function toUnifiedThreadMessage(
  message: ThreadMessageRecord,
  fallback: {
    threadId: string;
    content: string;
    metadata: string;
  },
): UnifiedMessage {
  return {
    message_id: message.message_id || null,
    thread_id: message.thread_id || fallback.threadId,
    type: (message.type || 'user') as UnifiedMessage['type'],
    is_llm_message: Boolean(message.is_llm_message),
    content: normalizeThreadPayload(message.content, fallback.content),
    metadata: normalizeThreadPayload(message.metadata, fallback.metadata),
    created_at: message.created_at || new Date().toISOString(),
    updated_at: message.updated_at || new Date().toISOString(),
    agent_id: message.agent_id,
  };
}

export function ThreadComponent({ projectId, threadId, compact = false, configuredAgentId }: ThreadComponentProps) {
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // State
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [fileViewerOpen, setFileViewerOpen] = useState(false);
  const [storagePreviewFile, setStoragePreviewFile] = useState<{ path: string; name?: string } | null>(null);
  const [storagePreviewOpen, setStoragePreviewOpen] = useState(false);
  const [fileToView, setFileToView] = useState<string | null>(null);
  const [filePathList, setFilePathList] = useState<string[] | undefined>(
    undefined,
  );
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  // Removed tool side panel; keep UI simple
  // Use default agent only
  const selectedAgentId = 'Zmind';

  const { data: agentsResponse } = useAgents();
  const agents = agentsResponse?.agents || [];
  const [isSidePanelAnimating, setIsSidePanelAnimating] = useState(false); // retained for transitions around input bar only
  const [userInitiatedRun, setUserInitiatedRun] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [showAgentLimitDialog, setShowAgentLimitDialog] = useState(false);
  const [agentLimitData, setAgentLimitData] = useState<{
    runningCount: number;
    runningThreadIds: string[];
  } | null>(null);
  const [referencePicker, setReferencePicker] = useState<ReferenceImagePickerPayload | null>(null);
  const [isReferenceSubmitting, setIsReferenceSubmitting] = useState(false);

  // Refs - simplified for flex-column-reverse
  const latestMessageRef = useRef<HTMLDivElement>(null);
  const initialLayoutAppliedRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastStreamStartedRef = useRef<string | null>(null); // Track last runId we started streaming for

  // Sidebar
  const { state: leftSidebarState, setOpen: setLeftSidebarOpen } = useSidebar();

  // Custom hooks
  const {
    messages,
    setMessages,
    project,
    sandboxId,
    projectName,
    agentRunId,
    setAgentRunId,
    agentStatus,
    setAgentStatus,
    isLoading,
    error,
    initialLoadCompleted,
    threadQuery,
    messagesQuery,
    projectQuery,
    agentRunsQuery,
  } = useThreadData(threadId, projectId);

  // Side panel removed: keep minimal placeholders for keyboard shortcut hook
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);
  const userClosedPanelRef = useRef(false);
  const handleToolClick = useCallback(() => {}, []);
  const handleSidePanelNavigate = useCallback((index: number) => {}, []);
  const toggleSidePanel = useCallback(() => setIsSidePanelOpen((v) => !v), []);

  const {
    showBillingAlert,
    setShowBillingAlert,
    billingData,
    setBillingData,
    checkBillingLimits,
    billingStatusQuery,
  } = useBilling(null, agentStatus, initialLoadCompleted);

  // Real-time project updates (for sandbox creation)
  useProjectRealtime(projectId);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    isSidePanelOpen,
    setIsSidePanelOpen,
    leftSidebarState,
    setLeftSidebarOpen,
    userClosedPanelRef,
  });

  const addUserMessageMutation = useAddUserMessageMutation();
  const startAgentMutation = useStartAgentMutation();
  const stopAgentMutation = useStopAgentMutation();
  const { data: threadAgentData } = useThreadAgent(threadId);
  const agent = threadAgentData?.agent;
  const workflowId = threadQuery.data?.metadata?.workflow_id;

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: threadKeys.agentRuns(threadId) });
    queryClient.invalidateQueries({ queryKey: threadKeys.messages(threadId) });
  }, [threadId, queryClient]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    
    if (urlParams.get('google_auth') === 'success') {
      // Clean up the URL parameters first
      window.history.replaceState({}, '', window.location.pathname);
      
      // Check if there was an intent to upload to Google Slides
      const uploadIntent = sessionStorage.getItem('google_slides_upload_intent');
      if (uploadIntent) {
        sessionStorage.removeItem('google_slides_upload_intent');
        
        try {
          const uploadData = JSON.parse(uploadIntent);
          const { presentation_path, sandbox_url } = uploadData;
          
          if (presentation_path && sandbox_url) {
            // Handle upload in async function
            (async () => {
              const uploadPromise = handleGoogleSlidesUpload(
                sandbox_url,
                presentation_path
              );
              
              // Show loading toast and handle upload
              const loadingToast = toast.loading('Google authentication successful! Uploading presentation...');
              
              try {
                await uploadPromise;
                // Success toast is now handled universally by handleGoogleSlidesUpload
              } catch (error) {
                console.error('Upload failed:', error);
                // Error toast is also handled universally by handleGoogleSlidesUpload
              } finally {
                // Always dismiss loading toast
                toast.dismiss(loadingToast);
              }
            })();
          }
        } catch (error) {
          console.error('Error processing Google Slides upload from session:', error);
          // Error toast is handled universally by handleGoogleSlidesUpload, no need to duplicate
        }
      } else {
        toast.success('Google authentication successful!');
      }
    } else if (urlParams.get('google_auth') === 'error') {
      const error = urlParams.get('error');
      sessionStorage.removeItem('google_slides_upload_intent');
      window.history.replaceState({}, '', window.location.pathname);
      toast.error(`Google authentication failed: ${error || 'Unknown error'}`);
    }
  }, []);

  // Agent is now always the default Zmind agent

  const { data: subscriptionData } = useSharedSubscription();
  const subscriptionStatus: SubscriptionStatus =
    subscriptionData?.status === 'active' ? 'active' : 'no_subscription';

  const handleProjectRenamed = useCallback((newName: string) => {}, []);

  // Agent selection removed - using default agent only

  // scrollToBottom for flex-column-reverse layout
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const handleNewMessageFromStream = useCallback(
    (message: UnifiedMessage) => {
      if (!message.message_id) {
        console.warn(
          `[STREAM HANDLER] Received message is missing ID: Type=${message.type}`,
        );
      }

      const incomingMeta = safeJsonParse<ParsedMetadata>(message.metadata, {});
      const incomingRunId = incomingMeta?.thread_run_id
        ? String(incomingMeta.thread_run_id)
        : null;
      const incomingIsFinal = isFinalAssistantMeta(incomingMeta);
      const shouldReplaceStreaming =
        message.type === 'assistant' && incomingIsFinal && incomingRunId;

      setMessages((prev) => {
        const streamingIndex = shouldReplaceStreaming
          ? prev.findIndex((m) => {
              if (m.type !== 'assistant') return false;
              const meta = safeJsonParse<ParsedMetadata>(m.metadata, {});
              const runId = meta?.thread_run_id ? String(meta.thread_run_id) : null;
              return (
                runId &&
                runId === incomingRunId &&
                isStreamingChunkMeta(meta)
              );
            })
          : -1;
        const messageExists = prev.some(
          (m) => m.message_id === message.message_id,
        );
        if (messageExists) {
          const next = prev.map((m) =>
            m.message_id === message.message_id ? message : m,
          );
          if (
            streamingIndex >= 0 &&
            prev[streamingIndex].message_id !== message.message_id
          ) {
            next.splice(streamingIndex, 1);
          }
          return next;
        } else {
          if (streamingIndex >= 0) {
            const next = prev.slice();
            next[streamingIndex] = message;
            return next;
          }
          // If this is a user message, replace any optimistic user message with temp ID
          if (message.type === 'user') {
            const optimisticIndex = prev.findIndex(
              (m) =>
                m.type === 'user' &&
                m.message_id?.startsWith('temp-') &&
                m.content === message.content,
            );
            if (optimisticIndex !== -1) {
              // Replace the optimistic message with the real one
              return prev.map((m, index) =>
                index === optimisticIndex ? message : m,
              );
            }
          }
          return [...prev, message];
        }
      });

      // No side panel to auto-open/close

      // Auto-scroll to bottom (top: 0 in flex-col-reverse) when new messages arrive
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 100);
    },
    [setMessages],
  );

  const handleStreamStatusChange = useCallback(
    (hookStatus: string) => {
      switch (hookStatus) {
        case 'idle':
        case 'completed':
        case 'stopped':
        case 'agent_not_running':
        case 'error':
        case 'failed':
          setAgentStatus('idle');
          setAgentRunId(null);

          // No scroll needed with flex-column-reverse
          break;
        case 'connecting':
          setAgentStatus('connecting');
          break;
        case 'streaming':
          setAgentStatus('running');
          break;
      }
    },
    [setAgentStatus, setAgentRunId],
  );

  const handleStreamError = useCallback((errorMessage: string) => {
    const lower = errorMessage.toLowerCase();
    const isExpected =
      lower.includes('not found') || lower.includes('agent run is not running');

    // Downgrade log level for expected/benign cases (opening old conversations)
    if (isExpected) {
      console.info(`[PAGE] Stream skipped for inactive run: ${errorMessage}`);
      return;
    }

    console.error(`[PAGE] Stream hook error: ${errorMessage}`);
    toast.error(`Stream Error: ${errorMessage}`);
  }, []);

  const handleStreamClose = useCallback(() => {}, []);

  const {
    status: streamHookStatus,
    reasoningText: streamingReasoningText,
    toolCall: streamingToolCall,
    error: streamError,
    agentRunId: currentHookRunId,
    hasStreamingAssistant,
    startStreaming,
    stopStreaming,
  } = useAgentStream(
    {
      onMessage: handleNewMessageFromStream,
      onStatusChange: handleStreamStatusChange,
      onError: handleStreamError,
      onClose: handleStreamClose,
    },
    threadId,
    setMessages,
    threadAgentData?.agent?.agent_id,
  );

  const handleSubmitMessage = useCallback(
    async (
      message: string,
      options?: {
        model_name?: string;
        enable_thinking?: boolean;
        reference_images?: ReferenceImageInput[];
        attachments?: import('@/lib/api').MessageAttachmentInput[];
        context?: any;
        run_mode?: RunMode;
        cta?: {
          action: string;
          payload?: any;
          label?: string;
        };
      },
    ) => {
      const hasAttachments = Boolean(options?.attachments && options.attachments.length > 0);
      const hasReferenceImages = Boolean(options?.reference_images && options.reference_images.length > 0);
      if (!message.trim() && !hasAttachments && !hasReferenceImages) return;
      setIsSending(true);

      const optimisticMetadata = options?.attachments && options.attachments.length > 0
        ? JSON.stringify({ attachments: options.attachments })
        : '{}';
      const fallbackClientMessageContent = JSON.stringify({ role: 'user', content: message });
      const fallbackClientMessageMetadata =
        options?.attachments && options.attachments.length > 0
          ? { attachments: options.attachments }
          : {};

      const optimisticUserMessage: UnifiedMessage = {
        message_id: `temp-${Date.now()}`,
        thread_id: threadId,
        type: 'user',
        is_llm_message: false,
        content: message,
        metadata: optimisticMetadata,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, optimisticUserMessage]);
      setNewMessage('');

      // Auto-scroll to bottom when user sends a message
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 100);

      let createdUserMessage: ThreadMessageRecord | null = null;
      let persistedUserMessage = false;
      const removeOptimisticMessage = () => {
        setMessages((prev) =>
          prev.filter((m) => m.message_id !== optimisticUserMessage.message_id),
        );
      };
      const refreshMessages = () => {
        void queryClient.invalidateQueries({ queryKey: threadKeys.messages(threadId) });
      };

      try {
        const reference_images = options?.reference_images?.filter(
          (img) => img && (img.file_id || img.storage_path || img.node_id),
        );
        createdUserMessage = await addUserMessageMutation.mutateAsync({
          threadId,
          message,
          context: options?.context,
          ctaAction: options?.cta?.action,
          ctaPayload: options?.cta?.payload,
          ctaLabel: options?.cta?.label,
          referenceImages: reference_images,
          attachments: options?.attachments,
        });
        persistedUserMessage = true;
        if (createdUserMessage?.message_id) {
          const persistedMessage = toUnifiedThreadMessage(createdUserMessage, {
            threadId,
            content: fallbackClientMessageContent,
            metadata: optimisticMetadata,
          });
          setMessages((prev) => {
            const optimisticIndex = prev.findIndex(
              (m) => m.message_id === optimisticUserMessage.message_id,
            );
            if (optimisticIndex === -1) {
              const existingIndex = prev.findIndex(
                (m) => m.message_id === persistedMessage.message_id,
              );
              if (existingIndex === -1) {
                return [...prev, persistedMessage];
              }
              return prev.map((m, index) =>
                index === existingIndex ? persistedMessage : m,
              );
            }
            return prev.map((m, index) =>
              index === optimisticIndex ? persistedMessage : m,
            );
          });
        }
        const runMode = options?.run_mode ?? getStoredRunMode();
        const forwardOptions = {
          model_name: options?.model_name,
          enable_thinking: options?.enable_thinking,
          run_mode: runMode,
        };
        const clientMessageHint: ClientMessageHint | undefined =
          createdUserMessage?.message_id
            ? {
                message_id: createdUserMessage.message_id,
                content: createdUserMessage.content,
                metadata: createdUserMessage.metadata,
                type: createdUserMessage.type,
              }
            : {
                content: { role: 'user', content: message },
                metadata: fallbackClientMessageMetadata,
                role: 'user',
                type: 'user',
              };

        let agentResult;
        try {
          agentResult = await startAgentMutation.mutateAsync({
            threadId,
            options: {
              ...forwardOptions,
              agent_id: runMode === 'chat' ? undefined : selectedAgentId,
              client_message: clientMessageHint,
            },
          });
        } catch (error) {
          console.error('Failed to start agent:', error);

          if (error instanceof BillingError) {
            const didShow = await checkBillingLimits();
            if (!didShow) {
              setBillingData({
                title: 'Upgrade required',
                message:
                  error.detail.message ||
                  'Upgrade to continue.',
                primaryAction: 'upgrade',
                accountId: null,
              });
              setShowBillingAlert(true);
            }
            removeOptimisticMessage();
            refreshMessages();
            return;
          }

          if (error instanceof AgentRunLimitError) {
            const { running_thread_ids, running_count } = error.detail;

            setAgentLimitData({
              runningCount: running_count,
              runningThreadIds: running_thread_ids,
            });
            setShowAgentLimitDialog(true);
            removeOptimisticMessage();
            refreshMessages();
            return;
          }

          if (error instanceof ProjectLimitError) {
            setBillingData({
              title: 'Project limit reached',
              message:
                error.detail.message ||
                `You've reached your project limit (${error.detail.current_count}/${error.detail.limit}). Please upgrade to create more projects.`,
              primaryAction: 'upgrade',
              accountId: null,
            });
            setShowBillingAlert(true);
            removeOptimisticMessage();
            refreshMessages();
            return;
          }

          // For other errors, rely on centralized API error handling
          // (startAgent/addUserMessage already call handleApiError).
          throw error;
        }

        setUserInitiatedRun(true);
        setAgentRunId(agentResult.agent_run_id);
      } catch (err) {
        console.error('Error sending message or starting agent:', err);
        // Billing/limit errors已经在上方分支和全局 error handler 中提示，这里不重复 toast。
        removeOptimisticMessage();
        if (persistedUserMessage) {
          refreshMessages();
        }
      } finally {
        setIsSending(false);
      }
    },
    [
      threadId,
      addUserMessageMutation,
      startAgentMutation,
      setMessages,
      setBillingData,
      setShowBillingAlert,
      setAgentRunId,
      checkBillingLimits,
      queryClient,
    ],
  );

  const handleCtaAction = useCallback(
    async (cta: CtaAction) => {
      if (!cta?.action) return;
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
      const fileName = (payload as any).file_name || (payload as any).fileName;
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
            console.error('Failed to get download url:', err);
          }
        }
        toast.error(`下载链接不可用${fileName ? `: ${fileName}` : ''}`);
        return;
      }
      const label = (cta.label || cta.action || '').trim();
      const messageText = label || cta.action;
      if (!messageText) return;
      await handleSubmitMessage(messageText, {
        cta: {
          action: cta.action,
          payload: cta.payload,
          label: cta.label,
        },
      });
    },
    [handleSubmitMessage],
  );

  const handleReferenceSelection = useCallback(
    async (candidate: ReferenceImageCandidate) => {
      if (!referencePicker) return;
      if (isReferenceSubmitting) return;
      const targetCanvasId = referencePicker.canvas_id;
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
        console.error('[ThreadComponent] reference retry failed:', err);
        toast.error('Failed to generate image. Please try again.');
      } finally {
        setIsReferenceSubmitting(false);
      }
    },
    [referencePicker, threadId, isReferenceSubmitting],
  );

  const handleStopAgent = useCallback(async () => {
    setAgentStatus('idle');

    await stopStreaming();

    if (agentRunId) {
      try {
        await stopAgentMutation.mutateAsync(agentRunId);
      } catch (error) {
        console.error('Error stopping agent:', error);
      }
    }
  }, [stopStreaming, agentRunId, stopAgentMutation, setAgentStatus]);

  const handleOpenFileViewer = useCallback(
    async (filePath?: string, filePathList?: string[], file?: string | { path?: string; name?: string; fileUrl?: string; downloadUrl?: string; fileId?: string }) => {
      let resolvedPath = filePath;
      let derivedName: string | undefined = undefined;
      let resolvedFileId: string | undefined = undefined;
      if (typeof file === 'object' && file) {
        resolvedPath = file.fileUrl || file.downloadUrl || file.path || filePath;
        derivedName = file.name;
        resolvedFileId = file.fileId;
      }

      const isLikelyFileId = (value?: string | null) => !!value && /^[0-9a-fA-F-]{36}$/.test(value);
      const fileId = resolvedFileId || (isLikelyFileId(resolvedPath) ? resolvedPath : undefined);
      const isWorkspacePath = typeof resolvedPath === 'string' && resolvedPath.startsWith('/workspace');

      if (fileId && !isWorkspacePath) {
        try {
          const { url } = await getDownloadUrl(fileId);
          if (url && typeof window !== 'undefined') {
            window.open(url, '_blank', 'noopener,noreferrer');
            return;
          }
        } catch (err) {
          console.error('Failed to open file by id:', err);
        }
      }

      if (resolvedPath && !isWorkspacePath) {
        setStoragePreviewFile({
          path: resolvedPath,
          name: derivedName,
        });
        setStoragePreviewOpen(true);
        return;
      }

      if (resolvedPath) {
        setFileToView(resolvedPath);
      } else {
        setFileToView(null);
      }
      setFilePathList(filePathList);
      setFileViewerOpen(true);
    },
    [],
  );

  const toolViewAssistant = useCallback(
    (assistantContent?: string, toolContent?: string) => {
      if (!assistantContent) return null;

      return (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">
            Assistant Message
          </div>
          <div className="rounded-md border bg-muted/50 p-3">
            <div className="text-xs prose prose-xs dark:prose-invert chat-markdown max-w-none">
              {assistantContent}
            </div>
          </div>
        </div>
      );
    },
    [],
  );

  const toolViewResult = useCallback(
    (toolContent?: string, isSuccess?: boolean) => {
      if (!toolContent) return null;

      return (
        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <div className="text-xs font-medium text-muted-foreground">
              Tool Result
            </div>
            <div
              className={`px-2 py-0.5 rounded-full text-xs ${
                isSuccess
                  ? 'bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300'
                  : 'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300'
              }`}
            >
              {isSuccess ? 'Success' : 'Failed'}
            </div>
          </div>
          <div className="rounded-md border bg-muted/50 p-3">
            <div className="text-xs prose prose-xs dark:prose-invert chat-markdown max-w-none">
              {toolContent}
            </div>
          </div>
        </div>
      );
    },
    [],
  );

  // Effects
  useEffect(() => {
    if (!initialLayoutAppliedRef.current) {
      setLeftSidebarOpen(false);
      initialLayoutAppliedRef.current = true;
    }
  }, [setLeftSidebarOpen]);

  // Removed auto-open side panel effect

  useEffect(() => {
    // Prevent duplicate streaming calls for the same runId
    if (agentRunId && lastStreamStartedRef.current === agentRunId) {
      return;
    }

    // Start streaming if user initiated a run (don't wait for initialLoadCompleted for first-time users)
    if (agentRunId && agentRunId !== currentHookRunId && userInitiatedRun) {
      console.log(`[ThreadComponent] Starting user-initiated stream for runId: ${agentRunId}`);
      startStreaming(agentRunId);
      lastStreamStartedRef.current = agentRunId; // Track that we started this runId
      setUserInitiatedRun(false); // Reset flag after starting
      return;
    }

    // Only auto-start streaming on page load if we know the agent is currently running
    if (
      agentRunId &&
      agentRunId !== currentHookRunId &&
      initialLoadCompleted &&
      !userInitiatedRun &&
      agentStatus === 'running'
    ) {
      console.log(`[ThreadComponent] Starting auto stream for runId: ${agentRunId}`);
      startStreaming(agentRunId);
      lastStreamStartedRef.current = agentRunId; // Track that we started this runId
    }
  }, [
    agentRunId,
    startStreaming,
    currentHookRunId,
    initialLoadCompleted,
    userInitiatedRun,
    agentStatus,
  ]);

  useEffect(() => {
    if (
      (streamHookStatus === 'completed' ||
        streamHookStatus === 'stopped' ||
        streamHookStatus === 'agent_not_running' ||
        streamHookStatus === 'error') &&
      (agentStatus === 'running' || agentStatus === 'connecting')
    ) {
      setAgentStatus('idle');
      setAgentRunId(null);
      // Reset the stream tracking ref when stream completes
      lastStreamStartedRef.current = null;
    }
  }, [streamHookStatus, agentStatus, setAgentStatus, setAgentRunId]);

  // Reset stream tracking ref when threadId changes  
  useEffect(() => {
    lastStreamStartedRef.current = null;
  }, [threadId]);

  // SEO title update
  useEffect(() => {
    if (projectName) {
      document.title = `${projectName} | Zmind`;

      const metaDescription = document.querySelector(
        'meta[name="description"]',
      );
      if (metaDescription) {
        metaDescription.setAttribute(
          'content',
          `${projectName} - Interactive thinking workspace powered by Zmind`,
        );
      }

      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) {
        ogTitle.setAttribute('content', `${projectName} | Zmind`);
      }

      const ogDescription = document.querySelector(
        'meta[property="og:description"]',
      );
      if (ogDescription) {
        ogDescription.setAttribute(
          'content',
          `Interactive AI conversation for ${projectName}`,
        );
      }
    }
  }, [projectName]);

  useEffect(() => {
    const debugParam = searchParams.get('debug');
    setDebugMode(debugParam === 'true');
  }, [searchParams]);

  const hasCheckedUpgradeDialog = useRef(false);

  useEffect(() => {
    if (
      initialLoadCompleted &&
      subscriptionData &&
      !hasCheckedUpgradeDialog.current
    ) {
      hasCheckedUpgradeDialog.current = true;
      const hasSeenUpgradeDialog = localStorage.getItem(
        'zmind_upgrade_dialog_displayed',
      );
      const isFreeTier = subscriptionStatus === 'no_subscription';
      if (!hasSeenUpgradeDialog && isFreeTier && !isLocalMode()) {
        setShowUpgradeDialog(true);
      }
    }
  }, [subscriptionData, subscriptionStatus, initialLoadCompleted]);

  const handleDismissUpgradeDialog = () => {
    setShowUpgradeDialog(false);
    localStorage.setItem('zmind_upgrade_dialog_displayed', 'true');
  };

  // No tool streaming side panel

  useEffect(() => {
    setIsSidePanelAnimating(true);
    const timer = setTimeout(() => setIsSidePanelAnimating(false), 200);
    return () => clearTimeout(timer);
  }, [isSidePanelOpen]);

  // Scroll detection for show/hide scroll-to-bottom button
  useEffect(() => {
    const handleScroll = () => {
      if (!scrollContainerRef.current) return;

      const scrollTop = scrollContainerRef.current.scrollTop;
      const scrollHeight = scrollContainerRef.current.scrollHeight;
      const clientHeight = scrollContainerRef.current.clientHeight;
      const threshold = 100;

      // With flex-column-reverse, scrollTop becomes NEGATIVE when scrolling up
      // Show button when scrollTop < -threshold (scrolled up enough from bottom)
      const shouldShow = scrollTop < -threshold && scrollHeight > clientHeight;
      setShowScrollToBottom(shouldShow);
    };

    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll, {
        passive: true,
      });
      // Check initial state
      setTimeout(() => handleScroll(), 100);

      return () => {
        scrollContainer.removeEventListener('scroll', handleScroll);
      };
    }
  }, [messages, initialLoadCompleted]);

  if (!initialLoadCompleted || isLoading) {
    return <ThreadSkeleton compact={compact} />;
  }

  if (error) {
    return (
      <ThreadLayout
        threadId={threadId}
        projectName={projectName}
        projectId={project?.id || ''}
        project={project}
        sandboxId={sandboxId}
        onToggleSidePanel={toggleSidePanel}
        onViewFiles={handleOpenFileViewer}
        fileViewerOpen={fileViewerOpen}
        setFileViewerOpen={setFileViewerOpen}
        fileToView={fileToView}
        filePathList={filePathList}
        messages={messages as ApiMessageType[]}
        isLoading={!initialLoadCompleted || isLoading}
        showBillingAlert={showBillingAlert}
        billingData={billingData}
        onDismissBilling={() => setShowBillingAlert(false)}
        debugMode={debugMode}
        isMobile={isMobile}
        initialLoadCompleted={initialLoadCompleted}
        agentName={agent && agent.name}
      >
        <ThreadError error={error} />
      </ThreadLayout>
    );
  }

  if (compact) {
    return (
      <>
        <ThreadLayout
          threadId={threadId}
          projectName={projectName}
          projectId={project?.id || ''}
          project={project}
          sandboxId={sandboxId}
          onToggleSidePanel={toggleSidePanel}
          onProjectRenamed={handleProjectRenamed}
          onViewFiles={handleOpenFileViewer}
          fileViewerOpen={fileViewerOpen}
          setFileViewerOpen={setFileViewerOpen}
          fileToView={fileToView}
          filePathList={filePathList}
          messages={messages as ApiMessageType[]}
          isLoading={!initialLoadCompleted || isLoading}
          showBillingAlert={showBillingAlert}
          billingData={billingData}
          onDismissBilling={() => setShowBillingAlert(false)}
          debugMode={debugMode}
          isMobile={isMobile}
          initialLoadCompleted={initialLoadCompleted}
          agentName={agent && agent.name}
          compact={true}
        >
          {/* Thread Content - Scrollable */}
          <div 
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col-reverse"
          >
            <div className="flex-shrink-0">
                <ThreadContent
                  messages={messages}
                  streamingReasoningContent={streamingReasoningText}
                  streamingToolCall={streamingToolCall}
                  agentStatus={agentStatus}
                  handleToolClick={() => {}}
                  handleOpenFileViewer={handleOpenFileViewer}
                  onCtaAction={handleCtaAction}
                  readOnly={false}
                  streamHookStatus={streamHookStatus}
                sandboxId={sandboxId}
                project={project}
                debugMode={debugMode}
                agentName={agent && agent.name}
                agentAvatar={undefined}
                agentMetadata={undefined}
                agentData={agent}
                isPreviewMode={true}
                shareThreadId={threadId}
                hasStreamingAssistant={hasStreamingAssistant}
                forceShowLoader={isSending || userInitiatedRun}
              />
            </div>
          </div>

          {/* Compact Chat Input */}
          <div className="flex-shrink-0 border-t border-border/20 bg-background p-4">
            <ChatInput
              value={newMessage}
              onChange={setNewMessage}
              onSubmit={handleSubmitMessage}
              placeholder={`Describe what you need help with...`}
              loading={isSending}
              disabled={
                isSending ||
                agentStatus === 'running' ||
                agentStatus === 'connecting'
              }
              isAgentRunning={
                agentStatus === 'running' || agentStatus === 'connecting'
              }
              onStopAgent={handleStopAgent}
              autoFocus={!isLoading}
              enableAdvancedConfig={false}
              onFileBrowse={handleOpenFileViewer}
              sandboxId={sandboxId || undefined}
              messages={messages}
              agentName={agent && agent.name}
              hideAgentSelection={!!configuredAgentId}
              
              defaultShowSnackbar="tokens"
              showScrollToBottomIndicator={showScrollToBottom}
              onScrollToBottom={scrollToBottom}
              onPreviewAttachment={handleOpenFileViewer}
              threadId={threadId}
            />
          </div>
        </ThreadLayout>

        <UpgradeDialog
          open={showUpgradeDialog}
          onOpenChange={setShowUpgradeDialog}
          onDismiss={handleDismissUpgradeDialog}
        />

        {agentLimitData && (
          <AgentRunLimitDialog
            open={showAgentLimitDialog}
            onOpenChange={setShowAgentLimitDialog}
            runningCount={agentLimitData.runningCount}
            runningThreadIds={agentLimitData.runningThreadIds}
            projectId={projectId}
          />
        )}
      </>
    );
  }

  // Full layout version for dedicated thread pages
  const inputDockStyle = isMobile
    ? undefined
    : ({
        left:
          leftSidebarState === 'expanded'
            ? 'var(--sidebar-width)'
            : 'var(--sidebar-width-icon)',
        right: '0px',
      } as React.CSSProperties);

  return (
    <>
      <ThreadLayout
        threadId={threadId}
        projectName={projectName}
        projectId={project?.id || ''}
        project={project}
        sandboxId={sandboxId}
        onToggleSidePanel={toggleSidePanel}
        onProjectRenamed={handleProjectRenamed}
        onViewFiles={handleOpenFileViewer}
        fileViewerOpen={fileViewerOpen}
        setFileViewerOpen={setFileViewerOpen}
        fileToView={fileToView}
        filePathList={filePathList}
        messages={messages as ApiMessageType[]}
        isLoading={!initialLoadCompleted || isLoading}
        showBillingAlert={showBillingAlert}
        billingData={billingData}
        onDismissBilling={() => setShowBillingAlert(false)}
        debugMode={debugMode}
        isMobile={isMobile}
        initialLoadCompleted={initialLoadCompleted}
        agentName={agent && agent.name}
      >
        <ThreadContent
          messages={messages}
          streamingReasoningContent={streamingReasoningText}
          streamingToolCall={streamingToolCall}
          agentStatus={agentStatus}
          handleToolClick={() => {}}
          handleOpenFileViewer={handleOpenFileViewer}
          onCtaAction={handleCtaAction}
          readOnly={false}
          streamHookStatus={streamHookStatus}
          sandboxId={sandboxId}
          project={project}
          debugMode={debugMode}
          agentName={agent && agent.name}
          agentAvatar={undefined}
          agentMetadata={undefined}
          agentData={agent}
          shareThreadId={threadId}
          hasStreamingAssistant={hasStreamingAssistant}
          forceShowLoader={isSending || userInitiatedRun}
        />

        <div
          className={cn(
            'fixed bottom-0 z-10 bg-gradient-to-t from-background via-background/90 to-transparent px-4 pt-8 safe-area-bottom-spacious safe-area-x',
            isSidePanelAnimating ? '' : 'transition-all duration-200 ease-in-out',
            isMobile ? 'left-0 right-0' : '',
          )}
          style={inputDockStyle}
        >
          <div className={cn('mx-auto', isMobile ? 'w-full' : 'max-w-3xl')}>
            <ChatInput
              value={newMessage}
              onChange={setNewMessage}
              onSubmit={handleSubmitMessage}
              placeholder={`Describe what you need help with...`}
              loading={isSending}
              disabled={
                isSending ||
                agentStatus === 'running' ||
                agentStatus === 'connecting'
              }
              isAgentRunning={
                agentStatus === 'running' || agentStatus === 'connecting'
              }
              onStopAgent={handleStopAgent}
              autoFocus={!isLoading}
              enableAdvancedConfig={false}
              onFileBrowse={handleOpenFileViewer}
              sandboxId={sandboxId || undefined}
              messages={messages}
              agentName={agent && agent.name}
              hideAgentSelection={!!configuredAgentId}
              
              defaultShowSnackbar="tokens"
              showScrollToBottomIndicator={showScrollToBottom}
              onScrollToBottom={scrollToBottom}
              onPreviewAttachment={handleOpenFileViewer}
              threadId={threadId}
            />
          </div>
        </div>
      </ThreadLayout>

      <FileViewerModal
        open={fileViewerOpen}
        onOpenChange={setFileViewerOpen}
        initialFilePath={fileToView}
        filePathList={filePathList}
        sandboxId={sandboxId}
      />

      <StorageFilePreviewModal
        open={storagePreviewOpen}
        file={storagePreviewFile}
        onClose={() => {
          setStoragePreviewOpen(false);
          setStoragePreviewFile(null);
        }}
      />

      <UpgradeDialog
        open={showUpgradeDialog}
        onOpenChange={setShowUpgradeDialog}
        onDismiss={handleDismissUpgradeDialog}
      />

      {agentLimitData && (
        <AgentRunLimitDialog
          open={showAgentLimitDialog}
          onOpenChange={setShowAgentLimitDialog}
          runningCount={agentLimitData.runningCount}
          runningThreadIds={agentLimitData.runningThreadIds}
          projectId={projectId}
        />
      )}

      <ReferenceImagePickerDialog
        open={Boolean(referencePicker)}
        payload={referencePicker}
        onOpenChange={(open) => {
          if (!open && !isReferenceSubmitting) setReferencePicker(null);
        }}
        onConfirm={handleReferenceSelection}
      />
    </>
  );
}
