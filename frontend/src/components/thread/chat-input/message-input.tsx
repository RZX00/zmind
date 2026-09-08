import React, { forwardRef, useEffect, useState } from 'react';
import { AtSign } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Square, Loader2, ArrowUp } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import { UploadedFile } from './chat-input';
import { FileUploadHandler } from './file-upload-handler';
import { VoiceRecorder } from './voice-recorder';
import { UnifiedConfigMenu } from './unified-config-menu';
// Note: canAccessModel is now part of useModelSelection hook
export type SubscriptionStatus = 'no_subscription' | 'active';
import { isLocalMode } from '@/lib/config';
import { TooltipContent } from '@/components/ui/tooltip';
import { Tooltip } from '@/components/ui/tooltip';
import { TooltipProvider, TooltipTrigger } from '@radix-ui/react-tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RunModeMenu } from './run-mode-menu';
// Pricing is now a dedicated page
import { useRouter } from '@/i18n/routing';
import { useWorkspace } from '@/contexts/workspace-context';
import { buildTeamScopedPath } from '@/lib/workspace-path';
import { handleFiles } from './file-upload-handler';
import type { RunMode } from '@/lib/run-mode';

interface MessageInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  onTranscription: (text: string) => void;
  placeholder: string;
  loading: boolean;
  disabled: boolean;
  isAgentRunning: boolean;
  onStopAgent?: () => void;
  isDraggingOver: boolean;
  uploadedFiles: UploadedFile[];

  fileInputRef: React.RefObject<HTMLInputElement>;
  isUploading: boolean;
  sandboxId?: string;
  setPendingFiles: React.Dispatch<React.SetStateAction<File[]>>;
  setUploadedFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  setIsUploading: React.Dispatch<React.SetStateAction<boolean>>;
  maxFileBytes?: number;
  hideAttachments?: boolean;
  isLoggedIn?: boolean;

  selectedModel: string;
  onModelChange: (model: string) => void;
  modelOptions: any[];
  subscriptionStatus: SubscriptionStatus;
  canAccessModel: (modelId: string) => boolean;
  refreshCustomModels?: () => void;
  modelsLoading?: boolean;
  modelsError?: Error | null;
  enableAdvancedConfig?: boolean;
  onOpenIntegrations?: () => void;
  runMode: RunMode;
  onRunModeChange: (mode: RunMode) => void;
  onRunModeOpen?: () => void;
  // When true, render compact, neutral styles for embedded scenarios (e.g., Canvas AI panel)
  embedded?: boolean;
  heroStyle?: boolean;
  allowSendWhileRunning?: boolean;
  showPauseButton?: boolean;
  onPauseQueue?: () => void;
}

