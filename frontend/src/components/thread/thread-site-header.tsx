'use client';

import { Button } from "@/components/ui/button"
import { FolderOpen, ExternalLink, Monitor, Copy, Check, FileText, Play, Pause, Home, MousePointer, Wand2 } from "lucide-react"
import Link from 'next/link';
import GoldStarAI from "@/canvas/components/shared/icons/GoldStarAI";
import { usePathname } from "next/navigation"
import { toast } from "sonner"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useState, useRef, KeyboardEvent, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { useUpdateProject } from "@/hooks/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { ShareModal } from "@/components/sidebar/share-modal"
import { useQueryClient } from "@tanstack/react-query";
import { projectKeys } from "@/hooks/react-query/sidebar/keys";
import { threadKeys } from "@/hooks/react-query/threads/keys";
import { ThemeSwitcher } from '@/components/theme/theme-switcher';

interface ThreadSiteHeaderProps {
  threadId?: string;
  projectId?: string;
  projectName: string;
  onViewFiles: () => void;
  onToggleSidePanel: () => void;
  onToggleOutline?: () => void;
  onProjectRenamed?: (newName: string) => void;
  isMobileView?: boolean;
  debugMode?: boolean;
  variant?: 'default' | 'shared';
  published?: boolean; // publish state for shared views
  // Share view enhancements
  showThemeToggle?: boolean;
  showPlayback?: boolean;
  isPlaying?: boolean;
  onTogglePlayback?: () => void;
  // Show bottom playback/timeline panel
  onRequestOpenPlaybackMenu?: () => void;
  // Center title (e.g., canvas share)
  centerTitle?: boolean;
  // Shared selection mode toggle (for shared canvas page)
  showSelectionToggle?: boolean;
  selectionMode?: boolean;
  onToggleSelectionMode?: () => void;
}

