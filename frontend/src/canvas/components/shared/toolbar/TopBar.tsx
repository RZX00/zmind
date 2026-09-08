/**
 * Canvas Application TopBar Component (No Tabs)
 * Centered editable document title + right controls
 */
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Camera } from '@/components/ui/icons';
import { Loader2, Users, Share2, ListTree, FolderOpen, Search, MoreHorizontal, RotateCw, PanelRight, Maximize2 } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { CanvasShareModal } from './CanvasShareModal';
import { CanvasInviteModal } from './CanvasInviteModal';
import TopFloatingButtons from '../TopFloatingButtons';
import {useTranslations} from 'next-intl';
import type { BackgroundStyle } from '../panels/StylePanel';
import { DEFAULT_CANVAS_TITLE, MAX_CANVAS_TITLE_LENGTH } from '@/canvas/constants';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { collaboratorInitials, computeCollaboratorColor } from '@/canvas/collaboration/collaboratorColors';
import { openGlobalSearch } from '@/lib/global-search';

// 独立的可编辑标题区域，编辑期间冻结React更新以避免光标跳动
const EditableTitleArea = React.memo(({
  editing,
  containerRef,
  bgRef,
  titleRef,
  text,
  onDoubleClick,
  onKeyDown,
  onInput,
  onPaste,
  onCompositionStart,
  onCompositionEnd,
  onBlur,
}: {
  editing: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  bgRef: React.RefObject<HTMLDivElement>;
  titleRef: React.RefObject<HTMLSpanElement>;
  text: string;
  onDoubleClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onInput: (e: React.FormEvent<HTMLSpanElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLSpanElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onBlur: () => void;
}) => {

  return (
    <div
      ref={containerRef}
      className="relative pointer-events-auto inline-flex items-center min-w-0"
      onDoubleClick={onDoubleClick}
      onMouseDown={(e) => {
        if (!editing && (e as React.MouseEvent).detail >= 2) {
          onDoubleClick();
        }
      }}
    >
      {editing && (
        <div
          ref={bgRef}
          className="absolute z-0 pointer-events-none"
          style={{
            top: 0,
            height: '100%',
            left: 0,
            width: '100%',
            background: 'var(--card)',
            borderRadius: 0
          }}
          aria-hidden="true"
        />
      )}
      <span
        ref={titleRef}
        className={`relative z-10 inline-block text-xl font-semibold font-playfair text-foreground whitespace-nowrap focus:outline-none ${editing ? 'overflow-visible max-w-none' : 'overflow-hidden text-ellipsis max-w-full'}`}
        role={editing ? 'textbox' : 'heading'}
        aria-level={editing ? undefined : 1}
        aria-readonly={editing ? undefined : true}
        aria-label={editing ? 'Edit title' : `Document title: ${text || DEFAULT_CANVAS_TITLE}`}
        tabIndex={0}
        contentEditable={editing}
        suppressContentEditableWarning
        onKeyDown={onKeyDown}
        onInput={onInput}
        onPaste={onPaste}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onBlur={onBlur}
      >
        {text}
      </span>
    </div>
  );
}, (prev, next) => {
  // 编辑中：完全冻结（不更新），避免React影响光标位置
  if (prev.editing && next.editing) return true;
  // 非编辑态：仅在文本或编辑态切换变化时更新
  return prev.editing === next.editing && prev.text === next.text;
});

EditableTitleArea.displayName = 'EditableTitleArea';

type CollaboratorInfo = {
  userId: string;
  name: string;
  avatar?: string;
  color?: string;
  isSelf?: boolean;
  // optional activity metadata
  lastActiveAt?: number;
  lastEditAt?: number;
};

interface TopBarProps {
  // 文档标题与保存状态
  documentTitle: string;
  isDirty?: boolean;
  saveState?: 'idle' | 'saving' | 'saved' | 'draft' | 'error';
  saveError?: string | null;
  lastDraftSavedAt?: number | null;
  onRetrySave?: () => void;
  isSyncing?: boolean;
  hasError?: boolean;
  onDocumentTitleChange?: (title: string) => void;
  // 画布ID（用于分享入口）
  canvasId?: string;

  // 面板按钮控制
  onCodeEditorToggle?: () => void;
  onAgentToggle?: (enabled: boolean) => void;
  showCodeEditor?: boolean;
  showAgentPanel?: boolean;

  // 样式相关
  className?: string;

  // 背景样式匹配
  backgroundStyle?: BackgroundStyle;
  backgroundColor?: string;

  // 视图模式：顶部右侧按钮
  viewMode?: 'canvas' | 'outline';
  onViewModeChange?: (mode: 'canvas' | 'outline') => void;

  // 播放控制（顶部栏集成）
  playState?: 'idle' | 'playing' | 'paused';
  onPlayStateChange?: (state: 'idle' | 'playing' | 'paused') => void;
  onRequestOpenPlaybackMenu?: () => void;

  // 资产面板
  onAssetLibraryToggle?: (open: boolean) => void;
  showAssetLibrary?: boolean;
  // 右侧侧栏（AI/Assets）收起展开
  rightPanelCollapsed?: boolean;
  onRightPanelToggle?: () => void;
  // 展开编辑入口
  canOpenExpandedEditor?: boolean;
  onOpenExpandedEditor?: () => void;

  // 协作状态
  collaborators?: CollaboratorInfo[];
  collaborationConnected?: boolean;

  // Screenshot
  onScreenshot?: () => void;
  screenshotLoading?: boolean;
}

// 使用统一常量

const TopBar: React.FC<TopBarProps> = ({
  documentTitle,
  isDirty = false,
  saveState = 'idle',
  saveError = null,
  lastDraftSavedAt = null,
  onRetrySave,
  isSyncing = false,
  hasError = false,
  onDocumentTitleChange,
  canvasId,

  onCodeEditorToggle,
  onAgentToggle,
  showCodeEditor = false,
  showAgentPanel = false,

  className = '',
  backgroundStyle,
  backgroundColor,
  viewMode = 'canvas',
  onViewModeChange,
  playState = 'idle',
  onPlayStateChange,
  onRequestOpenPlaybackMenu,
  onAssetLibraryToggle,
  showAssetLibrary,
  rightPanelCollapsed = false,
  onRightPanelToggle,
  canOpenExpandedEditor = false,
  onOpenExpandedEditor,
  collaborators = [],
  collaborationConnected = false,
  onScreenshot,
  screenshotLoading = false
}) => {
  const t = useTranslations();
  const isOutline = false; // Outline now a floating panel; top bar stays consistent
  const isMobile = useIsMobile();
  const [actionsExpanded, setActionsExpanded] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const nonSelfCollaborators = useMemo(() => collaborators.filter(c => !c.isSelf), [collaborators]);
  const showAvatars = !isOutline && nonSelfCollaborators.length > 0;
  const visibleCollaborators = useMemo(() => collaborators.slice(0, 3), [collaborators]);
  const remainingCollaborators = Math.max(0, collaborators.length - visibleCollaborators.length);
  // 顶部栏背景与画布保持一致
  const getTopBarBackgroundColor = () => {
    if (backgroundColor) return backgroundColor;
    if (backgroundStyle) {
      if (backgroundStyle.type === 'solid') return backgroundStyle.color || '#eeeded';
      return '#eeeded';
    }
    return '#eeeded';
  };

  // 行内编辑状态
  const [editing, setEditing] = useState(false);
  const [localTitle, setLocalTitle] = useState(documentTitle || DEFAULT_CANVAS_TITLE);
  const originalTitleRef = useRef(documentTitle || DEFAULT_CANVAS_TITLE);
  const titleRef = useRef<HTMLSpanElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editableContainerRef = useRef<HTMLDivElement>(null);
  const bgOverlayRef = useRef<HTMLDivElement>(null);

  const updateBackgroundOverlay = useCallback(() => {
    if (!editing) return;
    const span = titleRef.current;
    const container = editableContainerRef.current; // inner editable container
    const bg = bgOverlayRef.current;
    if (!span || !container || !bg) return;

    // 扩展像素值：左右对称更大范围
    const EXTEND = 140; // px

    // span 的相对位置和尺寸
    const spanRect = span.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // 以文本中心为基准对称扩展
    const spanCenter = (spanRect.left - containerRect.left) + (spanRect.width / 2);
    const width = Math.max(spanRect.width + EXTEND * 2, 320);
    const left = spanCenter - (width / 2);
    const top = (spanRect.top - containerRect.top);
    const height = spanRect.height;

    bg.style.left = `${left}px`;
    bg.style.width = `${width}px`;
    bg.style.top = `${top}px`;
    bg.style.height = `${height}px`;
  }, [editing]);
  const isComposingRef = useRef(false);
  const inputBufferRef = useRef<string>(documentTitle || DEFAULT_CANVAS_TITLE);
  const actionsHoverTimerRef = useRef<number | null>(null);

  const shouldCollapseActions = isMobile || isPortrait;

  const openActionsOnHover = useCallback(() => {
    if (!shouldCollapseActions) return;
    if (actionsHoverTimerRef.current) {
      window.clearTimeout(actionsHoverTimerRef.current);
      actionsHoverTimerRef.current = null;
    }
    setActionsExpanded(true);
  }, [shouldCollapseActions]);

  const closeActionsOnHover = useCallback(() => {
    if (!shouldCollapseActions) return;
    if (actionsHoverTimerRef.current) {
      window.clearTimeout(actionsHoverTimerRef.current);
    }
    actionsHoverTimerRef.current = window.setTimeout(() => {
      setActionsExpanded(false);
    }, 120);
  }, [shouldCollapseActions]);

  useEffect(() => {
    if (!shouldCollapseActions) {
      setActionsExpanded(false);
    }
  }, [shouldCollapseActions]);

  useEffect(() => {
    return () => {
      if (actionsHoverTimerRef.current) {
        window.clearTimeout(actionsHoverTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (shouldCollapseActions && viewMode === 'outline') {
      setActionsExpanded(true);
    }
  }, [shouldCollapseActions, viewMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(orientation: portrait)');
    const update = () => {
      const portrait = mql.matches || window.innerHeight >= window.innerWidth;
      setIsPortrait(portrait);
    };
    update();
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', update);
    } else {
      mql.addListener(update);
    }
    window.addEventListener('resize', update);
    return () => {
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', update);
      } else {
        mql.removeListener(update);
      }
      window.removeEventListener('resize', update);
    };
  }, []);

  // 同步外部标题变化（非编辑态）
  useEffect(() => {
    if (!editing) {
      setLocalTitle(documentTitle || DEFAULT_CANVAS_TITLE);
      if (titleRef.current) titleRef.current.textContent = documentTitle || DEFAULT_CANVAS_TITLE;
      inputBufferRef.current = documentTitle || DEFAULT_CANVAS_TITLE;
    }
  }, [documentTitle, editing]);

  const sanitize = useCallback((text: string) => {
    // 去除换行，保留正常空格，限制长度
    let v = (text || '').replace(/\r|\n/g, ' ');
    v = v.trim();
    if (v.length > MAX_CANVAS_TITLE_LENGTH) v = v.slice(0, MAX_CANVAS_TITLE_LENGTH);
    return v;
  }, []);

  const startEdit = useCallback(() => {
    setEditing(true);
    originalTitleRef.current = documentTitle || DEFAULT_CANVAS_TITLE;
    // 延后到下一个tick，设置文本并全选
    requestAnimationFrame(() => {
      const el = titleRef.current;
      if (!el) return;
      el.focus();
      // 选中全部内容（便于直接覆盖输入）
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      inputBufferRef.current = el.textContent || '';
      // 初始更新背景覆盖尺寸
      updateBackgroundOverlay();
    });
  }, [documentTitle, updateBackgroundOverlay]);

  const commitSave = useCallback(() => {
    // 以输入缓冲为准进行清理与保存
    let finalTitle = sanitize(inputBufferRef.current);
    if (!finalTitle) finalTitle = DEFAULT_CANVAS_TITLE;
    if (titleRef.current) titleRef.current.textContent = finalTitle;
    setEditing(false);
    setLocalTitle(finalTitle);
    if (finalTitle !== (documentTitle || DEFAULT_CANVAS_TITLE)) {
      onDocumentTitleChange?.(finalTitle);
    }
  }, [documentTitle, onDocumentTitleChange, sanitize]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setLocalTitle(originalTitleRef.current);
    if (titleRef.current) titleRef.current.textContent = originalTitleRef.current;
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    // 组合输入中不拦截
    if (isComposingRef.current) return;
    if (editing) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitSave();
        (e.currentTarget as HTMLElement).blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
        (e.currentTarget as HTMLElement).blur();
      }
    } else {
      // 非编辑态支持 Enter / F2 启动编辑
      if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        startEdit();
      }
    }
  }, [editing, commitSave, cancelEdit, startEdit]);

  const onInput = useCallback((e: React.FormEvent<HTMLSpanElement>) => {
    // 编辑过程中不触发React重渲染，避免光标跳转
    const content = e.currentTarget.textContent || '';
    inputBufferRef.current = content;
    updateBackgroundOverlay();
  }, [updateBackgroundOverlay]);

  // 粘贴只允许纯文本，并执行相同的清洗与长度限制
  const onPaste = useCallback((e: React.ClipboardEvent<HTMLSpanElement>) => {
    if (!editing) return;
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    const clean = sanitize(text.replace(/\r|\n/g, ' '));
    // 插入到当前光标位置
    try {
      document.execCommand('insertText', false, clean);
    } catch {
      // 回退：直接覆盖
      const el = titleRef.current;
      if (el) el.textContent = clean;
    }
    inputBufferRef.current = titleRef.current?.textContent || clean;
    updateBackgroundOverlay();
  }, [editing, sanitize, updateBackgroundOverlay]);

  const onCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const onCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
    // 组合输入结束后统一清理
    const el = titleRef.current;
    if (!el) return;
    const clean = sanitize(el.textContent || '');
    inputBufferRef.current = clean;
    if (el.textContent !== clean) {
      el.textContent = clean;
      // 保持光标在末尾
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    updateBackgroundOverlay();
  }, [sanitize, updateBackgroundOverlay]);

  const showStatusIndicator = playState === 'idle';
  const hasSaveError = Boolean(saveError);
  const openSidePanelLabel = t.has?.('canvas.toolbar.openSidePanel')
    ? t('canvas.toolbar.openSidePanel')
    : (t.has?.('canvas.ai.expandPanel') ? t('canvas.ai.expandPanel') : 'Open side panel');
  const closeSidePanelLabel = t.has?.('canvas.toolbar.closeSidePanel')
    ? t('canvas.toolbar.closeSidePanel')
    : (t.has?.('canvas.ai.collapsePanel') ? t('canvas.ai.collapsePanel') : 'Close side panel');
  const rightPanelToggleLabel = rightPanelCollapsed
    ? openSidePanelLabel
    : closeSidePanelLabel;
  const openExpandedEditorLabel = t.has?.('canvas.toolbar.openExpandedEditor')
    ? t('canvas.toolbar.openExpandedEditor')
    : 'Open expanded editor';
  const rightPanelToggleButtonClass = rightPanelCollapsed
    ? 'border-border/60 bg-background/75 text-foreground hover:bg-accent/60'
    : 'border-border/60 bg-accent/50 text-foreground hover:bg-accent/65';
  const canToggleOutline = Boolean(onViewModeChange);
  const canControlPlayback = Boolean(onPlayStateChange);
  const canTakeScreenshot = Boolean(onScreenshot);

  const draftSavedLabel = useMemo(() => {
    if (!lastDraftSavedAt) return null;
    try {
      return new Date(lastDraftSavedAt).toLocaleString();
    } catch {
      return null;
    }
  }, [lastDraftSavedAt]);

  const status = useMemo(() => {
    if (saveState === 'error' || hasError || hasSaveError) {
      return {
        tone: 'error',
        label: t('canvas.status.saveFailed', { default: 'Save failed' }),
        title: t('canvas.status.saveFailedDetail', { default: 'We could not sync your changes. Your local draft is still available.' }),
        actionLabel: onRetrySave ? t('canvas.status.retry', { default: 'Retry' }) : null,
      };
    }
    if (saveState === 'saving' || isSyncing) {
      return {
        tone: 'saving',
        label: t('canvas.status.saving', { default: 'Saving...' }),
        title: t('canvas.status.saving', { default: 'Saving...' }),
        actionLabel: null,
      };
    }
    if (saveState === 'draft') {
      return {
        tone: 'draft',
        label: t('canvas.status.localDraft', { default: 'Local draft saved' }),
        title: draftSavedLabel
          ? t('canvas.status.savedAt', { time: draftSavedLabel, default: `Saved at ${draftSavedLabel}` })
          : t('canvas.status.localDraft', { default: 'Local draft saved' }),
        actionLabel: null,
      };
    }
    if (!collaborationConnected) {
      return {
        tone: 'offline',
        label: t('canvas.status.offline', { default: 'Not connected' }),
        title: t('canvas.status.offline', { default: 'Not connected' }),
        actionLabel: null,
      };
    }
    if (isDirty) {
      return {
        tone: 'dirty',
        label: t('canvas.status.unsaved', { default: 'Unsaved changes' }),
        title: t('canvas.status.unsaved', { default: 'Unsaved changes' }),
        actionLabel: null,
      };
    }
    return {
      tone: 'saved',
      label: t('canvas.status.saved', { default: 'Saved' }),
      title: t('canvas.status.saved', { default: 'Saved' }),
      actionLabel: null,
    };
  }, [saveState, hasError, hasSaveError, isSyncing, isDirty, collaborationConnected, draftSavedLabel, t, onRetrySave]);

  const dotColor = useMemo(() => {
    switch (status.tone) {
      case 'error':
        return 'bg-red-500';
      case 'saving':
        return 'bg-sky-500';
      case 'draft':
        return 'bg-amber-500';
      case 'offline':
        return 'bg-gray-300';
      case 'dirty':
        return 'bg-orange-500';
      default:
        return 'bg-green-500';
    }
  }, [status.tone]);

  const dotLabel = status.label;

  // 点击外部（包括画布）自动保存并退出编辑
  useEffect(() => {
    if (!editing) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (wrapperRef.current && !wrapperRef.current.contains(target)) {
        commitSave();
        if (titleRef.current) titleRef.current.blur();
      }
    };
    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('touchstart', handlePointerDown, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('touchstart', handlePointerDown, true);
    };
  }, [editing, commitSave]);

  // 根据文本实际显示宽度，精确设置背景覆盖层尺寸和位置
  

  // 窗口尺寸变化时也更新
  useEffect(() => {
    if (!editing) return;
    const onResize = () => updateBackgroundOverlay();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [editing, updateBackgroundOverlay]);

  return (
    <div
      className={`relative flex flex-col w-full sticky top-0 z-[80] ${className}`}
      style={{ backgroundColor: getTopBarBackgroundColor() }}
    >
      <header
        className="relative flex items-center justify-between h-12 min-h-[48px] w-full"
        style={{ backgroundColor: getTopBarBackgroundColor() }}
      >
        {/* 左侧：状态圆点（最左侧显示） */}
        <div className="flex items-center gap-3 flex-shrink-0 px-4 z-10">
          {showStatusIndicator && (
            <div className="flex items-center gap-2" title={status.title || status.label}>
              <div
                className={`w-[3px] h-5 ${dotColor} ${status.tone === 'dirty' ? 'status-bar-breath' : ''}`}
                aria-label={dotLabel}
              />
              {status.actionLabel && onRetrySave && (
                <button
                  type="button"
                  onClick={onRetrySave}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-primary hover:bg-accent/60"
                  aria-label={status.actionLabel}
                  title={status.actionLabel}
                >
                  <RotateCw size={12} />
                </button>
              )}
              <span className="sr-only" aria-live="polite">
                {dotLabel}
              </span>
            </div>
          )}
          {showAvatars && visibleCollaborators.length > 0 && (
            <TooltipProvider>
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">
                  {visibleCollaborators.map((collab) => {
                    const now = Date.now();
                    const editRecent = typeof collab.lastEditAt === 'number' && now - collab.lastEditAt < 5000;
                    const activeRecent = !editRecent && typeof collab.lastActiveAt === 'number' && now - collab.lastActiveAt < 30000;
                    const ringClass = editRecent
                      ? 'collab-color-ring collab-color-ring--editing'
                      : activeRecent
                        ? 'collab-color-ring collab-color-ring--active'
                        : '';
                    const ringColor = computeCollaboratorColor(collab.name || collab.userId, collab.color);
                    return (
                      <Tooltip key={collab.userId}>
                        <TooltipTrigger asChild>
                          <div
                            className={`relative inline-block ${ringClass}`}
                            style={{ ["--ring-color"]: ringColor } as React.CSSProperties}
                          >
                            <Avatar className="relative z-[1] h-8 w-8 border border-background shadow-sm">
                              <AvatarImage src={collab.avatar} alt={collab.name} />
                              <AvatarFallback
                                style={{
                                  backgroundColor: ringColor,
                                  color: 'white',
                                }}
                              >
                                {collaboratorInitials(collab.name)}
                              </AvatarFallback>
                            </Avatar>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{collab.name}</TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="h-6 px-2 inline-flex items-center rounded-full bg-white/60 dark:bg-neutral-900/50 backdrop-blur-sm border border-black/10 dark:border-white/10 text-xs font-medium text-foreground hover:bg-white/80 dark:hover:bg-neutral-900/70 transition-colors duration-150"
                      aria-label={t('canvas.toolbar.collaborators', { default: 'Collaborators' })}
                    >
                      {remainingCollaborators > 0 ? `+${remainingCollaborators}` : <Users size={12} />}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" sideOffset={6} className="w-64 p-2">
                    <div className="px-1 pb-2 text-xs font-medium text-muted-foreground">
                      {t('canvas.toolbar.collaborators', { default: 'Collaborators' })} ({collaborators.length})
                    </div>
                    <div className="max-h-72 overflow-y-auto flex flex-col gap-0.5">
                      {collaborators.map((collab) => {
                        const color = computeCollaboratorColor(collab.name || collab.userId, collab.color);
                        return (
                          <div
                            key={collab.userId}
                            className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent/60"
                          >
                            <Avatar className="h-7 w-7 border border-background shadow-sm">
                              <AvatarImage src={collab.avatar} alt={collab.name} />
                              <AvatarFallback style={{ backgroundColor: color, color: 'white' }}>
                                {collaboratorInitials(collab.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="flex-1 min-w-0 truncate text-sm text-foreground">
                              {collab.name}
                            </span>
                            {collab.isSelf && (
                              <span className="text-[10px] text-muted-foreground">
                                {t('canvas.toolbar.you', { default: 'You' })}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </TooltipProvider>
          )}
        </div>

        {/* 居中标题层（允许交互） */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {/* 用一个容器Ref做外部点击判断 */}
          <div ref={wrapperRef} className="pointer-events-auto relative min-w-0 max-w-[90vw] px-2">
            <EditableTitleArea
              editing={editing}
              containerRef={editableContainerRef}
              bgRef={bgOverlayRef}
              titleRef={titleRef}
              text={localTitle}
              onDoubleClick={() => !editing && startEdit()}
              onKeyDown={onKeyDown}
              onInput={onInput}
              onPaste={onPaste}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              onBlur={() => (editing ? commitSave() : undefined)}
            />
          </div>
        </div>

        {/* 右侧：按钮区域（大纲视图仅保留返回画布按钮） */}
        <div className="flex items-center gap-1 flex-shrink-0 px-4 z-10">
          {shouldCollapseActions ? (
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => setActionsExpanded((prev) => !prev)}
                onMouseEnter={openActionsOnHover}
                onMouseLeave={closeActionsOnHover}
                className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors duration-150 ${actionsExpanded ? 'bg-accent text-accent-foreground hover:bg-accent/90' : 'text-foreground hover:bg-accent/60'}`}
                aria-expanded={actionsExpanded}
                aria-label={actionsExpanded ? 'Hide toolbar actions' : 'Show toolbar actions'}
                title={actionsExpanded ? 'Hide actions' : 'Show actions'}
              >
                <MoreHorizontal size={16} />
              </button>
              <TopFloatingButtons
                onCodeEditorToggle={onCodeEditorToggle}
                onAgentToggle={onAgentToggle}
                showCodeEditor={showCodeEditor}
                showAgentPanel={showAgentPanel}
                showCodeButton={false}
                showAIButton={true}
                buttonClassName="w-8 h-8"
              />
            </div>
          ) : (
            <>
              <button
                onClick={() => openGlobalSearch()}
                className="hidden md:flex items-center gap-2 h-8 px-3 rounded-md border border-border/60 bg-background/70 text-muted-foreground hover:text-foreground hover:bg-accent/60"
                aria-label={t('globalSearch.open', { default: 'Search docs and canvases' })}
                title={t('globalSearch.open', { default: 'Search docs and canvases' })}
              >
                <Search size={14} />
                <span className="text-sm truncate max-w-[160px]">{t('globalSearch.placeholder', { default: 'Search docs and canvases...' })}</span>
                <span className="text-[10px] text-muted-foreground">Cmd+K</span>
              </button>
              {canvasId && (
                <button
                  className="w-8 h-8 rounded-md flex items-center justify-center transition-colors duration-150 text-foreground hover:bg-accent/60"
                  title={t('canvas.toolbar.collaborate', { default: 'Collaborate' })}
                  onClick={() => setInviteOpen(true)}
                >
                  <Users size={16} />
                </button>
              )}
              {canvasId && (
                <button
                  className="w-8 h-8 rounded-md flex items-center justify-center transition-colors duration-150 text-foreground hover:bg-accent/60"
                  title={t('canvas.toolbar.shareCanvas', { default: 'Share Canvas' })}
                  onClick={() => setShareOpen(true)}
                >
                  <Share2 size={16} />
                </button>
              )}

              {canToggleOutline && (
                <button
                  onClick={() => onViewModeChange?.(viewMode === 'canvas' ? 'outline' : 'canvas')}
                  className={`text-foreground hover:bg-accent/60 w-8 h-8 rounded-md transition-colors duration-150 flex items-center justify-center`}
                  title={t('canvas.toolbar.switchToOutline', { default: 'Open outline' })}
                  aria-label={t('canvas.toolbar.switchToOutline', { default: 'Open outline' })}
                >
                  <ListTree size={16} />
                </button>
              )}

              {canControlPlayback && (
                playState === 'playing' ? (
                  <button
                    className="w-8 h-8 rounded-md flex items-center justify-center transition-colors duration-150 text-foreground hover:bg-accent/60"
                    title={t('canvas.toolbar.stop', { default: 'Stop' })}
                    onClick={() => { onPlayStateChange?.('idle'); }}
                  >
                    <Square size={16} />
                  </button>
                ) : (
                  <button
                    className="w-8 h-8 rounded-md flex items-center justify-center transition-colors duration-150 text-foreground hover:bg-accent/60"
                    title={t('canvas.toolbar.play', { default: 'Play' })}
                    onClick={() => { onPlayStateChange?.('playing'); onRequestOpenPlaybackMenu?.(); }}
                  >
                    <Play size={16} />
                  </button>
                )
              )}

              {canTakeScreenshot && (
                <button
                  className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors duration-150 text-foreground hover:bg-accent/60 ${screenshotLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
                  title={t('canvas.toolbar.screenshot', { default: 'Screenshot' })}
                  onClick={() => onScreenshot?.()}
                  disabled={screenshotLoading}
                  aria-busy={screenshotLoading}
                >
                  {screenshotLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera size={16} />}
                </button>
              )}

              {onAssetLibraryToggle && (
                <button
                  className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors duration-150 ${showAssetLibrary ? 'bg-accent text-accent-foreground hover:bg-accent/90' : 'text-foreground hover:bg-accent/60'}`}
                  title={showAssetLibrary ? t('canvas.toolbar.closeAssetLibrary', { default: 'Close Asset Library' }) : t('canvas.toolbar.openAssetLibrary', { default: 'Open Asset Library' })}
                  onClick={() => onAssetLibraryToggle?.(!showAssetLibrary)}
                >
                  <FolderOpen size={16} />
                </button>
              )}
              <TopFloatingButtons
                onCodeEditorToggle={onCodeEditorToggle}
                onAgentToggle={onAgentToggle}
                showCodeEditor={showCodeEditor}
                showAgentPanel={showAgentPanel}
              />
            </>
          )}
          {onOpenExpandedEditor && (
            <button
              onClick={() => {
                if (!canOpenExpandedEditor) return;
                onOpenExpandedEditor();
              }}
              className={`w-8 h-8 rounded-md border flex items-center justify-center transition-colors duration-150 ${
                canOpenExpandedEditor
                  ? 'border-border/60 text-foreground hover:bg-accent/60'
                  : 'border-border/50 text-muted-foreground/50 cursor-not-allowed'
              }`}
              aria-label={openExpandedEditorLabel}
              title={openExpandedEditorLabel}
              disabled={!canOpenExpandedEditor}
            >
              <Maximize2 size={16} />
            </button>
          )}
          {onRightPanelToggle && (
            <button
              onClick={onRightPanelToggle}
              className={`w-9 h-8 rounded-md border flex items-center justify-center transition-colors duration-150 ${rightPanelToggleButtonClass}`}
              aria-label={rightPanelToggleLabel}
              title={rightPanelToggleLabel}
              aria-pressed={!rightPanelCollapsed}
            >
              <PanelRight size={16} />
            </button>
          )}
        </div>
      </header>
      {shouldCollapseActions && (
        <div
          className={`absolute left-0 right-0 top-full translate-y-2 px-3 transition-all duration-200 ${actionsExpanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
          aria-hidden={!actionsExpanded}
          style={{ zIndex: 90 }}
          onMouseEnter={openActionsOnHover}
          onMouseLeave={closeActionsOnHover}
        >
          <div
            className="rounded-2xl border border-black/10 dark:border-white/10 bg-background/60 backdrop-blur-md shadow-lg flex flex-wrap items-center gap-2 px-2 py-2 justify-end"
          >
            <button
              onClick={() => openGlobalSearch()}
              className="w-8 h-8 rounded-md flex items-center justify-center transition-colors duration-150 text-foreground hover:bg-accent/60 flex-shrink-0"
              aria-label={t('globalSearch.open', { default: 'Search docs and canvases' })}
              title={t('globalSearch.open', { default: 'Search docs and canvases' })}
            >
              <Search size={16} />
            </button>

            {canvasId && (
              <button
                className="w-8 h-8 rounded-md flex items-center justify-center transition-colors duration-150 text-foreground hover:bg-accent/60 flex-shrink-0"
                title={t('canvas.toolbar.collaborate', { default: 'Collaborate' })}
                onClick={() => setInviteOpen(true)}
              >
                <Users size={16} />
              </button>
            )}

            {canvasId && (
              <button
                className="w-8 h-8 rounded-md flex items-center justify-center transition-colors duration-150 text-foreground hover:bg-accent/60 flex-shrink-0"
                title={t('canvas.toolbar.shareCanvas', { default: 'Share Canvas' })}
                onClick={() => setShareOpen(true)}
              >
                <Share2 size={16} />
              </button>
            )}

            {canToggleOutline && (
              <button
                onClick={() => onViewModeChange?.(viewMode === 'canvas' ? 'outline' : 'canvas')}
                className={`${viewMode === 'outline' ? 'bg-accent text-accent-foreground hover:bg-accent/90' : 'text-foreground hover:bg-accent/60'} w-8 h-8 rounded-md transition-colors duration-150 flex items-center justify-center flex-shrink-0`}
                title={viewMode === 'outline' ? t('canvas.toolbar.backToCanvas', { default: 'Back to Canvas' }) : t('canvas.toolbar.switchToOutline', { default: 'Switch to Outline' })}
                aria-label={viewMode === 'outline' ? t('canvas.toolbar.backToCanvas', { default: 'Back to Canvas' }) : t('canvas.toolbar.switchToOutline', { default: 'Switch to Outline' })}
              >
                <ListTree size={16} />
              </button>
            )}

            {!isOutline && (
              <>
                {canControlPlayback && (
                  <button
                    className="w-8 h-8 rounded-md flex items-center justify-center transition-colors duration-150 text-foreground hover:bg-accent/60 flex-shrink-0"
                    title={playState === 'playing' ? t('canvas.toolbar.stop', { default: 'Stop' }) : t('canvas.toolbar.play', { default: 'Play' })}
                    onClick={() => {
                      if (playState === 'playing') {
                        onPlayStateChange?.('idle');
                      } else {
                        onPlayStateChange?.('playing');
                        onRequestOpenPlaybackMenu?.();
                      }
                    }}
                  >
                    {playState === 'playing' ? <Square size={16} /> : <Play size={16} />}
                  </button>
                )}

                {canTakeScreenshot && (
                  <button
                    className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors duration-150 text-foreground hover:bg-accent/60 flex-shrink-0 ${screenshotLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
                    title={t('canvas.toolbar.screenshot', { default: 'Screenshot' })}
                    onClick={() => onScreenshot?.()}
                    disabled={screenshotLoading}
                    aria-busy={screenshotLoading}
                  >
                    {screenshotLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera size={16} />}
                  </button>
                )}

                {onAssetLibraryToggle && (
                  <button
                    className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors duration-150 flex-shrink-0 ${showAssetLibrary ? 'bg-accent text-accent-foreground hover:bg-accent/90' : 'text-foreground hover:bg-accent/60'}`}
                    title={showAssetLibrary ? t('canvas.toolbar.closeAssetLibrary', { default: 'Close Asset Library' }) : t('canvas.toolbar.openAssetLibrary', { default: 'Open Asset Library' })}
                    onClick={() => onAssetLibraryToggle?.(!showAssetLibrary)}
                  >
                    <FolderOpen size={16} />
                  </button>
                )}
              </>
            )}

            {!isOutline && (
              <TopFloatingButtons
                onCodeEditorToggle={onCodeEditorToggle}
                onAgentToggle={onAgentToggle}
                showCodeEditor={showCodeEditor}
                showAgentPanel={showAgentPanel}
                showCodeButton={true}
                showAIButton={false}
                buttonClassName="w-8 h-8"
              />
            )}
          </div>
        </div>
      )}
      {canvasId && (
        <CanvasInviteModal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} canvasId={canvasId} />
      )}
      {canvasId && (
        <CanvasShareModal isOpen={shareOpen} onClose={() => setShareOpen(false)} canvasId={canvasId} />
      )}
    </div>
  );
};

export default TopBar;