export const MessageInput = forwardRef<HTMLTextAreaElement, MessageInputProps>(
  (
    {
      value,
      onChange,
      onSubmit,
      onTranscription,
      placeholder,
      loading,
      disabled,
      isAgentRunning,
      onStopAgent,
      isDraggingOver,
      uploadedFiles,

      fileInputRef,
      isUploading,
      sandboxId,
      setPendingFiles,
      setUploadedFiles,
      setIsUploading,
      maxFileBytes,
      hideAttachments = false,
      isLoggedIn = true,

      selectedModel,
      onModelChange,
      modelOptions,
      subscriptionStatus,
      canAccessModel,
      refreshCustomModels,
      modelsLoading = false,
      modelsError = null,

      enableAdvancedConfig = false,
      onOpenIntegrations,
      runMode,
      onRunModeChange,
      onRunModeOpen,
      embedded = false,
      heroStyle = false,
      allowSendWhileRunning = false,
      showPauseButton = false,
      onPauseQueue,
    },
    ref,
  ) => {
    const router = useRouter();
    const { teamSlug } = useWorkspace();
    const subscriptionPath = buildTeamScopedPath('/subscription', teamSlug);
    const [mounted, setMounted] = useState(false);
    const [runModeOpen, setRunModeOpen] = useState(false);
    const effectiveLoading = loading && !(allowSendWhileRunning && isAgentRunning);

    useEffect(() => {
      setMounted(true);
    }, []);

    useEffect(() => {
      const textarea = ref as React.RefObject<HTMLTextAreaElement>;
      if (!textarea.current) return;

      const adjustHeight = () => {
        const el = textarea.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.maxHeight = '260px';
        el.style.overflowY = el.scrollHeight > 260 ? 'auto' : 'hidden';

        const newHeight = Math.min(el.scrollHeight, 260);
        el.style.height = `${newHeight}px`;
      };

      adjustHeight();

      window.addEventListener('resize', adjustHeight);
      return () => window.removeEventListener('resize', adjustHeight);
    }, [value, ref]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        const canTrigger =
          (value.trim() || uploadedFiles.length > 0) &&
          !effectiveLoading &&
          (!disabled || isAgentRunning);
        if (!canTrigger) return;
        if (isAgentRunning && !allowSendWhileRunning) {
          onStopAgent?.();
          return;
        }
        onSubmit(e as unknown as React.FormEvent);
      }
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items || []);

      // Collect any files from clipboard (not just images). Some browsers only provide images.
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }

      // Dedupe by name:size:type to avoid double-counting between items/files.
      const seen = new Set<string>();
      const deduped = files.filter((f) => {
        const key = `${f.name || 'noname'}:${f.size}:${f.type || 'application/octet-stream'}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (deduped.length > 0) {
        e.preventDefault();
        handleFiles(
          deduped,
          setPendingFiles,
          setUploadedFiles,
          setIsUploading,
          maxFileBytes,
        );
      }
    };

    const renderModeSwitch = () => {
      if (!mounted) {
        return (
          <div
            className={cn(
              'h-8',
              embedded ? 'w-8' : 'w-20 rounded-md bg-muted/20',
            )}
          />
        );
      }
      const currentLabel = runMode === 'chat' ? 'Chat' : 'Agent';
      const showLabel = !embedded;
      if (embedded && onRunModeOpen) {
        return (
          <button
            type="button"
            onClick={onRunModeOpen}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            aria-label="Switch run mode"
          >
            <AtSign className="h-4 w-4" />
          </button>
        );
      }
      return (
        <Popover open={runModeOpen} onOpenChange={setRunModeOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex h-8 items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors',
                embedded
                  ? 'w-8 justify-center px-0 rounded-xl hover:bg-accent/50'
                  : 'rounded-xl border border-border/50 px-2.5 hover:bg-muted/40',
                'hover:text-foreground',
              )}
              aria-label="Switch run mode"
            >
              {embedded ? (
                <AtSign className="h-4 w-4" />
              ) : (
                <span className="text-[12px]">@</span>
              )}
              {showLabel && (
                <span className="text-[12px] font-medium">{currentLabel}</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" sideOffset={8} className="w-44 p-2">
            <RunModeMenu
              runMode={runMode}
              onSelect={(mode) => {
                onRunModeChange(mode);
                setRunModeOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      );
    };

    const renderDropdown = () => {
      const showAdvancedFeatures = isLoggedIn && enableAdvancedConfig;
      // Don't render dropdown components until after hydration to prevent ID mismatches
      if (!mounted) {
        return <div className="flex items-center gap-2 h-8" />; // Placeholder with same height
      }
      // Unified compact menu for both logged and non-logged (non-logged shows only models subset via menu trigger)
      return (
        <div className="flex items-center gap-2" data-tour="agent-selector">
          <UnifiedConfigMenu
            isLoggedIn={isLoggedIn}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            modelOptions={modelOptions}
            isLoadingModels={modelsLoading}
            modelError={modelsError}
            subscriptionStatus={subscriptionStatus}
            canAccessModel={canAccessModel}
            refreshCustomModels={refreshCustomModels}
            onUpgradeRequest={() => router.push(subscriptionPath)}
          />
          {showAdvancedFeatures && onOpenIntegrations && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/40"
              onClick={onOpenIntegrations}
            >
              Apps
            </Button>
          )}
        </div>
      );
    }

    const canSend =
      ((value?.trim()?.length || 0) > 0 || uploadedFiles.length > 0) &&
      !effectiveLoading &&
      !disabled &&
      (!isAgentRunning || allowSendWhileRunning) &&
      !isUploading;
    const showStopOnSend = isAgentRunning && !allowSendWhileRunning;
    const sendDisabled = showStopOnSend ? false : !canSend;

    return (
      <div className={cn('relative flex h-full w-full flex-col justify-between gap-2 chat-input-root', heroStyle && 'chat-input-hero')}>

        <div className={cn('flex flex-col gap-1 px-2 chat-input-body')}>
          {/* Keep input editable while AI is responding; submission is blocked by loading/isAgentRunning */}
          <Textarea
            ref={ref}
            value={value}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            className={cn(
              'w-full bg-transparent dark:bg-transparent border-none shadow-none focus-visible:ring-0 px-0.5 pb-6 pt-4 min-h-[100px] sm:min-h-[72px] max-h-[220px] overflow-y-auto resize-none rounded-[24px] !text-[16px] sm:!text-[15px] chat-input-textarea',
              heroStyle ? 'min-h-[110px] leading-relaxed' : '',
              isDraggingOver ? 'opacity-40' : '',
            )}
            disabled={disabled && !isAgentRunning}
            rows={1}
          />
        </div>


        <div className={cn('mt-0 mb-1 flex items-center justify-between gap-1 px-1.5 sm:px-2 chat-input-actions')}>
          <div className="flex items-center gap-2">
            {renderModeSwitch()}
            {!hideAttachments && (
              <FileUploadHandler
                ref={fileInputRef}
                loading={effectiveLoading}
                disabled={disabled}
                isAgentRunning={isAgentRunning}
                isUploading={isUploading}
                sandboxId={sandboxId}
                setPendingFiles={setPendingFiles}
                setUploadedFiles={setUploadedFiles}
                setIsUploading={setIsUploading}
                isLoggedIn={isLoggedIn}
                maxFileBytes={maxFileBytes}
                iconOnly={embedded}
              />
            )}

          </div>

          {/* {subscriptionStatus === 'no_subscription' && !isLocalMode() &&
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <p role='button' className='text-sm text-amber-500 hidden sm:block cursor-pointer' onClick={() => setBillingModalOpen(true)}>Upgrade for more usage</p>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Your current plan has limited usage. Upgrade to experience the full power of Zmind.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          } */}

          <div className='flex items-center gap-1.5'>
            {renderDropdown()}

            {isLoggedIn && <VoiceRecorder
              onTranscription={onTranscription}
              disabled={effectiveLoading || (disabled && !isAgentRunning)}
            />}

            {showPauseButton && isAgentRunning && onPauseQueue && (
              <Button
                type="button"
                onClick={onPauseQueue}
                size="sm"
                variant={'ghost'}
                className={cn(
                  'w-8 h-8 flex-shrink-0 self-end transition-colors duration-200',
                  heroStyle ? 'rounded-full border border-white/40 shadow-sm dark:border-white/10' : 'rounded-2xl border-[1.5px] border-border',
                  heroStyle ? 'bg-foreground text-background' : 'bg-accent text-foreground',
                )}
                aria-label="Pause"
                title="Pause"
              >
                <Square className="h-5 w-5" />
              </Button>
            )}

            <Button
              type="submit"
              onClick={showStopOnSend ? (onStopAgent ?? onSubmit) : onSubmit}
              size="sm"
              variant={'ghost'}
              className={cn(
                'w-8 h-8 flex-shrink-0 self-end transition-colors duration-200 chat-input-submit',
                heroStyle ? 'rounded-full border border-white/40 shadow-sm dark:border-white/10' : 'rounded-2xl border-[1.5px] border-border',
                showStopOnSend
                  ? heroStyle
                    ? 'bg-foreground text-background'
                    : 'bg-accent text-foreground'
                  : canSend
                    ? heroStyle
                      ? 'bg-foreground text-background hover:bg-foreground/90'
                      : 'bg-neutral-600 text-white hover:bg-neutral-500'
                    : heroStyle
                      ? 'bg-white/60 text-muted-foreground hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/20'
                      : 'text-muted-foreground hover:bg-accent'
              )}
              // Allow stopping even while loading; only disable when not running and invalid
              disabled={sendDisabled}
              aria-label={showStopOnSend ? 'Stop' : 'Send'}
              title={showStopOnSend ? 'Stop' : 'Send'}
            >
              {showStopOnSend ? (
                <Square className="h-5 w-5" />
              ) : effectiveLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ArrowUp className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
        {/* {subscriptionStatus === 'no_subscription' && !isLocalMode() &&
          <div className='sm:hidden absolute -bottom-8 left-0 right-0 flex justify-center'>
            <p className='text-xs text-amber-500 px-2 py-1'>
              Upgrade for better performance
            </p>
          </div>
        } */}
      </div>
    );
  },
);

MessageInput.displayName = 'MessageInput';
