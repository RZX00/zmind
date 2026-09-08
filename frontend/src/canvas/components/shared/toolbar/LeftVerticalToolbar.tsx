// 左侧垂直工具栏组件 - 分组胶囊版
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {useTranslations} from 'next-intl';
import {
  Type,
  CheckSquare,
  Workflow,
  FileCode2,
  LayoutPanelLeft,
  Table,
  MousePointer2,
  Hand,
  MessageSquare,
  Mic,
  Link2,
  Palette,
  Code2,
  X
} from 'lucide-react';
import { StylePanelContent } from '../panels/StylePanel';
import NodeStylePanel from '../panels/NodeStylePanel';
import ConnectionStylePanel from '../panels/ConnectionStylePanel';
import GroupStylePanel from '../panels/GroupStylePanel';
import type { CanvasNode, CornerStyle, FontStyle } from '../../../../types/canvas';
import type { BackgroundStyle } from '../panels/StylePanel';
import type { AlignmentType } from '../../../types/node-alignment';
import { useCanvasStore } from '../../../stores/canvas.store';

interface LeftVerticalToolbarProps {
  // 编辑模式
  isEditMode: boolean;
  onEditModeChange: (mode: boolean) => void;

  // 节点选择状态
  selectedNodes?: CanvasNode[];
  onNodeStyleChange?: (nodeId: string, styles: any) => void;

  // 节点对齐功能
  onNodeAlignment?: (nodes: CanvasNode[], type: AlignmentType) => void;

  // 样式控制
  backgroundStyle: BackgroundStyle;
  onBackgroundStyleChange: (style: BackgroundStyle) => void;
  cornerStyle: CornerStyle;
  onCornerStyleChange: (style: CornerStyle) => void;
  fontStyle: FontStyle;
  onFontStyleChange: (style: FontStyle) => void;
  backgroundColor: string;
  onBackgroundColorChange: (color: string) => void;
  patternColor: string;
  onPatternColorChange: (color: string) => void;
  // 组样式
  selectedGroup?: CanvasNode | null;
  onGroupStyleChange?: (groupId: string, styles: { accentColor?: string; groupStyles?: { bgOpacity?: number } }) => void;
}

type ActivePanel = 'text' | 'code' | 'style' | null;

