'use client';

import * as React from 'react';
import {Link, useRouter} from '@/i18n/routing';
import Image from 'next/image';
import { Menu, House, Library, Loader2, Trash2, Globe, Package, Zap, Database, PlugZap } from 'lucide-react';
// Simple navigation to /dashboard; no thread creation here

import { NavUserWithTeams } from '@/components/sidebar/nav-user-with-teams';
import { ZmindLogo } from '@/components/sidebar/zmind-logo';
import { InviteCodesCard } from '@/components/sidebar/invite-codes-card';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { useCallback, useEffect, useState } from 'react';
import {useTranslations} from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
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
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { useDocumentModalStore } from '@/lib/stores/use-document-modal-store';
// Removed search: agent conversation search no longer in sidebar
import { useWorkspaceData } from '@/hooks/useWorkspaceData';
import { useLocalExpandState } from '@/hooks/useLocalExpandState';
import type { FolderTreeNode } from '@/canvas/types/folder';
import type { Canvas } from '@/canvas/types/canvas';
import { useAccounts } from '@/hooks/use-accounts';
// Use Canvas Sidebar's File Tree UI/UX
import SidebarFileTree from '@/components/file-tree/SidebarFileTree';
import { useCanvas } from '@/canvas/hooks/useCanvas';
import { useCanvasStore } from '@/canvas/stores/canvas.store';
import { useSidebarState } from '@/hooks/useSidebarState';
import { useWorkspace } from '@/contexts/workspace-context';
import { buildCanvasPath, buildDocPath, buildTeamScopedPath } from '@/lib/workspace-path';
import { NavLoadingProvider, useNavLoading } from '@/hooks/useNavLoading';
import { useEffect as useReactEffect } from 'react';
import { requestStopAgentRun, setAgentRunStatus, useAgentRunStatus } from '@/hooks/useAgentRunStatus';
import { fetchMyRoles } from '@/lib/backend-api';
// Import the unified sidebar styles to preserve exact UI/UX

