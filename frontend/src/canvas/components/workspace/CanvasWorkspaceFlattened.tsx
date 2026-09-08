'use client';

// 扁平化工作台：同一层网格中按列排布，用缩进表示层级

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { useTheme } from 'next-themes';
import {useTranslations, useFormatter, useLocale, useMessages} from 'next-intl';
import { Plus, FileText, Clock, Search, FolderPlus, Folder as FolderIcon, FolderOpen as FolderOpenIcon, Loader2, X } from 'lucide-react';
import { ChevronsUpDownIcon } from '../shared/toolbar/ChevronsUpDownIcon';
import { ChevronsDownUpIcon } from '../shared/toolbar/ChevronsDownUpIcon';
import { cn } from '@/lib/utils';

// Muted multi-hue palette used across workspace for visual consistency
const CARD_PALETTE_LIGHT = ['#97C7B5', '#9FBECB', '#AEC3CF', '#ADCABD', '#BBC8C3'];
const CARD_PALETTE_DARK  = ['#2F564E', '#315263', '#375668', '#385D52', '#3A5957'];

import type { Canvas } from '@/canvas/types/canvas';
import type { Folder } from '@/canvas/types/folder';
import type { GridItem } from '@/canvas/types/grid-item';

import { useCanvas } from '@/canvas/hooks/useCanvas';
import { useWorkspaceContextMenu } from '@/canvas/hooks/useWorkspaceContextMenu';
import { useWorkspaceContextMenu as useWorkspaceGeneralContextMenu } from '@/canvas/hooks/useWorkspaceGeneralContextMenu';
import { useFolderContextMenu } from '@/canvas/hooks/useFolderContextMenu';
import { buildGridItems, shouldShowDivider as shouldShowDividerUtil } from '@/canvas/utils/gridItemUtils';
import { useWorkspaceData } from '@/hooks/useWorkspaceData';
import { useWorkspaceMutations } from '@/hooks/react-query/workspace/use-workspace-mutations';
import useWorkspaceLauncherActions from '@/hooks/useWorkspaceLauncherActions';
import { useWorkspace } from '@/contexts/workspace-context';
import { buildCanvasPath } from '@/lib/workspace-path';
import { canvasCache } from '@/canvas/cache/canvas-cache';
import canvasSnapshotService from '@/canvas/services/canvas-snapshot.service';
import { useLocalExpandState } from '@/hooks/useLocalExpandState';
import { UnifiedContextMenu } from '@/components/ui/context-menu';
import UnifiedSearchPanel from '@/components/search/UnifiedSearchPanel';
import WorkspaceLauncherGuardDialog from '@/components/workspace/WorkspaceLauncherGuardDialog';

interface CanvasWorkspaceProps {
  className?: string;
  hideBackground?: boolean;
  maxWidthClass?: string; // align inner container width with input area (e.g., 'max-w-[784px]')
  gridClassName?: string; // override grid template for responsive columns
}

// 背景装饰（精简版：静态渐变 + 模糊，适配深浅色）
const BlurredCanvasBackground: React.FC = () => (
  <div className="absolute inset-0 overflow-hidden">
    {/* Light theme */}
    <div
      className="absolute inset-0 backdrop-blur-md dark:hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(249, 250, 245, 0.6) 0%, rgba(242, 243, 238, 0.7) 100%)',
        backdropFilter: 'blur(6px) saturate(120%)'
      }}
    />
    {/* Dark theme */}
    <div
      className="absolute inset-0 backdrop-blur-md hidden dark:block"
      style={{
        background: 'linear-gradient(135deg, rgba(35,38,40,0.6) 0%, rgba(24,26,27,0.7) 100%)',
        backdropFilter: 'blur(6px) saturate(120%)'
      }}
    />
  </div>
);

// 画布卡片（复用现有风格）
interface CanvasCardProps {
  canvas?: Canvas;
  isCreateNew?: boolean;
  onClick?: () => void;
  onHover?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  isEditing?: boolean;
  editingTitle?: string;
  onTitleChange?: (value: string) => void;
  onSaveRename?: () => void;
  onCancelRename?: () => void;
  isLoading?: boolean;
}