const LeftVerticalToolbar: React.FC<LeftVerticalToolbarProps> = ({
  isEditMode,
  onEditModeChange,
  selectedNodes = [],
  onNodeStyleChange,
  onNodeAlignment,
  backgroundStyle,
  onBackgroundStyleChange,
  cornerStyle,
  onCornerStyleChange,
  fontStyle,
  onFontStyleChange,
  backgroundColor,
  onBackgroundColorChange,
  patternColor,
  onPatternColorChange,
  selectedGroup,
  onGroupStyleChange
}) => {
  const t = useTranslations();
  const hasSelectedNodes = selectedNodes.length > 0;
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [panelAnchorTop, setPanelAnchorTop] = useState(0);
  const [panelAnchorBottom, setPanelAnchorBottom] = useState(0);

  const clearHoverCloseTimer = () => {
    if (hoverCloseTimerRef.current) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  };

  const scheduleHoverClose = () => {
    if (!activePanel) return;
    clearHoverCloseTimer();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setActivePanel(null);
      hoverCloseTimerRef.current = null;
    }, 220);
  };

  const updatePanelAnchor = (anchor?: HTMLElement | null) => {
    if (!anchor || !toolbarRef.current) return;
    const anchorRect = anchor.getBoundingClientRect();
    const toolbarRect = toolbarRef.current.getBoundingClientRect();
    const nextTop = Math.max(0, Math.round(anchorRect.top - toolbarRect.top));
    const nextBottom = Math.max(0, Math.round(anchorRect.bottom - toolbarRect.top));
    setPanelAnchorTop(nextTop);
    setPanelAnchorBottom(nextBottom);
  };

  const openPanel = (panel: ActivePanel, anchor?: HTMLElement | null) => {
    clearHoverCloseTimer();
    if (panel) {
      updatePanelAnchor(anchor);
    }
    setActivePanel(panel);
    if (panel && toolMode === 'line') {
      setToolMode('select');
    }
  };

  const closeActivePanel = () => {
    clearHoverCloseTimer();
    setActivePanel(null);
  };

  useEffect(() => {
    return () => {
      clearHoverCloseTimer();
    };
  }, []);

  const hasSelectedGroup = !!selectedGroup && (selectedGroup as any).type === 'group';
  const toolMode = useCanvasStore((s) => s.interactionState.toolMode);
  const setToolMode = useCanvasStore((s) => s.setToolMode);
  const currentMode = !isEditMode ? 'chat' : toolMode === 'hand' ? 'drag' : 'select';
  const modeLabels = useMemo(() => ({
    select: t('canvas.toolbarLeft.modes.select', { default: 'Select mode' }),
    drag: t('canvas.toolbarLeft.modes.drag', { default: 'Drag mode' }),
    chat: t('canvas.toolbarLeft.modes.chat', { default: 'Chat mode' })
  }), [t]);
  const currentModeLabel = modeLabels[currentMode];
  const selectedConnectionIds = useCanvasStore((s) => s.selections.connectionIds);
  const hasSelectedConnectionsOnly = useMemo(() => {
    const count = (selectedConnectionIds && selectedConnectionIds.size) || 0;
    return count > 0 && !hasSelectedNodes && !hasSelectedGroup;
  }, [selectedConnectionIds, hasSelectedNodes, hasSelectedGroup]);

  const handlePanelToggle = (panel: ActivePanel, anchor?: HTMLElement | null) => {
    openPanel(panel, anchor);
  };

  const handleModeSelect = (mode: 'select' | 'drag' | 'chat') => {
    if (mode === 'chat') {
      onEditModeChange(false);
      setToolMode('select');
    } else {
      onEditModeChange(true);
      setToolMode(mode === 'drag' ? 'hand' : 'select');
    }
    closeActivePanel();
  };

  // Select button cycles: Chat → Select → Drag → Select → ...
  const handleSelectButtonClick = () => {
    if (currentMode === 'chat') {
      handleModeSelect('select');
    } else if (currentMode === 'select') {
      handleModeSelect('drag');
    } else {
      handleModeSelect('select');
    }
  };

  const handleLineToolToggle = () => {
    onEditModeChange(true);
    setToolMode(toolMode === 'line' ? 'select' : 'line');
    closeActivePanel();
  };

  const handleCreateDragStart = (nodeType: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'create-node',
      nodeType
    }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const createGroups = useMemo(() => ([
    {
      id: 'text',
      title: t('canvas.toolbarLeft.sections.text', { default: 'Text' }),
      items: [
        {
          nodeType: 'text',
          label: t('canvas.toolbarLeft.items.text', { default: 'Text' }),
          icon: Type,
          title: t('canvas.toolbarLeft.createText', { default: 'Drag to create Text node' })
        },
        {
          nodeType: 'todo',
          label: t('canvas.toolbarLeft.items.todo', { default: 'To-do' }),
          icon: CheckSquare,
          title: t('canvas.toolbarLeft.createTodo', { default: 'Drag to create To-Do node' })
        },
        {
          nodeType: 'table',
          label: t('canvas.toolbarLeft.items.table', { default: 'Table' }),
          icon: Table,
          title: t('canvas.toolbarLeft.createTable', { default: 'Drag to create Table node' })
        },
        {
          nodeType: 'column',
          label: t('canvas.toolbarLeft.items.column', { default: 'Column' }),
          icon: LayoutPanelLeft,
          title: t('canvas.toolbarLeft.createColumn', { default: 'Drag to create Column node' })
        }
      ]
    },
    {
      id: 'code',
      title: t('canvas.toolbarLeft.sections.code', { default: 'Code' }),
      items: [
        {
          nodeType: 'mermaid',
          label: t('canvas.toolbarLeft.items.mermaid', { default: 'Mermaid' }),
          icon: Workflow,
          title: t('canvas.toolbarLeft.createMermaid', { default: 'Drag to create Mermaid node' })
        },
        {
          nodeType: 'html',
          label: t('canvas.toolbarLeft.items.html', { default: 'HTML' }),
          icon: FileCode2,
          title: t('canvas.toolbarLeft.createHTML', { default: 'Drag to create HTML node' })
        },
        {
          nodeType: 'canvas-link',
          label: t('canvas.toolbarLeft.items.link', { default: 'Canvas link' }),
          icon: Link2,
          title: t('canvas.toolbarLeft.createLink', { default: 'Drag to create Canvas Link node' })
        }
      ]
    }
  ]), [t]);

  const filteredCreateGroups = useMemo(() => {
    if (activePanel === 'text') {
      return createGroups.filter((group) => group.id === 'text');
    }
    if (activePanel === 'code') {
      return createGroups.filter((group) => group.id === 'code');
    }
    return [];
  }, [activePanel, createGroups]);

  const selectionStylePanel = hasSelectedGroup
    ? 'group'
    : hasSelectedConnectionsOnly
    ? 'connection'
    : hasSelectedNodes
    ? 'node'
    : null;

  const showCreatePanel = activePanel === 'text' || activePanel === 'code';
  const showGlobalStylePanel = activePanel === 'style';
  const showSelectionInline = !activePanel && Boolean(selectionStylePanel);

  useEffect(() => {
    if (selectionStylePanel && activePanel) {
      setActivePanel(null);
    }
  }, [selectionStylePanel, activePanel]);

  const PanelShell: React.FC<{
    title?: string;
    onClose?: () => void;
    bodyClassName?: string;
    className?: string;
    contentClassName?: string;
    showTitle?: boolean;
    children: React.ReactNode;
  }> = ({ title, onClose, bodyClassName, className, contentClassName, showTitle = true, children }) => {
    const hasHeader = Boolean(onClose) || Boolean(showTitle && title);
    const rootClassName = [
      'relative rounded-2xl border border-border/60 bg-card/95 text-foreground shadow-xl backdrop-blur-sm',
      className || 'w-64'
    ]
      .filter(Boolean)
      .join(' ');
    const contentClass = ['relative', contentClassName || 'p-3', 'text-foreground']
      .filter(Boolean)
      .join(' ');

    return (
      <div className={rootClassName} aria-label={title}>
        <div className="absolute inset-0 rounded-2xl bg-background/60" />
        <div className={contentClass}>
          {hasHeader ? (
            <div className="flex items-center justify-between">
              {showTitle && title ? (
                <div className="text-sm font-medium">{title}</div>
              ) : (
                <div />
              )}
              {onClose ? (
                <button
                  onClick={onClose}
                  className="w-6 h-6 rounded-md hover:bg-accent/60 flex items-center justify-center transition-all duration-150"
                  title={t('canvas.toolbarLeft.actions.closePanel', { default: 'Close panel' })}
                >
                  <X size={12} className="text-muted-foreground" />
                </button>
              ) : null}
            </div>
          ) : null}
          <div className={bodyClassName || (hasHeader ? 'mt-3 space-y-3' : 'space-y-3')}>
            {children}
          </div>
        </div>
      </div>
    );
  };

  const panelContent = (() => {
    if (showCreatePanel) {
      const panelTitle = activePanel === 'text'
        ? t('canvas.toolbarLeft.panels.text', { default: 'Text' })
        : t('canvas.toolbarLeft.panels.code', { default: 'Code' });

      return (
        <PanelShell
          title={panelTitle}
          showTitle={false}
          className="w-14"
          contentClassName="p-2"
          bodyClassName="flex flex-col items-center gap-2 py-1"
        >
          {filteredCreateGroups.map((group, groupIndex) => (
            <React.Fragment key={group.id}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.nodeType}
                    type="button"
                    draggable
                    onDragStart={handleCreateDragStart(item.nodeType)}
                    className="h-10 w-10 rounded-xl flex items-center justify-center cursor-grab transition-all duration-150 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    title={item.title}
                    aria-label={item.label}
                  >
                    <Icon size={18} />
                  </button>
                );
              })}
              {groupIndex < filteredCreateGroups.length - 1 ? (
                <div className="h-px w-6 bg-border/70" />
              ) : null}
            </React.Fragment>
          ))}
        </PanelShell>
      );
    }

    if (showGlobalStylePanel) {
      return (
        <div className="relative w-72 rounded-[var(--canvas-panel-radius)] border border-border/60 bg-card/95 shadow-xl backdrop-blur-sm overflow-hidden">
          <div className="absolute inset-0 rounded-[var(--canvas-panel-radius)] bg-background/60" />
          <StylePanelContent
            selectedFont={fontStyle}
            selectedBackground={backgroundStyle}
            selectedCorner={cornerStyle}
            backgroundColor={backgroundColor}
            patternColor={patternColor}
            onFontChange={onFontStyleChange}
            onBackgroundChange={onBackgroundStyleChange}
            onCornerChange={onCornerStyleChange}
            onBackgroundColorChange={onBackgroundColorChange}
            onPatternColorChange={onPatternColorChange}
          />
        </div>
      );
    }

    return null;
  })();

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 z-20 left-4"
      onMouseEnter={clearHoverCloseTimer}
      onMouseLeave={scheduleHoverClose}
    >
      <div className="flex flex-col items-center gap-2">
        {/* Mode switch - always visible, separate block at top */}
        <div className="relative flex flex-col items-center gap-2 rounded-[var(--canvas-panel-radius)] border border-border/60 bg-background/80 px-2 py-3 shadow-xl backdrop-blur-sm" onMouseEnter={closeActivePanel}>
          {/* Sliding indicator */}
          <div
            className="absolute top-0 left-2 right-2 h-10 rounded-2xl bg-card shadow-md ring-1 ring-border/60 transition-all duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] pointer-events-none"
            style={{ transform: `translateY(${currentMode === 'chat' ? '60px' : '12px'})` }}
          />
          <button
            type="button"
            onClick={handleSelectButtonClick}
            className={`relative z-10 h-10 w-10 rounded-2xl flex items-center justify-center transition-all duration-200 ${
              currentMode !== 'chat'
                ? 'text-foreground scale-100'
                : 'text-muted-foreground hover:text-foreground scale-95 opacity-70 hover:opacity-100'
            }`}
            title={currentMode === 'drag' ? modeLabels.drag : modeLabels.select}
            aria-label={currentMode === 'drag' ? modeLabels.drag : modeLabels.select}
            aria-pressed={currentMode !== 'chat'}
          >
            {currentMode === 'drag' ? <Hand size={18} /> : <MousePointer2 size={18} />}
          </button>
          <button
            type="button"
            onClick={() => handleModeSelect('chat')}
            className={`relative z-10 h-10 w-10 rounded-2xl flex items-center justify-center transition-all duration-200 ${
              currentMode === 'chat'
                ? 'text-foreground scale-100'
                : 'text-muted-foreground hover:text-foreground scale-95 opacity-70 hover:opacity-100'
            }`}
            title={modeLabels.chat}
            aria-label={modeLabels.chat}
            aria-pressed={currentMode === 'chat'}
          >
            <MessageSquare size={18} />
          </button>
        </div>

        {/* Main toolbar + panel */}
        <div className="relative">
        <div
          ref={toolbarRef}
          className="flex flex-col items-center gap-2 rounded-[var(--canvas-panel-radius)] border border-border/60 bg-background/80 px-2 py-3 shadow-xl backdrop-blur-sm"
        >
          {showSelectionInline ? (
            selectionStylePanel === 'group' ? (
              <GroupStylePanel
                selectedGroup={selectedGroup as CanvasNode}
                onStyleChange={onGroupStyleChange || (() => {})}
              />
            ) : selectionStylePanel === 'connection' ? (
              <ConnectionStylePanel />
            ) : (
              <NodeStylePanel
                selectedNodes={selectedNodes}
                onStyleChange={onNodeStyleChange || (() => {})}
                onAlignment={onNodeAlignment}
              />
            )
          ) : (
            <>
              <button
                onClick={handleLineToolToggle}
                onMouseEnter={closeActivePanel}
                className={`h-10 w-10 rounded-2xl flex items-center justify-center transition-all duration-150 ${
                  toolMode === 'line'
                    ? 'bg-card text-foreground shadow-sm ring-1 ring-border/60'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}
                title={t('canvas.toolbarLeft.tools.line', { default: 'Line tool' })}
                aria-pressed={toolMode === 'line'}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M2.7 15.1L12.6 5.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                  <path d="M10.6 2.7L16.9 1.1L15.3 7.4Z" fill="currentColor" />
                </svg>
              </button>

              <button
                onClick={(event) => handlePanelToggle('text', event.currentTarget)}
                onMouseEnter={(event) => openPanel('text', event.currentTarget)}
                className={`h-10 w-10 rounded-2xl flex items-center justify-center transition-all duration-150 ${
                  activePanel === 'text'
                    ? 'bg-card text-foreground shadow-sm ring-1 ring-border/60'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}
                title={t('canvas.toolbarLeft.tools.text', { default: 'Text' })}
                aria-pressed={activePanel === 'text'}
              >
                <Type size={18} />
              </button>

              <button
                onClick={(event) => handlePanelToggle('code', event.currentTarget)}
                onMouseEnter={(event) => openPanel('code', event.currentTarget)}
                className={`h-10 w-10 rounded-2xl flex items-center justify-center transition-all duration-150 ${
                  activePanel === 'code'
                    ? 'bg-card text-foreground shadow-sm ring-1 ring-border/60'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}
                title={t('canvas.toolbarLeft.tools.code', { default: 'Code' })}
                aria-pressed={activePanel === 'code'}
              >
                <Code2 size={18} />
              </button>

              <button
                type="button"
                draggable
                onMouseEnter={closeActivePanel}
                onDragStart={handleCreateDragStart('media-audio')}
                className="h-10 w-10 rounded-2xl flex items-center justify-center transition-all duration-150 cursor-grab text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                title={t('canvas.toolbarLeft.createAudio', { default: 'Drag to start recording audio' })}
                aria-label={t('canvas.toolbarLeft.items.audio', { default: 'Audio' })}
              >
                <Mic size={18} />
              </button>

              <button
                onClick={(event) => handlePanelToggle('style', event.currentTarget)}
                onMouseEnter={(event) => openPanel('style', event.currentTarget)}
                className={`h-10 w-10 rounded-2xl flex items-center justify-center transition-all duration-150 ${
                  activePanel === 'style'
                    ? 'bg-card text-foreground shadow-sm ring-1 ring-border/60'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}
                title={t('canvas.toolbarLeft.tools.style', { default: 'Canvas style' })}
                aria-pressed={activePanel === 'style'}
              >
                <Palette size={18} />
              </button>
            </>
          )}
        </div>

        {panelContent ? (
          <div
            className={`absolute left-full ml-1 animate-in fade-in duration-150 ${
              activePanel === 'style' ? 'slide-in-from-right-2' : 'slide-in-from-left-2'
            }`}
            style={activePanel === 'style' ? { top: panelAnchorBottom } : { top: panelAnchorTop }}
            onMouseEnter={clearHoverCloseTimer}
            onMouseLeave={scheduleHoverClose}
          >
            <div style={activePanel === 'style' ? { transform: 'translateY(-100%)' } : undefined}>
              {panelContent}
            </div>
          </div>
        ) : null}
        </div>
      </div>

    </div>
  );
};

export default LeftVerticalToolbar;
