'use client';

import * as React from 'react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, X, FileText, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { usePathname } from 'next/navigation';
import { format } from 'date-fns';

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useProjects, useAllThreads } from '@/hooks/react-query';
import {Link} from '@/i18n/routing';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useDeleteThread } from '@/hooks/react-query/sidebar/use-sidebar';
import { useQueryClient } from '@tanstack/react-query';
import { useItemNavLoading } from '@/hooks/useNavLoading';
import { threadKeys as threadsKeysGlobal } from '@/hooks/react-query/threads/keys';
import { toast } from 'sonner';
import { useWorkspace } from '@/contexts/workspace-context';
import { buildTeamScopedPath } from '@/lib/workspace-path';

// Thread with associated project info for display in sidebar & search
type ThreadWithProject = {
  threadId: string;
  projectId: string;
  projectName: string;
  url: string;
  updatedAt: string;
};

export function SidebarSearch() {
  const [query, setQuery] = useState('');
  const [threads, setThreads] = useState<ThreadWithProject[]>([]);
  const [filteredThreads, setFilteredThreads] = useState<ThreadWithProject[]>(
    [],
  );
  // Row-level navigation loading handled by hook inside row component
  const router = useRouter();
  const pathname = usePathname();
  const { state } = useSidebar();
  const { teamSlug } = useWorkspace();

  // Context menu and deletion state
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteThreadMutation = useDeleteThread();
  const queryClient = useQueryClient();

  // Use React Query hooks
  const { data: projectsRaw, isLoading: projectsLoading } = useProjects();
  const { data: allThreadsRaw, isLoading: threadsLoading } = useAllThreads();
  // Stabilize empty-array fallbacks to avoid changing deps every render
  const projects = useMemo(() => projectsRaw ?? [], [projectsRaw]);
  const allThreads = useMemo(() => allThreadsRaw ?? [], [allThreadsRaw]);
  const isLoading = projectsLoading || threadsLoading;

  // Helper to sort threads by updated_at (most recent first)
  const sortThreads = (
    threadsList: ThreadWithProject[],
  ): ThreadWithProject[] => {
    return [...threadsList].sort((a, b) => {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  };

  // Process threads with project data when data changes
  useEffect(() => {
    if (!projects.length || !allThreads.length) {
      setThreads([]);
      setFilteredThreads([]);
      return;
    }

    // Create a map of projects by ID for faster lookups
    const projectsById = new Map();
    projects.forEach((project) => {
      projectsById.set(project.id, project);
    });

    // Create display objects for threads with their project info
    const threadsWithProjects: ThreadWithProject[] = [];

    for (const thread of allThreads) {
      const projectId = thread.project_id;
      // Skip threads without a project ID
      if (!projectId) continue;

      // Get the associated project
      const project = projectsById.get(projectId);
      if (!project) continue;

      // Check if this is a workflow thread and use the workflow name if available
      let displayName = project.name || 'Unnamed Project';
      if (thread.metadata?.is_workflow_execution && thread.metadata?.workflow_run_name) {
        displayName = thread.metadata.workflow_run_name;
      }

      // Add to our list
      threadsWithProjects.push({
        threadId: thread.thread_id,
        projectId: projectId,
        projectName: displayName,
        url: buildTeamScopedPath(`/projects/${projectId}/thread/${thread.thread_id}`, teamSlug),
        updatedAt:
          thread.updated_at || project.updated_at || new Date().toISOString(),
      });
    }

    // Set threads, ensuring consistent sort order
    const sortedThreads = sortThreads(threadsWithProjects);
    setThreads(sortedThreads);
    setFilteredThreads(sortedThreads);
  }, [projects, allThreads, teamSlug]);

  // Filter threads based on search query
  const filterThreads = useCallback(
    (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setFilteredThreads(threads);
        return;
      }

      const query = searchQuery.toLowerCase();
      const filtered = threads.filter((thread) =>
        thread.projectName.toLowerCase().includes(query),
      );

      setFilteredThreads(filtered);
    },
    [threads],
  );

  // Update filtered threads when query changes
  useEffect(() => {
    filterThreads(query);
  }, [query, filterThreads]);

  // Data is automatically loaded by React Query hooks

  // Handle keyboard shortcut to focus search (/)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isTyping) return;
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        document.getElementById('sidebar-search-input')?.focus();
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // Row click handled via hook inside item component

  const handleContextMenu = (
    e: React.MouseEvent,
    threadId: string,
  ) => {
    e.preventDefault();
    setMenuOpenId(threadId);
  };

  const startLongPress = (threadId: string) => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => setMenuOpenId(threadId), 500);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const performDelete = async (threadId: string) => {
    try {
      await deleteThreadMutation.mutateAsync({ threadId });
      // Optimistically update local state
      setThreads((prev) => prev.filter((t) => t.threadId !== threadId));
      setFilteredThreads((prev) => prev.filter((t) => t.threadId !== threadId));
      setMenuOpenId(null);
      setConfirmDeleteId(null);
      // If the current page is the deleted thread, navigate away
      if (pathname?.includes(threadId)) {
        router.push(buildTeamScopedPath('/dashboard', teamSlug));
      }
      // Invalidate thread queries to refresh other views
      await queryClient.invalidateQueries({ queryKey: threadsKeysGlobal.all });
      await queryClient.invalidateQueries({ queryKey: ['threads'] });
      toast.success('已删除会话');
    } catch (error) {
      console.error('Delete thread failed', error);
      toast.error('删除失败');
    }
  };

  return (
    <SidebarGroup>
      {/* Search input in sidebar */}
      {state === 'collapsed' ? (
        // In collapsed state, show just the search icon centered
        <div className="flex items-center justify-center px-2 pt-3 pb-2">
          <div className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors">
            <Search className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      ) : (
        // In expanded state, show full search input
        <div className="flex items-center px-2 pt-3 pb-2">
          <div className="relative w-full">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="sidebar-search-input"
              type="text"
              placeholder="Search..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 pl-8 pr-8
                        text-sm transition-colors placeholder:text-muted-foreground
                        focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm
                          opacity-70 hover:opacity-100 focus:outline-none"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Clear</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Search results */}
      <SidebarGroupLabel>
        {state === 'collapsed'
          ? 'Recent'
          : (query ? 'Search Results' : 'Recent')
        }
      </SidebarGroupLabel>
      <SidebarMenu className="overflow-y-auto max-h-[calc(100vh-270px)] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
        {isLoading ? (
          // Show skeleton loaders while loading
          Array.from({ length: 3 }).map((_, index) => (
            <SidebarMenuItem key={`skeleton-${index}`}>
              <SidebarMenuButton>
                <div className="h-4 w-4 bg-sidebar-foreground/10 rounded-md animate-pulse"></div>
                {state !== 'collapsed' && <div className="h-3 bg-sidebar-foreground/10 rounded w-3/4 animate-pulse"></div>}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))
        ) : (state === 'collapsed' ? threads.length > 0 : filteredThreads.length > 0) ? (
          // Show all filtered threads (in collapsed state show all threads, in expanded state show filtered)
          (state === 'collapsed' ? threads : filteredThreads).map((thread, index) => (
            <ThreadRow
              key={`thread-${thread.threadId}-${index}`}
              thread={thread}
              collapsed={state === 'collapsed'}
              isActive={Boolean(pathname?.includes(thread.threadId))}
              onContextMenu={handleContextMenu}
              onStartLongPress={startLongPress}
              onCancelLongPress={cancelLongPress}
              onConfirmDelete={performDelete}
              isMenuOpen={menuOpenId === thread.threadId}
              setMenuOpenId={setMenuOpenId}
              confirmDeleteId={confirmDeleteId}
              setConfirmDeleteId={setConfirmDeleteId}
            />
          ))
        ) : (
          // Empty state
          <SidebarMenuItem>
            <SidebarMenuButton className="text-sidebar-foreground/70">
              <FileText className="h-4 w-4" />
              <span>{query ? 'No results found' : 'No agents yet'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function ThreadRow({
  thread,
  collapsed,
  isActive,
  onContextMenu,
  onStartLongPress,
  onCancelLongPress,
  onConfirmDelete,
  isMenuOpen,
  setMenuOpenId,
  confirmDeleteId,
  setConfirmDeleteId,
}: {
  thread: ThreadWithProject;
  collapsed: boolean;
  isActive: boolean;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onStartLongPress: (id: string) => void;
  onCancelLongPress: () => void;
  onConfirmDelete: (id: string) => Promise<void>;
  isMenuOpen: boolean;
  setMenuOpenId: (id: string | null) => void;
  confirmDeleteId: string | null;
  setConfirmDeleteId: (id: string | null) => void;
}) {
  const { onClick, isLoading } = useItemNavLoading({ to: thread.url });
  const updatedDate = new Date(thread.updatedAt);
  const isToday = new Date().toDateString() === updatedDate.toDateString();
  const isYesterday = new Date(Date.now() - 86400000).toDateString() === updatedDate.toDateString();
  const dateDisplay = isToday ? 'Today' : isYesterday ? 'Yesterday' : format(updatedDate, 'MMM d, yyyy');

  return (
    <SidebarMenuItem>
      <div
        onContextMenu={(e) => onContextMenu(e, thread.threadId)}
        onTouchStart={() => onStartLongPress(thread.threadId)}
        onTouchEnd={onCancelLongPress}
        onTouchCancel={onCancelLongPress}
        className="relative"
      >
        <SidebarMenuButton
          asChild
          className={isActive ? 'bg-accent text-accent-foreground font-medium' : ''}
        >
          <Link
            href={thread.url}
            onClick={onClick}
            prefetch={false}
            className={collapsed ? 'flex items-center justify-center w-full' : 'flex items-center justify-between w-full'}
          >
            {collapsed ? (
              isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )
            ) : (
              <>
                <div className="flex items-center">
                  {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate">{thread.projectName}</span>
                </div>
                <span className="ml-2 text-xs text-muted-foreground shrink-0">{dateDisplay}</span>
              </>
            )}
          </Link>
        </SidebarMenuButton>
      </div>

      <DropdownMenu
        open={isMenuOpen}
        onOpenChange={(open) => setMenuOpenId(open ? thread.threadId : null)}
      >
        <DropdownMenuTrigger asChild>
          <div className="absolute inset-0 invisible" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" sideOffset={6} className="w-40">
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => {
              setConfirmDeleteId(thread.threadId);
              setMenuOpenId(null);
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" /> 删除会话
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Confirm deletion */}
      <AlertDialog open={confirmDeleteId === thread.threadId} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除会话？</AlertDialogTitle>
            <AlertDialogDescription>
              该操作不可撤销，这将永久删除此会话及其消息记录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => onConfirmDelete(thread.threadId)}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarMenuItem>
  );
}
