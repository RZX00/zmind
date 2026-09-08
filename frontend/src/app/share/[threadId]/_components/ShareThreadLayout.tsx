import React from 'react';
import { FileViewerModal } from '@/components/thread/file-viewer-modal';
import { SiteHeader } from '@/components/thread/thread-site-header';
import { Project } from '@/lib/api';
import { useIsMobile } from '@/hooks/use-mobile';
import { UnifiedMessage } from '@/components/thread/types';



interface ShareThreadLayoutProps {
  children: React.ReactNode;
  threadId: string;
  projectId: string;
  projectName: string;
  project: Project | null;
  sandboxId: string | null;
  isSidePanelOpen: boolean;
  onToggleSidePanel: () => void;
  onViewFiles: (filePath?: string, filePathList?: string[]) => void;
  fileViewerOpen: boolean;
  setFileViewerOpen: (open: boolean) => void;
  fileToView: string | null;
  toolCalls: any[];
  messages: UnifiedMessage[];
  externalNavIndex?: number;
  agentStatus: 'idle' | 'running' | 'connecting' | 'error';
  currentToolIndex: number;
  onSidePanelNavigate: (index: number) => void;
  onSidePanelClose: () => void;
  initialLoadCompleted: boolean;
  published?: boolean;
  // Header options
  showThemeToggle?: boolean;
  showPlayback?: boolean;
  isPlaying?: boolean;
  onTogglePlayback?: () => void;
}

export function ShareThreadLayout({
  children,
  threadId,
  projectId,
  projectName,
  project,
  sandboxId,
  isSidePanelOpen,
  onToggleSidePanel,
  onViewFiles,
  fileViewerOpen,
  setFileViewerOpen,
  fileToView,
  toolCalls,
  messages,
  externalNavIndex,
  agentStatus,
  currentToolIndex,
  onSidePanelNavigate,
  onSidePanelClose,
  initialLoadCompleted,
  published,
  showThemeToggle,
  showPlayback,
  isPlaying,
  onTogglePlayback,
}: ShareThreadLayoutProps) {
  const isActuallyMobile = useIsMobile();
  
  return (
    <div className="flex h-screen">
      <div className={`flex flex-col flex-1 overflow-hidden`}>
        <SiteHeader
          projectName={projectName}
          onViewFiles={onViewFiles}
          onToggleSidePanel={onToggleSidePanel}
          isMobileView={isActuallyMobile}
          variant="shared"
          published={published}
          showThemeToggle={showThemeToggle}
          showPlayback={showPlayback}
          isPlaying={isPlaying}
          onTogglePlayback={onTogglePlayback}
        />

        {children}
      </div>

      {sandboxId && (
        <FileViewerModal
          open={fileViewerOpen}
          onOpenChange={setFileViewerOpen}
          sandboxId={sandboxId}
          initialFilePath={fileToView}
          project={project || undefined}
        />
      )}
    </div>
  );
}
