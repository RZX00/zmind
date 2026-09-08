'use client';

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
} from 'react';
import Image from 'next/image';

import { Card, CardContent } from '@/components/ui/card';
import { SelectionContextStack } from '@/canvas/components/shared/SelectionContextStack';
import { handleFiles } from './file-upload-handler';
import { MessageInput } from './message-input';
import { AttachmentGroup } from '../attachment-group';
import { useModelSelection } from '@/hooks/use-model-selection';
import { useFileDelete } from '@/hooks/react-query/files';
import { ToolCallInput } from './floating-tool-preview';
import { ChatSnack } from './chat-snack';
import { ArrowDown, Sparkles } from 'lucide-react';
import { useComposioToolkitIcon } from '@/hooks/react-query/composio/use-composio';
import { Skeleton } from '@/components/ui/skeleton';
import { ENABLE_INTEGRATIONS } from '@/lib/flags';
import { ComposioConnectionsSection } from '@/components/integrations/composio-connections-section';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSubscriptionData } from '@/contexts/SubscriptionContext';
import { isLocalMode } from '@/lib/config';
// Pricing is now a dedicated page; keep BillingModal for other flows only if needed
import { useRouter } from '@/i18n/routing';
import posthog from 'posthog-js';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { REFERENCE_IMAGE_EVENT, SET_REFERENCE_IMAGE_EVENT, ReferenceImagePayload, ReferenceImageInput, toReferenceImageInput, fromReferenceImageInput } from '@/lib/reference-images';
import { useFileStorageUsage } from '@/hooks/react-query/files';
import { DEFAULT_MAX_FILE_SIZE_BYTES } from '@/lib/constants/files';
import { useWorkspace } from '@/contexts/workspace-context';
import { buildTeamScopedPath } from '@/lib/workspace-path';
import {
  getStoredRunMode,
  normalizeRunMode,
  RUN_MODE_EVENT,
  RUN_MODE_STORAGE_KEY,
  setStoredRunMode,
  type RunMode,
} from '@/lib/run-mode';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RunModeMenu } from './run-mode-menu';

export interface ChatInputHandles {
  getPendingFiles: () => File[];
  clearPendingFiles: () => void;
  focus: () => void;
  getDraftPayload: () => {
    text: string;
    attachments: MessageAttachmentInput[];
    reference_images: ReferenceImageInput[];
    run_mode: RunMode;
    model_name?: string;
    hasPendingUploads: boolean;
    hasUploadError: boolean;
  };
  setDraftPayload: (payload: {
    text?: string;
    attachments?: MessageAttachmentInput[];
    reference_images?: ReferenceImageInput[];
  }) => void;
  clearDraft: () => void;
}

export interface ChatInputProps {
  onSubmit: (
    message: string,
    options?: {
      model_name?: string;
      enable_thinking?: boolean;
      agent_id?: string;
      run_mode?: RunMode;
      reference_images?: ReferenceImageInput[];
      attachments?: MessageAttachmentInput[];
      context?: any;
      cta?: {
        action: string;
        payload?: any;
        label?: string;
      };
    },
  ) => void;
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
  isAgentRunning?: boolean;
  onStopAgent?: () => void;
  autoFocus?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  onFileBrowse?: () => void;
  sandboxId?: string;
  hideAttachments?: boolean;
  agentName?: string;
  messages?: any[];
  bgColor?: string;
  toolCalls?: ToolCallInput[];
  toolCallIndex?: number;
  showToolPreview?: boolean;
  onExpandToolPreview?: () => void;
  isLoggedIn?: boolean;
  enableAdvancedConfig?: boolean;
  onConfigureAgent?: (agentId: string) => void;
  hideAgentSelection?: boolean;
  defaultShowSnackbar?: 'tokens' | 'upgrade' | false;
  showToLowCreditUsers?: boolean;
  agentMetadata?: {
    is_zmind_default?: boolean;
  };
  showScrollToBottomIndicator?: boolean;
  onScrollToBottom?: () => void;
  // Canvas-only: show selection stack above attachments (purely visual)
  selectionCount?: number;
  // Dashboard hero style: larger, squarer, subtle shadow
  heroStyle?: boolean;
  onPreviewAttachment?: (path?: string, filePathList?: string[], file?: UploadedFile | string) => void;
  threadId?: string;
  variant?: 'default' | 'panel';
  allowSendWhileRunning?: boolean;
  showPauseButton?: boolean;
  onPauseQueue?: () => void;
  hideRunModeSwitch?: boolean;
  forcedRunMode?: RunMode;
}

