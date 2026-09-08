'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Play, Pause, Square, X } from 'lucide-react';
import { SiteHeader } from '@/components/thread/thread-site-header';
import dynamic from 'next/dynamic';
const InfiniteCanvas = dynamic(() => import('@/canvas/components/core/InfiniteCanvas'), { ssr: false });
const CanvasAIPanel = dynamic(() => import('@/canvas/components/panels/CanvasAIPanel'), { ssr: false });
import { DEFAULT_NODE_SIZES, type Canvas } from '@/types/canvas';
import { safeJsonParse } from '@/components/thread/utils';
import { extractToolName } from '@/components/thread/tool-views/xml-parser';
import { BACKGROUND_STYLES } from '@/canvas/constants/backgroundStyles';
import { CORNER_STYLES, DEFAULT_CORNER_STYLE } from '@/canvas/constants/cornerStyles';
import { DEFAULT_FONT_STYLE } from '@/canvas/utils/canvasUtils';
import { mapBackgroundColorForTheme, mapPatternColorForTheme } from '@/canvas/utils/themeColorMapping';
import { FONT_STYLES as PRESET_FONT_STYLES } from '@/canvas/components/shared/controls/selectors/FontSelector';
import canvasViewStateService from '@/canvas/services/canvas-view-state.service';
import OutlineView from '@/canvas/components/shared/OutlineView';
import { useCanvasStore } from '@/canvas/stores/canvas.store';
import { useTheme } from 'next-themes';
import { useLocale } from 'next-intl';

type Params = Promise<{ canvasId: string }>; // Next 15+ style

interface MessageRow {
  message_id: string;
  thread_id: string;
  type: string;
  is_llm_message?: boolean;
  content: any;
  metadata?: any;
  created_at?: string;
  updated_at?: string;
}

const toFiniteNumber = (value: unknown, fallback: number): number => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getDocNodesCount = (value: unknown): number => {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return 0;
  return value.nodes.length;
};

const getDocUpdatedAt = (value: unknown): number => {
  if (!isRecord(value)) return 0;
  const ts = Number(value.updatedAt);
  return Number.isFinite(ts) ? ts : 0;
};

const resolveDefaultNodeSize = (node: any, nodeType: string): { width: number; height: number } => {
  switch (nodeType) {
    case 'text':
      return DEFAULT_NODE_SIZES.text;
    case 'todo':
      return DEFAULT_NODE_SIZES.todo;
    case 'column':
      return DEFAULT_NODE_SIZES.column;
    case 'table':
      return DEFAULT_NODE_SIZES.table;
    case 'canvas-link':
      return DEFAULT_NODE_SIZES['canvas-link'];
    case 'media':
      return DEFAULT_NODE_SIZES.media;
    case 'code': {
      const codeType = typeof node?.codeType === 'string' ? node.codeType.toLowerCase() : '';
      if (codeType === 'mermaid') return DEFAULT_NODE_SIZES.mermaid;
      if (codeType === 'html') return DEFAULT_NODE_SIZES.html;
      if (codeType === 'svg') return DEFAULT_NODE_SIZES.svg;
      return { width: 320, height: 180 };
    }
    default:
      return { width: 320, height: 180 };
  }
};

const chooseBestPublicDoc = (
  snapshotCandidate: unknown,
  rowCandidate: unknown,
): { raw: Record<string, any>; source: 'snapshot' | 'row' } => {
  const rowDoc = isRecord(rowCandidate) ? rowCandidate : {};
  const snapshotDoc = isRecord(snapshotCandidate) ? snapshotCandidate : null;
  if (!snapshotDoc) return { raw: rowDoc, source: 'row' };
  const snapshotNodes = getDocNodesCount(snapshotDoc);
  const rowNodes = getDocNodesCount(rowDoc);
  const snapshotHasNodes = snapshotNodes > 0;
  const rowHasNodes = rowNodes > 0;
  const snapshotUpdatedAt = getDocUpdatedAt(snapshotDoc);
  const rowUpdatedAt = getDocUpdatedAt(rowDoc);

  if (snapshotHasNodes && !rowHasNodes) return { raw: snapshotDoc, source: 'snapshot' };
  if (!snapshotHasNodes && rowHasNodes) {
    if (snapshotUpdatedAt > 0 && rowUpdatedAt > 0 && snapshotUpdatedAt >= rowUpdatedAt) {
      // Snapshot can legitimately be empty if the public canvas was just cleared.
      return { raw: snapshotDoc, source: 'snapshot' };
    }
    return { raw: rowDoc, source: 'row' };
  }
  if (snapshotUpdatedAt >= rowUpdatedAt) return { raw: snapshotDoc, source: 'snapshot' };
  return { raw: rowDoc, source: 'row' };
};