const CanvasCard: React.FC<CanvasCardProps> = ({
  canvas, isCreateNew, onClick, onContextMenu,
  isEditing, editingTitle, onTitleChange, onSaveRename, onCancelRename, isLoading, onHover
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const t = useTranslations();
  const format = useFormatter();
  const locale = useLocale();
  if (isCreateNew) {
    return (
      <div
        onClick={onClick}
        className="group relative rounded-xl border border-border bg-card p-8 transition-all duration-300 cursor-pointer min-h-[200px] flex items-center justify-center shadow-sm hover:shadow-md"
      >
        <div className="text-center">
          <div className="w-12 h-12 rounded-full mb-4 mx-auto flex items-center justify-center group-hover:scale-110 transition-transform bg-muted">
            <Plus className="w-6 h-6 text-foreground/80" />
          </div>
          <p className="font-medium text-foreground">{t('canvas.create', {default: 'Create New Canvas'})}</p>
          <p className="text-sm mt-1 text-muted-foreground">{t('canvas.blank', {default: 'Start with a blank canvas'})}</p>
        </div>
      </div>
    );
  }
  if (!canvas) return null;
  const nodeCount = typeof canvas.nodeCount === 'number'
    ? canvas.nodeCount
    : (canvas.nodes?.length || 0);
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onHover}
      className={cn(
        "group relative rounded-xl border border-border bg-card p-4 transition-all duration-300 cursor-pointer min-h-[180px] shadow-sm hover:shadow-md"
      )}
    >
      {isLoading && (
        <div className="absolute inset-0 z-20 bg-background/60 backdrop-blur-[1px] rounded-xl flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}
      <div className="mb-3 rounded-lg relative h-[88px] overflow-hidden bg-muted/40">
        {(() => {
          // Map node count to 1..7 layers for an intuitive density feel
          const layerCountFor = (n: number) => {
            if (n <= 0) return 0;
            if (n <= 10) return 1;
            if (n <= 20) return 2;
            if (n <= 40) return 3;
            if (n <= 70) return 4;
            if (n <= 110) return 5;
            if (n <= 160) return 6;
            return 7;
          };

          // Deterministic PRNG based on canvas id for stable layout
          const strHash = (s: string | undefined) => {
            if (!s) return 123456789;
            let h = 2166136261;
            for (let i = 0; i < s.length; i++) {
              h ^= s.charCodeAt(i);
              h = Math.imul(h, 16777619);
            }
            return h >>> 0;
          };
          const mulberry32 = (a: number) => {
            return () => {
              a |= 0; a = a + 0x6D2B79F5 | 0;
              let t = Math.imul(a ^ (a >>> 15), 1 | a);
              t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
              return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
          };

          const count = Math.min(layerCountFor(nodeCount), 5);
          if (count === 0) return null;

          const rng = mulberry32(strHash(canvas?.id));
          const primary = isDark ? '#2F5E35' : '#34D399';
          const secondary = isDark ? '#3A7F45' : '#10B981';
          const borderLight = 'rgba(0,0,0,0.04)';
          const borderDark = 'rgba(255,255,255,0.06)';

          const colors = isDark ? CARD_PALETTE_DARK : CARD_PALETTE_LIGHT;

          // Fan layout around horizontal center
          const fanMax = 18; // wider fan
          const spread = 30; // use more horizontal room
          const yBase = 6;   // start higher to use more vertical room

          // Equal-density layout across center: compute evenly spaced centers, then order center→sides
          const wMean = 46; // bigger cards (width %)
          const hMean = 58; // bigger cards (height %)
          const maxSpread = 50 - wMean / 2 - 2; // clamp to keep inside box
          const effSpread = Math.max(8, Math.min(spread, maxSpread));
          const centersSorted: number[] = [];
          if (count === 1) {
            centersSorted.push(50);
          } else {
            const step = (2 * effSpread) / (count - 1);
            for (let k = 0; k < count; k++) {
              centersSorted.push(50 - effSpread + k * step);
            }
          }

          const centerOutOrder = (n: number) => {
            const idxs: number[] = [];
            if (n <= 0) return idxs;
            if (n % 2 === 1) {
              const mid = (n - 1) >> 1;
              idxs.push(mid);
              for (let k = 1; idxs.length < n; k++) {
                idxs.push(mid - k);
                if (idxs.length < n) idxs.push(mid + k);
              }
            } else {
              const l = n / 2 - 1, r = l + 1;
              idxs.push(l, r);
              for (let k = 1; idxs.length < n; k++) {
                idxs.push(l - k);
                if (idxs.length < n) idxs.push(r + k);
              }
            }
            return idxs.filter(i => i >= 0 && i < n);
          };

          const order = centerOutOrder(count); // kept for potential future use (not used for painting order)

          // Paint strictly left → right so that rightmost is appended last (top-most layer)
          const items = Array.from({ length: count }).map((_, ci) => {
            const j = () => (rng() - 0.5) * 2; // [-1,1]
            const center = centersSorted[ci];

            // Bigger cards with slight size jitter
            const w = wMean + j() * 2.0; // ~46% ±2%
            const h = hMean + j() * 2.0; // ~58% ±2%

            // Horizontal position based on even spacing; minimal horizontal jitter to keep density equal
            let left = center - w / 2;
            // Vertical centering with slight downward bias and subtle stagger
            let top = (100 - h) / 2 + 1.2 + j() * 1.0 + ((ci % 3) - 1) * 0.6;

            // Angle: alternate by horizontal (x) order to ensure neighbors differ, with seed-based flip
            const seedFlip = ((strHash(canvas?.id) & 1) ? 1 : -1);
            const xIndex = ci; // centersSorted is ascending left→right
            const sign = seedFlip * (xIndex % 2 === 0 ? -1 : 1);
            // Unique amplitude across horizontal order to avoid duplicates
            const baseMin = 7, baseMax = 15;
            const denom = Math.max(1, count - 1);
            const amp = baseMin + (xIndex * (baseMax - baseMin)) / denom; // 8° .. 14°
            const angle = sign * (amp + j() * 1.2);

            // clamp
            const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
            left = clamp(left, 0, 100 - w);
            top  = clamp(top, 0, 100 - h);

            const color = colors[ci % colors.length];
            const opacity = Math.max(0.12, 0.2 - ci * 0.01);
            const lift = ci >= count - 2;
            return (
              <div
                key={ci}
                className={`absolute rounded-md transform-gpu transition-transform duration-200 ${lift ? 'group-hover:-translate-y-0.5' : ''}`}
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  width: `${w}%`,
                  height: `${h}%`,
                  transform: `rotate(${angle}deg)`,
                  backgroundColor: color,
                  opacity,
                  border: `1px solid ${isDark ? borderDark : borderLight}`,
                  boxShadow: isDark ? '0 1px 2px rgba(0,0,0,0.25)' : '0 1px 2px rgba(0,0,0,0.08)'
                }}
              />
            );
          });
          return items;
        })()}
      </div>
      <div className="flex items-center justify-between">
        {isEditing ? (
          <input
            value={editingTitle}
            onChange={(e) => onTitleChange?.(e.target.value)}
            onBlur={onSaveRename}
            onKeyDown={(e) => { if (e.key === 'Enter') onSaveRename?.(); if (e.key === 'Escape') onCancelRename?.(); }}
            autoFocus
            className="font-semibold mb-2 w-full bg-transparent border-b border-border focus:border-blue-500 focus:outline-none transition-colors text-foreground"
          />
        ) : (
          <h3 className="font-semibold mb-2 truncate transition-colors text-foreground">{canvas.title || t('canvas.untitled')}</h3>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="flex items-center text-xs text-muted-foreground"><FileText className="w-3 h-3 mr-1" />{t('workspace.nodes', {count: nodeCount})}</span>
        <span className="flex items-center text-xs text-muted-foreground"><Clock className="w-3 h-3 mr-1" />{format.dateTime(new Date(canvas.updatedAt || canvas.createdAt), {year:'numeric', month:'short', day:'numeric'})}</span>
      </div>
    </div>
  );
};

interface WorkspaceDocMetaItem {
  itemId: string;
  title: string;
  version: number;
  updatedAt: number;
}

interface DocCardProps {
  doc: WorkspaceDocMetaItem;
  onClick?: () => void;
  isLoading?: boolean;
}

const DocCard: React.FC<DocCardProps> = ({ doc, onClick, isLoading }) => {
  const t = useTranslations();
  const format = useFormatter();
  const messages = useMessages() as any;
  const hasDocUntitledMessage = Boolean(messages?.workspace?.doc?.untitled);
  const hasDocVersionMessage = Boolean(messages?.workspace?.doc?.version);
  return (
    <div
      onClick={onClick}
      className="group relative min-h-[180px] cursor-pointer rounded-xl border border-border bg-card p-4 shadow-sm transition-all duration-300 hover:shadow-md"
    >
      {isLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-background/60 backdrop-blur-[1px]">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}
      <div className="mb-3 flex h-[88px] items-center justify-center rounded-lg bg-muted/40">
        <FileText className="h-9 w-9 text-foreground/70" />
      </div>
      <h3 className="mb-2 truncate font-semibold text-foreground">
        {doc.title || (hasDocUntitledMessage ? t('workspace.doc.untitled') : 'Untitled Doc')}
      </h3>
      <div className="flex items-center justify-between">
        <span className="flex items-center text-xs text-muted-foreground">
          <FileText className="mr-1 h-3 w-3" />
          {hasDocVersionMessage
            ? t('workspace.doc.version', { version: doc.version })
            : `Version ${doc.version}`}
        </span>
        <span className="flex items-center text-xs text-muted-foreground">
          <Clock className="mr-1 h-3 w-3" />
          {format.dateTime(new Date(doc.updatedAt || Date.now()), { year: 'numeric', month: 'short', day: 'numeric' })}
        </span>
      </div>
    </div>
  );
};

// 文件夹卡片（和画布卡一致大小，双击切换；左上角chevrons可切换）
interface FolderCardProps {
  folder: Folder;
  isEditing: boolean;
  editingName: string;
  onNameChange: (v: string) => void;
  onToggle: () => void;
  onRenameStart: () => void;
  onRenameConfirm: () => void;
  onDelete: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  highlight?: boolean;
  isLoading?: boolean;
}

const FolderCard: React.FC<FolderCardProps> = ({
  folder,
  isEditing,
  editingName,
  onNameChange,
  onToggle,
  onRenameStart,
  onRenameConfirm,
  onDelete,
  onDragStart,
  highlight,
  isLoading,
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const childFolderCount = folder.childFolderIds?.length || 0;
  const canvasCount = folder.canvasIds?.length || 0;
  const totalChildren = childFolderCount + canvasCount;
  const t = useTranslations();
  const format = useFormatter();
  const updated = format.dateTime(new Date(folder.updatedAt || Date.now()), {year:'numeric', month:'short', day:'numeric'});
  const badgeColor = isDark ? CARD_PALETTE_DARK[1] : CARD_PALETTE_LIGHT[2];
  return (
    <div
      className="group relative bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer min-h-[180px]"
      style={{ backgroundColor: folder.isExpanded ? 'rgba(122, 140, 126, 0.08)' : undefined }}
      draggable
      onDragStart={onDragStart}
      onDoubleClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
      {isLoading && (
        <div className="absolute inset-0 z-20 bg-background/60 backdrop-blur-[1px] rounded-xl flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}
      {highlight && (
        <div className="absolute inset-0 rounded-xl pointer-events-none flex items-center justify-center bg-muted/40">
          <span className="text-xs px-2 py-1 rounded text-foreground bg-card border border-dashed border-border">
            {t('workspace.folder.release')}
          </span>
        </div>
      )}
      <div className="w-full h-[88px] bg-muted/30 rounded-lg mb-3 overflow-hidden relative">
        <div className="absolute inset-0 flex items-center justify-center">
          {folder.isExpanded ? (
            <FolderOpenIcon className="w-8 h-8" style={{ color: '#7A8C7E' }} />
          ) : (
            <FolderIcon className="w-8 h-8" style={{ color: '#7A8C7E' }} />
          )}
        </div>
        {totalChildren > 0 && (
          <div className="absolute top-2 right-2 text-foreground text-xs rounded-full w-6 h-6 flex items-center justify-center font-semibold bg-muted">
            {totalChildren > 99 ? '99+' : totalChildren}
          </div>
        )}
        {folder.isExpanded && (
          <div className="absolute bottom-2 left-2 text-white text-xs px-2 py-1 rounded-full font-medium" style={{ backgroundColor: '#5C6B5F' }}>
            {t('workspace.folder.expanded')}
          </div>
        )}
      </div>

      <div className="flex items-start justify-between mb-2">
        {isEditing ? (
          <input
            value={editingName}
            onChange={(e) => onNameChange(e.target.value)}
            onBlur={onRenameConfirm}
            onKeyDown={(e) => { if (e.key === 'Enter') onRenameConfirm(); }}
            autoFocus
            className="font-semibold mb-2 w-full bg-transparent border-b border-border focus:border-blue-500 focus:outline-none transition-colors text-foreground"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <h3 className="font-semibold mb-2 truncate transition-colors text-foreground">
            {folder.name || t('workspace.folder.new')}
          </h3>
        )}
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button className="text-xs px-2 py-1 border rounded hover:bg-muted/40" onClick={(e) => { e.stopPropagation(); onRenameStart(); }}>{t('workspace.folder.rename')}</button>
          <button className="text-xs px-2 py-1 border rounded hover:bg-muted/40" onClick={(e) => { e.stopPropagation(); onDelete(); }}>{t('workspace.folder.delete')}</button>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
        <span>{t('workspace.folder.items', {count: totalChildren})}</span>
        <span className="text-xs text-muted-foreground">{updated}</span>
      </div>

      <div className="absolute top-2 left-2 text-muted-foreground opacity-80" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
        {folder.isExpanded ? <ChevronsDownUpIcon size={16} /> : <ChevronsUpDownIcon size={16} />}
      </div>
    </div>
  );
};

// 扁平化工作台主组件
const CanvasWorkspaceFlattened: React.FC<CanvasWorkspaceProps> = ({ className = '', hideBackground = false, maxWidthClass = 'max-w-6xl', gridClassName }) => {
  const t = useTranslations();
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  // Inline search input focus management
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (showSearch) {
      setTimeout(() => {
        try { searchInputRef.current?.focus(); } catch {}
      }, 0);
    }
  }, [showSearch]);
  const [editingCanvasId, setEditingCanvasId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [movingCanvasId, setMovingCanvasId] = useState<string | null>(null);
  const [movingTargetFolderId, setMovingTargetFolderId] = useState<string | null>(null);
  const [movingFolderSourceId, setMovingFolderSourceId] = useState<string | null>(null);
  // 置顶状态：从 localStorage 恢复
  const [pinnedCanvases, setPinnedCanvases] = useState<Set<string>>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('canvas_pinned_canvases') : null;
      return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  const { allCanvases: fallbackCanvases } = useCanvas({ autoLoad: false });
  const {
    deleteCanvas: deleteWorkspaceCanvas,
    renameCanvas: renameWorkspaceCanvas,
    createFolder: createWorkspaceFolder,
    renameFolder: renameWorkspaceFolder,
    deleteFolder: deleteWorkspaceFolder,
    moveCanvas: moveWorkspaceCanvas,
    moveFolder: moveWorkspaceFolder,
  } = useWorkspaceMutations();
  const {
    createCanvasAndOpen,
    createDocAndOpen,
    openCanvas,
    openDoc,
    creatingCanvas,
    creatingDoc,
    guardDialog,
    confirmPendingAction,
    cancelPendingAction,
  } = useWorkspaceLauncherActions();

  // Aggregated workspace data (folders + canvases)
  const { data: workspaceData, loading: wsLoading } = useWorkspaceData();
  const workspaceCanvases: Canvas[] = (workspaceData?.canvases || []) as any;
  const allCanvases: Canvas[] = workspaceCanvases.length ? workspaceCanvases : (fallbackCanvases as any);
  const allFolderIds = useMemo(() => ((workspaceData?.folders || []) as any[]).map(f => f.id), [workspaceData]);
  const prefetchLimit = 2;

  useEffect(() => {
    if (!allCanvases.length) return;
    const pinned = allCanvases.filter(c => pinnedCanvases.has(c.id));
    const recent = [...allCanvases].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const ordered = [...pinned, ...recent.filter(c => !pinnedCanvases.has(c.id))];
    ordered.slice(0, prefetchLimit).forEach((c) => {
      if (!c?.id) return;
      canvasSnapshotService.prefetch(c.id, { allowStaleMs: 60_000 });
    });
  }, [allCanvases, pinnedCanvases, prefetchLimit]);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  // Canvas actions
  const handleCreateNew = useCallback(async () => {
    try {
      await createCanvasAndOpen({
        title: t('workspace.canvas.newTitle', { default: 'New Canvas' }),
        autoCollapseSidebar: true,
      });
    } catch (e) {
      console.error(e);
    }
  }, [createCanvasAndOpen, t]);
  const handleOpenCanvas = useCallback(
    (canvas: Canvas) => {
      openCanvas(canvas, { autoCollapseSidebar: true });
    },
    [openCanvas],
  );
  const handleRename = useCallback((canvasId: string) => {
    const c = allCanvases.find(x=>x.id===canvasId); setEditingCanvasId(canvasId); setEditingTitle(c?.title || 'Untitled Canvas');
  }, [allCanvases]);

  const handleSaveRename = useCallback(async () => {
    if (!editingCanvasId || !editingTitle.trim()) { setEditingCanvasId(null); setEditingTitle(''); return; }
    try { 
      const newTitle = editingTitle.trim();
      await renameWorkspaceCanvas({ id: editingCanvasId, title: newTitle });
      try { window.dispatchEvent(new CustomEvent('canvas:title-changed', { detail: { id: editingCanvasId, title: newTitle } })); } catch {}
      // 同步本地缓存/快照，避免打开画布时使用旧标题的缓存
      try {
        const entry = canvasCache.get(editingCanvasId) || canvasCache.hydrateFromSnapshot(editingCanvasId);
        if (entry) {
          canvasCache.set(editingCanvasId, {
            ...entry,
            canvas: { ...entry.canvas, title: newTitle, updatedAt: Date.now() },
          });
        }
      } catch {}
    } catch(e){ console.error(e);} finally { setEditingCanvasId(null); setEditingTitle(''); }
  }, [editingCanvasId, editingTitle, renameWorkspaceCanvas]);
  const handleCancelRename = useCallback(() => { setEditingCanvasId(null); setEditingTitle(''); }, []);
  // Unified confirm dialog (internal)
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState('');
  const askConfirm = useCallback((message: string) => {
    setConfirmMessage(message);
    setConfirmOpen(true);
    return new Promise<boolean>((resolve) => { confirmResolveRef.current = resolve; });
  }, []);
  const handleConfirm = useCallback(() => { if (confirmResolveRef.current) confirmResolveRef.current(true); setConfirmOpen(false); }, []);
  const handleCancel = useCallback(() => { if (confirmResolveRef.current) confirmResolveRef.current(false); setConfirmOpen(false); }, []);
  const handleDelete = useCallback(async (id: string) => { 
    try {
      await deleteWorkspaceCanvas({ id });
    } catch(e){
      console.error(e);
    }
  }, [deleteWorkspaceCanvas]);

  // 置顶相关处理
  const handlePinCanvas = useCallback((canvasId: string, pinned: boolean) => {
    setPinnedCanvases(prev => {
      const next = new Set(prev);
      if (pinned) next.add(canvasId); else next.delete(canvasId);
      try { localStorage.setItem('canvas_pinned_canvases', JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);
  const getPinnedStatus = useCallback((canvasId: string) => pinnedCanvases.has(canvasId), [pinnedCanvases]);

  // Local-only expand state
  // Scope expansion key to current user; teamId not provided here (default)
  const [userId, setUserId] = useState<string | undefined>(undefined);
  useEffect(() => { (async () => { try { const { createClient } = await import('@/lib/supabase/client'); const supabase = createClient(); const { data } = await supabase.auth.getUser(); setUserId(data.user?.id); } catch {} })(); }, []);
  const { expanded, isExpanded, toggle: toggleLocalExpand, setAll: setAllExpanded, clearInvalid } = useLocalExpandState({ userId });

  useEffect(() => {
    const ids = new Set((workspaceData?.folders || []).map((f: any) => f.id));
    clearInvalid(ids);
  }, [workspaceData, clearInvalid]);

  // Expand/collapse all toggle (depends on isExpanded)
  const allExpanded = useMemo(() => allFolderIds.length > 0 && allFolderIds.every(id => isExpanded(id)), [allFolderIds, isExpanded]);
  const toggleExpandAll = useCallback(() => {
    if (allExpanded) setAllExpanded([]); else setAllExpanded(allFolderIds);
  }, [allExpanded, setAllExpanded, allFolderIds]);

  // Workspace context
  const { teamSlug } = useWorkspace();
  const locale = useLocale();
  const allWorkspaceDocs: WorkspaceDocMetaItem[] = useMemo(() => {
    const docs = (workspaceData?.docsMeta || []) as WorkspaceDocMetaItem[];
    return [...docs].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [workspaceData?.docsMeta]);
  const workspaceDocs: WorkspaceDocMetaItem[] = useMemo(() => {
    const lowered = searchTerm.trim().toLowerCase();
    const filtered = lowered
      ? allWorkspaceDocs.filter((doc) => (doc.title || '').toLowerCase().includes(lowered))
      : allWorkspaceDocs;
    return [...filtered].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [allWorkspaceDocs, searchTerm]);

  const handleCreateDoc = useCallback(async () => {
    try {
      const baseTitle = t('workspace.doc.newTitle', { default: 'New Doc' });
      const existingTitles = new Set(
        allWorkspaceDocs
          .map((doc) => (doc.title || '').trim())
          .filter((title) => title.length > 0),
      );
      let title = baseTitle;
      let suffix = 2;
      while (existingTitles.has(title)) {
        title = `${baseTitle} ${suffix}`;
        suffix += 1;
      }
      await createDocAndOpen({
        title,
        contentMd: '',
        autoCollapseSidebar: true,
      });
    } catch (error) {
      console.error(error);
    }
  }, [allWorkspaceDocs, createDocAndOpen, t]);

  const handleOpenDoc = useCallback((itemId: string) => {
    openDoc(itemId, { autoCollapseSidebar: true });
  }, [openDoc]);

  // 右键菜单（画布）
  const { contextMenu, handleContextMenu: showContextMenu, hideContextMenu } = useWorkspaceContextMenu({
    onRenameCanvas: handleRename,
    onDeleteCanvas: handleDelete,
    onPinCanvas: handlePinCanvas,
                onOpenInNewTab: (id) => {
                  const base = buildCanvasPath(id, teamSlug);
                  const href = locale === 'zh' ? `/zh${base}` : base;
                  window.open(href, '_blank');
                },
    onDuplicateCanvas: () => {},
    getPinnedStatus,
    confirmDialog: { warning: (msg) => askConfirm(msg) }
  });

  // Folder context menu
  const { contextMenu: folderContextMenu, handleContextMenu: showFolderContextMenu, hideContextMenu: hideFolderContextMenu } = useFolderContextMenu({
    onStartRenameFolder: (folder) => { setEditingFolderId(folder.id); setEditingFolderName(folder.name || 'New Folder'); },
    onToggleFolder: (folderId) => { toggleLocalExpand(folderId); },
    onDeleteFolder: (folderId) => { deleteWorkspaceFolder({ id: folderId, moveCanvasesToParent: true }); },
    onCreateSubfolder: async (parentId) => { try { await createWorkspaceFolder({ name: 'New Folder', parentId }); } catch(e){} },
    confirmDialog: { warning: (msg) => askConfirm(msg) },
  });

  // General (blank area) context menu
  const { contextMenu: generalContextMenu, handleWorkspaceContextMenu: showGeneralContextMenu, hideContextMenu: hideGeneralContextMenu } = useWorkspaceGeneralContextMenu({
    onCreateCanvas: handleCreateNew,
    onCreateFolder: async () => { try { await createWorkspaceFolder({ name: 'New Folder', parentId: null }); } catch(e){} },
    onExpandAllFolders: async () => { setAllExpanded((workspaceData?.folders || []).map((f:any) => f.id)); },
    onCollapseAllFolders: async () => { setAllExpanded([]); },
  });

  // 过滤画布
  const filteredCanvases = useMemo(() => {
    return allCanvases.filter(c => (c.title?.toLowerCase() || '').includes(searchTerm.toLowerCase()));
  }, [allCanvases, searchTerm]);

  // 扁平化项目构建
  const gridItems: GridItem[] = useMemo(() => {
    const folders = (workspaceData?.folders || []) as any[];
    const expandState = { expandedFolders: expanded, expandedLevels: new Map<string, number>() } as any;
    return buildGridItems(folders as any, filteredCanvases as any, expandState);
  }, [workspaceData, filteredCanvases, expanded]);

  // 将置顶的画布在同一层级内提前（不打乱层级结构）
  const displayItems: GridItem[] = useMemo(() => {
    const items = [...gridItems];
    const out: GridItem[] = [];
    let i = 0;
    while (i < items.length) {
      const cur = items[i];
      // 仅对连续的画布块进行重排，保持文件夹和层级结构不变
      if ((cur.type === 'canvas' || cur.type === 'canvas-in-folder')) {
        const level = cur.level;
        const parentId = cur.parentId ?? null;
        const block: GridItem[] = [];
        while (i < items.length) {
          const it = items[i];
          if ((it.type === 'canvas' || it.type === 'canvas-in-folder') && it.level === level && (it.parentId ?? null) === parentId) {
            block.push(it);
            i++;
          } else {
            break;
          }
        }
        // 置顶优先，保持相对顺序稳定
        const pinnedFirst = block.slice().sort((a, b) => {
          const ap = pinnedCanvases.has(a.id);
          const bp = pinnedCanvases.has(b.id);
          if (ap === bp) return 0;
          return ap ? -1 : 1;
        });
        out.push(...pinnedFirst);
      } else {
        out.push(cur);
        i++;
      }
    }
    return out;
  }, [gridItems, pinnedCanvases]);

  // 拖拽辅助
  const parseDragData = (e: React.DragEvent) => { try { return JSON.parse(e.dataTransfer.getData('application/json')); } catch { return null; } };
  const onDragOverAllow = (e: React.DragEvent) => { e.preventDefault(); };
  const onDropOnFolder = useCallback(async (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault(); const data = parseDragData(e); if (!data) return;
    setMovingTargetFolderId(targetFolderId);
    if (data.type === 'canvas') { await moveWorkspaceCanvas({ canvasId: data.id, fromFolderId: data.sourceParentId ?? null, toFolderId: targetFolderId }); }
    else if (data.type === 'folder') { await moveWorkspaceFolder({ folderId: data.id, newParentId: targetFolderId }); }
    setMovingTargetFolderId(null);
  }, [moveWorkspaceCanvas, moveWorkspaceFolder]);
  const onRootDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); const data = parseDragData(e); if (!data) return;
    if (data.type === 'canvas') { setMovingCanvasId(data.id); await moveWorkspaceCanvas({ canvasId: data.id, fromFolderId: data.sourceParentId ?? null, toFolderId: null }); setMovingCanvasId(null); }
    else if (data.type === 'folder') { setMovingFolderSourceId(data.id); await moveWorkspaceFolder({ folderId: data.id, newParentId: null }); setMovingFolderSourceId(null); }
  }, [moveWorkspaceCanvas, moveWorkspaceFolder]);

  // No skeletons: header renders immediately; grid shows spinner while loading

  return (
    <div
      className={cn('h-full w-full relative overflow-hidden bg-background', className)}
      onContextMenu={showGeneralContextMenu}
      onDragOver={(e) => { onDragOverAllow(e); if (dragOverFolderId) setDragOverFolderId(null); }}
      onDrop={onRootDrop}
    >
      {!hideBackground && <BlurredCanvasBackground />}
      <div className="relative z-10 h-full flex flex-col">
        <div className="flex-shrink-0 p-8 pb-4">
          <div className={cn('mx-auto', maxWidthClass)}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div>
                  <h2 className="text-xl font-medium text-foreground">{t('dashboard.workspaceHeader.title', {default: 'My Knowledge Workspace'})}</h2>
                  <p className="text-xs text-muted-foreground">{t('dashboard.workspaceHeader.subtitle', {default: 'Browse and manage canvases and docs'})}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!showSearch ? (
                  <button
                    className="h-8 w-8 rounded-md border border-transparent hover:border-border hover:bg-accent/40 text-muted-foreground flex items-center justify-center"
                    title={t('workspace.search.open', { default: 'Search' })}
                    aria-label={t('workspace.search.ariaOpen', { default: 'Open search' })}
                    aria-expanded={false}
                    aria-controls="workspace-search"
                    onClick={() => setShowSearch(true)}
                  >
                    <Search className="w-4 h-4" />
                  </button>
                ) : (
                  <div className="relative w-[260px] sm:w-[320px]">
                    <div
                      id="workspace-search"
                      role="search"
                      aria-label={t('workspace.search.ariaLabel', { default: 'Canvas search' })}
                      className="flex items-center gap-2"
                    >
                      <input
                        ref={searchInputRef}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { setShowSearch(false); (e.target as HTMLInputElement).blur(); } }}
                        type="text"
                        placeholder={t('workspace.search.placeholder', { default: 'Search canvases and docs...' })}
                        aria-label={t('workspace.search.ariaSearchLabel', { default: 'Search canvases and docs' })}
                        className="flex-1 h-8 px-3 py-1 rounded-md border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
                      />
                      <button
                        className="h-8 w-8 rounded-md border border-transparent hover:border-border hover:bg-accent/40 text-muted-foreground flex items-center justify-center"
                        aria-label={t('workspace.search.ariaClose', { default: 'Close search' })}
                        onClick={() => setShowSearch(false)}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <UnifiedSearchPanel
                      query={searchTerm}
                      visible={showSearch && searchTerm.trim().length > 0}
                      className="absolute top-10 z-40 w-full"
                      onResultSelect={() => setShowSearch(false)}
                    />
                  </div>
                )}
                <button
                  className="flex items-center gap-2 h-8 px-3 rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-accent/40 transition-all"
                  title={t('workspace.menu.newDoc', { default: 'New Doc' })}
                  onClick={() => { void handleCreateDoc(); }}
                >
                  <FileText className="w-4 h-4" />
                  <span className="text-sm font-medium hidden sm:inline">{t('workspace.menu.newDoc', { default: 'New Doc' })}</span>
                </button>
                <button
                  className="flex items-center gap-2 h-8 px-3 rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-accent/40 transition-all"
                  title={t('workspace.menu.newFolder', { default: 'New Folder' })}
                  onClick={() => createWorkspaceFolder({ name: t('workspace.folder.new', { default: 'New Folder' }), parentId: null })}
                >
                  <FolderPlus className="w-4 h-4" />
                  <span className="text-sm font-medium hidden sm:inline">{t('workspace.menu.newFolder', {default: 'New Folder'})}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 画布网格视图（扁平化） */}
        <div className="flex-1 overflow-y-auto px-8 pb-8 min-h-0">
          <div className={cn('mx-auto min-h-full', maxWidthClass)}>
            <div className={cn(gridClassName || 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 py-4')}>
              {(isLoading || wsLoading) ? (
                <div className="col-span-full flex justify-center py-12">
                  <div className="animate-spin w-8 h-8 border-4 border-t-transparent rounded-full" style={{borderColor: '#8c8273', borderTopColor: 'transparent'}} />
                </div>
              ) : (
                <>
                  {/* 创建新画布卡片始终在首位 */}
                  <CanvasCard isCreateNew onClick={handleCreateNew} isLoading={creatingCanvas} />
                  {workspaceDocs.map((doc) => (
                    <DocCard
                      key={`doc-${doc.itemId}`}
                      doc={doc}
                      onClick={() => handleOpenDoc(doc.itemId)}
                      isLoading={creatingDoc}
                    />
                  ))}

                  {displayItems.map((item, index) => {
                    const indent = { marginLeft: `${item.level * 20}px` } as React.CSSProperties;
                    const renderDivider = shouldShowDividerUtil(item, index, displayItems) ? (
                      <div key={`div-${index}`} className="col-span-full">
                        <div className="border-t-2 border-dashed border-gray-300 dark:border-zinc-700" style={{ marginTop: '24px', marginBottom: '16px' }} />
                      </div>
                    ) : null;

                if (item.type === 'folder') {
                  const folder = item.data as Folder;
                  return (
                    <React.Fragment key={`folder-${folder.id}`}>
                      {renderDivider}
                      <div
                        style={indent}
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (dragOverFolderId !== folder.id) setDragOverFolderId(folder.id); }}
                        onDrop={(e) => { e.stopPropagation(); onDropOnFolder(e, folder.id); setDragOverFolderId(null); }}
                        onContextMenu={(e) => showFolderContextMenu(e, folder)}
                      >
                        <FolderCard
                          folder={{...folder, isExpanded: isExpanded(folder.id)}}
                          isEditing={editingFolderId === folder.id}
                          editingName={editingFolderName}
                          onNameChange={setEditingFolderName}
                          onToggle={() => toggleLocalExpand(folder.id)}
                          onRenameStart={() => { setEditingFolderId(folder.id); setEditingFolderName(folder.name || 'New Folder'); }}
                          onRenameConfirm={async () => { if (!editingFolderId) return; const name = editingFolderName.trim(); if (!name) { setEditingFolderId(null); setEditingFolderName(''); return; } try { await renameWorkspaceFolder({ id: editingFolderId, name }); } finally { setEditingFolderId(null); setEditingFolderName(''); } }}
                          onDelete={async () => {
                            const ok = await askConfirm(
                              t('workspace.folder.confirmDelete', {
                                default: 'Delete this folder? Canvases inside will move to the parent/root.'
                              })
                            );
                            if (ok) {
                              try {
                                await deleteWorkspaceFolder({ id: folder.id, moveCanvasesToParent: true });
                              } catch (e) {
                                console.error(e);
                              }
                            }
                          }}
                          onDragStart={(e) => { e.dataTransfer.setData('application/json', JSON.stringify({ type: 'folder', id: folder.id, sourceParentId: folder.parentId || null })); e.dataTransfer.effectAllowed = 'move'; }}
                          highlight={dragOverFolderId === folder.id}
                          isLoading={movingTargetFolderId === folder.id || movingFolderSourceId === folder.id}
                        />
                      </div>
                    </React.Fragment>
                  );
                }

                // 画布
                const c = item.data as Canvas;
                return (
                  <React.Fragment key={`canvas-${c.id}`}>
                    {renderDivider}
                    <div style={indent} draggable onDragStart={(e) => { const fs = (workspaceData?.folders || []) as any[]; const pid = (fs.find(f => (f.canvasIds || []).includes(c.id))?.id) || null; e.dataTransfer.setData('application/json', JSON.stringify({ type: 'canvas', id: c.id, sourceParentId: pid })); e.dataTransfer.effectAllowed = 'move'; }}>
                      <CanvasCard
                        canvas={c}
                        onClick={() => handleOpenCanvas(c)}
                        onHover={() => canvasSnapshotService.prefetch(c.id, { allowStaleMs: 15_000 })}
                        onContextMenu={(e) => showContextMenu(e, c.id, c)}
                        isEditing={editingCanvasId === c.id}
                        editingTitle={editingTitle}
                        onTitleChange={setEditingTitle}
                        onSaveRename={handleSaveRename}
                        onCancelRename={handleCancelRename}
                        isLoading={movingCanvasId === c.id}
                      />
                    </div>
                  </React.Fragment>
                );
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Inline search implemented in header; overlay removed */}

      {/* Internal confirm dialog for deletions */}
      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!open) handleCancel(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
            <AlertDialogDescription>{confirmMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <WorkspaceLauncherGuardDialog
        open={guardDialog.open}
        title={guardDialog.title}
        description={guardDialog.description}
        confirmLabel={guardDialog.confirmLabel}
        cancelLabel={guardDialog.cancelLabel}
        onConfirm={confirmPendingAction}
        onCancel={cancelPendingAction}
      />

      {/* Context menus */}
      <UnifiedContextMenu state={contextMenu as any} onClose={hideContextMenu} />
      <UnifiedContextMenu state={generalContextMenu as any} onClose={hideGeneralContextMenu} />
      <UnifiedContextMenu state={folderContextMenu as any} onClose={hideFolderContextMenu} />
    </div>
  );
};

export default CanvasWorkspaceFlattened;
