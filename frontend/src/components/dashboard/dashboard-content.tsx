'use client';

import '@reactour/tour/dist/index.css';
import React, { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { TourProvider, useTour, type StepType } from '@reactour/tour';
import {
  ChatInput,
  ChatInputHandles,
} from '@/components/thread/chat-input/chat-input';
import { useAuth } from '@/components/AuthProvider';
// Removed direct thread initiation; errors handled within Canvas panel
import { useBillingError } from '@/hooks/useBillingError';
import { BillingErrorAlert } from '@/components/billing/usage-limit-alert';
import { useAccounts } from '@/hooks/use-accounts';
// import { isLocalMode, isStagingMode } from '@/lib/config';

import { BillingModal } from '@/components/billing/billing-modal';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import { AgentRunLimitDialog } from '@/components/thread/agent-run-limit-dialog';
import { toast } from 'sonner';
import { useSubscriptionContext } from '@/contexts/SubscriptionContext';
import { useDashboardTour } from '@/hooks/use-dashboard-tour';
import { TourConfirmationDialog } from '@/components/tour/TourConfirmationDialog';
// icons not used in dashboard content
import CanvasWorkspace from '@/canvas/components/workspace/CanvasWorkspace';
import { useCanvasStore } from '@/canvas/stores/canvas.store';
import KnowledgeDashboardSection from '@/components/knowledge-base/knowledge-dashboard-section';
import { generateCanvasTitle } from '@/lib/api';
import { createCanvas } from '@/canvas/services/canvas-manager.service';
import { useWorkspace } from '@/contexts/workspace-context';
import { buildCanvasPath, buildTeamScopedPath } from '@/lib/workspace-path';

const PENDING_PROMPT_KEY = 'pendingAgentPrompt';
const AUTO_COLLAPSE_SIDEBAR_KEY = 'sidebar:autoCollapseOnCanvasOpen';

const tourStyles = {
  maskWrapper: () => ({
    color: 'rgba(0, 0, 0, 0.7)',
  }),
  popover: () => ({
    backgroundColor: '#ffffff',
    borderRadius: 'var(--radius-md)',
    padding: 20,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    border: '1px solid #e5e7eb',
    color: '#000000',
  }),
  navigation: () => ({
    display: 'flex',
    gap: 8,
    marginTop: 12,
  }),
  button: () => ({
    backgroundColor: '#000000',
    color: '#ffffff',
    fontSize: 12,
    padding: '8px 16px',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    fontWeight: 500,
  }),
  close: () => ({
    color: '#6b7280',
  }),
};

function DashboardTourSync({
  run,
  stopTour,
}: {
  run: boolean;
  stopTour: () => void;
}) {
  const { isOpen, setIsOpen } = useTour();
  const hasOpenedRef = React.useRef(false);

  useEffect(() => {
    if (run) {
      setIsOpen(true);
    } else {
      setIsOpen(false);
      hasOpenedRef.current = false;
    }
  }, [run, setIsOpen]);

  useEffect(() => {
    if (isOpen) {
      hasOpenedRef.current = true;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen && run && hasOpenedRef.current) {
      stopTour();
      hasOpenedRef.current = false;
    }
  }, [isOpen, run, stopTour]);

  return null;
}

// Steps localized inside component via t()

export function DashboardContent() {
  const tr = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { teamSlug } = useWorkspace();
  const subscriptionPath = buildTeamScopedPath('/subscription', teamSlug);
  const { user } = useAuth();

  // Section-based scrolling removed; workspace uses dedicated page

  const [inputValue, setInputValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState(false);
  // const [initiatedThreadId, setInitiatedThreadId] = useState<string | null>(null);
  const { billingError, clearBillingError } = useBillingError();
  const [showAgentLimitDialog, setShowAgentLimitDialog] = useState(false);
  const [agentLimitData, setAgentLimitData] = useState<{
    runningCount: number;
    runningThreadIds: string[];
  } | null>(null);
  // legacy dashboard content below (will be removed later)
  const { data: accounts } = useAccounts();
  const personalAccount = accounts?.find((account) => account.personal_account);
  const chatInputRef = React.useRef<ChatInputHandles>(null);
  // No longer initiating agent from dashboard
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showInviteSuccess, setShowInviteSuccess] = useState(false);
  const { refetch, refetchBalance } = useSubscriptionContext();

  // Tour integration
  const {
    run,
    stepIndex,
    setStepIndex,
    stopTour,
    showWelcome,
    handleWelcomeAccept,
    handleWelcomeDecline,
  } = useDashboardTour();

  // const threadQuery = useThreadQuery(initiatedThreadId || '');

  // const enabledEnvironment = isStagingMode() || isLocalMode();


  // Legacy redirect effect not used anymore

  const renderTourContent = (title: string, body: string) => (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-black">{title}</p>
      <p className="text-sm text-neutral-700 leading-relaxed">{body}</p>
    </div>
  );

  const dashboardTourSteps: StepType[] = [
    {
      selector: '[data-tour="dashboard-title"]',
      content: renderTourContent(
        tr('dashboard.tour.welcome.title', {default: 'Welcome to your Dashboard'}),
        tr('dashboard.tour.welcome.content', {default: 'Welcome! This is your starting point. Create new thinking, manage canvases, and organize your knowledge here.'})
      ),
      position: 'bottom',
    },
    {
      selector: '[data-tour="chat-input"]',
      content: renderTourContent(
        tr('dashboard.tour.chat.title', {default: 'Start a Conversation'}),
        tr('dashboard.tour.chat.content', {default: 'Describe what you need. You can attach files, configure models, and Zmind will create a canvas for your task.'})
      ),
      position: 'top',
    },
    {
      selector: '[data-tour="agent-selector"]',
      content: renderTourContent(
        tr('dashboard.tour.agent.title', {default: 'Model & Settings'}),
        tr('dashboard.tour.agent.content', {default: 'Choose a model and adjust settings from this compact menu. Upgrade for advanced models when needed.'})
      ),
      position: 'bottom',
    },
    {
      selector: '[data-tour="workspace"]',
      content: renderTourContent(
        tr('dashboard.tour.workspace.title', {default: 'Workspace'}),
        tr('dashboard.tour.workspace.content', {default: 'Your canvases live here. Open, rename, organize into folders, or create a new canvas to begin.'})
      ),
      position: 'top',
    },
    {
      selector: '[data-tour="knowledge"]',
      content: renderTourContent(
        tr('dashboard.tour.knowledge.title', {default: 'Knowledge Base'}),
        tr('dashboard.tour.knowledge.content', {default: 'Upload files or connect sources to power richer context. Zmind uses this knowledge across canvases.'})
      ),
      position: 'top',
    },
  ];

  const handleSubmit = useCallback(async (
    message: string,
    options?: {
      model_name?: string;
      enable_thinking?: boolean;
      reasoning_effort?: string;
      stream?: boolean;
      enable_context_manager?: boolean;
      attachments?: import('@/lib/api').MessageAttachmentInput[];
    },
  ) => {
    const text = (message || '').trim();
    const hasAttachments = Boolean(options?.attachments && options.attachments.length > 0);
    if ((!text && !hasAttachments) || isSubmitting || isRedirecting) return;

    setIsSubmitting(true);
    try {
      // 1) Create a new canvas with a provisional title
      const provisionalTitle = text.slice(0, 30) || 'New Canvas';
      const canvas = await createCanvas(provisionalTitle);
      const newCanvasId = canvas.id;
      try {
        const { beginCanvasSwitch } = useCanvasStore.getState();
        beginCanvasSwitch(newCanvasId, canvas.title || provisionalTitle);
      } catch (err) {
        console.warn('[Dashboard] unable to set canvas switch state', err);
      }

      // 2) Kick off background title generation (non-blocking)
      if (text) {
        try { generateCanvasTitle(newCanvasId, text).catch(() => {}); } catch {}
      }

      // 2.5) Persist attachments for the canvas auto-submit (if any)
      if (hasAttachments) {
        try {
          sessionStorage.setItem(
            `canvas:initialAttachments:${newCanvasId}`,
            JSON.stringify(options?.attachments || []),
          );
        } catch {}
      }

      // 3) Navigate to dedicated canvas page with initial text (URL param for short, storage for long)
      let target = buildCanvasPath(newCanvasId, teamSlug);
      if (text) {
        if (text.length <= 1500) {
          const p = new URLSearchParams();
          p.set('prompt', text);
          target += `?${p.toString()}`;
        } else {
          try { sessionStorage.setItem(`canvas:initialPrompt:${newCanvasId}`, text); } catch {}
          const p = new URLSearchParams();
          p.set('p', '1');
          target += `?${p.toString()}`;
        }
      }

      if (text) {
        try {
          sessionStorage.setItem(AUTO_COLLAPSE_SIDEBAR_KEY, '1');
        } catch {}
      }

      setIsRedirecting(true);
      router.push(target);

      // Clear pending local files after handing off attachments (if any)
      chatInputRef.current?.clearPendingFiles();
    } catch (error: any) {
      console.error('Error creating canvas from dashboard:', error);
      const errorMessage = error instanceof Error ? error.message : 'Operation failed';
      toast.error(errorMessage);
      setIsSubmitting(false);
    }
  }, [isSubmitting, isRedirecting, router, teamSlug]);

  React.useEffect(() => {
    // Show invite success dialog when redirected from activation
    try {
      const s = searchParams?.get('invite');
      if (s === 'redeemed') {
        setShowInviteSuccess(true);
        // Force refresh subscription + balance on invite redemption
        try { refetch(); } catch {}
        try { refetchBalance(); } catch {}
        // Clean the URL but keep dialog open via state
        router.replace('/dashboard', { scroll: false });
      }
    } catch {}
  }, [refetch, refetchBalance, router, searchParams]);

  React.useEffect(() => {
    // Auto-focus when coming from New Thinking (hash-based trigger)
    try {
      if (typeof window !== 'undefined' && window.location.hash === '#new-thinking') {
        setTimeout(() => chatInputRef.current?.focus?.(), 0);
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      const pendingPrompt = localStorage.getItem(PENDING_PROMPT_KEY);

      if (pendingPrompt) {
        setInputValue(pendingPrompt);
        setAutoSubmit(true);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, []);

  React.useEffect(() => {
    if (autoSubmit && inputValue && !isSubmitting && !isRedirecting) {
      const timer = setTimeout(() => {
        handleSubmit(inputValue);
        setAutoSubmit(false);
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [autoSubmit, handleSubmit, inputValue, isSubmitting, isRedirecting]);

  return (
    <TourProvider
      steps={dashboardTourSteps}
      currentStep={stepIndex}
      setCurrentStep={setStepIndex}
      showBadge
      showDots
      showNavigation
      showCloseButton
      styles={tourStyles}
      onClickClose={stopTour}
      onClickMask={() => {}}
      scrollSmooth
    >
      <DashboardTourSync run={run} stopTour={stopTour} />

      <TourConfirmationDialog
        open={showWelcome}
        onAccept={handleWelcomeAccept}
        onDecline={handleWelcomeDecline}
      />

      <BillingModal 
        open={showPaymentModal} 
        onOpenChange={setShowPaymentModal}
        showUsageLimitAlert={true}
      />

      {/* Invite redeemed success dialog */}
      <Dialog open={showInviteSuccess} onOpenChange={setShowInviteSuccess}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <Sparkles className="h-4 w-4" />
              </span>
              邀请码兑换成功
            </DialogTitle>
            <DialogDescription>
              你已获得 10 美元使用额度（约 1000 积分，30 天有效），并已激活 AI 功能使用权限。现在可以开始使用模型，或前往订阅查看剩余积分。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => { setShowInviteSuccess(false); router.push(subscriptionPath); }}>
              查看订阅
            </Button>
            <Button onClick={() => setShowInviteSuccess(false)}>
              开始使用
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <div className="flex flex-col h-screen w-full overflow-x-hidden overflow-y-auto scrollbar-none">
        {/* Chat/Input Section */}
        <section id="chat" className="pt-28 md:pt-40 lg:pt-48 pb-8 md:pb-12 lg:pb-20">
          <div className="flex items-center justify-center px-4 py-2">
            <div className="w-full max-w-7xl flex flex-col items-center justify-center space-y-3 md:space-y-4">
              <div className="flex flex-col items-center text-center w-full px-4 md:px-0">
                <p
                  className="tracking-tight text-2xl md:text-3xl font-normal text-foreground/90 font-serif"
                  data-tour="dashboard-title"
                >
                  {tr('dashboard.greeting', {
                    name:
                      user?.user_metadata?.name ||
                      user?.user_metadata?.full_name ||
                      user?.email?.split('@')[0] ||
                      tr('dashboard.guest', { default: 'there' }),
                    default: `Hi, ${
                      user?.user_metadata?.name ||
                      user?.user_metadata?.full_name ||
                      user?.email?.split('@')[0] ||
                      tr('dashboard.guest', { default: 'there' })
                    }`,
                  })}
                  {' · '}
                  {tr('dashboard.title', {default: "What's your new thinking today?"})}
                </p>
              </div>
              <div className="w-full px-2 sm:px-4 md:px-8 lg:px-12 xl:px-16 2xl:px-20" data-tour="chat-input">
                <ChatInput
                  ref={chatInputRef}
                  onSubmit={handleSubmit}
                  loading={isSubmitting || isRedirecting}
                  placeholder={tr('dashboard.inputPlaceholder', {default: 'Describe what you need help with...'})}
                  value={inputValue}
                  onChange={setInputValue}
                  hideAttachments={false}
                  enableAdvancedConfig={true}
                  heroStyle
                />
              </div>
              {/* Examples removed per new design */}
            </div>
          </div>
        </section>

        {/* Sticky section nav removed per new design */}

        {/* Workspace Section */}
        <section id="workspace" className="py-8">
          <div className="w-full h-full px-4" data-tour="workspace">
            <div className="mx-auto max-w-7xl">
              <CanvasWorkspace
                className="bg-transparent"
                hideBackground
                maxWidthClass="max-w-none"
                gridClassName="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6 py-4"
              />
            </div>
          </div>
        </section>

        {/* Knowledge Section (dashboard variant) */}
        <section id="knowledge" className="pb-8 px-4" data-tour="knowledge">
          <KnowledgeDashboardSection maxWidthClass="max-w-7xl" />
        </section>

        <BillingErrorAlert
          title={billingError?.message ? 'Upgrade required' : undefined}
          message={billingError?.message}
          primaryAction="upgrade"
          includeSavedPrefix={false}
          onDismiss={clearBillingError}
          isOpen={!!billingError}
        />
      </div>

      {agentLimitData && (
        <AgentRunLimitDialog
          open={showAgentLimitDialog}
          onOpenChange={setShowAgentLimitDialog}
          runningCount={agentLimitData.runningCount}
          runningThreadIds={agentLimitData.runningThreadIds}
          projectId={undefined}
        />
      )}
    </TourProvider>
  );
}