const CANVAS_EXISTS_CACHE_TTL_MS = 60_000;

class ShareCanvasErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ShareCanvas] Render error boundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-full items-center justify-center px-6 text-sm text-destructive">
          Failed to render this shared canvas. Please refresh the page.
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ShareCanvasPage({ params }: { params: Params }) {
  const unwrapped = React.use(params);
  const canvasId = unwrapped.canvasId;
  const supabase = useMemo(() => createClient(), []);

  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState<boolean>(false);
  const [timelineEnabled, setTimelineEnabled] = useState<boolean>(false);
  const [rightPanelWidth, setRightPanelWidth] = useState<string>('0px');
  const [aiPanelOpen, setAiPanelOpen] = useState<boolean>(false);
  const [showOutline, setShowOutline] = useState(false);
  const setPersistenceDisabled = useCanvasStore((s) => s.setPersistenceDisabled);
  const { resolvedTheme } = useTheme();
  const [canvasPlayState, setCanvasPlayState] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [showPlaybackPanel, setShowPlaybackPanel] = useState<boolean>(false);
  const hideTimerRef = useRef<number | null>(null);
  const [uiHidden, setUiHidden] = useState<boolean>(false);
  const locale = useLocale();
  // Theme readiness to avoid initial mismatch flashes on client hydration
  const [themeMounted, setThemeMounted] = useState(false);
  useEffect(() => { setThemeMounted(true); }, []);
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('view') === 'outline') setShowOutline(true);
    } catch {}
  }, []);
  // ===== Timeline (versions) playback state =====
  const originalCanvasRef = useRef<Canvas | null>(null);
  type Frame = { doc: Canvas; ts: number };
  const publicFramesRef = useRef<Frame[]>([]);
  const timelineTimerRef = useRef<number | null>(null);
  const timelineIdxRef = useRef<number>(0);
  const [timelinePlaying, setTimelinePlaying] = useState<boolean>(false);
  const [timelineLoading, setTimelineLoading] = useState<boolean>(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [hudInfo, setHudInfo] = useState<{ title: string; time?: string } | null>(null);
  // Progress position (current frame index)
  const [timelinePos, setTimelinePos] = useState<number>(0);
  // Playback speed (multiplier): 0.5x, 1x, 1.5x, 2x
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const speedRef = useRef<number>(1);
  useEffect(() => { speedRef.current = playbackSpeed; }, [playbackSpeed]);
  // Bottom panel auto-hide
  const [panelHidden, setPanelHidden] = useState<boolean>(false);
  const panelHideTimerRef = useRef<number | null>(null);
  // Progress bar interactions (click/drag seek)
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const wasPlayingRef = useRef<boolean>(false);
  const canvasExistsCacheRef = useRef<Map<string, { exists: boolean; ts: number }>>(new Map());

  useEffect(() => {
    try {
      if (timelineTimerRef.current) {
        window.clearTimeout(timelineTimerRef.current);
        timelineTimerRef.current = null;
      }
    } catch {}
    originalCanvasRef.current = null;
    publicFramesRef.current = [];
    timelineIdxRef.current = 0;
    setTimelinePlaying(false);
    setTimelinePos(0);
    setHudInfo(null);
    setTimelineError(null);
  }, [canvasId]);

  const seekToClientX = (clientX: number) => {
    const frames = publicFramesRef.current;
    const el = progressBarRef.current;
    if (!el || !frames.length) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const idx = Math.round(ratio * (frames.length - 1));
    if (idx < 0 || idx >= frames.length) return;
    // Apply frame immediately
    try { timelineIdxRef.current = idx; } catch {}
    try { setTimelinePos(idx); } catch {}
    try {
      const frame = frames[idx];
      setCanvas(frame.doc);
      // update HUD (nearest previous message)
      try {
        const fts = frame.ts || Date.now();
        let nearest: MessageRow | null = null;
        if (messages && messages.length) {
          let lo = 0, hi = messages.length - 1, at = -1;
          const timeAt = (m: MessageRow) => { try { return m.created_at ? Date.parse(m.created_at) : 0; } catch { return 0; } };
          while (lo <= hi) { const mid = (lo + hi) >> 1; const t = timeAt(messages[mid]); if (t <= fts) { at = mid; lo = mid + 1; } else { hi = mid - 1; } }
          nearest = at >= 0 ? messages[at] : null;
        }
        if (nearest) {
          let title = 'AI 更新';
          if (nearest.type === 'assistant') {
            let toolName = 'assistant';
            try {
              const parsed = safeJsonParse<{ content?: string; tool_calls?: Array<{ function?: { name?: string }; name?: string }> }>(typeof nearest.content === 'string' ? nearest.content : JSON.stringify(nearest.content || {}), {});
              const fromXml = parsed.content ? extractToolName(parsed.content) : null;
              if (fromXml) toolName = fromXml; else if (parsed.tool_calls && parsed.tool_calls.length > 0) {
                const raw = parsed.tool_calls[0].function?.name || parsed.tool_calls[0].name || 'assistant';
                toolName = raw.replace(/_/g, '-').toLowerCase();
              }
            } catch {}
            title = `Assistant planned ${toolName}`;
          } else if (nearest.type === 'tool') {
            title = 'Canvas updated';
          } else if (nearest.type === 'user') {
            try { const parsed = safeJsonParse<{ content?: string }>(typeof nearest.content === 'string' ? nearest.content : JSON.stringify(nearest.content || {}), {}); title = parsed.content || 'User'; } catch { title = 'User'; }
          }
          setHudInfo({ title, time: nearest.created_at });
        } else { setHudInfo(null); }
      } catch { setHudInfo(null); }
    } catch {}
  };
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);

  const onSharedCanvasExists = React.useCallback(async (targetCanvasId: string) => {
    const id = String(targetCanvasId || '').trim();
    if (!id) return false;
    if (id === canvasId) return true;
    const now = Date.now();
    const cached = canvasExistsCacheRef.current.get(id);
    if (cached && now - cached.ts <= CANVAS_EXISTS_CACHE_TTL_MS) {
      return cached.exists;
    }
    try {
      const { data, error } = await supabase
        .from('canvases')
        .select('id,is_public,is_deleted')
        .eq('id', id)
        .limit(1);
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : (data as any);
      const exists = Boolean(row?.id) && Boolean(row?.is_public) && !Boolean(row?.is_deleted);
      canvasExistsCacheRef.current.set(id, { exists, ts: now });
      return exists;
    } catch {
      try {
        const resp = await fetch(`/api/public/canvases/${encodeURIComponent(id)}/snapshot`, { cache: 'no-store' });
        const exists = resp.ok;
        canvasExistsCacheRef.current.set(id, { exists, ts: now });
        return exists;
      } catch {
        // Network uncertainty should not mark links as broken.
        return true;
      }
    }
  }, [canvasId, supabase]);



  const canvasBackgroundColor = typeof (canvas as any)?.backgroundColor === 'string'
    ? (canvas as any).backgroundColor
    : undefined;
  const canvasPatternColor = typeof (canvas as any)?.patternColor === 'string'
    ? (canvas as any).patternColor
    : undefined;

  const effectiveBgColor = useMemo(() => {
    if (!themeMounted) {
      // Keep persisted/raw color before theme is mounted to avoid wrong flash
      const raw = canvasBackgroundColor;
      if (typeof raw === 'string' && raw.trim()) return raw;
      return resolvedTheme === 'dark' ? '#232628' : '#EBEBEB';
    }
    const target: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light';
    return mapBackgroundColorForTheme(canvasBackgroundColor, target);
  }, [themeMounted, canvasBackgroundColor, resolvedTheme]);
  const effectivePatternColor = useMemo(() => {
    if (!themeMounted) {
      const raw = canvasPatternColor;
      if (typeof raw === 'string' && raw.trim()) return raw;
      return resolvedTheme === 'dark' ? '#4A5D4F' : '#C9A889';
    }
    const target: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light';
    return mapPatternColorForTheme(canvasPatternColor, target);
  }, [themeMounted, canvasPatternColor, resolvedTheme]);

  // Global UI hide in sync with inactivity (3s), consistent with playback panel behavior
  useEffect(() => {
    const updateHtmlClass = (hide: boolean) => {
      try {
        if (hide) document.documentElement.classList.add('playback-ui-hidden');
        else document.documentElement.classList.remove('playback-ui-hidden');
      } catch {}
    };

    if (canvasPlayState === 'playing') {
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
      if (hideTimerRef.current) { window.clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
      setUiHidden(false);
      try { document.documentElement.classList.remove('playback-ui-hidden'); } catch {}
    }
  }, [canvasPlayState]);

  // Keep ToolModeSelector visible by shifting it left when the AI panel is visible on md+ screens
  useEffect(() => {
    const updateWidth = () => {
      try {
        const isMdUp = typeof window !== 'undefined' ? window.innerWidth >= 768 : true;
        setRightPanelWidth(aiPanelOpen && isMdUp ? '420px' : '0px');
      } catch {
        setRightPanelWidth(aiPanelOpen ? '420px' : '0px');
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [aiPanelOpen]);

  useEffect(() => {
    // 禁用持久化，防止分享页写入/创建画布
    try { setPersistenceDisabled(true); } catch {}
    return () => { try { setPersistenceDisabled(false); } catch {} };
  }, [setPersistenceDisabled]);

  useEffect(() => {
    return () => {
      try {
        if (hideTimerRef.current) { window.clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
        if (timelineTimerRef.current) { window.clearTimeout(timelineTimerRef.current); timelineTimerRef.current = null; }
        if (panelHideTimerRef.current) { window.clearTimeout(panelHideTimerRef.current); panelHideTimerRef.current = null; }
      } catch {}
      try { document.documentElement.classList.remove('playback-ui-hidden'); } catch {}
    };
  }, []);

  // ===== Timeline (versions) playback helpers (public) =====
  const stopTimeline = React.useCallback(() => {
    try { if (timelineTimerRef.current) { window.clearTimeout(timelineTimerRef.current); timelineTimerRef.current = null; } } catch {}
    setTimelinePlaying(false);
    setTimelineError(null);
    // restore original canvas snapshot
    if (originalCanvasRef.current) {
      setCanvas(originalCanvasRef.current);
    }
    setHudInfo(null);
    setTimelinePos(0);
  }, []);

  const stepTimeline = React.useCallback(() => {
    if (!publicFramesRef.current.length) { setTimelinePlaying(false); return; }
    const i = timelineIdxRef.current;
    const nextFrame = publicFramesRef.current[i];
    setCanvas(nextFrame.doc);
    setTimelinePos(i);
    // Update HUD to nearest previous AI message
    try {
      const fts = nextFrame.ts || Date.now();
      // find last message with created_at <= frame.ts
      let nearest: MessageRow | null = null;
      if (messages && messages.length) {
        // binary search over sorted messages by created_at
        let lo = 0, hi = messages.length - 1, idx = -1;
        const timeAt = (m: MessageRow) => { try { return m.created_at ? Date.parse(m.created_at) : 0; } catch { return 0; } };
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const t = timeAt(messages[mid]);
          if (t <= fts) { idx = mid; lo = mid + 1; } else { hi = mid - 1; }
        }
        nearest = idx >= 0 ? messages[idx] : null;
      }
      if (nearest) {
        let title = 'AI 更新';
        if (nearest.type === 'assistant') {
          let toolName = 'assistant';
          try {
            const parsed = safeJsonParse<{ content?: string; tool_calls?: Array<{ function?: { name?: string }; name?: string }> }>(typeof nearest.content === 'string' ? nearest.content : JSON.stringify(nearest.content || {}), {});
            const fromXml = parsed.content ? extractToolName(parsed.content) : null;
            if (fromXml) toolName = fromXml; else if (parsed.tool_calls && parsed.tool_calls.length > 0) {
              const raw = parsed.tool_calls[0].function?.name || parsed.tool_calls[0].name || 'assistant';
              toolName = raw.replace(/_/g, '-').toLowerCase();
            }
          } catch {}
          title = `Assistant planned ${toolName}`;
        } else if (nearest.type === 'tool') {
          title = 'Canvas updated';
        } else if (nearest.type === 'user') {
          try {
            const parsed = safeJsonParse<{ content?: string }>(typeof nearest.content === 'string' ? nearest.content : JSON.stringify(nearest.content || {}), {});
            title = parsed.content || 'User';
          } catch { title = 'User'; }
        }
        setHudInfo({ title, time: nearest.created_at });
      } else {
        setHudInfo(null);
      }
    } catch { setHudInfo(null); }
    const next = i + 1;
    if (next >= publicFramesRef.current.length) {
      timelineIdxRef.current = 0;
      setTimelinePlaying(false);
      // Auto-hide the bottom controls when playback completes
      setShowPlaybackPanel(false);
      setHudInfo(null);
      return;
    }
    timelineIdxRef.current = next;
    try {
      const base = 900; // base frame interval in ms
      const interval = Math.max(120, Math.round(base / (speedRef.current || 1)));
      timelineTimerRef.current = window.setTimeout(() => stepTimeline(), interval);
    } catch {}
  }, [messages, setCanvas]);

  const startTimeline = React.useCallback(async () => {
    if (!canvasId) return;
    if (timelinePlaying || timelineLoading) return;
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      // preserve original
      if (!originalCanvasRef.current && canvas) originalCanvasRef.current = canvas;
      // prefer event timeline with doc_after snapshots; fallback to versions
      let frames: Frame[] = [];
      try {
        const tResp = await fetch(`/api/public/canvases/${encodeURIComponent(canvasId)}/timeline?order_direction=asc&limit=500`);
        if (tResp.ok) {
          const events: Array<{ doc_after?: Canvas; created_at?: number }> = await tResp.json();
          const mapped = (events || [])
            .map(e => ({ doc: e.doc_after as Canvas, ts: typeof e.created_at === 'number' ? e.created_at : Date.now() }))
            .filter(f => !!f.doc) as Frame[];
          if (mapped.length > 0) frames = mapped;
        }
      } catch {}
      if (frames.length === 0) {
        const vResp = await fetch(`/api/public/canvases/${encodeURIComponent(canvasId)}/versions?order_direction=asc`);
        if (!vResp.ok) throw new Error(`Failed to fetch versions: ${vResp.status}`);
        const versions: Array<{ version_data: Canvas; created_at?: number }> = await vResp.json();
        frames = (versions || [])
          .map(v => ({ doc: v.version_data as Canvas, ts: typeof v.created_at === 'number' ? v.created_at : Date.now() }))
          .filter(f => !!f.doc) as Frame[];
      }
      if (frames.length === 0) throw new Error('No timeline frames available');
      publicFramesRef.current = frames;
      timelineIdxRef.current = 0;
      setTimelinePos(0);
      setTimelinePlaying(true);
      stepTimeline();
    } catch (e: any) {
      console.warn('[ShareCanvas] Timeline playback failed:', e);
      const msg = (e && e.message) ? String(e.message) : 'No timeline frames available';
      setTimelineError(msg);
    } finally {
      setTimelineLoading(false);
    }
  }, [canvasId, canvas, timelinePlaying, timelineLoading, stepTimeline]);

  // Local auto-hide for the bottom panel when playing
  useEffect(() => {
    if (!showPlaybackPanel || !timelinePlaying) {
      if (panelHideTimerRef.current) { window.clearTimeout(panelHideTimerRef.current); panelHideTimerRef.current = null; }
      setPanelHidden(false);
      return;
    }
    const schedule = () => {
      if (panelHideTimerRef.current) window.clearTimeout(panelHideTimerRef.current);
      panelHideTimerRef.current = window.setTimeout(() => setPanelHidden(true), 3000);
    };
    const onInteract = () => { setPanelHidden(false); schedule(); };
    schedule();
    document.addEventListener('mousemove', onInteract);
    document.addEventListener('keydown', onInteract);
    document.addEventListener('touchstart', onInteract);
    return () => {
      document.removeEventListener('mousemove', onInteract);
      document.removeEventListener('keydown', onInteract);
      document.removeEventListener('touchstart', onInteract);
      if (panelHideTimerRef.current) { window.clearTimeout(panelHideTimerRef.current); panelHideTimerRef.current = null; }
    };
  }, [showPlaybackPanel, timelinePlaying]);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      setLoading(true);
      setError(null);
      try {
        // 1) Canvas row
        const { data: cRows, error: cErr } = await supabase
          .from('canvases')
          .select('id,title,doc,version,created_at,updated_at,is_public,public_shows_timeline,timeline_enabled,is_deleted')
          .eq('id', canvasId)
          .limit(1);
        if (cErr) throw cErr;
        const cRow = Array.isArray(cRows) ? cRows[0] : cRows as any;
        if (!cRow) throw new Error('Canvas not found or not public');
        if (Boolean(cRow?.is_deleted)) throw new Error('Canvas not found or not public');
        const canUseTimeline = Boolean((cRow as any)?.public_shows_timeline) && Boolean((cRow as any)?.timeline_enabled);
        if (!cancelled) {
          setIsPublic(Boolean(cRow?.is_public));
          setTimelineEnabled(canUseTimeline);
        }

        let snapshotDoc: any = null;
        try {
          const snapshotResp = await fetch(
            `/api/public/canvases/${encodeURIComponent(canvasId)}/snapshot`,
            { cache: 'no-store' },
          );
          if (snapshotResp.ok) {
            snapshotDoc = await snapshotResp.json();
          }
        } catch {}

        const rowDoc = isRecord(cRow?.doc) ? cRow.doc : {};
        const rowDocForChoice = (
          isRecord(rowDoc) && typeof rowDoc.updatedAt === 'number'
            ? rowDoc
            : {
                ...rowDoc,
                updatedAt: cRow.updated_at ? Date.parse(cRow.updated_at) : 0,
              }
        );
        const chosen = chooseBestPublicDoc(snapshotDoc, rowDocForChoice);
        const raw: any = chosen.raw;
        if (process.env.NODE_ENV !== 'production' && chosen.source === 'row' && isRecord(snapshotDoc)) {
          console.warn('[ShareCanvas] Snapshot fallback to canvases.doc', {
            canvasId,
            snapshotNodes: getDocNodesCount(snapshotDoc),
            rowNodes: getDocNodesCount(rowDocForChoice),
            snapshotUpdatedAt: getDocUpdatedAt(snapshotDoc),
            rowUpdatedAt: getDocUpdatedAt(rowDocForChoice),
          });
        }
        const createdAt = typeof raw.createdAt === 'number'
          ? raw.createdAt
          : (cRow.created_at ? Date.parse(cRow.created_at) : Date.now());
        const updatedAt = typeof raw.updatedAt === 'number'
          ? raw.updatedAt
          : (cRow.updated_at ? Date.parse(cRow.updated_at) : Date.now());
        const nodes = Array.isArray(raw.nodes)
          ? raw.nodes
              .filter((node: any) => node && typeof node === 'object')
              .map((node: any, index: number) => {
                const type = typeof node.type === 'string' && node.type.trim()
                  ? node.type.trim()
                  : 'text';
                const defaults = resolveDefaultNodeSize(node, type);
                const width = toFiniteNumber(node.width, defaults.width);
                const height = toFiniteNumber(node.height, defaults.height);
                return {
                  ...node,
                  id: typeof node.id === 'string' && node.id.trim() ? node.id : `shared-node-${index}`,
                  type,
                  x: toFiniteNumber(node.x, 0),
                  y: toFiniteNumber(node.y, 0),
                  width: width > 0 ? width : defaults.width,
                  height: height > 0 ? height : defaults.height,
                  content: typeof node.content === 'string' ? node.content : '',
                };
              })
          : [];
        const connections = Array.isArray(raw.connections)
          ? raw.connections
              .filter((connection: any) => connection && typeof connection === 'object')
              .map((connection: any, index: number) => ({
                ...connection,
                id: typeof connection.id === 'string' && connection.id.trim()
                  ? connection.id
                  : `shared-connection-${index}`,
              }))
          : [];

        const c: Canvas = {
          id: raw.id || cRow.id,
          title: typeof raw.title === 'string'
            ? raw.title
            : (typeof cRow.title === 'string' ? cRow.title : 'Untitled'),
          nodes,
          connections,
          groups: Array.isArray(raw.groups) ? raw.groups : undefined,
          createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
          version: typeof raw.version === 'string'
            ? raw.version
            : (typeof cRow.version === 'string' ? cRow.version : '1.0.0'),
          folderId: raw.folderId ?? null,
          cornerStyle: raw.cornerStyle,
          fontStyle: raw.fontStyle,
          backgroundColor: raw.backgroundColor,
          backgroundStyleId: raw.backgroundStyleId,
          patternColor: raw.patternColor,
        } as Canvas;
        // Always clear any persisted view for share page so we can fit-to-view on mount
        try { canvasViewStateService.clearView(c.id); } catch {}
        if (!cancelled) setCanvas(c);

        // 2) Find thread by canvas_id
        const { data: tRows } = await supabase
          .from('threads')
          .select('thread_id')
          .eq('canvas_id', canvasId)
          .limit(1);
        const tid = Array.isArray(tRows) && tRows.length > 0 ? tRows[0].thread_id : null;
        if (!cancelled) setThreadId(tid);

        // 3) Load messages in batches (no join to avoid extra RLS requirements)
        let all: MessageRow[] = [];
        if (tid && canUseTimeline) {
          const batchSize = 1000;
          let from = 0;
          let hasMore = true;
          while (hasMore) {
            const { data: mData, error: mErr } = await supabase
              .from('messages')
              .select('*')
              .eq('thread_id', tid)
              .neq('type', 'cost')
              .neq('type', 'summary')
              .order('created_at', { ascending: true })
              .range(from, from + batchSize - 1);
            if (mErr) throw mErr;
            const batch = (mData as any[]) || [];
            all = all.concat(batch as MessageRow[]);
            hasMore = batch.length === batchSize;
            from += batchSize;
            if (cancelled) break;
          }
        }
        if (!cancelled) setMessages(all);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load shared canvas');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAll();
    return () => { cancelled = true; };
  }, [canvasId, supabase]);

  if (loading) {
    return (
      <div className="flex flex-col h-screen">
        <SiteHeader projectName="Shared Canvas" onViewFiles={() => {}} onToggleSidePanel={() => setAiPanelOpen((v) => !v)} onToggleOutline={() => setShowOutline((v) => !v)} variant="shared" published={isPublic} />
        <div className="flex flex-1 items-center justify-center">Loading...</div>
      </div>
    );
  }

  if (error || !canvas) {
    return (
      <div className="flex flex-col h-screen">
        <SiteHeader projectName="Shared Canvas" onViewFiles={() => {}} onToggleSidePanel={() => setAiPanelOpen((v) => !v)} onToggleOutline={() => setShowOutline((v) => !v)} variant="shared" published={isPublic} />
        <div className="flex flex-1 items-center justify-center text-destructive">{error || 'Canvas not available'}</div>
      </div>
    );
  }

  return (
    <ShareCanvasErrorBoundary>
      <div className="flex flex-col h-screen">
      <SiteHeader
        projectName={canvas.title || 'Shared Canvas'}
        onViewFiles={() => {}}
        onToggleSidePanel={() => setAiPanelOpen((v) => !v)}
        onToggleOutline={() => setShowOutline((v) => !v)}
        variant="shared"
        published={isPublic}
        showThemeToggle={true}
        centerTitle={true}
        showPlayback={true}
        isPlaying={canvasPlayState === 'playing'}
        onTogglePlayback={() => {
          setCanvasPlayState((prev) => (prev === 'playing' ? 'paused' : 'playing'));
        }}
        onRequestOpenPlaybackMenu={() => {
          setShowPlaybackPanel(true);
          // Auto-start timeline playback when opening via magic icon
          if (!timelinePlaying && !timelineLoading) {
            startTimeline();
          }
        }}
      />
      <div className="flex flex-1 overflow-hidden relative">
        <div
          className="flex-1 overflow-hidden relative"
          style={{ ['--ai-panel-width' as any]: rightPanelWidth }}
        >
          {/* Read-only canvas view: allow zoom/pan/playback interactions; editing is disabled at the app level */}
          <div className="w-full h-full" ref={canvasContainerRef}>
            <InfiniteCanvas
              canvas={canvas}
              enablePlayback={true}
              readOnly={true}
              // Open canvas-link targets in a new tab from the shared view
              onCanvasNavigate={(targetCanvasId) => {
                const base = `/share/canvas/${encodeURIComponent(targetCanvasId)}`;
                const href = locale === 'zh' ? `/zh${base}` : base;
                try { window.open(href, '_blank', 'noopener'); } catch {}
              }}
              onCanvasExists={onSharedCanvasExists}
              // 读取持久化的全局样式；字段缺失时回退到主题默认
              backgroundStyle={
                (BACKGROUND_STYLES.find(s => s.id === (canvas as any)?.backgroundStyleId) || BACKGROUND_STYLES[0])
              }
              backgroundColor={effectiveBgColor}
              patternColor={effectivePatternColor}
              // Preserve formatting from the canvas document when available
              fontStyle={(PRESET_FONT_STYLES.find(f => f.id === (canvas as any)?.fontStyle) || DEFAULT_FONT_STYLE) as any}
              cornerStyle={(CORNER_STYLES.find(c => c.id === (canvas as any)?.cornerStyle) || DEFAULT_CORNER_STYLE) as any}
              playState={canvasPlayState}
              onPlayStateChange={(state) => {
                setCanvasPlayState(state);
                if (state === 'idle') {
                  setShowPlaybackPanel(false);
                }
              }}
            />
          </div>
          {/* Bottom icon-only timeline controls (+ message markers & HUD) */}
          {showPlaybackPanel && (
            <div className={`absolute inset-x-0 bottom-3 z-[52] flex items-center justify-center transition-opacity duration-200 ${panelHidden ? 'opacity-0 pointer-events-none translate-y-1' : 'opacity-100'}`}>
              <div className="flex flex-col items-center gap-2 rounded-xl border bg-background/85 backdrop-blur-md px-3 py-2 shadow-sm">
                {/* Mini progress with AI message markers */}
                {(() => {
                  const frames = publicFramesRef.current;
                  const msgs = messages || [];
                  if (!frames.length) return null;
                  const minTs = frames[0].ts;
                  const maxTs = frames[frames.length - 1].ts || (minTs + 1);
                  const span = Math.max(1, maxTs - minTs);
                  const markers = msgs
                    .map(m => {
                      try { const t = m.created_at ? Date.parse(m.created_at) : 0; return t; } catch { return 0; }
                    })
                    .filter(t => t >= minTs && t <= maxTs);

                  const progressPct = frames.length > 1 ? Math.min(100, Math.max(0, (timelinePos / (frames.length - 1)) * 100)) : 0;

                  return (
                    <div
                      ref={progressBarRef}
                      className="w-56 h-1.5 relative rounded-full bg-muted overflow-hidden"
                      style={{ touchAction: 'none', cursor: 'pointer' }}
                      onPointerDown={(e) => {
                        try { if (timelineTimerRef.current) { window.clearTimeout(timelineTimerRef.current); timelineTimerRef.current = null; } } catch {}
                        wasPlayingRef.current = !!timelinePlaying;
                        isDraggingRef.current = true;
                        try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch {}
                        seekToClientX(e.clientX);
                        const onMove = (ev: PointerEvent) => { if (!isDraggingRef.current) return; seekToClientX(ev.clientX); };
                        const onUp = () => {
                          isDraggingRef.current = false;
                          window.removeEventListener('pointermove', onMove);
                          window.removeEventListener('pointerup', onUp);
                          // resume if was playing
                          if (wasPlayingRef.current) {
                            try { stepTimeline(); } catch {}
                          }
                        };
                        window.addEventListener('pointermove', onMove);
                        window.addEventListener('pointerup', onUp, { once: true });
                      }}
                    >
                      {/* progress fill */}
                      <div className="absolute inset-y-0 left-0 bg-primary/40" style={{ width: `${progressPct}%` }} />
                      {/* markers */}
                      {markers.map((t, i) => {
                        const pct = ((t - minTs) / span) * 100;
                        return (
                          <div key={i} className="absolute top-0 h-1.5" style={{ left: `${pct}%` }}>
                            <div className="w-0.5 h-1.5 bg-primary/70" />
                          </div>
                        );
                      })}
                      {/* knob: vertically centered inside the bar */}
                      <div className="absolute top-1/2 -translate-y-1/2" style={{ left: `calc(${progressPct}% - 3px)` }}>
                        <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-sm" />
                      </div>
                    </div>
                  );
                })()}
                <div className="flex items-center gap-2">
                  <button
                    className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted"
                    title={timelinePlaying ? 'Pause' : 'Play'}
                    aria-label={timelinePlaying ? 'Pause' : 'Play'}
                    onClick={() => {
                      if (timelinePlaying) {
                        if (timelineTimerRef.current) { clearTimeout(timelineTimerRef.current); timelineTimerRef.current = null; }
                        setTimelinePlaying(false);
                      } else {
                        startTimeline();
                      }
                    }}
                  >
                    {timelinePlaying ? (<Pause className="h-4 w-4" />) : (<Play className="h-4 w-4" />)}
                  </button>
                  {/* Speed toggle: cycles 0.5x -> 1x -> 1.5x -> 2x */}
                  <button
                    className="px-2 h-8 rounded-full flex items-center justify-center text-[11px] border hover:bg-muted"
                    title="Speed"
                    aria-label="Speed"
                    onClick={() => {
                      const next = (() => {
                        const order = [0.5, 1, 1.5, 2];
                        const idx = order.indexOf(playbackSpeed);
                        return order[(idx + 1) % order.length];
                      })();
                      setPlaybackSpeed(next);
                    }}
                  >
                    {`${playbackSpeed}x`}
                  </button>
                  <button
                    className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted"
                    title="Stop"
                    aria-label="Stop"
                    onClick={() => { stopTimeline(); setShowPlaybackPanel(false); }}
                  >
                    <Square className="h-4 w-4" />
                  </button>
                  <button
                    className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted"
                    title="Close"
                    aria-label="Close"
                    onClick={() => { stopTimeline(); setShowPlaybackPanel(false); }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {/* HUD: nearest message summary */}
                {hudInfo && (
                  <div className="text-[11px] text-muted-foreground mt-1 max-w-xs line-clamp-1">
                    {hudInfo.title}
                  </div>
                )}
              </div>
            </div>
          )}
          {/* Inline feedback for timeline errors (optional) */}
          {timelineEnabled && timelineError && (
            <div className="absolute left-1/2 -translate-x-1/2 bottom-16 z-[52] text-xs px-3 py-1 rounded bg-amber-100 text-amber-900 border border-amber-200">
              {timelineError}
            </div>
          )}
          {/* 右侧 AI 面板（只读，可切换） */}
          {aiPanelOpen && (
            <div
              className="absolute z-[51] hidden md:block playback-hideable"
              style={{ top: 0, right: '5px', bottom: '5px', width: '420px' }}
            >
              <div className="absolute inset-[2px]">
                <div className="h-full rounded-2xl overflow-hidden shadow-sm border bg-background/70 backdrop-blur-sm">
                  <CanvasAIPanel canvasId={canvas.id} className="h-full" readOnly={true} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {showOutline && canvas && (
        <OutlineView
          canvas={canvas}
          readOnly={true}
          onNodeSelect={() => setShowOutline(false)}
          onClose={() => setShowOutline(false)}
        />
      )}
      </div>
    </ShareCanvasErrorBoundary>
  );
}