export function SiteHeader({
  threadId,
  projectId,
  projectName,
  onViewFiles,
  onToggleSidePanel,
  onToggleOutline,
  onProjectRenamed,
  isMobileView,
  debugMode,
  variant = 'default',
  published,
  showThemeToggle,
  showPlayback,
  isPlaying,
  onTogglePlayback,
  onRequestOpenPlaybackMenu,
  centerTitle,
  showSelectionToggle,
  selectionMode,
  onToggleSelectionMode,
}: ThreadSiteHeaderProps) {
  const pathname = usePathname()
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(projectName)
  const inputRef = useRef<HTMLInputElement>(null)
  const [showShareModal, setShowShareModal] = useState(false);
  const [showKnowledgeBase, setShowKnowledgeBase] = useState(false);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const isMobile = useIsMobile() || isMobileView
  const updateProjectMutation = useUpdateProject()

  const openShareModal = () => {
    setShowShareModal(true)
  }

  const openKnowledgeBase = () => {
    setShowKnowledgeBase(true)
  }

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      toast.success("Share link copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Failed to copy link");
    }
  };

  const startEditing = () => {
    setEditName(projectName);
    setIsEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditName(projectName);
  };

  const saveNewName = async () => {
    if (editName.trim() === '') {
      setEditName(projectName);
      setIsEditing(false);
      return;
    }

    if (editName !== projectName) {
      try {
        if (!projectId) {
          toast.error('Cannot rename: Project ID is missing');
          setEditName(projectName);
          setIsEditing(false);
          return;
        }

        const updatedProject = await updateProjectMutation.mutateAsync({
          projectId,
          data: { name: editName }
        })
        if (updatedProject) {
          onProjectRenamed?.(editName);
          queryClient.invalidateQueries({ queryKey: threadKeys.project(projectId) });
        } else {
          throw new Error('Failed to update project');
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to rename project';
        console.error('Failed to rename project:', errorMessage);
        toast.error(errorMessage);
        setEditName(projectName);
      }
    }

    setIsEditing(false)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      saveNewName();
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  };

  const mobileShared = variant === 'shared' && isMobile;

  return (
    <>
      <header className={cn(
        "bg-background sticky top-0 z-20 w-full h-12 sm:h-14 flex items-center justify-between flex-shrink-0 relative zmind-site-header playback-hideable",
        isMobile && "safe-area-top safe-area-x"
      )}>


        <div className="flex h-full flex-1 items-center gap-2 px-3 sm:px-4">
          {/* Mobile (shared) left controls: Theme + Playback */}
          {mobileShared && (
            <div className="flex items-center gap-1">
              {/* Theme toggle */}
              {(showThemeToggle ?? true) && mounted && (
                <ThemeSwitcher
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 cursor-pointer"
                  tooltip="Theme"
                />
              )}

              {/* Magic (timeline panel) toggle */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRequestOpenPlaybackMenu?.()}
                      className="h-9 w-9 cursor-pointer"
                      aria-label="Timeline Panel"
                    >
                      <Wand2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side={isMobile ? "bottom" : "bottom"} className="z-[60]">
                    <p>Timeline</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Playback quick control */}
              {showPlayback && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={onTogglePlayback}
                        className="h-9 w-9 cursor-pointer"
                        aria-label={isPlaying ? 'Pause Replay' : 'Play Replay'}
                      >
                        {isPlaying ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side={isMobile ? "bottom" : "bottom"} className="z-[60]">
                      <p>{isPlaying ? 'Pause' : 'Play'}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          )}

          {variant === 'shared' ? (
            // Shared view (desktop): show Back-to-Home on the left; title may be centered by overlay
            isMobile ? (
              centerTitle ? (<div className="h-5" />) : (
                <div className="text-base font-medium text-muted-foreground flex items-center gap-2">
                  {projectName}
                  <span className="text-xs px-2 py-0.5 rounded-full border border-border/60">
                    {published ? 'Public' : 'Private'}
                  </span>
                </div>
              )
            ) : (
              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-9 w-9 cursor-pointer" asChild>
                        <Link href="/" aria-label="Back to Home">
                          <Home className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="z-[60]">
                      <p>Back to Home</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {!centerTitle && (
                  <div className="text-base font-medium text-muted-foreground flex items-center gap-2">
                    {projectName}
                    <span className="text-xs px-2 py-0.5 rounded-full border border-border/60">
                      {published ? 'Public' : 'Private'}
                    </span>
                  </div>
                )}
              </div>
            )
          ) : isEditing ? (
            <Input
              ref={inputRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={saveNewName}
              className="h-8 w-auto min-w-[180px] text-base font-medium"
              maxLength={50}
            />
          ) : !projectName || projectName === 'Project' ? (
            <Skeleton className="h-5 w-32" />
          ) : (
            <div
              className="text-base font-medium text-muted-foreground hover:text-foreground cursor-pointer flex items-center"
              onClick={startEditing}
              title="Click to rename project"
            >
              {projectName}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 pr-4">
          {/* Debug mode indicator */}
          {debugMode && (
            <div className="bg-amber-500 text-black text-xs px-2 py-0.5 rounded-md mr-2">
              Debug
            </div>
          )}

          {/* Show all buttons on both mobile and desktop - responsive tooltips */}
          <TooltipProvider>
            {variant !== 'shared' && (
              <Button
                variant="ghost"
                onClick={openShareModal}
                className="h-9 px-3 cursor-pointer gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                <span>Share</span>
              </Button>
            )}

            {variant !== 'shared' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onViewFiles}
                    className="h-9 w-9 cursor-pointer"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side={isMobile ? "bottom" : "bottom"}>
                  <p>View Files in Task</p>
                </TooltipContent>
              </Tooltip>
            )}

          {variant === 'shared' ? (
            <>
              {/* In mobile shared view: only Outline + AI on the right; theme/play moved left */}
              {mobileShared ? (
                <>
                  {/* Outline view toggle */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={onToggleOutline}
                        className="h-9 w-9 cursor-pointer"
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side={isMobile ? "bottom" : "bottom"} className="z-[60]">
                      <p>Toggle Outline View</p>
                    </TooltipContent>
                  </Tooltip>

                  {/* AI panel toggle */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={onToggleSidePanel}
                        className="h-9 w-9 cursor-pointer"
                      >
                        <GoldStarAI size={16} animated={true} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side={isMobile ? "bottom" : "bottom"} className="z-[60]">
                      <p>Toggle AI Panel</p>
                    </TooltipContent>
                  </Tooltip>
                </>
              ) : (
                <>
                  {/* Desktop shared: show all buttons on the right */}
              {(showThemeToggle ?? true) && mounted && (
                <ThemeSwitcher
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 cursor-pointer"
                  tooltip="Theme"
                />
              )}

              {/* Magic (timeline panel) toggle */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onRequestOpenPlaybackMenu?.()}
                    className="h-9 w-9 cursor-pointer"
                    aria-label="Timeline Panel"
                  >
                    <Wand2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side={isMobile ? "bottom" : "bottom"} className="z-[60]">
                  <p>Timeline</p>
                </TooltipContent>
              </Tooltip>

                  {showPlayback && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={onTogglePlayback}
                          className="h-9 w-9 cursor-pointer"
                          aria-label={isPlaying ? 'Pause Replay' : 'Play Replay'}
                        >
                          {isPlaying ? (
                            <Pause className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                    <TooltipContent side={isMobile ? "bottom" : "bottom"} className="z-[60]">
                      <p>{isPlaying ? 'Pause' : 'Play'}</p>
                    </TooltipContent>
                  </Tooltip>
                )}

                  {/* Selection, Outline and AI */}
                  {showSelectionToggle && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={selectionMode ? 'default' : 'ghost'}
                          size="icon"
                          onClick={onToggleSelectionMode}
                          className="h-9 w-9 cursor-pointer"
                          aria-label="Toggle Selection Mode"
                        >
                          <MousePointer className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side={isMobile ? "bottom" : "bottom"} className="z-[60]">
                        <p>Selection Mode</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={onToggleOutline}
                        className="h-9 w-9 cursor-pointer"
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side={isMobile ? "bottom" : "bottom"} className="z-[60]">
                      <p>Toggle Outline View</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={onToggleSidePanel}
                        className="h-9 w-9 cursor-pointer"
                      >
                        <GoldStarAI size={16} animated={true} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side={isMobile ? "bottom" : "bottom"} className="z-[60]">
                      <p>Toggle AI Panel</p>
                    </TooltipContent>
                  </Tooltip>
                </>
              )}
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleSidePanel}
                  className="h-9 w-9 cursor-pointer"
                >
                  <Monitor className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side={isMobile ? "bottom" : "bottom"}>
                <p>Toggle Outline/Panel</p>
              </TooltipContent>
            </Tooltip>
          )}
          </TooltipProvider>
        </div>

        {/* Centered title overlay for shared view when requested */}
        {variant === 'shared' && centerTitle && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-base font-medium text-muted-foreground flex items-center gap-2">
              {projectName}
              <span className="text-xs px-2 py-0.5 rounded-full border border-border/60">
                {published ? 'Public' : 'Private'}
              </span>
            </div>
          </div>
        )}
      </header>
      {variant === 'default' && threadId && projectId && (
        <ShareModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          threadId={threadId}
          projectId={projectId}
        />
      )}
    </>
  )
} 
