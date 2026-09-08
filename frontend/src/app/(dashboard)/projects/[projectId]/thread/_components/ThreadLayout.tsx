import React from 'react';
import { SiteHeader } from '@/components/thread/thread-site-header';
import { FileViewerModal } from '@/components/thread/file-viewer-modal';
import { BillingErrorAlert } from '@/components/billing/usage-limit-alert';
import { Project } from '@/lib/api';
import { ApiMessageType, BillingData } from '../_types';
import { useIsMobile } from '@/hooks/use-mobile';

interface ThreadLayoutProps {
  children: React.ReactNode;
  threadId: string;
  projectName: string;
  projectId: string;
  project: Project | null;
  sandboxId: string | null;
  onToggleSidePanel: () => void;
  onProjectRenamed?: (newName: string) => void;
  onViewFiles: (filePath?: string, filePathList?: string[]) => void;
  fileViewerOpen: boolean;
  setFileViewerOpen: (open: boolean) => void;
  fileToView: string | null;
  filePathList?: string[];
  messages: ApiMessageType[];
  isLoading: boolean;
  showBillingAlert: boolean;
  billingData: BillingData;
  onDismissBilling: () => void;
  debugMode: boolean;
  isMobile: boolean;
  initialLoadCompleted: boolean;
  agentName?: string;
  compact?: boolean;
}

export function ThreadLayout({
  children,
  threadId,
  projectName,
  projectId,
  project,
  sandboxId,
  onToggleSidePanel,
  onProjectRenamed,
  onViewFiles,
  fileViewerOpen,
  setFileViewerOpen,
  fileToView,
  filePathList,
  messages,
  isLoading,
  showBillingAlert,
  billingData,
  onDismissBilling,
  debugMode,
  isMobile,
  initialLoadCompleted,
  agentName,
  compact = false
}: ThreadLayoutProps) {
  const isActuallyMobile = useIsMobile();
  
  // Compact mode for embedded use
  if (compact) {
    return (
      <>
        <div className="relative h-full">
          {debugMode && (
            <div className="absolute top-4 right-4 bg-amber-500 text-black text-xs px-2 py-1 rounded-md shadow-md z-50">
              Debug Mode
            </div>
          )}

          {/* Main content - always full width */}
          <div className="flex flex-col h-full overflow-hidden">
            {children}
          </div>

          {/* Tool side panel removed in compact mode */}

          {/* File Viewer Modal */}
          {sandboxId && (
            <FileViewerModal
              open={fileViewerOpen}
              onOpenChange={setFileViewerOpen}
              sandboxId={sandboxId}
              initialFilePath={fileToView}
              project={project || undefined}
              filePathList={filePathList}
            />
          )}

          <BillingErrorAlert
            title={billingData.title}
            message={billingData.message}
            creditBalance={billingData.creditBalance}
            canPurchaseCredits={billingData.canPurchaseCredits}
            tierName={billingData.tierName}
            tierCredits={billingData.tierCredits}
            primaryAction={billingData.primaryAction}
            onDismiss={onDismissBilling}
            isOpen={showBillingAlert}
          />
        </div>
      </>
    );
  }

  // Full layout mode
  return (
    <div className="flex h-screen">
      {debugMode && (
        <div className="fixed top-16 right-4 bg-amber-500 text-black text-xs px-2 py-1 rounded-md shadow-md z-50">
          Debug Mode
        </div>
      )}

      <div className={`flex flex-col flex-1 overflow-hidden`}>
        <SiteHeader
          threadId={threadId}
          projectName={projectName}
          projectId={projectId}
          onViewFiles={onViewFiles}
          onToggleSidePanel={onToggleSidePanel}
          onProjectRenamed={onProjectRenamed}
          isMobileView={isMobile}
          debugMode={debugMode}
        />

        {children}
      </div>

      {/* Tool side panel removed */}

      {sandboxId && (
        <FileViewerModal
          open={fileViewerOpen}
          onOpenChange={setFileViewerOpen}
          sandboxId={sandboxId}
          initialFilePath={fileToView}
          project={project || undefined}
          filePathList={filePathList}
        />
      )}

      <BillingErrorAlert
        title={billingData.title}
        message={billingData.message}
        creditBalance={billingData.creditBalance}
        canPurchaseCredits={billingData.canPurchaseCredits}
        tierName={billingData.tierName}
        tierCredits={billingData.tierCredits}
        primaryAction={billingData.primaryAction}
        onDismiss={onDismissBilling}
        isOpen={showBillingAlert}
      />
    </div>
  );
} 
