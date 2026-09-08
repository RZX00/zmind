// Zmind Canvas Editor - 完整Canvas编辑环境
// 基于ZhenZhi架构，集成所有工具栏和面板
'use client';

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTheme } from 'next-themes';
import { useLocale, useTranslations } from 'next-intl';
import InfiniteCanvas from './InfiniteCanvas';
import CanvasLoadingOverlay from './CanvasLoadingOverlay';
import { useRouter } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import LeftVerticalToolbar from '../shared/toolbar/LeftVerticalToolbar';
import TopBar from '../shared/toolbar/TopBar';
import RestoreDraftModal from '../shared/RestoreDraftModal';
import { toast } from 'sonner';
import PlaybackPanel from '../shared/playback/PlaybackPanel';
import OutlineView from '../shared/OutlineView';
import CanvasAIPanel from '../panels/CanvasAIPanel';
import FloatingEditorPanel from '../../mermaid/FloatingEditorPanel';
import { CORNER_STYLES, DEFAULT_CORNER_STYLE } from '../../constants/cornerStyles';
import type { CornerStyle } from '../../types/canvas';
import { BACKGROUND_STYLES, type BackgroundStyle } from '../../constants/backgroundStyles';
import { DEFAULT_FONT_STYLE } from '../../utils/canvasUtils';
import { mapBackgroundColorForTheme, mapPatternColorForTheme } from '../../utils/themeColorMapping';
import type { Canvas, CanvasNode, FontStyle } from '../../types/canvas';
import { AlignmentType } from '../../services/canvas-node-alignment.service';
import { useCanvasStore } from '../../stores/canvas.store';
import { useCanvasCollaboration } from '../../collaboration/useCanvasCollaboration';
import useCanvas from '../../hooks/useCanvas';
import useCanvasHydrator, { useCanvasHydratorWithOptions } from '../../hooks/useCanvasHydrator';
import {
  useCanvasLoadError,
  useCanvasLoading,
  useCanvasPendingTitle,
  useCanvasSwitching,
} from '../../hooks/useCanvasSelector';
import { canvasLinkService } from '../../services/canvas-link.service';
import { canvasManager } from '../../services/canvas-manager.service';
import { canvasThumbnailService } from '../../services/canvas-thumbnail.service';
import { migrateLegacyLocalStorage } from '@/lib/utils/migrate-local-storage';
import { trackEvent } from '@/lib/telemetry';
import { useIsMobile } from '@/hooks/use-mobile';
import { useWorkspace } from '@/contexts/workspace-context';
import { buildCanvasPath } from '@/lib/workspace-path';
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { tidyLayout, applyLayout } from '../../utils/mindmapLayout';
// Import preset font styles list for mapping persisted id -> FontStyle object
import { FONT_STYLES as PRESET_FONT_STYLES } from '../shared/controls/selectors/FontSelector';
import { useSettingsStore } from '../../stores/settings.store';
import { Loader2, PanelRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { requestStopAgentRun, setAgentRunStatus, useAgentRunStatus } from '@/hooks/useAgentRunStatus';
import { useScreenshotController } from '../../presentation/screenshot/useScreenshotController';
import ScreenshotPanel from '../../presentation/screenshot/ScreenshotPanel';

interface CanvasEditorProps {
  canvasId?: string;
  className?: string;
}

const RIGHT_PANEL_STATE_STORAGE_KEY = 'canvas_right_panel_state';
const RIGHT_PANEL_WIDTH_STORAGE_KEY = 'canvas_right_panel_width';
const RIGHT_PANEL_COLLAPSED_STORAGE_KEY = 'canvas_right_panel_collapsed';
const RIGHT_PANEL_MIN_WIDTH = 360;
const RIGHT_PANEL_DEFAULT_WIDTH = 440;
const RIGHT_PANEL_MAX_WIDTH = 920;
const RIGHT_PANEL_SAFE_STAGE_WIDTH = 320;

const CanvasEditor: React.FC<CanvasEditorProps> = ({ canvasId, className }) => {
  // Canvas Store
  const canvas = useCanvasStore(state => state.canvas);
  const selectionNodeIds = useCanvasStore(state => state.selections.nodeIds);
  const currentFileId = useCanvasStore(state => state.currentFileId);
  const isDirty = useCanvasStore(state => state.isDirty);
  const saveState = useCanvasStore(state => state.saveState);
  const saveError = useCanvasStore(state => state.saveError);
  const lastDraftSavedAt = useCanvasStore(state => state.lastDraftSavedAt);
  const draftRecovery = useCanvasStore(state => state.draftRecovery);
  const storeError = useCanvasStore(state => state.error);
  const openCanvas = useCanvasStore(state => state.openCanvas);
  const loadCanvasFromStore = useCanvasStore(state => state.loadCanvas);
  const updateNode = useCanvasStore(state => state.updateNode);
  const updateCanvasState = useCanvasStore(state => state.updateCanvas);
  const setCanvasState = useCanvasStore(state => state.setCanvas);
  const selectSingleNode = useCanvasStore(state => state.selectSingleNode);
  const persistDraft = useCanvasStore(state => state.persistDraft);
  const clearDraft = useCanvasStore(state => state.clearDraft);
  const setDraftRecovery = useCanvasStore(state => state.setDraftRecovery);
  const saveCanvas = useCanvasStore(state => state.saveCanvas);
  const { workspaceId, teamSlug, isReady: isWorkspaceReady } = useWorkspace();
  const isStoreLoading = useCanvasLoading();
  const isSwitchingCanvas = useCanvasSwitching();
  const pendingCanvasTitle = useCanvasPendingTitle();
  const canvasLoadError = useCanvasLoadError();
  const { isRunning: isAgentRunning } = useAgentRunStatus();
  const canvasIdValue = canvas?.id;
  const canvasNodes = canvas?.nodes;
  const canvasBackgroundColor = (canvas as any)?.backgroundColor;
  const canvasPatternColor = (canvas as any)?.patternColor;
  const [switchConfirmOpen, setSwitchConfirmOpen] = useState(false);
  const [pendingSwitchCanvasId, setPendingSwitchCanvasId] = useState<string | null>(null);
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const inviteId = searchParams?.get('invite') || null;
  const inviteCodeFromUrl = searchParams?.get('code') || '';
  const [inviteCode, setInviteCode] = useState('');
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'success'>('idle');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteWorkspaceId, setInviteWorkspaceId] = useState<string | null>(null);
  const [inviteClosed, setInviteClosed] = useState(false);
  const [inviteUserLoggedIn, setInviteUserLoggedIn] = useState<boolean | null>(null);
  const screenshotHideSelectors = useMemo(() => [
    '.selection-feedback-overlay',
    '.selection-chat-overlay',
    '.canvas-context-menu',
    '.canvas-playback-overlay',
    '.canvas-drag-box',
  ], []);

  const getInviteToken = useCallback((): { token: string; expiresAt?: string } | null => {
    if (!canvasId || typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(`canvas_invite_token:${canvasId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const token = parsed?.token as string | undefined;
      const expiresAt = parsed?.expiresAt as string | undefined;
      if (expiresAt) {
        const expMs = new Date(expiresAt).getTime();
        if (Number.isFinite(expMs) && expMs < Date.now()) {
          window.sessionStorage.removeItem(`canvas_invite_token:${canvasId}`);
          return null;
        }
      }
      return token ? { token, expiresAt } : null;
    } catch {
      return null;
    }
  }, [canvasId]);

  const readInviteInfo = useCallback((): { token?: string; workspaceId?: string } | null => {
    if (!canvasId || typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(`canvas_invite_token:${canvasId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const token = parsed?.token as string | undefined;
      const expiresAt = parsed?.expiresAt as string | undefined;
      if (expiresAt) {
        const expMs = new Date(expiresAt).getTime();
        if (Number.isFinite(expMs) && expMs < Date.now()) {
          window.sessionStorage.removeItem(`canvas_invite_token:${canvasId}`);
          return null;
        }
      }
      if (!token) return null;
      const parts = token.split('.');
      if (parts.length >= 2) {
        try {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          const ws = payload?.workspaceId || payload?.workspace_id;
          return { token, workspaceId: typeof ws === 'string' ? ws : undefined };
        } catch {
          return { token };
        }
      }
      return { token };
    } catch {
      return null;
    }
  }, [canvasId]);

  const hydrationStatus = useCanvasHydratorWithOptions(canvasId, { enabled: !inviteId || inviteStatus === 'success' });

  const focusHandledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!canvasId || !canvas || canvas.id !== canvasId) return;
    const focusNodeId = searchParams?.get('focusNode');
    if (!focusNodeId) return;
    const token = `${canvasId}:${focusNodeId}`;
    if (focusHandledRef.current === token) return;

    const node = (canvas.nodes || []).find((n) => n.id === focusNodeId);
    if (node) {
      selectSingleNode(focusNodeId);
      window.dispatchEvent(new CustomEvent('canvas:focus-bbox', {
        detail: {
          x: node.x,
          y: node.y,
          w: node.width,
          h: node.height,
          padding: 16,
          keepScale: true,
        },
      }));
      focusHandledRef.current = token;
      return;
    }

    const fx = Number(searchParams?.get('fx'));
    const fy = Number(searchParams?.get('fy'));
    const fw = Number(searchParams?.get('fw'));
    const fh = Number(searchParams?.get('fh'));
    if ([fx, fy, fw, fh].every((v) => Number.isFinite(v))) {
      window.dispatchEvent(new CustomEvent('canvas:focus-bbox', {
        detail: {
          x: fx,
          y: fy,
          w: fw,
          h: fh,
          padding: 16,
          keepScale: true,
        },
      }));
      selectSingleNode(focusNodeId);
      focusHandledRef.current = token;
      return;
    }

    toast(t('globalSearch.nodeMissing', { default: 'This node may have been deleted.' }));
    focusHandledRef.current = token;
  }, [canvasId, canvas, searchParams, selectSingleNode, t]);

  const selectedNodes = useMemo(() => {
    return Array.from(selectionNodeIds).map(id =>
      canvas.nodes.find(n => n.id === id)
    ).filter(Boolean) as CanvasNode[];
  }, [selectionNodeIds, canvas.nodes]);
  const selectedExpandableNodeId = useMemo(() => {
    if (selectedNodes.length !== 1) return null;
    const target = selectedNodes[0];
    if (target.type !== 'text' && target.type !== 'todo') return null;
    return target.id;
  }, [selectedNodes]);
  const { collaborators, connected: collaborationConnected } = useCanvasCollaboration(canvasId, inviteWorkspaceId || undefined);

  // UI状态管理
  const [isEditMode, setIsEditMode] = useState(true);
  const [backgroundStyle, setBackgroundStyle] = useState(BACKGROUND_STYLES.find(s => s.id === 'dots-medium') || BACKGROUND_STYLES[0]);
  const [cornerStyle, setCornerStyle] = useState(DEFAULT_CORNER_STYLE);
  const [fontStyle, setFontStyle] = useState(DEFAULT_FONT_STYLE);
  const [backgroundColor, setBackgroundColor] = useState('#eeeded');
  const [patternColor, setPatternColor] = useState('#C7C9CA');
  const { resolvedTheme } = useTheme();
  const bgUserChangedRef = useRef(false);
  const patternUserChangedRef = useRef(false);

  // 侧边栏已移除

  // 视图模式状态
  const [showOutline, setShowOutline] = useState(false);
  // 播放状态（顶部栏控制 + PlaybackContainer消费）
  const [playState, setPlayState] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [showPlaybackMenu, setShowPlaybackMenu] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  // 面板状态
  // 代码编辑器独立入口；右侧三分栏固定显示（AI / 素材库 Tab）
  const [showCodeEditor, setShowCodeEditor] = useState(false);
  const [rightPanel, setRightPanel] = useState<'ai'|'assets'>('ai');
  const [mobileRightPanelOpen, setMobileRightPanelOpen] = useState(false);
  const [desktopRightPanelCollapsed, setDesktopRightPanelCollapsed] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH);
  const [expandedEditorState, setExpandedEditorState] = useState<{ open: boolean; nodeId: string | null }>({
    open: false,
    nodeId: null,
  });
  const [expandedEditorOpenRequestId, setExpandedEditorOpenRequestId] = useState(0);
  const stageLayoutRef = useRef<HTMLDivElement | null>(null);
  const isMobileView = useIsMobile();

  const resolveRightPanelMaxWidth = useCallback(() => {
    const hostWidth = stageLayoutRef.current?.clientWidth
      ?? (typeof window !== 'undefined' ? window.innerWidth : RIGHT_PANEL_MAX_WIDTH);
    return Math.max(
      RIGHT_PANEL_MIN_WIDTH,
      Math.min(RIGHT_PANEL_MAX_WIDTH, hostWidth - RIGHT_PANEL_SAFE_STAGE_WIDTH),
    );
  }, []);

  const clampRightPanelWidth = useCallback((value: number) => {
    const maxWidth = resolveRightPanelMaxWidth();
    return Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(maxWidth, Math.round(value)));
  }, [resolveRightPanelMaxWidth]);

  // Toggle global UI hide during playback in sync with inactivity window (3s)
  useEffect(() => {
    const updateHtmlClass = (hide: boolean) => {
      try {
        if (hide) document.documentElement.classList.add('playback-ui-hidden');
        else document.documentElement.classList.remove('playback-ui-hidden');
      } catch {}
    };

    if (playState === 'playing') {
      // Start/refresh inactivity timer
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => { setUiHidden(true); updateHtmlClass(true); }, 3000);

      const onInteract = () => {
        setUiHidden(false);
        updateHtmlClass(false);
        if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = window.setTimeout(() => { setUiHidden(true); updateHtmlClass(true); }, 3000);
      };
      document.addEventListener('mousemove', onInteract);
      document.addEventListener('keydown', onInteract);
      document.addEventListener('touchstart', onInteract);
      return () => {
        document.removeEventListener('mousemove', onInteract);
        document.removeEventListener('keydown', onInteract);
        document.removeEventListener('touchstart', onInteract);
      };
    } else {
      // Pause or stop: reveal UI and clear timers
      if (hideTimerRef.current) { window.clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
      setUiHidden(false);
      try { document.documentElement.classList.remove('playback-ui-hidden'); } catch {}
    }
  }, [playState]);

  const hasRenderableCanvas = Boolean(canvas?.id && (!canvasId || canvas.id === canvasId));
  const shouldBlockForLoad = !hasRenderableCanvas && (isStoreLoading || isSwitchingCanvas || hydrationStatus === 'loading');
  const shouldBlockForError = Boolean(canvasLoadError) && !hasRenderableCanvas;
  const overlayVisible = shouldBlockForLoad || shouldBlockForError;
  const overlayStatus: 'loading' | 'slow' | 'error' = shouldBlockForError ? 'error' : 'loading';
  const overlayTitle = pendingCanvasTitle ?? null;
  const overlayMessage = canvasLoadError ?? undefined;
  const isSyncing =
    hasRenderableCanvas &&
    (isStoreLoading || isSwitchingCanvas || hydrationStatus === 'loading' || hydrationStatus === 'hydrating');
  const hasStatusError = Boolean(storeError || canvasLoadError);
  const activeCanvasId = canvasId || currentFileId || canvas?.id;
  const showDraftRecovery = Boolean(
    draftRecovery &&
    activeCanvasId &&
    draftRecovery.canvasId === activeCanvasId &&
    hasRenderableCanvas &&
    !isSwitchingCanvas
  );

  // 轻量埋点：记录打开失败与自救操作（控制台/开发日志）
  useEffect(() => {
    if (canvasLoadError) {
      try { console.warn('[CanvasEditor] canvas open failed', { id: canvasId, error: canvasLoadError }); } catch {}
      const lower = canvasLoadError.toLowerCase();
      if ((inviteId || getInviteToken()) && (lower.includes('forbidden') || lower.includes('access denied') || lower.includes('unauthorized'))) {
        try { window.sessionStorage.removeItem(`canvas_invite_token:${canvasId}`); } catch {}
        setInviteStatus('idle');
        setInviteClosed(true);
        setInviteError('协作已关闭或当前链接已失效，请联系邀请人重新开启。');
      }
    }
  }, [canvasLoadError, canvasId, inviteId, getInviteToken]);

  // 🧠 一次性规范化：打开画布后，将思维导图组内的文本/待办节点宽度规范到 [150, 450] 并按内容估算
  const normalizedMindmapGroupsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    try {
      const c = canvas;
      if (!c || !Array.isArray(c.nodes)) return;
      const groups = c.nodes.filter((n: any) => n && n.type === 'group' && ((n as any).groupMode === 'mindmap' || (n as any).mindmap));
      if (!groups.length) return;
      const { estimateAutoTextWidth, calculateTextNodeHeight, getTextLayoutPreset, DEFAULT_TEXT_LAYOUT_PRESET } = require('../../utils/canvasUtils');
      const presetId = c.textLayoutPreset ?? DEFAULT_TEXT_LAYOUT_PRESET;
      const layout = getTextLayoutPreset ? getTextLayoutPreset(presetId) : undefined;
      const now = Date.now();
      const autoMode = (() => { try { return (require('../../stores/settings.store') as any).useSettingsStore.getState().mindmap?.autoWidthMode === 'auto'; } catch { return false; } })();
      for (const g of groups as any[]) {
        if (normalizedMindmapGroupsRef.current.has(g.id)) continue;
        const memberIds: string[] = Array.isArray(g.children) ? g.children : [];
        let touched = false;
        for (const id of memberIds) {
          const n = c.nodes.find(nn => nn.id === id);
          if (!n) continue;
          // 跳过已标记"仅自动一次"的节点
          if ((n as any).autoSizeOnce) continue;
          if (n.type === 'text' || n.type === 'todo') {
            const w = autoMode ? estimateAutoTextWidth(n.content || '', { layoutPreset: layout, nodeType: n.type as any, clamp: { min: 150, max: 450 } }) : 300;
            if (Math.abs((n.width || 0) - w) > 0.5 || (n.width as any) < 150 || (n.width as any) > 450) {
              const h = calculateTextNodeHeight ? calculateTextNodeHeight(n.content || '', w, { layoutPreset: layout }) : (n.height || 60);
              updateNode(n.id, { width: w, height: h, updatedAt: now } as any);
              touched = true;
            }
          }
        }
        normalizedMindmapGroupsRef.current.add(g.id);
        if (touched) {
          // 触发布局以收敛位置
          try {
            const latest = useCanvasStore.getState().canvas;
            const res = tidyLayout(latest, g.id);
            applyLayout(res);
          } catch {}
        }
      }
    } catch {}
  }, [canvas, canvasIdValue, canvasNodes, updateNode]);

  // 错误态自救：无缓存重试 & 清理本地状态
  const [retryBusy, setRetryBusy] = useState(false);
  const handleRetryNoCache = useCallback(async () => {
    if (retryBusy) return;
    setRetryBusy(true);
    try {
      if (canvasId) {
        await openCanvas(canvasId);
      } else {
        await loadCanvasFromStore();
      }
    } catch (e) {
      // ignore; overlay 会继续显示错误
    } finally {
      setRetryBusy(false);
    }
  }, [retryBusy, canvasId, openCanvas, loadCanvasFromStore]);

  const handleClearLocalState = useCallback(async () => {
    try {
      const keys = [
        'last_canvas_id',
        'canvas_history',
        'canvas_repository_config',
        'canvas_pinned_canvases',
      ];
      // 清理当前画布的本地快照
      if (canvasId) {
        keys.push(`canvas_snapshot:${canvasId}`);
      }
      for (const k of keys) {
        try { localStorage.removeItem(k); } catch {}
      }
    } catch {}
    // 清理后，尝试重新加载
    try {
      if (canvasId) await openCanvas(canvasId); else await loadCanvasFromStore();
    } catch {}
  }, [canvasId, openCanvas, loadCanvasFromStore]);

  const handleRestoreDraft = useCallback(() => {
    if (!draftRecovery?.doc) return;
    setCanvasState(draftRecovery.doc, draftRecovery.canvasId);
    persistDraft('manual', { force: true });
    setDraftRecovery(null);
    try { trackEvent('canvas.draft.restored', { canvasId: draftRecovery.canvasId }); } catch {}
  }, [draftRecovery, setCanvasState, persistDraft, setDraftRecovery]);

  const handleDiscardDraft = useCallback(() => {
    if (draftRecovery?.canvasId) {
      clearDraft(draftRecovery.canvasId);
    }
    setDraftRecovery(null);
    try { trackEvent('canvas.draft.discarded', { canvasId: draftRecovery?.canvasId }); } catch {}
  }, [draftRecovery, clearDraft, setDraftRecovery]);

  // 群组选择状态
  const [selectedGroup, setSelectedGroup] = useState<CanvasNode | null>(null);

  // 当其它画布标题变更事件触发时，更新本画布中的 canvas-link 节点标题
  useEffect(() => {
    const handler = (e: any) => {
      try {
        const id = e?.detail?.id;
        const title = e?.detail?.title;
        if (!id || typeof title !== 'string') return;
        const latestCanvas = useCanvasStore.getState().canvas;
        const linkNodes = (latestCanvas?.nodes || []).filter((n: any) => n?.type === 'canvas-link' && n?.targetCanvasId === id);
        if (!linkNodes || linkNodes.length === 0) return;
        linkNodes.forEach((n: any) => {
          updateNode(n.id, { title });
        });
      } catch {}
    };
    try { window.addEventListener('canvas:title-changed', handler as any); } catch {}
    return () => { try { window.removeEventListener('canvas:title-changed', handler as any); } catch {} };
  }, [updateNode]);

  // 画布列表缓存与服务（用于 Canvas Link 工作流）
  const {
    allCanvases,
    loadAllCanvases,
    refreshCanvases,
  } = useCanvas({ autoLoad: false });

  // 顶部栏改为单一文档标题（无标签系统）

  useEffect(() => {
    try { useSettingsStore.getState().load(); } catch {}
  }, []);

  // Track theme readiness to avoid initial mismatch before next-themes hydrates
  const [themeMounted, setThemeMounted] = useState(false);
  useEffect(() => { setThemeMounted(true); }, []);

  // Enforce one-to-one theme mapping (Strategy B: nearest neighbor) for background color on theme change.
  useEffect(() => {
    try {
      const targetTheme: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light';
      // Avoid mapping during loading/switching to prevent flicker against incoming data
      if (!themeMounted || isStoreLoading || isSwitchingCanvas || !canvasIdValue) return;
      const currentBg = canvasBackgroundColor || backgroundColor;
      const mapped = mapBackgroundColorForTheme(currentBg, targetTheme);
      // Normalize compare (lowercase hex)
      const normA = (currentBg || '').toString().trim().toLowerCase();
      const normB = (mapped || '').toString().trim().toLowerCase();
      if (normA !== normB) {
        // Update local UI and persist via store
        setBackgroundColor(mapped);
        // mark as user-changed to prevent older default-fallback logic interfering
        bgUserChangedRef.current = true;
        try { updateCanvasState({ backgroundColor: mapped }); } catch {}
      }
      // Pattern color: keep user's setting; only nudge default preview if they didn't choose
      if (!patternUserChangedRef.current) {
        const desiredPattern = resolvedTheme === 'dark' ? '#4D4F52' : '#C7C9CA';
        setPatternColor(desiredPattern);
      }
    } catch {}
  }, [
    themeMounted,
    resolvedTheme,
    canvasIdValue,
    canvasBackgroundColor,
    backgroundColor,
    isStoreLoading,
    isSwitchingCanvas,
    updateCanvasState,
  ]);

  // Always render with a theme-mapped background color (prevents stale persisted colors on reopen)
  const effectiveBgColor = React.useMemo(() => {
    if (!themeMounted) {
      // Before theme is mounted, keep persisted/raw color to avoid wrong flash
      return ((canvasBackgroundColor as any) || backgroundColor) as string;
    }
    const target: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light';
    const base = canvasBackgroundColor || backgroundColor;
    return mapBackgroundColorForTheme(base, target);
  }, [themeMounted, resolvedTheme, canvasBackgroundColor, backgroundColor]);

  // Pattern color mapped to theme for rendering (preserve stored value)
  const effectivePatternColor = React.useMemo(() => {
    if (!themeMounted) {
      return ((canvasPatternColor as any) || patternColor) as string;
    }
    const target: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light';
    const base = canvasPatternColor || patternColor;
    return mapPatternColorForTheme(base, target);
  }, [themeMounted, resolvedTheme, canvasPatternColor, patternColor]);
  const screenshot = useScreenshotController({
    canvasTitle: canvas?.title,
    backgroundColor: effectiveBgColor,
    hideSelectors: screenshotHideSelectors,
  });

  // 节点样式更新处理
  const handleNodeStyleChange = useCallback((nodeId: string, styles: any) => {
    updateNode(nodeId, styles);
  }, [updateNode]);

  // 节点对齐处理
  const handleNodeAlignment = useCallback((alignedNodes: CanvasNode[], type: AlignmentType) => {
    if (!canvas) return;

    // 🎯 更新画布中的节点位置
    const updatedCanvas: Canvas = {
      ...canvas,
      nodes: canvas.nodes.map(node => {
        // 找到对齐后的节点并替换
        const alignedNode = alignedNodes.find(aligned => aligned.id === node.id);
        return alignedNode || node;
      }),
      updatedAt: Date.now()
    };

    // 更新 store 中的画布状态
    setCanvasState(updatedCanvas);
  }, [canvas, setCanvasState]);

  // 同步浏览器标签标题，增强识别性
  useEffect(() => {
    if (typeof document !== 'undefined') {
      try {
        document.title = canvas?.title ? `${canvas.title} - Zmind` : 'Zmind';
      } catch {}
    }
  }, [canvas?.title]);

  // 保持视口宽度稳定：在画布编辑器挂载期间禁用页面纵向滚动，避免出现/消失滚动条引发的布局抖动
  useEffect(() => {
    const prev = document?.body?.style?.overflowY || '';
    try { document.body.style.overflowY = 'hidden'; } catch {}
    return () => { try { document.body.style.overflowY = prev; } catch {} };
  }, []);

  const setActiveRightPanel = useCallback((panel: 'ai'|'assets') => {
    setRightPanel(panel);
    try { localStorage.setItem(RIGHT_PANEL_STATE_STORAGE_KEY, panel); } catch {}
  }, []);

  const openMobileRightPanel = useCallback((panel: 'ai'|'assets') => {
    setActiveRightPanel(panel);
    setMobileRightPanelOpen(true);
  }, [setActiveRightPanel]);

  const handleTopBarRightPanelToggle = useCallback(() => {
    if (isMobileView) {
      setMobileRightPanelOpen((prev) => !prev);
      return;
    }
    setDesktopRightPanelCollapsed((prev) => !prev);
  }, [isMobileView]);

  const handleTopBarOpenExpandedEditor = useCallback(() => {
    if (!selectedExpandableNodeId) return;
    setExpandedEditorOpenRequestId((prev) => prev + 1);
  }, [selectedExpandableNodeId]);

  // 初始化：从 localStorage 恢复右侧面板 tab 与宽度
  useEffect(() => {
    try {
      const last = localStorage.getItem(RIGHT_PANEL_STATE_STORAGE_KEY);
      if (last === 'ai' || last === 'assets') {
        setRightPanel(last as 'ai' | 'assets');
      }
      const collapsed = localStorage.getItem(RIGHT_PANEL_COLLAPSED_STORAGE_KEY);
      if (collapsed === '1') {
        setDesktopRightPanelCollapsed(true);
      }
      const storedWidth = Number(localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY));
      if (Number.isFinite(storedWidth) && storedWidth > 0) {
        setRightPanelWidth(clampRightPanelWidth(storedWidth));
      }
    } catch {}
  }, [clampRightPanelWidth]);

  useEffect(() => {
    const handleResize = () => {
      setRightPanelWidth((prev) => clampRightPanelWidth(prev));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampRightPanelWidth]);

  useEffect(() => {
    const host = stageLayoutRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setRightPanelWidth((prev) => clampRightPanelWidth(prev));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [clampRightPanelWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(rightPanelWidth));
    } catch {}
  }, [rightPanelWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(RIGHT_PANEL_STATE_STORAGE_KEY, rightPanel);
    } catch {}
  }, [rightPanel]);

  useEffect(() => {
    try {
      localStorage.setItem(RIGHT_PANEL_COLLAPSED_STORAGE_KEY, desktopRightPanelCollapsed ? '1' : '0');
    } catch {}
  }, [desktopRightPanelCollapsed]);

  // One-time localStorage key migration (legacy prefixes -> zmind-*)
  useEffect(() => {
    try { migrateLegacyLocalStorage(); } catch {}
  }, []);

  // 当 canvas 的持久化全局样式变化时，若用户未手动更改过背景/图案颜色，则用持久化值覆盖本地 UI 状态
  useEffect(() => {
    try {
      const bgId = (canvas as any)?.backgroundStyleId as string | undefined;
      if (bgId) {
        const obj = BACKGROUND_STYLES.find(s => s.id === bgId);
        if (obj) setBackgroundStyle(obj);
      }
      if (!bgUserChangedRef.current && (canvas as any)?.backgroundColor) {
        setBackgroundColor((canvas as any).backgroundColor);
      }
      if (!patternUserChangedRef.current && (canvas as any)?.patternColor) {
        setPatternColor((canvas as any).patternColor);
      }
      // 同步圆角/字体（如果存储中有值）
      const csId = (canvas as any)?.cornerStyle;
      if (csId) {
        const c = CORNER_STYLES.find(x => x.id === csId);
        setCornerStyle(c || DEFAULT_CORNER_STYLE);
      } else {
        setCornerStyle(DEFAULT_CORNER_STYLE);
      }
      const fsId = (canvas as any)?.fontStyle;
      if (fsId) {
        const f = (PRESET_FONT_STYLES as any).find((x: any) => x.id === fsId) || DEFAULT_FONT_STYLE;
        setFontStyle(f as any);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas?.id, (canvas as any)?.backgroundStyleId, (canvas as any)?.backgroundColor, (canvas as any)?.patternColor, (canvas as any)?.cornerStyle, (canvas as any)?.fontStyle]);

  // 允许外部请求打开 AI 面板（供选择聊天入口触发）
  useEffect(() => {
    const handler = () => {
      try {
        if (isMobileView) {
          openMobileRightPanel('ai');
        } else {
          setActiveRightPanel('ai');
          setDesktopRightPanelCollapsed(false);
        }
      } catch {}
    };
    try { window.addEventListener('canvas:open-ai-panel', handler as any); } catch {}
    return () => { try { window.removeEventListener('canvas:open-ai-panel', handler as any); } catch {} };
  }, [isMobileView, openMobileRightPanel, setActiveRightPanel]);

  // URL 参数触发大纲显示（view=outline）
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('view') === 'outline') setShowOutline(true);
    } catch {}
  }, []);

  // 大纲视图中的节点选择
  const handleOutlineNodeSelect = useCallback((nodeId: string) => {
    // 仅选中节点，但不切回画布（保持大纲叠加层）
    selectSingleNode(nodeId);
  }, [selectSingleNode]);

  // 代码编辑器切换
  const handleCodeEditorToggle = useCallback(() => {
    setShowCodeEditor(!showCodeEditor);
  }, [showCodeEditor]);

  // ===== Canvas Link 回调：使用本地缓存优先策略 =====
  const handleGetAvailableCanvases = useCallback(async () => {
    const currentId = canvas?.id;
    // 优先使用前端缓存，避免每次打开都请求
    if (allCanvases && allCanvases.length > 0) {
      return allCanvases
        .filter(c => !currentId || c.id !== currentId)
        .slice()
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .map(c => ({ id: c.id, title: String(c.title || '未命名画布'), lastUpdated: c.updatedAt }));
    }
    // 缓存为空时，调用服务获取，并异步刷新缓存
    const remote = (await canvasLinkService.getAvailableCanvases()).filter(c => !currentId || c.id !== currentId);
    try { loadAllCanvases?.(); } catch {}
    return remote.map(c => ({ id: c.id, title: String(c.title || '未命名画布'), lastUpdated: c.lastUpdated }));
  }, [allCanvases, loadAllCanvases, canvas?.id]);

  const handleCreateLinkedCanvas = useCallback(async (name: string): Promise<string> => {
    const id = await canvasLinkService.createCanvas(name);
    // 刷新缓存，但不阻塞创建流程
    try { refreshCanvases?.(); } catch {}
    return id;
  }, [refreshCanvases]);

  const handleCanvasExists = useCallback(async (id: string): Promise<boolean> => {
    if (allCanvases && allCanvases.some(c => c.id === id)) return true;
    try {
      return await canvasManager.canvasExists(id);
    } catch {
      return false;
    }
  }, [allCanvases]);

  const navigateToCanvas = useCallback((targetCanvasId: string) => {
    try {
      const basePath = buildCanvasPath(targetCanvasId, teamSlug ?? undefined);
      const href = locale === 'zh' ? `/zh${basePath}` : basePath;
      const opened = window.open(href, '_blank', 'noopener,noreferrer');
      if (!opened) {
        router.push(href);
      }
    } catch (e) {
      console.warn('[CanvasEditor] 打开画布链接失败:', e);
      try {
        const fallbackPath = buildCanvasPath(targetCanvasId, teamSlug ?? undefined);
        router.push(locale === 'zh' ? `/zh${fallbackPath}` : fallbackPath);
      } catch {}
    }
  }, [teamSlug, locale, router]);

  const handleCanvasNavigate = useCallback((targetCanvasId: string) => {
    if (isAgentRunning) {
      setPendingSwitchCanvasId(targetCanvasId);
      setSwitchConfirmOpen(true);
      return;
    }
    navigateToCanvas(targetCanvasId);
  }, [isAgentRunning, navigateToCanvas]);

  const handleConfirmCanvasSwitch = useCallback(() => {
    const targetId = pendingSwitchCanvasId;
    setSwitchConfirmOpen(false);
    setPendingSwitchCanvasId(null);
    if (!targetId) return;
    requestStopAgentRun();
    setAgentRunStatus('idle');
    navigateToCanvas(targetId);
  }, [pendingSwitchCanvasId, navigateToCanvas]);

  const handleCancelCanvasSwitch = useCallback(() => {
    setSwitchConfirmOpen(false);
    setPendingSwitchCanvasId(null);
  }, []);

  const handleRefreshThumbnail = useCallback(async (nodeId: string) => {
    try {
      const node = canvas?.nodes?.find(n => n.id === nodeId);
      if (!node) return;
      const targetId = (node as any).targetCanvasId || node.content;
      if (!targetId) return;
      const result = await canvasThumbnailService.generateThumbnail(targetId, {
        width: 280,
        height: 180,
        format: 'svg',
        backgroundColor: resolvedTheme === 'dark' ? '#111827' : '#f8fafc'
      });
      if (result?.url) {
        updateNode(nodeId, { thumbnailUrl: result.url });
      }
    } catch (e) {
      console.warn('[CanvasEditor] 刷新缩略图失败:', e);
    }
  }, [canvas?.nodes, updateNode, resolvedTheme]);

  useEffect(() => {
    if (getInviteToken()) {
      setInviteStatus('success');
    }
  }, [getInviteToken]);

  useEffect(() => {
    const info = readInviteInfo();
    if (info?.token) {
      setInviteStatus('success');
      if (info.workspaceId) setInviteWorkspaceId(info.workspaceId);
    }
  }, [readInviteInfo]);

  useEffect(() => {
    if (!inviteId) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        if (!cancelled) setInviteUserLoggedIn(!!data.session);
      } catch {
        if (!cancelled) setInviteUserLoggedIn(null);
      }
    })();
    return () => { cancelled = true; };
  }, [inviteId]);

  const verifyInvite = useCallback(async (codeOverride?: string) => {
    if (!canvasId || !inviteId) {
      setInviteError('缺少邀请参数');
      return;
    }
    const code = (codeOverride ?? inviteCode).trim();
    if (!code) {
      setInviteError('请输入邀请码');
      return;
    }
    setInviteSubmitting(true);
    setInviteError(null);
    setInviteClosed(false);
    try {
      const resp = await fetch(`/api/canvases/${canvasId}/invite/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inviteId, code }),
      });
      if (!resp.ok) {
        const msg = await resp.text();
        if (resp.status === 403) {
          setInviteClosed(true);
          throw new Error(msg || '协作已关闭，当前链接已失效');
        }
        throw new Error(msg || '验证失败');
      }
      const data = await resp.json();
      if (data?.token) {
        try {
          window.sessionStorage.setItem(
            `canvas_invite_token:${canvasId}`,
            JSON.stringify({ token: data.token, expiresAt: data.expiresAt }),
          );
        } catch {}
        setInviteStatus('success');
        if (data?.workspaceId) {
          setInviteWorkspaceId(String(data.workspaceId));
        }
        toast.success('验证成功，正在进入协作');
      }
    } catch (e: any) {
      const msg = typeof e?.message === 'string' && e.message ? e.message : '验证失败或协作已关闭';
      setInviteError(msg);
    } finally {
      setInviteSubmitting(false);
    }
  }, [canvasId, inviteCode, inviteId]);

  const handleVerifyInvite = useCallback(() => {
    verifyInvite();
  }, [verifyInvite]);

  useEffect(() => {
    if (!inviteId || !inviteCodeFromUrl) return;
    setInviteCode((prev) => prev || inviteCodeFromUrl);
  }, [inviteId, inviteCodeFromUrl]);

  useEffect(() => {
    if (!inviteId || !inviteCodeFromUrl) return;
    if (inviteStatus !== 'idle' || inviteSubmitting) return;
    if (inviteUserLoggedIn !== true) return;
    verifyInvite(inviteCodeFromUrl);
  }, [inviteId, inviteCodeFromUrl, inviteStatus, inviteSubmitting, inviteUserLoggedIn, verifyInvite]);


  // 当从 Dashboard 跳转并携带初始 prompt 时，自动打开 AI 面板
  const autoOpenForCanvasRef = useRef<string | null>(null);
  useEffect(() => {
    try {
      if (!canvasId) return;
      // 避免针对同一画布重复触发
      if (autoOpenForCanvasRef.current === canvasId) return;

      const hasUrlPrompt = !!searchParams?.get('prompt');
      let hasStoredPrompt = false;
      if (searchParams?.get('p') === '1') {
        try { hasStoredPrompt = !!sessionStorage.getItem(`canvas:initialPrompt:${canvasId}`); } catch {}
      }
      let hasStoredAttachments = false;
      try { hasStoredAttachments = !!sessionStorage.getItem(`canvas:initialAttachments:${canvasId}`); } catch {}

      if (hasUrlPrompt || hasStoredPrompt || hasStoredAttachments) {
        autoOpenForCanvasRef.current = canvasId;
        if (isMobileView) {
          openMobileRightPanel('ai');
        } else {
          setActiveRightPanel('ai');
          setDesktopRightPanelCollapsed(false);
        }
      }
    } catch {}
  }, [canvasId, searchParams, isMobileView, openMobileRightPanel, setActiveRightPanel]);

  // 群组选择变化处理
  const handleSelectedGroupChange = useCallback((groupNode: CanvasNode | null) => {
    setSelectedGroup(groupNode);
  }, []);

  // 群组样式更新处理
  const handleGroupStyleChange = useCallback((groupId: string, styles: { accentColor?: string; groupStyles?: { bgOpacity?: number } }) => {
    updateNode(groupId, styles);
  }, [updateNode]);

  const handleRightPanelResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (isMobileView) return;

    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}

    const startX = event.clientX;
    const startWidth = rightPanelWidth;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      setRightPanelWidth(clampRightPanelWidth(startWidth + delta));
    };

    const stopResize = () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopResize, { once: true });
    window.addEventListener('pointercancel', stopResize, { once: true });
  }, [clampRightPanelWidth, isMobileView, rightPanelWidth]);

  const desktopPanelOpen = !isMobileView && !desktopRightPanelCollapsed;
  const desktopPanelWidth = `${rightPanelWidth}px`;
  const aiContextMode = expandedEditorState.open && expandedEditorState.nodeId ? 'node' : 'selection';

  return (
    <div
      className={`w-full h-full flex flex-col bg-muted/30 ${className || ''}`}
      style={{
        ['--ai-panel-width' as any]: '0px',
      }}
    >
      <ScreenshotPanel
        isOpen={screenshot.open}
        loading={screenshot.loading}
        screenshotUrl={screenshot.screenshotUrl}
        aspect={screenshot.aspect}
        message={screenshot.message}
        hasBlob={screenshot.hasBlob}
        aspectOptions={screenshot.aspectOptions}
        onClose={screenshot.close}
        onRetry={() => screenshot.capture(screenshot.aspect)}
        onDownload={screenshot.download}
        onAspectChange={screenshot.changeAspect}
      />

      {inviteId && inviteStatus !== 'success' && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-3xl rounded-2xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-8 shadow-2xl space-y-4 text-gray-900 dark:text-zinc-100">
            <div className="space-y-2">
              <div className="text-xl font-semibold">外部协作邀请</div>
              <p className="text-sm text-muted-foreground">
                输入邀请码后加入协作。未登录会先跳转登录，再自动返回这里。
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="请输入邀请码"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                className="sm:w-72 text-base h-11"
                autoFocus
              />
              <Button size="lg" onClick={handleVerifyInvite} disabled={inviteSubmitting || !inviteCode.trim()} className="h-11 px-6">
                {inviteSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : '加入协作'}
              </Button>
            </div>
            {inviteError ? (
              <p className="text-sm text-destructive">{inviteError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                邀请链接 + 邀请码双重校验，更安心。
              </p>
            )}
            {inviteClosed && (
              <div className="flex flex-wrap gap-2 pt-1">
                {inviteUserLoggedIn && (
                  <Button variant="outline" size="sm" onClick={() => router.push('/dashboard')}>
                    返回工作台
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => router.push('/')}>
                  回到首页
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <div ref={stageLayoutRef} className="relative flex flex-1 min-h-0 gap-1.5 overflow-hidden p-1.5">
        <div
          className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm transition-[margin-right] duration-[340ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{
            marginRight: !isMobileView && desktopPanelOpen ? `calc(${desktopPanelWidth} + 6px)` : '0px',
          }}
        >
          {/* 顶部工具栏（仅中间画布栏） */}
          <TopBar
            className="playback-hideable"
            documentTitle={canvas.title}
            canvasId={canvas?.id}
            isDirty={isDirty}
            saveState={saveState}
            saveError={saveError}
            lastDraftSavedAt={lastDraftSavedAt}
            onRetrySave={saveCanvas}
            isSyncing={isSyncing}
            hasError={hasStatusError}
            onDocumentTitleChange={(title) => {
              updateCanvasState({ title });
              try {
                const id = currentFileId;
                if (id) {
                  window.dispatchEvent(new CustomEvent('canvas:title-changed', { detail: { id, title } }));
                }
              } catch {}
            }}
            backgroundStyle={backgroundStyle}
            backgroundColor={effectiveBgColor}
            viewMode={'canvas'}
            onViewModeChange={() => setShowOutline(v => !v)}
            onCodeEditorToggle={handleCodeEditorToggle}
            playState={playState}
            onPlayStateChange={setPlayState}
            onRequestOpenPlaybackMenu={() => setShowPlaybackMenu(true)}
            collaborators={collaborators}
            collaborationConnected={collaborationConnected}
            canOpenExpandedEditor={Boolean(selectedExpandableNodeId)}
            onOpenExpandedEditor={handleTopBarOpenExpandedEditor}
            rightPanelCollapsed={isMobileView ? !mobileRightPanelOpen : desktopRightPanelCollapsed}
            onRightPanelToggle={handleTopBarRightPanelToggle}
            onScreenshot={() => screenshot.capture()}
            screenshotLoading={screenshot.loading}
          />

          {/* 中间栏画布区 */}
          <div className="relative flex flex-1 min-h-0 overflow-hidden">
            <LeftVerticalToolbar
              isEditMode={isEditMode}
              onEditModeChange={setIsEditMode}
              selectedNodes={selectedNodes}
              onNodeStyleChange={handleNodeStyleChange}
              onNodeAlignment={handleNodeAlignment}
              backgroundStyle={backgroundStyle}
              onBackgroundStyleChange={(style) => {
                setBackgroundStyle(style);
                try { updateCanvasState({ backgroundStyleId: style?.id }); } catch {}
              }}
              cornerStyle={cornerStyle}
              onCornerStyleChange={(style) => {
                setCornerStyle(style);
                try { updateCanvasState({ cornerStyle: style?.id }); } catch {}
              }}
              fontStyle={fontStyle}
              onFontStyleChange={(style) => {
                setFontStyle(style);
                try { updateCanvasState({ fontStyle: style?.id }); } catch {}
              }}
              backgroundColor={effectiveBgColor}
              onBackgroundColorChange={(color) => {
                bgUserChangedRef.current = true;
                setBackgroundColor(color);
                try { updateCanvasState({ backgroundColor: color }); } catch {}
              }}
              patternColor={patternColor}
              onPatternColorChange={(color) => {
                patternUserChangedRef.current = true;
                setPatternColor(color);
                try { updateCanvasState({ patternColor: color }); } catch {}
              }}
              selectedGroup={selectedGroup}
              onGroupStyleChange={handleGroupStyleChange}
            />

            <div className="flex-1 min-w-0 relative overflow-hidden flex">
              <InfiniteCanvas
                canvas={canvas}
                isEditMode={isEditMode}
                collaborators={collaborators}
                backgroundStyle={backgroundStyle}
                backgroundColor={effectiveBgColor}
                patternColor={effectivePatternColor}
                cornerStyle={cornerStyle}
                fontStyle={fontStyle}
                playState={playState}
                onPlayStateChange={setPlayState}
                onSelectedGroupChange={handleSelectedGroupChange}
                onExpandedEditorStateChange={setExpandedEditorState}
                onCanvasChange={(newCanvas) => {
                  setCanvasState(newCanvas);
                }}
                onGetAvailableCanvases={handleGetAvailableCanvases}
                onCreateCanvas={handleCreateLinkedCanvas}
                onCanvasExists={handleCanvasExists}
                onCanvasNavigate={handleCanvasNavigate}
                onRefreshThumbnail={handleRefreshThumbnail}
                openExpandedEditorRequestId={expandedEditorOpenRequestId}
                openExpandedEditorNodeId={selectedExpandableNodeId}
              />
              {showPlaybackMenu && (
                <PlaybackPanel
                  canvas={canvas}
                  playState={playState}
                  onPlayStateChange={(state) => {
                    if (state === 'play') setPlayState('playing');
                    else if (state === 'pause') setPlayState('paused');
                    else { setPlayState('idle'); setShowPlaybackMenu(false); }
                  }}
                  onClose={() => setShowPlaybackMenu(false)}
                  backgroundStyle={backgroundStyle}
                  backgroundColor={backgroundColor}
                />
              )}
              {showCodeEditor && (
                <div className="absolute z-[52]" style={{ left: 20, top: 80, width: 560, height: 'calc(100% - 160px)' }}>
                  <div className="absolute inset-0 rounded-xl border bg-background/70 backdrop-blur-sm" />
                  <div className="relative h-full">
                    <FloatingEditorPanel
                      isVisible={true}
                      onClose={() => setShowCodeEditor(false)}
                      canvasData={canvas}
                      selectedNode={selectedNodes?.[0] || null}
                      onCanvasDataChange={(newData) => setCanvasState(newData)}
                      onNodeContentChange={(nodeId, content) => updateNode(nodeId, { content })}
                    />
                  </div>
                </div>
              )}

              {isMobileView && !mobileRightPanelOpen && (
                <button
                  type="button"
                  className="absolute right-3 top-3 z-[53] inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/85 text-foreground shadow-md backdrop-blur-sm"
                  aria-label="Open side panel"
                  onClick={() => openMobileRightPanel('ai')}
                >
                  <PanelRight className="h-4 w-4" />
                </button>
              )}

              {isMobileView && (
                <Sheet open={mobileRightPanelOpen} onOpenChange={setMobileRightPanelOpen}>
                  <SheetContent
                    side="bottom"
                    className="h-[72vh] max-h-[calc(100vh-80px)] rounded-t-3xl border-t border-border bg-background/95 backdrop-blur-sm p-0 gap-0"
                  >
                    <SheetHeader className="px-4 pb-2 pt-4">
                      <SheetTitle className="text-sm font-semibold">Workspace Side Panel</SheetTitle>
                    </SheetHeader>
                    <div className="flex-1 overflow-hidden px-3 pb-3 pt-1">
                      <div
                        className="h-full rounded-[var(--canvas-panel-radius)] border border-border/60 bg-card overflow-hidden"
                      >
                        <CanvasAIPanel
                          canvasId={canvasId || currentFileId || canvas.id}
                          className="h-full"
                          contextMode={aiContextMode}
                          contextNodeId={expandedEditorState.nodeId}
                          onClosePanel={() => setMobileRightPanelOpen(false)}
                        />
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>
              )}

              <CanvasLoadingOverlay
                visible={overlayVisible}
                title={overlayTitle}
                status={overlayStatus}
                message={overlayMessage}
                onRetry={handleRetryNoCache}
                onClearLocal={handleClearLocalState}
                busy={retryBusy}
              />
            </div>
          </div>
        </div>

        {!isMobileView && (
          <div
            className="pointer-events-none absolute inset-y-1.5 right-1.5 z-[56]"
            style={{ width: desktopPanelWidth }}
          >
            <aside
              className={`pointer-events-auto absolute inset-y-0 right-0 flex h-full flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm transform-gpu transition-transform duration-[340ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                desktopPanelOpen
                  ? 'translate-x-0'
                  : 'translate-x-[calc(100%+12px)] pointer-events-none'
              }`}
              style={{ width: desktopPanelWidth }}
              aria-hidden={!desktopPanelOpen}
            >
              <div
                className="absolute inset-y-0 left-0 z-20 w-2 -translate-x-1 cursor-col-resize touch-none"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize right panel"
                onPointerDown={handleRightPanelResizeStart}
              >
                <div className="mx-auto h-full w-px bg-border/40 transition-colors hover:bg-primary/50" />
              </div>

              <div className="min-h-0 flex-1 px-2 pb-2 pt-1">
                <div
                  className="h-full overflow-hidden rounded-[var(--canvas-panel-radius)] bg-card"
                >
                  <CanvasAIPanel
                    canvasId={canvasId || currentFileId || canvas.id}
                    className="h-full"
                    contextMode={aiContextMode}
                    contextNodeId={expandedEditorState.nodeId}
                    onClosePanel={() => setDesktopRightPanelCollapsed(true)}
                  />
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>

      {showOutline && (
        <OutlineView
          canvas={canvas}
          onNodeSelect={handleOutlineNodeSelect}
          onClose={() => setShowOutline(false)}
          onOutlineToggle={(open) => {
            try { useCanvasStore.getState().updateViewState?.({ outlineOpen: open }); } catch {}
          }}
        />
      )}
      {showDraftRecovery && (
        <RestoreDraftModal
          isOpen={showDraftRecovery}
          savedAt={draftRecovery?.savedAt}
          onRestore={handleRestoreDraft}
          onDiscard={handleDiscardDraft}
        />
      )}
      <AlertDialog
        open={switchConfirmOpen}
        onOpenChange={(open) => {
          if (!open) handleCancelCanvasSwitch();
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
            <AlertDialogCancel onClick={handleCancelCanvasSwitch}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmCanvasSwitch}>
              停止并切换
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CanvasEditor;