function FloatingMobileMenuButton() {
  const t = useTranslations();
  const { setOpenMobile, openMobile } = useSidebar();
  const isMobile = useIsMobile();

  if (!isMobile || openMobile) return null;

  return (
    <div className="fixed top-3 left-3 z-50 safe-area-top safe-area-left">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={() => setOpenMobile(true)}
            size="icon"
            className="h-9 w-9 rounded-full bg-background/80 backdrop-blur-sm text-foreground border border-border shadow-md hover:bg-background transition-all duration-200 active:scale-95 touch-manipulation"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {t('sidebar.openMenu', {default: 'Open menu'})}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function SidebarLeftView({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { state, setOpen, setOpenMobile } = useSidebar();
  const isMobile = useIsMobile();
  const { data: workspaceData, loading: wsLoading, refetch: refetchWorkspace } = useWorkspaceData();
  const { isExpanded, toggle: toggleLocalExpand, clearInvalid } = useLocalExpandState({});
  // Unified Sidebar (CSB) state for file tree collapse
  const { fileTreeCollapsed, toggleFileTree } = useSidebarState();
  
  const [user, setUser] = useState<{
    name: string;
    email: string;
    avatar: string;
    isAdmin?: boolean;
  }>({
    name: 'Loading...',
    email: 'loading@example.com',
    avatar: '',
    isAdmin: false,
  });

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { teamSlug, isPersonal } = useWorkspace();
  const dashboardPath = buildTeamScopedPath('/dashboard', teamSlug);
  const knowledgePath = buildTeamScopedPath('/knowledge', teamSlug);
  const skillsPath = '/skills';
  const triggersPath = buildTeamScopedPath('/triggers', teamSlug);
  const explorePath = buildTeamScopedPath('/explore', teamSlug);
  const obsidianPath = buildTeamScopedPath('/integrations/obsidian', teamSlug);
  const openclawPath = buildTeamScopedPath('/integrations/openclaw', teamSlug);
  const trashPath = buildTeamScopedPath('/trash', teamSlug);
  let currentCanvasId = searchParams.get('canvasId') || undefined;
  if (!currentCanvasId && pathname) {
    const match = pathname.match(/\/canvas\/([^/]+)/);
    if (match && match[1]) {
      currentCanvasId = match[1];
    }
  }
  let currentDocId = searchParams.get('docId') || undefined;
  if (!currentDocId && pathname) {
    const match = pathname.match(/\/doc\/([^/]+)/);
    if (match && match[1]) {
      currentDocId = match[1];
    }
  }
  const [pendingCanvasId, setPendingCanvasId] = useState<string | null>(null);
  const [pendingDocId, setPendingDocId] = useState<string | null>(null);
  const { isRunning: isAgentRunning } = useAgentRunStatus();
  const [switchConfirmOpen, setSwitchConfirmOpen] = useState(false);
  const [pendingSwitchCanvas, setPendingSwitchCanvas] = useState<Canvas | null>(null);
  // Canvas create via hook (for New Canvas action)
  const { createCanvas } = useCanvas({ autoLoad: false });
  // Using NavLoadingProvider/useNavLoading for top-level navigation spinners
  const { isOpen: isDocumentModalOpen } = useDocumentModalStore();
  // Prepare workspace cached data
  const folders = React.useMemo(
    () => (workspaceData?.folders || []) as any[],
    [workspaceData?.folders],
  );
  const canvases = React.useMemo(
    () => (workspaceData?.canvases || []) as any[],
    [workspaceData?.canvases],
  );
  const items = React.useMemo(
    () => (workspaceData?.items || []) as any[],
    [workspaceData?.items],
  );
  const docsMeta = React.useMemo(
    () => (workspaceData?.docsMeta || []) as any[],
    [workspaceData?.docsMeta],
  );

  // Ensure expand set only contains valid folder ids
  useEffect(() => {
    const ids = new Set(folders.map(f => f.id));
    clearInvalid(ids);
  }, [folders, clearInvalid]);

  const t = useTranslations();
  // Build flat folder tree from cached workspace data
  const externalFolderTree: FolderTreeNode[] = React.useMemo(() => {
    const mapCanvas = new Map<string, any>();
    canvases.forEach(c => mapCanvas.set(c.id, c));
    const docsByFolder = new Map<string | null, any[]>();
    const docMetaByItem = new Map<string, any>();
    docsMeta.forEach((doc) => {
      if (!doc?.itemId) return;
      docMetaByItem.set(doc.itemId, doc);
    });

    const byParent = new Map<string | null, any[]>();
    folders.forEach(f => {
      const pid = f.parentId || null;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid)!.push(f);
    });

    const seenDocIds = new Set<string>();
    for (const item of items) {
      if (!item || item.type !== 'doc' || item.isDeleted || !item.id) continue;
      seenDocIds.add(item.id);
      const meta = docMetaByItem.get(item.id);
      const folderId = item.folderId || null;
      const docs = docsByFolder.get(folderId) || [];
      docs.push({
        itemId: item.id,
        title: item.title || meta?.title || t('workspace.doc.untitled', { default: 'Untitled Doc' }),
        updatedAt: meta?.updatedAt || item.updatedAt || Date.now(),
        createdAt: item.createdAt || Date.now(),
        version: meta?.version || 1,
        folderId,
      });
      docsByFolder.set(folderId, docs);
    }

    for (const meta of docsMeta) {
      if (!meta?.itemId || seenDocIds.has(meta.itemId)) continue;
      const docs = docsByFolder.get(null) || [];
      docs.push({
        itemId: meta.itemId,
        title: meta.title || t('workspace.doc.untitled', { default: 'Untitled Doc' }),
        updatedAt: meta.updatedAt || Date.now(),
        createdAt: meta.updatedAt || Date.now(),
        version: meta.version || 1,
        folderId: null,
      });
      docsByFolder.set(null, docs);
    }

    const result: FolderTreeNode[] = [];
    const byUpdatedDesc = (a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0);

    const toFolderNode = (f: any, level: number): FolderTreeNode => ({
      id: f.id,
      type: 'folder',
      name: f.name,
      parentId: f.parentId || null,
      level,
      isExpanded: isExpanded(f.id),
      canvasIds: f.canvasIds || [],
      docIds: (docsByFolder.get(f.id) || []).map((doc) => doc.itemId),
      childFolderIds: f.childFolderIds || [],
      sortOrder: f.sortOrder || 0,
      createdAt: f.createdAt || Date.now(),
      updatedAt: f.updatedAt || Date.now(),
      folder: f,
    });

    const toCanvasNode = (c: any, parentId: string | null, level: number): FolderTreeNode => ({
      id: c.id,
      type: 'canvas',
      name: typeof c.title === 'string' ? c.title : t('canvas.untitled'),
      parentId,
      level,
      sortOrder: c.updatedAt || Date.now(),
      createdAt: c.createdAt || Date.now(),
      updatedAt: c.updatedAt || Date.now(),
      canvas: { id: c.id, title: typeof c.title === 'string' ? c.title : t('canvas.untitled'), updatedAt: c.updatedAt || Date.now() },
    });

    const toDocNode = (doc: any, parentId: string | null, level: number): FolderTreeNode => ({
      id: doc.itemId,
      type: 'doc',
      name: doc.title || t('workspace.doc.untitled', { default: 'Untitled Doc' }),
      parentId,
      level,
      sortOrder: doc.updatedAt || Date.now(),
      createdAt: doc.createdAt || Date.now(),
      updatedAt: doc.updatedAt || Date.now(),
      doc: {
        itemId: doc.itemId,
        title: doc.title || t('workspace.doc.untitled', { default: 'Untitled Doc' }),
        updatedAt: doc.updatedAt || Date.now(),
        version: doc.version || 1,
        folderId: parentId,
      },
    });

    const walk = (pid: string | null, level: number) => {
      const children = (byParent.get(pid) || []).slice().sort(byUpdatedDesc);
      for (const f of children) {
        result.push(toFolderNode(f, level));
        if (isExpanded(f.id)) {
          // child folders
          walk(f.id, level + 1);
          // canvases and docs under folder
          const ids: string[] = f.canvasIds || [];
          const cs = ids.map(id => mapCanvas.get(id)).filter(Boolean).sort(byUpdatedDesc);
          const ds = (docsByFolder.get(f.id) || []).slice().sort(byUpdatedDesc);
          const entries = [
            ...cs.map((c) => toCanvasNode(c, f.id, level + 1)),
            ...ds.map((doc) => toDocNode(doc, f.id, level + 1)),
          ].sort(byUpdatedDesc);
          result.push(...entries);
        }
      }
    };

    // root folders
    walk(null, 0);

    // root canvases not in any folder
    const assigned = new Set<string>();
    folders.forEach(f => (f.canvasIds || []).forEach((id: string) => assigned.add(id)));
    const rootCs = canvases.filter(c => !assigned.has(c.id)).sort(byUpdatedDesc);
    const rootDocs = (docsByFolder.get(null) || []).slice().sort(byUpdatedDesc);
    const rootEntries = [
      ...rootCs.map((c) => toCanvasNode(c, null, 0)),
      ...rootDocs.map((doc) => toDocNode(doc, null, 0)),
    ].sort(byUpdatedDesc);
    result.push(...rootEntries);

    return result;
  }, [folders, canvases, items, docsMeta, isExpanded, t]);

  useEffect(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [pathname, searchParams, isMobile, setOpenMobile]);

  // Prefetch key routes when idle
  useEffect(() => {
    const idle = (cb: () => void) =>
      typeof (window as any).requestIdleCallback === 'function'
        ? (window as any).requestIdleCallback(cb)
        : setTimeout(cb, 300);
    idle(() => {
      try {
        router.prefetch(dashboardPath);
        router.prefetch(knowledgePath);
        router.prefetch(skillsPath);
        router.prefetch(triggersPath);
        router.prefetch(obsidianPath);
        router.prefetch(openclawPath);
        router.prefetch(trashPath);
      } catch {}
    });
  }, [router, dashboardPath, knowledgePath, skillsPath, triggersPath, obsidianPath, openclawPath, trashPath]);

  // Clear pending state once URL reflects the target canvas
  useReactEffect(() => {
    if (!pendingCanvasId) return;
    const matched = pathname && pathname.includes('/canvas/') && pathname.includes(pendingCanvasId);
    if (matched) {
      setPendingCanvasId(null);
    }
  }, [pathname, pendingCanvasId]);

  useReactEffect(() => {
    if (!pendingDocId) return;
    const matched = pathname && pathname.includes('/doc/') && pathname.includes(pendingDocId);
    if (matched) {
      setPendingDocId(null);
    }
  }, [pathname, pendingDocId]);

  
  useEffect(() => {
    const fetchUserData = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        // 权限由服务端判定：前端不再直查 user_roles 表
        const { is_admin: isAdmin } = await fetchMyRoles();
        
        setUser({
          name:
            data.user.user_metadata?.name ||
            data.user.email?.split('@')[0] ||
            'User',
          email: data.user.email || '',
          avatar: data.user.user_metadata?.avatar_url || '',
          isAdmin: isAdmin,
        });
      }
    };

    fetchUserData();
  }, []);


  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isDocumentModalOpen) return;
      
      if ((event.metaKey || event.ctrlKey) && event.key === 'b') {
        event.preventDefault();
        setOpen(!state.startsWith('expanded'));
        window.dispatchEvent(
          new CustomEvent('sidebar-left-toggled', {
            detail: { expanded: !state.startsWith('expanded') },
          }),
        );
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, setOpen, isDocumentModalOpen]);




  // Prepare navigation loading handlers (top-level hooks)
  const navDashboard = useNavLoading({
    key: 'dashboard',
    to: dashboardPath,
    navigate: () => {
      posthog.capture('new_canvas_clicked');
      router.push(dashboardPath);
    },
    onCloseMobile: isMobile ? () => setOpenMobile(false) : undefined,
  });
  const navKnowledge = useNavLoading({
    key: 'knowledge',
    to: knowledgePath,
    onCloseMobile: isMobile ? () => setOpenMobile(false) : undefined,
  });
  const navSkills = useNavLoading({
    key: 'skills',
    to: skillsPath,
    onCloseMobile: isMobile ? () => setOpenMobile(false) : undefined,
  });
  const navTriggers = useNavLoading({
    key: 'triggers',
    to: triggersPath,
    onCloseMobile: isMobile ? () => setOpenMobile(false) : undefined,
  });
  const navExplore = useNavLoading({
    key: 'explore',
    to: explorePath,
    onCloseMobile: isMobile ? () => setOpenMobile(false) : undefined,
  });
  const navObsidian = useNavLoading({
    key: 'obsidian',
    to: obsidianPath,
    onCloseMobile: isMobile ? () => setOpenMobile(false) : undefined,
  });
  const navOpenClaw = useNavLoading({
    key: 'openclaw',
    to: openclawPath,
    onCloseMobile: isMobile ? () => setOpenMobile(false) : undefined,
  });
  const navTrash = useNavLoading({
    key: 'trash',
    to: trashPath,
    navigate: () => router.push(trashPath),
    onCloseMobile: isMobile ? () => setOpenMobile(false) : undefined,
  });

  const navigateToCanvas = useCallback(
    (canvas: Canvas) => {
      try {
        const { beginCanvasSwitch } = useCanvasStore.getState();
        beginCanvasSwitch(canvas.id, canvas.title);
      } catch {}
      const target = buildCanvasPath(canvas.id, teamSlug);
      if (target === pathname) {
        setPendingCanvasId(null);
        if (isMobile) setOpenMobile(false);
        return;
      }
      setPendingCanvasId(canvas.id);
      router.push(target);
      if (isMobile) setOpenMobile(false);
    },
    [teamSlug, pathname, router, isMobile, setOpenMobile],
  );

  const handleCanvasSelect = useCallback(
    (canvas: Canvas) => {
      if (isAgentRunning) {
        setPendingSwitchCanvas(canvas);
        setSwitchConfirmOpen(true);
        return;
      }
      navigateToCanvas(canvas);
    },
    [isAgentRunning, navigateToCanvas],
  );

  const handleDocSelect = useCallback(
    (itemId: string) => {
      const target = buildDocPath(itemId, teamSlug);
      if (target === pathname) {
        setPendingDocId(null);
        if (isMobile) setOpenMobile(false);
        return;
      }
      setPendingDocId(itemId);
      router.push(target);
      if (isMobile) setOpenMobile(false);
    },
    [teamSlug, pathname, router, isMobile, setOpenMobile],
  );

  const handleConfirmSwitch = useCallback(() => {
    const canvas = pendingSwitchCanvas;
    setSwitchConfirmOpen(false);
    setPendingSwitchCanvas(null);
    if (!canvas) return;
    requestStopAgentRun();
    setAgentRunStatus('idle');
    navigateToCanvas(canvas);
  }, [pendingSwitchCanvas, navigateToCanvas]);

  const handleCancelSwitch = useCallback(() => {
    setSwitchConfirmOpen(false);
    setPendingSwitchCanvas(null);
  }, []);
  const navButtonClass =
    'touch-manipulation h-10 rounded-2xl border border-transparent px-2 hover:border-border/70 hover:bg-card/70';

  return (
    <Sidebar
      collapsible="icon"
      className="bg-sidebar/90 backdrop-blur-sm [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']"
      {...props}
    >
      <SidebarHeader className={cn('pt-3 pb-2 overflow-visible', state === 'collapsed' ? 'px-2' : 'px-3')}>
        <div className={cn('relative flex h-[40px] items-center', state === 'collapsed' ? 'justify-center' : '')}>
          {state === 'collapsed' ? (
            // Collapsed: show logo; clicking expands the sidebar
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex-shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
              aria-label={t('sidebar.expand', {default: 'Expand sidebar'})}
            >
              {/* Light mode symbol */}
              <Image
                src="/zmind-symbol-light.svg"
                alt="Zmind"
                width={24}
                height={24}
                className="h-6 w-6 dark:hidden"
                priority
              />
              {/* Dark mode symbol */}
              <Image
                src="/zmind-symbol.svg"
                alt="Zmind"
                width={24}
                height={24}
                className="h-6 w-6 hidden dark:block"
                priority
              />
            </button>
          ) : (
            <Link href="/" className="flex-shrink-0" onClick={() => isMobile && setOpenMobile(false)}>
              {/* Expanded - Show full logo for light/dark */}
              <Image
                src="/zmind-logo.svg"
                alt="Zmind"
                width={80}
                height={28}
                className="h-6 w-auto dark:hidden"
                priority
              />
              <Image
                src="/zmind-logo-white.svg"
                alt="Zmind"
                width={80}
                height={28}
                className="h-6 w-auto hidden dark:block"
                priority
              />
            </Link>
          )}
          {state !== 'collapsed' && (
            <div className="ml-2 transition-all duration-200 ease-in-out whitespace-nowrap"></div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {state !== 'collapsed' && !isMobile && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarTrigger className="h-8 w-8" />
                </TooltipTrigger>
                <TooltipContent>{t('sidebar.toggleSidebar', {default: 'Toggle sidebar (CMD+B)'})}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="[&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
        {/* Top actions: Home, Knowledge, Skills, Triggers */}
        <SidebarGroup>
          <SidebarMenu>
            {/* Home */}
            <SidebarMenuItem>
              <SidebarMenuButton className={cn(navButtonClass)} isActive={pathname === dashboardPath} {...navDashboard.buttonProps}>
                {state === 'collapsed' ? (
                  <div className="flex items-center justify-center w-full">
                    {navDashboard.isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <House className="h-4 w-4" />
                    )}
                    <span className="sr-only">Opening home…</span>
                  </div>
                ) : (
                  <span className="flex items-center justify-start w-full gap-2">
                    {navDashboard.isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin opacity-80" />
                    ) : (
                      <House className="h-4 w-4 opacity-60" />
                    )}
                    <span className="truncate">{t('sidebar.newThinking', {default: 'Home'})}</span>
                    <span className="sr-only">Opening home…</span>
                  </span>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
            {/* Knowledge */}
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                className={cn(navButtonClass)}
                isActive={pathname === knowledgePath}
                {...navKnowledge.buttonProps}
              >
                <Link href={knowledgePath}>
                  {state === 'collapsed' ? (
                    <div className="flex items-center justify-center w-full">
                      {navKnowledge.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Library size={16} />
                      )}
                    </div>
                  ) : (
                    <span className="flex items-center justify-start w-full gap-2">
                      {navKnowledge.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin opacity-80" />
                      ) : (
                        <Library size={14} className="opacity-60" />
                      )}
                      <span className="truncate">{t('sidebar.knowledge', {default: 'Knowledge'})}</span>
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* Skills */}
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                className={cn(navButtonClass)}
                isActive={pathname === skillsPath}
                {...navSkills.buttonProps}
              >
                <Link href={skillsPath}>
                  {state === 'collapsed' ? (
                    <div className="flex items-center justify-center w-full">
                      {navSkills.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Package size={16} />
                      )}
                    </div>
                  ) : (
                    <span className="flex items-center justify-start w-full gap-2">
                      {navSkills.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin opacity-80" />
                      ) : (
                        <Package size={14} className="opacity-60" />
                      )}
                      <span className="truncate">{t('sidebar.skills', { default: 'Skills' })}</span>
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* Triggers */}
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                className={cn(navButtonClass)}
                isActive={pathname === triggersPath}
                {...navTriggers.buttonProps}
              >
                <Link href={triggersPath}>
                  {state === 'collapsed' ? (
                    <div className="flex items-center justify-center w-full">
                      {navTriggers.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Zap size={16} />
                      )}
                    </div>
                  ) : (
                    <span className="flex items-center justify-start w-full gap-2">
                      {navTriggers.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin opacity-80" />
                      ) : (
                        <Zap size={14} className="opacity-60" />
                      )}
                      <span className="truncate">{t('sidebar.triggers', { default: 'Triggers' })}</span>
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* Template (Thinking Plaza) - top-level entry */}
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                className={cn(navButtonClass)}
                isActive={pathname === explorePath}
                {...navExplore.buttonProps}
              >
                <Link href={explorePath}>
                  {state === 'collapsed' ? (
                    <div className="flex items-center justify-center w-full">
                      {navExplore.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Globe size={16} />
                      )}
                    </div>
                  ) : (
                    <span className="flex items-center justify-start w-full gap-2">
                      {navExplore.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin opacity-80" />
                      ) : (
                        <Globe size={14} className="opacity-60" />
                      )}
                      <span className="truncate">{t('sidebar.template', { default: 'Template' })}</span>
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* Obsidian Integration */}
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                className={cn(navButtonClass)}
                isActive={pathname === obsidianPath}
                {...navObsidian.buttonProps}
              >
                <Link href={obsidianPath}>
                  {state === 'collapsed' ? (
                    <div className="flex items-center justify-center w-full">
                      {navObsidian.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Database size={16} />
                      )}
                    </div>
                  ) : (
                    <span className="flex items-center justify-start w-full gap-2">
                      {navObsidian.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin opacity-80" />
                      ) : (
                        <Database size={14} className="opacity-60" />
                      )}
                      <span className="truncate">{t('sidebar.obsidian', { default: 'Obsidian' })}</span>
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                className={cn(navButtonClass)}
                isActive={pathname === openclawPath}
                {...navOpenClaw.buttonProps}
              >
                <Link href={openclawPath}>
                  {state === 'collapsed' ? (
                    <div className="flex items-center justify-center w-full">
                      {navOpenClaw.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <PlugZap size={16} />
                      )}
                    </div>
                  ) : (
                    <span className="flex items-center justify-start w-full gap-2">
                      {navOpenClaw.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin opacity-80" />
                      ) : (
                        <PlugZap size={14} className="opacity-60" />
                      )}
                      <span className="truncate">{t('sidebar.openclaw', { default: 'OpenClaw' })}</span>
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        {/* Files — full-width without menu-sub wrapper */}
        <SidebarGroup>
          {state !== 'collapsed' && (
            <SidebarFileTree
              className="w-full"
              isCollapsed={fileTreeCollapsed}
              onToggleCollapse={toggleFileTree}
              currentCanvasId={currentCanvasId}
              currentDocId={currentDocId}
              externalFolderTree={externalFolderTree}
              externalLoading={wsLoading}
              pendingCanvasId={pendingCanvasId}
              pendingDocId={pendingDocId}
              onExternalFolderToggle={(id) => toggleLocalExpand(id)}
              onRefetch={refetchWorkspace}
              onCanvasSelect={handleCanvasSelect}
              onDocSelect={handleDocSelect}
              // When deleting current open canvas, navigate to dashboard
              onCanvasDeleted={(id) => {
                if (currentCanvasId && currentCanvasId === id) {
                  router.replace(dashboardPath);
                }
              }}
            />
          )}
        </SidebarGroup>
        {/* Trash (special non-deletable folder) */}
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton className={cn(navButtonClass)} isActive={pathname === trashPath} {...navTrash.buttonProps}>
                {state === 'collapsed' ? (
                  <div className="flex items-center justify-center w-full">
                    {navTrash.isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 size={16} />
                    )}
                  </div>
                ) : (
                  <span className="flex items-center justify-start w-full gap-2">
                    {navTrash.isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin opacity-80" />
                    ) : (
                      <Trash2 size={14} className="opacity-60" />
                    )}
                    <span className="truncate">{t('sidebar.trash', {default: 'Trash'})}</span>
                  </span>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      {state !== 'collapsed' && isPersonal && (
        <div className="px-3 py-2">
          <InviteCodesCard />
        </div>
      )}
      <SidebarFooter className={cn('border-t border-border/60 pb-3 pt-2', state === 'collapsed' ? 'px-1' : 'px-2')}>
        <NavUserWithTeams user={user} />
      </SidebarFooter>
      <SidebarRail />
      <AlertDialog
        open={switchConfirmOpen}
        onOpenChange={(open) => {
          if (!open) handleCancelSwitch();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>切换画布会停止当前任务</AlertDialogTitle>
            <AlertDialogDescription>
              AI 正在生成中。继续切换将自动停止当前任务。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelSwitch}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSwitch}>
              停止并切换
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sidebar>
  );
}

// Export the floating button so it can be used in the layout
export { FloatingMobileMenuButton };

export function SidebarLeft(props: React.ComponentProps<typeof Sidebar>) {
  return (
    <NavLoadingProvider>
      <SidebarLeftView {...props} />
    </NavLoadingProvider>
  );
}