export interface UploadedFile {
  name: string;
  path: string;
  size: number;
  type: string;
  fileId?: string;
  localUrl?: string;
  // New: URLs from storage upload for immediate preview/access
  fileUrl?: string; // signed or public URL for preview
  downloadUrl?: string; // signed/public download URL with original filename
  storagePath?: string;
}

export interface MessageAttachmentInput {
  file_id: string;
  name?: string;
  size?: number;
  content_type?: string;
  storage_path?: string;
}

interface ReferenceImage {
  id: string;
  storagePath: string;
  fileId?: string;
  label?: string;
  width?: number;
  height?: number;
  nodeId?: string;
  source: 'chat-upload' | 'canvas-node';
}
type ReferenceImageSource = 'chat-upload' | 'canvas-node';


export const ChatInput = forwardRef<ChatInputHandles, ChatInputProps>(
  (
    {
      onSubmit,
      placeholder = 'Describe what you need help with...',
      loading = false,
      disabled = false,
      isAgentRunning = false,
      onStopAgent,
      autoFocus = true,
      value: controlledValue,
      onChange: controlledOnChange,
      onFileBrowse,
      sandboxId,
      hideAttachments = false,
      agentName,
      messages = [],
      bgColor = 'bg-card',
      toolCalls = [],
      toolCallIndex = 0,
      showToolPreview = false,
      onExpandToolPreview,
      isLoggedIn = true,
      enableAdvancedConfig = false,
      onConfigureAgent,
      hideAgentSelection = false,
      defaultShowSnackbar = false,
      showToLowCreditUsers = true,
      agentMetadata,
      showScrollToBottomIndicator = false,
      onScrollToBottom,
      selectionCount,
      heroStyle = false,
      onPreviewAttachment,
      threadId,
      variant = 'default',
      allowSendWhileRunning = false,
      showPauseButton = false,
      onPauseQueue,
      hideRunModeSwitch = false,
      forcedRunMode,
    },
    ref,
  ) => {
    const isControlled =
      controlledValue !== undefined && controlledOnChange !== undefined;
    const router = useRouter();
    const { teamSlug } = useWorkspace();
    const subscriptionPath = buildTeamScopedPath('/subscription', teamSlug);

    const [uncontrolledValue, setUncontrolledValue] = useState('');
    const value = isControlled ? controlledValue : uncontrolledValue;

    const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const [registryDialogOpen, setRegistryDialogOpen] = useState(false);
    const [runMode, setRunMode] = useState<RunMode>(() => forcedRunMode ?? getStoredRunMode());
    const [runModePopoverOpen, setRunModePopoverOpen] = useState(false);

    const [showSnackbar, setShowSnackbar] = useState(defaultShowSnackbar);
    const [userDismissedUsage, setUserDismissedUsage] = useState(false);
    const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
    const ignoredChatReferences = useRef<Set<string>>(new Set());
    const imageAttachments = useMemo(
      () =>
        (uploadedFiles || []).filter(
          (file) =>
            !!file.path &&
            !file.path.startsWith('/workspace') &&
            (file.type?.startsWith('image/') ?? false),
        ),
      [uploadedFiles],
    );
    // const [billingModalOpen, setBillingModalOpen] = useState(false);

    const {
      selectedModel,
      setSelectedModel: handleModelChange,
      subscriptionStatus,
      allModels: modelOptions,
      canAccessModel,
      getActualModelId,
      refreshCustomModels,
      isLoading: modelsLoading,
      modelsError,
    } = useModelSelection();

    const { data: subscriptionData } = useSubscriptionData();
    const { data: storageUsage } = useFileStorageUsage(isLoggedIn);
    const maxFileBytes = storageUsage?.max_file_bytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    const deleteFileMutation = useFileDelete();
    const isPanelVariant = variant === 'panel';
    const runModeLabel = runMode === 'chat' ? 'Chat' : 'Agent';

    // Fetch integration icons only when feature enabled, logged in and advanced config UI is in use
    const shouldFetchIcons = ENABLE_INTEGRATIONS && isLoggedIn && !!enableAdvancedConfig;
    const { data: googleDriveIcon } = useComposioToolkitIcon('googledrive', { enabled: shouldFetchIcons });
    const { data: slackIcon } = useComposioToolkitIcon('slack', { enabled: shouldFetchIcons });
    const { data: notionIcon } = useComposioToolkitIcon('notion', { enabled: shouldFetchIcons });

    // Show usage preview logic:
    // - Always show to free users when showToLowCreditUsers is true
    // - For paid users, only show when they're at 70% or more of their cost limit (30% or below remaining)
    const shouldShowUsage = !isLocalMode() && subscriptionData && showToLowCreditUsers && (() => {
      // Free users: always show
      if (subscriptionStatus === 'no_subscription') {
        return true;
      }

      // Paid users: only show when at 70% or more of cost limit
      const currentUsage = subscriptionData.current_usage || 0;
      const costLimit = subscriptionData.cost_limit || 0;

      if (costLimit === 0) return false; // No limit set

      return currentUsage >= (costLimit * 0.7); // 70% or more used (30% or less remaining)
    })();

    // Auto-show usage preview when we have subscription data
    useEffect(() => {
      if (shouldShowUsage && defaultShowSnackbar !== false && !userDismissedUsage && (showSnackbar === false || showSnackbar === defaultShowSnackbar)) {
        setShowSnackbar('upgrade');
      } else if (!shouldShowUsage && showSnackbar !== false) {
        setShowSnackbar(false);
      }
    }, [subscriptionData, showSnackbar, defaultShowSnackbar, shouldShowUsage, subscriptionStatus, showToLowCreditUsers, userDismissedUsage]);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const inputContainerRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const handleRunModeChange = (next: RunMode) => {
      if (forcedRunMode) return;
      if (next === runMode) return;
      setRunMode(next);
      setStoredRunMode(next);
      setRunModePopoverOpen(false);
    };
    const openRunModePopover = () => {
      if (hideRunModeSwitch || forcedRunMode) return;
      setRunModePopoverOpen(true);
    };

    const toReferenceImage = useCallback(
      (image: ReferenceImagePayload, fallbackSource: ReferenceImageSource): ReferenceImage | null => {
        if (!image?.storagePath) return null;
        return {
          id: image.id || `${fallbackSource}-${image.storagePath}`,
          storagePath: image.storagePath,
          fileId: image.fileId,
          label: image.label,
          width: image.width,
          height: image.height,
          nodeId: image.nodeId,
          source: image.source || fallbackSource,
        };
      },
      [],
    );

    const addReferenceImages = useCallback(
      (images: ReferenceImagePayload[], source: ReferenceImageSource) => {
        if (!images?.length) return;
        setReferenceImages((prev) => {
          const existingByPath = new Map(prev.map((img) => [img.storagePath, img]));
          const next = [...prev];
          for (const image of images) {
            const base = toReferenceImage(image, source);
            if (!base) continue;
            if (existingByPath.has(base.storagePath)) {
              const idx = next.findIndex((img) => img.storagePath === base.storagePath);
              if (idx >= 0) {
                next[idx] = { ...next[idx], ...base };
              }
            } else {
              next.push(base);
            }
          }
          return next;
        });
      },
      [toReferenceImage],
    );

    

    useEffect(() => {
      if (!forcedRunMode) return;
      setRunMode(forcedRunMode);
    }, [forcedRunMode]);

    useEffect(() => {
      const handleStorage = (event: StorageEvent) => {
        if (forcedRunMode) return;
        if (event.key !== RUN_MODE_STORAGE_KEY) return;
        setRunMode(normalizeRunMode(event.newValue));
      };
      const handleRunModeEvent = (event: Event) => {
        if (forcedRunMode) return;
        const detail = (event as CustomEvent<{ mode?: string }>).detail;
        if (!detail?.mode) return;
        setRunMode(normalizeRunMode(detail.mode));
      };
      window.addEventListener('storage', handleStorage);
      window.addEventListener(RUN_MODE_EVENT, handleRunModeEvent as EventListener);
      return () => {
        window.removeEventListener('storage', handleStorage);
        window.removeEventListener(RUN_MODE_EVENT, handleRunModeEvent as EventListener);
      };
    }, [addReferenceImages, forcedRunMode]);

    useEffect(() => {
      if (autoFocus && textareaRef.current) {
        textareaRef.current.focus();
      }
    }, [autoFocus]);

    // Blur the textarea when clicking outside the chat input area
    useEffect(() => {
      const onDocPointer = (ev: MouseEvent | TouchEvent) => {
        const ta = textareaRef.current;
        if (!ta) return;
        if (document.activeElement !== ta) return;
        const root = inputContainerRef.current;
        const target = ev.target as Node | null;
        if (root && target && !root.contains(target)) {
          try { ta.blur(); } catch {}
        }
      };
      document.addEventListener('mousedown', onDocPointer, true);
      document.addEventListener('touchstart', onDocPointer, true);
      return () => {
        document.removeEventListener('mousedown', onDocPointer, true);
        document.removeEventListener('touchstart', onDocPointer, true);
      };
    }, [toReferenceImage]);

    useEffect(() => {
      const handleReferenceEvent = (event: Event) => {
        const detail = (event as CustomEvent<{ images: ReferenceImagePayload[] }>).detail;
        if (!detail?.images?.length) return;
        addReferenceImages(detail.images, 'canvas-node');
      };
      window.addEventListener(REFERENCE_IMAGE_EVENT, handleReferenceEvent as EventListener);
      return () => window.removeEventListener(REFERENCE_IMAGE_EVENT, handleReferenceEvent as EventListener);
    }, [addReferenceImages]);

    useEffect(() => {
      const handleSetEvent = (event: Event) => {
        const detail = (event as CustomEvent<{ images: ReferenceImagePayload[] }>).detail;
        const normalized = (detail?.images || [])
          .map((img) => toReferenceImage(img, 'canvas-node'))
          .filter(Boolean) as ReferenceImage[];
        setReferenceImages((prev) => {
          const manual = prev.filter((img) => img.source !== 'canvas-node');
          return [...manual, ...normalized];
        });
      };
      window.addEventListener(SET_REFERENCE_IMAGE_EVENT, handleSetEvent as EventListener);
      return () => window.removeEventListener(SET_REFERENCE_IMAGE_EVENT, handleSetEvent as EventListener);
    }, [toReferenceImage]);

    useEffect(() => {
      const attachmentPaths = new Set(
        imageAttachments.map((f) => f.fileId || f.path).filter(Boolean) as string[],
      );

      setReferenceImages((prev) => {
        const filtered = prev.filter(
          (img) => img.source !== 'chat-upload' || attachmentPaths.has(img.fileId || img.storagePath),
        );
        const existingPaths = new Set(
          filtered
            .filter((img) => img.source === 'chat-upload')
            .map((img) => img.fileId || img.storagePath),
        );
        const additions: ReferenceImagePayload[] = [];
        for (const file of imageAttachments) {
          const key = file.fileId || file.path;
          if (!key || ignoredChatReferences.current.has(key)) continue;
          if (existingPaths.has(key)) continue;
          additions.push({
            id: `chat-upload-${key}`,
            storagePath: file.path,
            fileId: file.fileId,
            label: file.name,
            width: undefined,
            height: undefined,
            source: 'chat-upload',
          });
        }
        if (additions.length === 0) {
          return filtered;
        }
        const merged = [...filtered];
        additions.forEach((img) =>
          merged.push({
            id: img.id || `chat-upload-${img.fileId || img.storagePath}`,
            storagePath: img.storagePath!,
            fileId: img.fileId,
            label: img.label,
            source: 'chat-upload',
          }),
        );
        return merged;
      });

      // cleanup ignored entries for removed attachments
      ignoredChatReferences.current.forEach((path) => {
        if (!attachmentPaths.has(path)) {
          ignoredChatReferences.current.delete(path);
        }
      });
    }, [imageAttachments]);

    const removeReferenceImage = (id: string) => {
      setReferenceImages((prev) => {
        const target = prev.find((img) => img.id === id);
        if (target?.source === 'chat-upload') {
          ignoredChatReferences.current.add(target.fileId || target.storagePath);
        }
        return prev.filter((img) => img.id !== id);
      });
    };

    const activeReferenceImages = referenceImages.filter((img) => !!(img.fileId || img.storagePath));
    const activeReferenceInputs = activeReferenceImages.map((img) => toReferenceImageInput(img));
    const referencedAttachmentPaths = useMemo(
      () =>
        new Set(
          referenceImages
            .filter((img) => img.source === 'chat-upload')
            .map((img) => img.fileId || img.storagePath),
        ),
      [referenceImages],
    );
    const availableAttachmentReferences = imageAttachments.filter(
      (file) => {
        const key = file.fileId || file.path;
        return key && !referencedAttachmentPaths.has(key);
      },
    );

    const resolveBaseModelName = () => {
      if (!selectedModel) return undefined;
      return getActualModelId(selectedModel);
    };

    const buildAttachmentInputs = () => {
      const attachments: MessageAttachmentInput[] = [];
      let hasUploadError = false;
      if (uploadedFiles.length > 0) {
        uploadedFiles.forEach((file) => {
          if (!file.fileId) return;
          attachments.push({
            file_id: file.fileId,
            name: file.name,
            size: file.size,
            content_type: file.type,
            storage_path: file.storagePath || file.path,
          });
        });
        if (attachments.length === 0) {
          hasUploadError = true;
        }
      }
      return { attachments, hasUploadError };
    };

    const buildDraftPayload = () => {
      const { attachments, hasUploadError } = buildAttachmentInputs();
      return {
        text: value,
        attachments,
        reference_images: activeReferenceInputs,
        run_mode: runMode,
        model_name: resolveBaseModelName(),
        hasPendingUploads: isUploading || pendingFiles.length > 0,
        hasUploadError,
      };
    };

    const attachmentsToUploadedFiles = (attachments: MessageAttachmentInput[]) => {
      return attachments
        .filter((att) => att && att.file_id)
        .map((att) => ({
          name: att.name || att.file_id,
          path: att.storage_path || att.file_id,
          size: att.size || 0,
          type: att.content_type || 'application/octet-stream',
          fileId: att.file_id,
        }));
    };

    useImperativeHandle(ref, () => ({
      getPendingFiles: () => pendingFiles,
      clearPendingFiles: () => setPendingFiles([]),
      focus: () => {
        try { textareaRef.current?.focus(); } catch {}
      },
      getDraftPayload: () => buildDraftPayload(),
      setDraftPayload: (payload) => {
        const nextText = payload.text ?? '';
        if (isControlled) {
          controlledOnChange(nextText);
        } else {
          setUncontrolledValue(nextText);
        }
        if (payload.attachments) {
          setPendingFiles([]);
          setUploadedFiles(attachmentsToUploadedFiles(payload.attachments));
        }
        if (payload.reference_images) {
          const normalized = payload.reference_images
            .map((img) => fromReferenceImageInput(img))
            .filter(Boolean) as ReferenceImage[];
          setReferenceImages((prev) => {
            const manual = prev.filter((img) => img.source !== 'canvas-node');
            return [...manual, ...normalized];
          });
        }
      },
      clearDraft: () => {
        if (isControlled) {
          controlledOnChange('');
        } else {
          setUncontrolledValue('');
        }
        setPendingFiles([]);
        setUploadedFiles([]);
        setReferenceImages((prev) => prev.filter((img) => img.source === 'canvas-node'));
      },
    }));

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (
        (!value.trim() && uploadedFiles.length === 0 && activeReferenceInputs.length === 0) ||
        (loading && !allowSendWhileRunning) ||
        (disabled && !isAgentRunning)
      )
        return;

      if (isAgentRunning && onStopAgent && !allowSendWhileRunning) {
        onStopAgent();
        return;
      }

      if (isUploading || pendingFiles.length > 0) {
        toast.info('Files are still uploading. Please wait.');
        return;
      }

      const message = value;
      const { attachments, hasUploadError } = buildAttachmentInputs();
      if (hasUploadError) {
        toast.error('Upload failed. Please reattach your files.');
        return;
      }

      // Resolve persisted model id to API payload model id.
      const baseModelName = resolveBaseModelName();

      posthog.capture("task_prompt_submitted", { message });

      onSubmit(message, {
        model_name: baseModelName,
        run_mode: runMode,
        reference_images: activeReferenceInputs,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      if (!isControlled) {
        setUncontrolledValue('');
      }

      setUploadedFiles([]);
      setReferenceImages((prev) => prev.filter((img) => img.source === 'canvas-node'));
    };

    const handleUseAttachmentAsReference = (file: UploadedFile) => {
      if (!file.path) return;
      ignoredChatReferences.current.delete(file.fileId || file.path);
      addReferenceImages(
        [
          {
            id: `chat-upload-${file.fileId || file.path}`,
            storagePath: file.path,
            fileId: file.fileId,
            label: file.name,
          },
        ],
        'chat-upload',
      );
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      if (isControlled) {
        controlledOnChange(newValue);
      } else {
        setUncontrolledValue(newValue);
      }
    };

    const handleTranscription = (transcribedText: string) => {
      const currentValue = isControlled ? controlledValue : uncontrolledValue;
      const newValue = currentValue ? `${currentValue} ${transcribedText}` : transcribedText;

      if (isControlled) {
        controlledOnChange(newValue);
      } else {
        setUncontrolledValue(newValue);
      }
    };

      const removeUploadedFile = async (index: number) => {
      const fileToRemove = uploadedFiles[index];

      // Clean up local URL if it exists
      if (fileToRemove.localUrl) {
        URL.revokeObjectURL(fileToRemove.localUrl);
      }

      // Remove from local state immediately for responsive UI
      setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
      if (pendingFiles.length > index) {
        setPendingFiles((prev) => prev.filter((_, i) => i !== index));
      }

      // Check if file is referenced in existing chat messages before deleting from server
      const fileKey = fileToRemove.fileId || fileToRemove.path;
      const isFileUsedInChat = messages.some(message => {
        try {
          const metaRaw = (message as any)?.metadata;
          let meta: any = metaRaw || {};
          if (typeof metaRaw === 'string') {
            try {
              meta = JSON.parse(metaRaw);
            } catch {
              meta = {};
            }
          }
          const attachments = Array.isArray(meta?.attachments) ? meta.attachments : [];
          if (fileKey && attachments.some((att: any) =>
            (att?.file_id || att?.fileId || att?.id) === fileKey ||
            att?.storage_path === fileKey
          )) {
            return true;
          }
        } catch {}
        const content = typeof message.content === 'string' ? message.content : '';
        return fileToRemove.path && content.includes(`[Uploaded File: ${fileToRemove.path}]`);
      });

      const shouldDeleteFromSandbox =
        Boolean(sandboxId) && typeof fileToRemove.path === 'string' && fileToRemove.path.startsWith('/workspace');

      // Only delete from server if file is not referenced in chat history
      if (shouldDeleteFromSandbox && !isFileUsedInChat) {
        deleteFileMutation.mutate({
          sandboxId,
          filePath: fileToRemove.path,
        }, {
          onError: (error) => {
            console.error('Failed to delete file from server:', error);
          }
        });
      } else {
        // File exists in chat history, don't delete from server
      }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(false);
    };



    return (
      <div className={cn('mx-auto w-full', heroStyle ? 'max-w-none !max-w-none' : 'max-w-4xl', 'relative')}>
        <div className="relative">
          <ChatSnack
            toolCalls={toolCalls}
            toolCallIndex={toolCallIndex}
            onExpandToolPreview={onExpandToolPreview}
            agentName={agentName}
            showToolPreview={showToolPreview}
            showUsagePreview={showSnackbar}
            subscriptionData={subscriptionData}
            onCloseUsage={() => { setShowSnackbar(false); setUserDismissedUsage(true); }}
            onOpenUpgrade={() => router.push(subscriptionPath)}
            isVisible={showToolPreview || !!showSnackbar}
          />

          {/* Scroll to bottom button */}
          {showScrollToBottomIndicator && onScrollToBottom && (
            <button
              onClick={onScrollToBottom}
              className={`absolute cursor-pointer right-3 z-50 w-8 h-8 rounded-full bg-card border border-border transition-all duration-200 hover:scale-105 flex items-center justify-center ${
                isPanelVariant
                  ? (showToolPreview || !!showSnackbar ? '-top-14' : '-top-8')
                  : (showToolPreview || !!showSnackbar ? '-top-12' : '-top-5')
              }`}
              title="Scroll to bottom"
            >
              <ArrowDown className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
          {(() => {
            const plainWrapper = heroStyle || isPanelVariant;
            const Wrapper: any = plainWrapper ? 'div' : Card;
            const wrapperClass = cn(
              'w-full mx-auto overflow-visible relative z-10',
              heroStyle
                ? ''
                : isPanelVariant
                  ? 'rounded-xl bg-transparent border-none shadow-none'
                  : 'rounded-3xl -mb-2 shadow-none max-w-4xl bg-transparent border-none'
            );
            const commonProps = {
              onDragOver: handleDragOver,
              onDragLeave: handleDragLeave,
              onDrop: (e: React.DragEvent) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingOver(false);
                if (fileInputRef.current && e.dataTransfer.files.length > 0) {
                  const files = Array.from(e.dataTransfer.files);
                  handleFiles(
                    files,
                    setPendingFiles,
                    setUploadedFiles,
                    setIsUploading,
                    maxFileBytes,
                  );
                }
              },
            } as any;
            return (
              <Wrapper className={wrapperClass} {...commonProps}>
                <div ref={inputContainerRef} className="w-full text-sm flex flex-col justify-between items-start">
                  {(() => {
                    const panel = (
                      <CardContent
                        className={cn(
                          'w-full',
                          heroStyle
                            ? 'hero-input-panel p-3 pt-4 pb-3'
                            : isPanelVariant
                              ? `p-0 ${bgColor} border border-border/60 rounded-[var(--canvas-panel-radius)] shadow-[0_8px_20px_rgba(59,130,246,0.12)] dark:shadow-none overflow-hidden`
                              : `p-1.5 pb-2 ${bgColor} border rounded-[24px]`
                        )}
                      >
                  {isPanelVariant && !hideRunModeSwitch && !forcedRunMode && (
                    <Popover open={runModePopoverOpen} onOpenChange={setRunModePopoverOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="group relative mb-2 block w-full rounded-t-[var(--canvas-panel-radius)] pb-3 pt-2 text-left transition-colors overflow-hidden"
                        >
                          <div className="pointer-events-none absolute inset-0 rounded-t-[var(--canvas-panel-radius)] bg-card/30 transition-colors group-hover:bg-card/35" />
                          <div className="px-3">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-background/70">
                                <Sparkles className="h-3.5 w-3.5 text-foreground/80" />
                              </span>
                              <span className="text-[13px] font-medium text-foreground/90">@{runModeLabel}</span>
                            </div>
                          </div>
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[var(--canvas-panel-radius)] rounded-t-[var(--canvas-panel-radius)] border border-border/75 border-b-0" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" side="top" sideOffset={8} className="w-44 p-2">
                        <RunModeMenu
                          runMode={runMode}
                          onSelect={(mode) => {
                            handleRunModeChange(mode);
                            setRunModePopoverOpen(false);
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                <div className={cn(isPanelVariant ? 'px-2 pb-2' : '')}>
                  {/* Selection context visual stack (no text, no interaction) */}
                  {typeof selectionCount === 'number' && selectionCount > 0 && (
                    <div className="w-full flex justify-start pl-1 pt-0.5">
                      <SelectionContextStack count={selectionCount} />
                    </div>
                  )}
                  <AttachmentGroup
                    files={uploadedFiles || []}
                    sandboxId={sandboxId}
                    onRemove={removeUploadedFile}
                    layout="inline"
                    maxHeight="216px"
                    showPreviews={true}
                    onFileClick={onPreviewAttachment ? (path, _fileList, file) => {
                      const list = (uploadedFiles || []).map((f) => f.path).filter(Boolean) as string[];
                      onPreviewAttachment(path, list, file as UploadedFile | string);
                    } : undefined}
                    shareThreadId={threadId}
                  />
                  {referenceImages.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 px-2 pb-1 text-xs text-muted-foreground">
                      <span className="text-[11px] uppercase tracking-wide">参考图片</span>
                      {referenceImages.map((img) => (
                        <button
                          key={img.id}
                          type="button"
                          onClick={() => removeReferenceImage(img.id)}
                          className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
                        >
                          <span className="max-w-[160px] truncate text-xs">
                            {img.label || (img.source === 'canvas-node' ? `节点 ${img.nodeId || ''}` : '图片')}
                          </span>
                          <span className="text-[10px] text-muted-foreground hover:text-foreground">✕</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {availableAttachmentReferences.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 px-2 pb-1 text-[11px] text-muted-foreground">
                      <span className="uppercase tracking-wide">添加参考</span>
                      {availableAttachmentReferences.map((file) => (
                        <button
                          key={`candidate-${file.path}`}
                          type="button"
                          onClick={() => handleUseAttachmentAsReference(file)}
                          className="rounded-full border border-dashed border-border/60 px-2 py-0.5 hover:bg-muted text-xs"
                        >
                          + {file.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <MessageInput
                    ref={textareaRef}
                    value={value}
                    onChange={handleChange}
                    onSubmit={handleSubmit}
                    onTranscription={handleTranscription}
                    placeholder={placeholder}
                    loading={loading}
                    disabled={disabled}
                    isAgentRunning={isAgentRunning}
                    onStopAgent={onStopAgent}
                    isDraggingOver={isDraggingOver}
                    uploadedFiles={uploadedFiles}

                    fileInputRef={fileInputRef}
                    isUploading={isUploading}
                    sandboxId={sandboxId}
                    setPendingFiles={setPendingFiles}
                    setUploadedFiles={setUploadedFiles}
                    setIsUploading={setIsUploading}
                    maxFileBytes={maxFileBytes}
                    hideAttachments={hideAttachments}
                    heroStyle={heroStyle}
                    embedded={isPanelVariant}
                    onRunModeOpen={isPanelVariant && !hideRunModeSwitch && !forcedRunMode ? openRunModePopover : undefined}

                    selectedModel={selectedModel}
                    onModelChange={handleModelChange}
                    modelOptions={modelOptions}
                    subscriptionStatus={subscriptionStatus}
                    canAccessModel={canAccessModel}
                    refreshCustomModels={refreshCustomModels}
                    modelsLoading={modelsLoading}
                    modelsError={modelsError}
                    isLoggedIn={isLoggedIn}
                    enableAdvancedConfig={enableAdvancedConfig}
                    onOpenIntegrations={ENABLE_INTEGRATIONS ? () => {
                      try {
                        const { useSettingsStore } = require('@/canvas/stores/settings.store') as typeof import('@/canvas/stores/settings.store');
                        useSettingsStore.getState().open('integrations');
                      } catch {
                        setRegistryDialogOpen(true);
                      }
                    } : undefined}
                    runMode={runMode}
                    onRunModeChange={handleRunModeChange}
                    allowSendWhileRunning={allowSendWhileRunning}
                    showPauseButton={showPauseButton}
                    onPauseQueue={onPauseQueue}

                  />
                </div>
                  </CardContent>
                    );
                    if (!heroStyle) return panel;
                    return <div className="hero-input-shell">{panel}</div>;
                  })()}
                </div>
              </Wrapper>
            );
          })()}

          {ENABLE_INTEGRATIONS && (
            <div className={cn('w-full mx-auto -mt-12 relative z-20', heroStyle ? 'max-w-none' : 'max-w-4xl')}>
              <div className="bg-gradient-to-b from-transparent via-transparent to-muted/30 pt-8 pb-2 px-4 rounded-b-3xl border border-t-0 border-border/50 transition-all duration-300 ease-out">
                <div className="flex items-center justify-between gap-1 overflow-x-auto scrollbar-none relative">
                  <button
                    onClick={() => setRegistryDialogOpen(true)}
                    className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-all duration-200 px-2.5 py-1.5 rounded-2xl hover:bg-muted/50 border border-transparent hover:border-border/30 flex-shrink-0 cursor-pointer relative pointer-events-auto"
                  >
                    <div className="flex items-center -space-x-0.5">
                      {googleDriveIcon?.icon_url && slackIcon?.icon_url && notionIcon?.icon_url ? (
                        <>
                          <div className="w-4 h-4 bg-white dark:bg-muted border border-border rounded-full flex items-center justify-center shadow-sm">
                            <Image
                              src={googleDriveIcon.icon_url}
                              alt="Google Drive"
                              width={10}
                              height={10}
                              unoptimized
                              loader={({ src }) => src}
                              className="w-2.5 h-2.5"
                            />
                          </div>
                          <div className="w-4 h-4 bg-white dark:bg-muted border border-border rounded-full flex items-center justify-center shadow-sm">
                            <Image
                              src={slackIcon.icon_url}
                              alt="Slack"
                              width={10}
                              height={10}
                              unoptimized
                              loader={({ src }) => src}
                              className="w-2.5 h-2.5"
                            />
                          </div>
                          <div className="w-4 h-4 bg-white dark:bg-muted border border-border rounded-full flex items-center justify-center shadow-sm">
                            <Image
                              src={notionIcon.icon_url}
                              alt="Notion"
                              width={10}
                              height={10}
                              unoptimized
                              loader={({ src }) => src}
                              className="w-2.5 h-2.5"
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="w-4 h-4 bg-white dark:bg-muted border border-border rounded-full flex items-center justify-center shadow-sm">
                            <Skeleton className="w-2.5 h-2.5 rounded" />
                          </div>
                          <div className="w-4 h-4 bg-white dark:bg-muted border border-border rounded-full flex items-center justify-center shadow-sm">
                            <Skeleton className="w-2.5 h-2.5 rounded" />
                          </div>
                          <div className="w-4 h-4 bg-white dark:bg-muted border border-border rounded-full flex items-center justify-center shadow-sm">
                            <Skeleton className="w-2.5 h-2.5 rounded" />
                          </div>
                        </>
                      )}
                    </div>
                    <span className="text-xs font-medium">Integrations</span>
                  </button>
                  {/* Triggers/Playbooks removed */}
                </div>
              </div>
            </div>
          )}

          {/* Legacy integrations dialog (kept as fallback if settings modal is not available) */}
          {ENABLE_INTEGRATIONS && registryDialogOpen && (
            <Dialog open={registryDialogOpen} onOpenChange={setRegistryDialogOpen}>
              <DialogContent className="p-0 max-w-6xl h-[90vh] overflow-hidden">
                <DialogHeader className="sr-only">
                  <DialogTitle>Integrations</DialogTitle>
                </DialogHeader>
                <ComposioConnectionsSection />
              </DialogContent>
            </Dialog>
          )}

          {/* Pricing moved to /subscription page */}
        </div>
      </div>
    );
  },
);

ChatInput.displayName = 'ChatInput';
