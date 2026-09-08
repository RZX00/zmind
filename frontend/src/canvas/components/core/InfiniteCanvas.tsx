// 🎨 无限画布主组
// 整合所有节点类型和交互功能
'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import {useTranslations} from 'next-intl';
import { useTheme } from 'next-themes';
import {
  ArrowRight,
  MousePointer2,
  Sparkles,
  Link2,
  Type,
  Image as ImageIcon,
  ClipboardList,
  FileText,
  Play,
} from 'lucide-react';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import EditorManager from '../editors/EditorManager';
import CanvasSelectionModal, { type CanvasSelectionResult, type CanvasOption } from '../shared/CanvasSelectionModal';
import { ExpandedTextEditorDialog } from '../../presentation/expanded-editor/ExpandedTextEditorDialog';
import type { NovelAiRequest, NovelEditorSnapshot } from '@/components/editor/novel';
import ToolModeSelector from '../shared/toolbar/ToolModeSelector';
import { UnifiedContextMenu } from '@/components/ui/context-menu';
import { generateBackgroundStyle } from '../../utils/backgroundStyle';
import { BACKGROUND_STYLES, type BackgroundStyle } from '../../constants/backgroundStyles';
import { DEFAULT_CORNER_STYLE } from '../../constants/cornerStyles';
import type { CornerStyle } from '../../types/canvas';

import type { Canvas, CanvasNode, CanvasToolMode, FontStyle, CanvasConnection, MediaNode } from '../../types/canvas';
import { AlignmentType } from '../../services/canvas-node-alignment.service';

const SNAP_COMMIT_TOLERANCE_PX = 4;
const SNAP_PREVIEW_TOLERANCE_PX = 8;
const SNAP_MAX_DELTA_PX = 6;

// 📍 局部类型定 
interface Position { x: number; y: number; }
import { updateNode, deleteNode, isPositionInColumn, moveNodeToColumn, DEFAULT_FONT_STYLE, getNodeParentColumn, createConnection, generateId, calculateSvgNodeSize, computeGlobalOverlapReflow, mergeConnectionAppearance } from '../../utils/canvasUtils';
import { NodeIds } from '../../utils/nodeIdUtils';
import { getFilesFromDragEvent, createMediaNode, logFileInfo, isImageFile, parseExternalVideoUrl } from '../../utils/mediaUtils';
import { DEFAULT_NODE_SIZES } from '../../types/canvas';
import { uploadFileToStorage, uploadFileToKnowledgeBase } from '../../services/canvas-media.service';
import { fetchExternalVideoMetadata } from '../../services/external-video.service';
import { transcribeAudio } from '@/lib/api';
import { DEFAULT_MAX_FILE_SIZE_BYTES } from '@/lib/constants/files';
import { useFileStorageUsage } from '@/hooks/react-query/files';
import { hasCanvasChanged } from '../../utils/canvasChangeDetection';
import { useCanvasKeyboard } from '../../hooks/useCanvasKeyboard';
import { ensureMindmapGroup, addMindmapChild, addMindmapSibling, tidyLayout, applyLayout, findMindmapGroupForNode, autoSnapOrDetachOnDragEnd, predictMindmapDragResult, MindmapDragPreview, computeSyncedGroupGeometry, resolveOverlapsAfterChange } from '../../utils/mindmapLayout';
import { getRotatingGroupColorByIndex, getHiddenMindmapNodesForGroup } from '../../utils/groupUtils';
import { useCanvasContextMenu } from '../../hooks/useCanvasContextMenu';
import { useCanvasStore } from '../../stores/canvas.store';
import {
  useCanvas,
  useSelectedNodeIds,
  useSelectedConnectionIds,
  useSelectedGroupId,
  useViewZoom,
  useIsPanningLocked,
  useIsConnecting,
  useConnectionStart,
  useDraggingNodeId,
  useDragTargetColumnId,
  useToolMode,
  useEditMode,
  useEditingEntityId,
  useAIProcessing,
  useViewTransform,
  useViewportSize,
} from '../../hooks/useCanvasSelector';
import { useCanvasCoordinates } from '../../hooks/useCanvasCoordinates';
import { useSettingsStore } from '../../stores/settings.store';
import { queryPoint } from '../../utils/spatialIndex';
 
import { createNodeAtPosition, createNode } from './systems/NodeFactory';
import { buildMindmapFromMarkdown } from '../../utils/markdownMindmap';
import { toast } from 'sonner';
import { performanceMonitor } from '../shared/playback/PerformanceMonitor';
import { performanceOptimizer } from '../shared/playback/PerformanceOptimizer';
import { onFocusChange, offFocusChange } from '../shared/playback/CameraAnimator';
import PlaybackContainer from '../shared/playback/PlaybackContainer';
import { calculateCanvasBounds, calculateGroupBounds } from './systems/CoordinateSystem';
import { applyColumnLayout, computeInsertionIndex, adjustNodeSizeForColumn } from './systems/ColumnLayout';
import { normalizeTodoContent, computeTodoCompletion, parseTodoContent } from '../../utils/todoUtils';
import {
  calculateTextHeightWithLayout,
  estimateMindmapAutoTextWidth,
  resolveTextLayoutPreset,
} from '../../domain/text-layout/textLayoutService';
import { useTemporaryGroup } from '../../hooks/useTemporaryGroup';
import GroupBoundingBox from '../shared/GroupBoundingBox';
import GroupBackgrounds from '../shared/groups/GroupBackgrounds';
import MindmapHandles from '../shared/groups/MindmapHandles';
import ConnectionsLayer from './layers/ConnectionsLayer';
import NodesLayer from './layers/NodesLayer';
import OverlaysLayer from './layers/OverlaysLayer';
import RemoteSelectionLayer from './overlays/RemoteSelectionLayer';
import type { Collaborator } from '@/canvas/collaboration/useCanvasCollaboration';
import type { GuideLine, DistanceHint, GuideSession, ResizeHandle } from '../../../domain/guides';
import { buildCanvasSnapshot, createGuidesController } from '../../../application/guides';
import {
  saveExpandedEditorUseCase,
  type SaveExpandedEditorResult,
} from '../../application/expanded-editor/save-expanded-editor.usecase';
import { requestExpandedEditorAiCompletionUseCase } from '../../application/expanded-editor/request-ai-completion.usecase';
import { CanvasSelectionAiAdapter } from '../../infrastructure/expanded-editor/canvas-selection-ai.adapter';
import { EXPANDED_EDITOR_DATA_KEY } from '../../domain/expanded-editor/types';
import { getGuideOptions } from '../../../infrastructure/guides/settingsRepository';
import { buildBaselineMap } from '../../../infrastructure/guides/baselineProvider';
import useNodesDnd from './interactions/useNodesDnd';
import useConnectionsEditing from './interactions/useConnectionsEditing';
import useCanvasLinkWorkflow from './interactions/useCanvasLinkWorkflow';
import useBoxSelection from './interactions/useBoxSelection';
import useCanvasViewModel from './viewmodel/useCanvasViewModel';
import useCanvasInteractions from './interactions/useCanvasInteractions';
import useGroups from './interactions/useGroups';
import canvasViewStateService, { clampScale as clampViewScale, computeCenterFromPosition, computePositionFromCenter } from '../../services/canvas-view-state.service';
import { snapFreeLineToAxis } from '../../utils/freeLineSnap';
import { computeOverlapShadowMap } from '../../utils/overlapShadow';

const FREE_LINE_SNAP_THRESHOLD_DEG = 1;

const BACKGROUND_WORLD_SIZE = 200000;
const BACKGROUND_WORLD_OFFSET = -BACKGROUND_WORLD_SIZE / 2;

interface InfiniteCanvasProps {
  canvas?: Canvas;  // 改为受控的canvas属
  isEditMode?: boolean;
  toolMode?: CanvasToolMode; // 工具模式
  backgroundStyle?: BackgroundStyle; // 背景样式
  cornerStyle?: CornerStyle; // 圆角样式
  fontStyle?: FontStyle; // 字体样式
  backgroundColor?: string; // 背景颜色
  patternColor?: string; // 图案颜色
  enableAgent?: boolean; // 启用Agent助手
  showAgentPanel?: boolean; // 显示Agent面板
  showEditorPanel?: boolean; // 显示编辑器面
  enablePlayback?: boolean; // 启用回放功能
  playState?: 'idle' | 'playing' | 'paused'; // 播放状态（从顶部栏传递）
  onPlayStateChange?: (state: 'idle' | 'playing' | 'paused') => void; // 播放状态变化回
  onCanvasChange?: (canvas: Canvas) => void;
  onNodeClick?: (nodeId: string) => void;
  onCanvasClick?: () => void;
  onSelectedNodesChange?: (selectedNodes: CanvasNode[]) => void; // 选中节点变化回调
  onSelectedGroupChange?: (groupNode: CanvasNode | null) => void; // 选中组变化回调（group节点
  onAgentToggle?: (enabled: boolean) => void; // Agent面板切换回调
  onEditorPanelToggle?: () => void; // 编辑器面板切换回
  onEditModeChange?: (mode: boolean) => void; // 编辑模式切换回调
  onToolModeChange?: (mode: CanvasToolMode) => void; // 工具模式切换回调
  // Canvas Link相关回调
  onCanvasNavigate?: (targetCanvasId: string) => void; // 画布导航回调
  onRefreshThumbnail?: (nodeId: string) => void; // 缩略图刷新回
  onCreateCanvas?: (name: string) => Promise<string>; // 创建画布回调
  onGetAvailableCanvases?: () => Promise<Array<{id: string, title: string, lastUpdated: number}>>; // 获取可用画布回调
  onCanvasExists?: (canvasId: string) => Promise<boolean>; // 检查画布是否存在回
  onExpandedEditorStateChange?: (state: { open: boolean; nodeId: string | null }) => void;
  openExpandedEditorRequestId?: number;
  openExpandedEditorNodeId?: string | null;
  // 新增：只读模式（共享视图使用
  readOnly?: boolean;
  // 协作者在线状态（用于远端选区/光标叠加层）
  collaborators?: Collaborator[];
}

// Schedule DOM-based optimize size for pasted mindmap nodes (retry across frames until mounted)
// scheduleOptimizeMindmapNodes removed per request (no auto run of Optimize Size after paste)

const InfiniteCanvas: React.FC<InfiniteCanvasProps> = ({
  canvas: externalCanvas,
  isEditMode = true,
  // toolMode从Store获取，移除props参数
  backgroundStyle = BACKGROUND_STYLES[0], // 默认使用点阵
  cornerStyle = DEFAULT_CORNER_STYLE,
  fontStyle = DEFAULT_FONT_STYLE, // 默认字体样式
  backgroundColor = '#eeeded',
  patternColor = '#C7C9CA',
  showAgentPanel = false,
  playState = 'idle',
  onPlayStateChange,
  showEditorPanel = false,
  enablePlayback = true, // 默认启用回放功能
  onCanvasChange,
  onNodeClick,
  onCanvasClick,
  onSelectedNodesChange,
  onSelectedGroupChange,
  onAgentToggle,
  onEditorPanelToggle,
  onToolModeChange,
  // Canvas Link相关回调
  onCanvasNavigate,
  onRefreshThumbnail,
  onCreateCanvas,
  onGetAvailableCanvases,
  onCanvasExists,
  onExpandedEditorStateChange,
  openExpandedEditorRequestId = 0,
  openExpandedEditorNodeId = null,
  readOnly = false,
  collaborators = []
}) => {
  const t = useTranslations();
  const { data: storageUsage } = useFileStorageUsage(!readOnly);
  const maxFileBytes = storageUsage?.max_file_bytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const [roToolMode, setRoToolMode] = useState<CanvasToolMode>('select');
  const previousNonLineToolModeRef = useRef<string>('select');
  // 播放态引用：播放时冻结全局transform写入，结束后一次性flush
  const playStateRef = useRef<'idle' | 'playing' | 'paused'>(playState);
  useEffect(() => { playStateRef.current = playState; }, [playState]);
  // 统一管理组件内的定时器句柄，便于卸载时清理，防止内存泄漏
  const positionUpdateTimeoutRef = useRef<Record<string, number | ReturnType<typeof setTimeout>>>({});
  // 思维导图布局防抖定时器（按组
  const mindmapLayoutTimersRef = useRef<Map<string, number | ReturnType<typeof setTimeout>>>(new Map());
  const nodeRefs = useRef<Map<string, HTMLElement>>(new Map());
  const handleRegisterNodeRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (!el) {
      nodeRefs.current.delete(id);
    } else {
      nodeRefs.current.set(id, el);
    }
  }, []);
  const transientPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const transientRafRef = useRef<number | null>(null);
  const [transientVersion, setTransientVersion] = useState(0);
  const scheduleTransientFlush = useCallback(() => {
    if (transientRafRef.current) return;
    transientRafRef.current = requestAnimationFrame(() => {
      transientRafRef.current = null;
      setTransientVersion((v) => v + 1);
    });
  }, []);
  useEffect(() => () => {
    if (transientRafRef.current) cancelAnimationFrame(transientRafRef.current);
  }, []);

  // 🚀 统一状态管理：直接使用Store状态，消除internalCanvas
  const canvas = useCanvas();

  // 🚀 统一状态管理：使用Store中的状态替代本地useState
  const selectedNodeIds = useSelectedNodeIds();
  const currentZoom = useViewZoom();
  const isPanningLocked = useIsPanningLocked();
  const isConnecting = useIsConnecting();
  const connectionStart = useConnectionStart();
  const draggingNodeId = useDraggingNodeId();
  const dragTargetColumnId = useDragTargetColumnId();
  const toolMode = useToolMode();
  useEffect(() => {
    if (toolMode !== 'line') {
      previousNonLineToolModeRef.current = toolMode;
    }
  }, [toolMode]);
  const handleToolModeChange = (mode: CanvasToolMode) => {
    interactions.handleToolModeChange(mode);
  };
  const editMode = useEditMode();
  const editingEntityId = useEditingEntityId();
  const isAIProcessing = useAIProcessing();
  const selectedConnectionIds = useSelectedConnectionIds();
  const selectedGroupId = useSelectedGroupId();

  // 直接绑定Store 的动作，避免整店订阅导致的重渲染
  const {
    setCanvas: setCanvasState,
    duplicateNode,
    selectNodes: selectNodesAction,
    selectGroup: selectGroupAction,
    selectConnections: selectConnectionsAction,
    updateNode: updateNodeAction,
    applyCanvasOps: applyCanvasOpsAction,
    setTransform,
    enterEditMode,
    setPanningLocked,
    addNode: addNodeAction,
    setViewportSize,
    selectSingleNode,
    setPersistenceDisabled,
    startConnection,
    cancelConnection,
    cancelEdit,
    setToolMode,
  } = useCanvasStore.getState();
  const exitLineModeToPrevious = useCallback(() => {
    const prev = previousNonLineToolModeRef.current;
    const nextMode: CanvasToolMode = prev === 'hand' ? 'hand' : 'select';
    try { setToolMode(nextMode); } catch {}
  }, [setToolMode]);

  const lastExternalInjectionRef = useRef<{ canvas: Canvas | null; readOnly: boolean | null }>({
    canvas: null,
    readOnly: null,
  });

  // 保持对外部Canvas的兼容性：仅在传入的 externalCanvas 真实变化时同步
  useEffect(() => {
    if (!externalCanvas) return;
    if (
      lastExternalInjectionRef.current.canvas === externalCanvas
      && lastExternalInjectionRef.current.readOnly === readOnly
    ) {
      return;
    }
    lastExternalInjectionRef.current = { canvas: externalCanvas, readOnly };
    const canvasStore = useCanvasStore.getState();
    try {
      if (readOnly) {
        // 分享/只读视图：注水但不触发持久化写入
        (canvasStore as any).hydrateCanvasForView?.(externalCanvas);
      } else {
        canvasStore.setCanvas(externalCanvas);
      }
    } catch {
      canvasStore.setCanvas(externalCanvas);
    }
  }, [externalCanvas, readOnly]);
  // 统一使用当前渲染用的画布对象
  const renderedCanvasRef = useRef<Canvas | null>(null);
  useEffect(() => {
    renderedCanvasRef.current = canvas || null;
  }, [canvas]);

  // 视图模型 Hook 将提供空间索引引
  
  // 🎯 群组拖拽功能集成
  const { 
    activeGroup, 
    createGroup, 
    updateGroupBounds,
    setGroupDragging,
    destroyGroup, 
    isGroupActive 
  } = useTemporaryGroup();
  
  // 🎯 群组拖拽状- 使用Ref避免闭包问题
  const groupDragStateRef = useRef<{
    isDragging: boolean;
    startMousePos: Position | null;
    startNodePositions: Map<string, Position> | null;
    startConnectionPositions: Map<string, { from?: Position; to?: Position; anchor?: Position; controls?: Position[] }> | null;
    nodeIds: Set<string> | null;
    createdFromPermanent: boolean;
    permanentGroupId: string | null;
  }>({
    isDragging: false,
    startMousePos: null,
    startNodePositions: null,
    startConnectionPositions: null,
    nodeIds: null,
    createdFromPermanent: false,
    permanentGroupId: null
  });

  // 🎯 群组整体缩放状态（框选边界右下角手柄
  const groupScaleStateRef = useRef<{
    isScaling: boolean;
    groupCenter: Position;
    baseRadius: number;
    nodeSnapshots: Array<{
      id: string;
      centerX: number;
      centerY: number;
      width: number;
      height: number;
      locked?: boolean;
      type?: string;
    }>;
  } | null>(null);
  
  // 🚀 已迁移到Store：编辑状态通过editMode和editingEntityId管理
  // const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  // const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);

  // 🎯 派生值：从Store状态计算editingNodeId，保持向后兼
  const editingNodeId = editMode === 'node' ? editingEntityId : null;
  // 🔒 当编辑群组标签时，锁定该群组以防止拖拽移
  const [lockedGroupId, setLockedGroupId] = useState<string | null>(null);
  const [expandedEditorNodeId, setExpandedEditorNodeId] = useState<string | null>(null);
  // 合并文本节点编辑与群组标签编辑的锁定状态，统一禁用平移/缩放/拖拽
  const editingLockId = editingNodeId || lockedGroupId;
  
  // ==================== Shared helpers: media files handling ====================
  // (moved below after updateCanvasRef to avoid TDZ issues)


  // 连接编辑交互（抽离）
  
  // 画布滚轮锁（当节点内部需要接管滚轮时
  const [isWheelLocked, setIsWheelLocked] = useState(false);
  
  // Canvas Link 选择弹窗状态由 useCanvasLinkWorkflow 管理
  
  // 📦 框选功能（抽离
  
  // 🎯 拖拽阈值常- 区分单击与拖拽的距离阈值（像素
  const DRAG_THRESHOLD = 8;
  const [previewSelectedNodes, setPreviewSelectedNodes] = useState<Set<string>>(new Set());
  // 🖊自由连线(线条工具)临时状态（屏幕坐标
  const [freeLine, setFreeLine] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);

  // 统一交互（右键拖平移、工具模式委托、上下文菜单辅助
  // 延后初始化到 effectiveToolMode 就绪
  
  // 🤖 AI输入栏状
  // 🚀 已迁移到Store：AI状态通过aiState管理
  // const [isAIInputExpanded, setIsAIInputExpanded] = useState<boolean>(false);
  // const [internalAIProcessing, setInternalAIProcessing] = useState<boolean>(false);
  
  // 🔄 智能布局处理状- 使用Store中的AI状

  // 🚀 后台性能系统：仅在播放进行时启动，退出播放立即让出主线程
  useEffect(() => {
    if (!enablePlayback) return;
    if (playState === 'playing') {
      performanceMonitor.startMonitoring();
      performanceOptimizer.startOptimization();
      return () => {
        performanceMonitor.stopMonitoring();
        performanceOptimizer.stopOptimization();
      };
    }
    performanceMonitor.stopMonitoring();
    performanceOptimizer.stopOptimization();
    return () => {};
  }, [enablePlayback, playState]);

  // 🔧 更新画布的统一方法 - 必须在其他函数之前定

  const viewTransform = useViewTransform();
  const viewportSize = useViewportSize();
  // 视图模型（提供空间索引等派生
  const viewModel = useCanvasViewModel({
    canvas,
    externalCanvas,
    transformRef: transformRef as React.RefObject<ReactZoomPanPinchRef>,
    viewTransform,
    viewportSize,
  });

  // 🎯 使用视图模型的派生
  const geometryVersion = canvas?.updatedAt ?? 0;
  const canvasBounds = viewModel.canvasBounds;
  const visibleNodes = viewModel.visibleNodes;

  const computeFitTransform = useCallback((nodes: CanvasNode[] | undefined, viewport: { width: number; height: number } | null) => {
    if (!nodes || nodes.length === 0 || !viewport || viewport.width <= 0 || viewport.height <= 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    nodes.forEach((node) => {
      const left = node.x;
      const top = node.y;
      const right = left + node.width;
      const bottom = top + node.height;
      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, right);
      maxY = Math.max(maxY, bottom);
    });
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
    const padding = 50;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    if (contentWidth <= 0 || contentHeight <= 0) return null;
    const contentCenterX = minX + contentWidth / 2;
    const contentCenterY = minY + contentHeight / 2;
    const scaleX = viewport.width / contentWidth;
    const scaleY = viewport.height / contentHeight;
    const unclampedScale = Math.min(scaleX, scaleY, 1);
    const scale = clampViewScale(unclampedScale, 0.1, 3);
    const positionX = (viewport.width / 2) - (contentCenterX * scale);
    const positionY = (viewport.height / 2) - (contentCenterY * scale);
    return { scale, positionX, positionY };
  }, []);

  const savedView = useMemo(() => {
    if (!canvas?.id) return null;
    return canvasViewStateService.loadView(canvas.id);
  }, [canvas?.id]);

  const initialTransform = useMemo(() => {
    if (savedView) {
      const scale = clampViewScale(savedView.scale, 0.1, 3);
      let positionX = typeof savedView.positionX === 'number' ? savedView.positionX : 0;
      let positionY = typeof savedView.positionY === 'number' ? savedView.positionY : 0;
      const hasViewport = viewportSize?.width > 0 && viewportSize?.height > 0;
      const restoreViewport = hasViewport ? viewportSize : (savedView.viewport || null);
      if (restoreViewport && typeof savedView.centerX === 'number' && typeof savedView.centerY === 'number') {
        const pos = computePositionFromCenter(savedView.centerX, savedView.centerY, scale, restoreViewport);
        positionX = pos.positionX;
        positionY = pos.positionY;
      }
      return { scale, positionX, positionY };
    }
    if (viewportSize?.width > 0 && viewportSize?.height > 0) {
      const fit = computeFitTransform(canvas?.nodes, viewportSize);
      if (fit) return fit;
    }
    return null;
  }, [savedView, viewportSize, canvas?.nodes, computeFitTransform]);

  const hasInitialTransform = Boolean(initialTransform);

  // ==================== 视口持久化（本地====================
  const saveViewTimerRef = useRef<number | null>(null);
  const canvasId = canvas?.id;
  const canvasUpdatedAt = canvas?.updatedAt;
  const doSaveView = useCallback(() => {
    try {
      const api: any = transformRef.current;
      if (!api || !api.state || !canvasId) return;
      const { scale, positionX, positionY } = api.state;
      // 获取 viewport 尺寸（优store，其次直接从 wrapper
      let vp = useCanvasStore.getState().viewState?.viewport;
      if (!vp || !vp.width || !vp.height) {
        const wrapperEl = api?.instance?.wrapperComponent as HTMLElement | undefined;
        if (wrapperEl) {
          const rect = wrapperEl.getBoundingClientRect();
          vp = { width: Math.round(rect.width), height: Math.round(rect.height) } as any;
        }
      }
      // 计算中心点（视口无效时仍按像素保存，兼容退化）
      const stateToSave = vp && vp.width && vp.height
        ? (() => {
            const { centerX, centerY } = computeCenterFromPosition(positionX, positionY, scale, vp);
            return { scale, centerX, centerY, viewport: { width: vp.width, height: vp.height } } as const;
          })()
        : ({ scale, positionX, positionY } as const);
      canvasViewStateService.saveView(
        canvasId,
        stateToSave as any,
        { contentHash: String(geometryVersion), canvasUpdatedAt }
      );
    } catch {
      // ignore
    }
  }, [transformRef, canvasId, canvasUpdatedAt, geometryVersion]);

  const scheduleSaveView = useCallback(() => {
    if (saveViewTimerRef.current) {
      window.clearTimeout(saveViewTimerRef.current);
      saveViewTimerRef.current = null;
    }
    // 节流保存，减少写入频
    saveViewTimerRef.current = window.setTimeout(() => {
      doSaveView();
      saveViewTimerRef.current = null;
    }, 500);
  }, [doSaveView]);

  // 页面生命周期：在隐藏/卸载前强制保存一次，避免节流导致的状态丢
  useEffect(() => {
    const flushSave = () => {
      if (saveViewTimerRef.current) {
        window.clearTimeout(saveViewTimerRef.current);
        saveViewTimerRef.current = null;
      }
      doSaveView();
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushSave(); };
    window.addEventListener('pagehide', flushSave);
    window.addEventListener('beforeunload', flushSave);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushSave);
      window.removeEventListener('beforeunload', flushSave);
      document.removeEventListener('visibilitychange', onVisibility);
      // 组件卸载也强制保存一
      flushSave();
    };
  }, [doSaveView]);

  // ===== External focus request (for playback camera follow on share page) =====
  useEffect(() => {
    const onFocusBBox = (ev: Event) => {
      try {
        const e = ev as CustomEvent<{ x: number; y: number; w: number; h: number; padding?: number; }>
        const api: any = transformRef.current;
        if (!api) return;
        const outlineOpen = useCanvasStore.getState().viewState.outlineOpen;
        // 当大纲打开时，仅平移到目标，不调整缩放且限制偏移幅度（防止视口波动导致视觉缩放
        // Extract viewport size
        let vp = useCanvasStore.getState().viewState?.viewport as { width: number; height: number } | undefined;
        if (!vp || !vp.width || !vp.height) {
          const wrapperEl = api?.instance?.wrapperComponent as HTMLElement | undefined;
          if (wrapperEl) {
            const rect = wrapperEl.getBoundingClientRect();
            vp = { width: Math.round(rect.width), height: Math.round(rect.height) } as any;
          }
        }
        if (!vp) return;
        const padding = Math.max(0, Math.round((e.detail?.padding ?? 0)));
        const targetW = Math.max(1, e.detail?.w ?? 1) + padding * 2;
        const targetH = Math.max(1, e.detail?.h ?? 1) + padding * 2;
        const keepScale = outlineOpen || !!((e as any).detail?.keepScale);
        const currentScale = api?.state?.scale ?? 1;
        // Compute scale to fit unless keepScale is requested
        const scaleX = vp.width / targetW;
        const scaleY = vp.height / targetH;
        let scale = keepScale ? currentScale : Math.max(0.05, Math.min(scaleX, scaleY));
        // Clamp to wrapper's scale limitations if present
        try {
          const st = api?.state;
          if (st && typeof st.minScale === 'number' && typeof st.maxScale === 'number') {
            scale = Math.max(st.minScale, Math.min(st.maxScale, scale));
          }
        } catch {}
        const centerX = (e.detail?.x ?? 0) + (e.detail?.w ?? 0) / 2;
        const centerY = (e.detail?.y ?? 0) + (e.detail?.h ?? 0) / 2;
        const { positionX, positionY } = computePositionFromCenter(centerX, centerY, scale, { width: vp.width, height: vp.height });
        api.setTransform(positionX, positionY, scale);
        try { useCanvasStore.getState().setTransform({ scale, positionX, positionY }); } catch {}
        try {
          const highlightPadding = Math.max(8, padding);
          setFocusHighlight({
            x: (e.detail?.x ?? 0) - highlightPadding,
            y: (e.detail?.y ?? 0) - highlightPadding,
            w: (e.detail?.w ?? 0) + highlightPadding * 2,
            h: (e.detail?.h ?? 0) + highlightPadding * 2,
          });
          if (focusHighlightTimerRef.current) {
            clearTimeout(focusHighlightTimerRef.current);
            focusHighlightTimerRef.current = null;
          }
          if (typeof window !== 'undefined') {
            focusHighlightTimerRef.current = window.setTimeout(() => {
              setFocusHighlight(null);
              focusHighlightTimerRef.current = null;
            }, 2400);
          }
        } catch {}
      } catch {}
    };
    try { window.addEventListener('canvas:focus-bbox', onFocusBBox as any); } catch {}
    return () => { try { window.removeEventListener('canvas:focus-bbox', onFocusBBox as any); } catch {} };
  }, [transformRef]);

  useEffect(() => {
    return () => {
      if (focusHighlightTimerRef.current) {
        clearTimeout(focusHighlightTimerRef.current);
        focusHighlightTimerRef.current = null;
      }
    };
  }, []);
  
  // 🎯 使用行业标准的纯几何坐标转换Hook
const { screenToCanvas, canvasToScreen, isReady: coordinatesReady, getContainerBounds } = useCanvasCoordinates({
    transformRef: transformRef as React.RefObject<ReactZoomPanPinchRef>,
    containerSelector: '.react-transform-wrapper',
    containerKey: canvas?.id
  });
  
  
  // 🔄 为了兼容现有代码，保留原有的函数
  const screenToCanvasCoords = useCallback((screenX: number, screenY: number) => {
    return screenToCanvas(screenX, screenY);
  }, [screenToCanvas]);

  // 📦 接入框Hook
  const box = useBoxSelection({
    canvas,
    spatialIndexRef: viewModel.spatialIndexRef,
    screenToCanvas: screenToCanvasCoords,
    coordinatesReady,
    setPreviewSelectedNodes: (s) => setPreviewSelectedNodes(s),
    isGroupActive,
    createGroup,
    destroyGroup,
    externalEditingActive: !!editingLockId,
  });

  const updateCanvas = useCallback((newCanvas: Canvas) => {
    const currentCanvas = canvas;


    const hasChanged = hasCanvasChanged(currentCanvas, newCanvas);
    if (!hasChanged) {
      return;
    }
    // 在写入之前，同步所有群组几何（mindmap 折叠过滤内置
    const syncedCanvas = computeSyncedGroupGeometry(newCanvas);
    if (externalCanvas) {
      // 受控模式：通知父组件（父组件会通过服务层保存）
      onCanvasChange?.(syncedCanvas);
    } else {
      // 非受控模式：更新内部状
      setCanvasState(syncedCanvas);
      // 注意：保存由父组件的Zustand Store统一管理
    }
  }, [canvas, externalCanvas, onCanvasChange, setCanvasState]);

  // 🎥 播放聚焦节点跟踪（用于非焦点淡化
  const [playbackFocusId, setPlaybackFocusId] = useState<string | null>(null);
  const [focusHighlight, setFocusHighlight] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const focusHighlightTimerRef = useRef<number | ReturnType<typeof setTimeout> | null>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const accentColor = isDark ? '#8c8273' : '#3b82f6';
  useEffect(() => {
    const handler = (id: string | null) => {
      // 仅在播放态才更新以避免多余渲
      if (playStateRef.current !== 'playing') return;
      setPlaybackFocusId(id || null);
    };
    try { onFocusChange(handler); } catch {}
    return () => {
      try { offFocusChange(handler); } catch {}
      setPlaybackFocusId(null);
    };
  }, []);

  useEffect(() => {
    if (playState !== 'playing') setPlaybackFocusId(null);
  }, [playState]);

  // 🎯 智能居中视图 - 计算内容边界并居
  const fitToView = useCallback(() => {
    if (!transformRef.current) {
      return;
    }
    
    if (!canvas.nodes?.length) {
      transformRef.current.centerView();
      return;
    }

    try {
      const instance = transformRef.current.instance;
      if (!instance) {
        return;
      }
      
      const container = instance.wrapperComponent;
      if (!container) {
        return;
      }
      
      const containerRect = container.getBoundingClientRect();
      const fit = computeFitTransform(canvas.nodes, { width: containerRect.width, height: containerRect.height });
      if (fit) {
        transformRef.current.setTransform(fit.positionX, fit.positionY, fit.scale);
        return;
      }
      transformRef.current.centerView();
    } catch (_error) {
      // 回退到简单的居中
      transformRef.current.centerView();
    }
  }, [canvas.nodes, computeFitTransform]);

  // 🎯 重置视图到原始位置和100%缩放
  const resetView = useCallback(() => {
    if (!transformRef.current) return;
    
    try {
      // 重置00%缩放和原始中心位(0, 0)
      transformRef.current.setTransform(0, 0, 1);
    } catch (_error) {
      // 回退到简单重
      transformRef.current.resetTransform();
    }
  }, []);


  // 清除节点选中状态（供连接编辑等处调用）
  const clearSelectedNodes = useCallback(() => {
    selectNodesAction([]);
    // 🧹 清空选择时销毁群
    if (isGroupActive) {
      destroyGroup();
    }
    selectGroupAction(null);
  }, [isGroupActive, destroyGroup, selectNodesAction, selectGroupAction]);

  // 连接编辑交互（大颗粒抽离Hook
  const connectionsEditing = useConnectionsEditing({
    canvas,
    updateCanvas,
    editMode,
    editingEntityId: editingEntityId as string | null,
    selectedConnectionIds: selectedConnectionIds as Set<string>,
    clearSelectedNodes,
  });

  // 连接编辑保护时间（防止双击后立即触发保存
  const editingStartTimeRef = useRef<number>(0);
  const handleConnectionLabelEditWrapped = useCallback((connectionId: string) => {
    editingStartTimeRef.current = Date.now();
    connectionsEditing.handleLabelEdit(connectionId);
  }, [connectionsEditing]);

  // 🔗 Canvas Link 工作流（抽离
  const link = useCanvasLinkWorkflow({
    canvas,
    updateCanvas,
    onGetAvailableCanvases,
    onCanvasExists,
    onCreateCanvas,
  });


  // 🔗 创建连接的辅助函(集成智能连线算法)
  // 🔗 创建动态智能连接（完全移除静态坐标存储）
  const createConnectionWithStyle = useCallback((fromNodeId: string, toNodeId: string) => {
    const fromNode = canvas?.nodes?.find(n => n.id === fromNodeId);
    const toNode = canvas?.nodes?.find(n => n.id === toNodeId);

    if (!fromNode || !toNode) return null;

    // 🎯 使用语义化连接ID生成器，确保连接ID格式统一
    const base = createConnection(fromNodeId, toNodeId, canvas.id);
    // 应用用户默认样式（存在则覆盖
    try {
      const def = (useSettingsStore.getState()?.connection as any)?.appearanceDefault;
      if (def && typeof def === 'object') {
        const mergedAppearance = mergeConnectionAppearance((base as any).appearance, def);
        return { ...(base as any), ...(mergedAppearance ? { appearance: mergedAppearance } : {}) } as any;
      }
    } catch {}
    return base;
  }, [canvas.nodes, canvas.id]);

  // 🖱节点操作函数
  const handleDeleteNodes = useCallback((nodeIds: string[]) => {
    const newCanvas = nodeIds.reduce((canvas, nodeId) => deleteNode(canvas, nodeId), canvas);
    const updatedCanvas = { ...newCanvas, updatedAt: Date.now() };

    if (externalCanvas && onCanvasChange) {
      onCanvasChange(updatedCanvas);
    } else {
      setCanvasState(updatedCanvas);
    }

    // 清除选中状态（包括临时群组），避免删除后仍残留框群组边界
    clearSelectedNodes();
  }, [canvas, externalCanvas, onCanvasChange, setCanvasState, clearSelectedNodes]);

  // 统一使用 Store duplicateNode，确保语义化ID/历史/持久化一
  const handleDuplicateNodes = useCallback((nodeIds: string[]) => {
    nodeIds.forEach((id) => {
      duplicateNode(id);
    });
  }, [duplicateNode]);

  // 🚀 已迁移到Store：选择状态通过selections管理
  // const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<string>>(new Set());
  // const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  // 🟡 保留本地状态：重命名请求是临时UI状
  const [renameGroupRequestId, setRenameGroupRequestId] = useState<string | null>(null);

  // 🎯 Ctrl+A 全选功- 必须在useCanvasKeyboard之前定义
  const handleSelectAll = useCallback(() => {
    const allVisibleNodeIds = (canvas?.nodes || []).map(node => node.id);
    selectNodesAction(allVisibleNodeIds);
  }, [canvas.nodes, selectNodesAction]);

  // ⌨️ 键盘快捷键Hook - 移到这里避免初始化顺序问
  const { effectiveToolMode: keyboardToolMode } = useCanvasKeyboard({
    enabled: true, // 🔧 显式启用键盘快捷
    enableHistory: true,
    enableSave: true,
    enableDeleteKey: true,
    selectedNodes: Array.from(selectedNodeIds as Set<string>),
    selectedConnections: Array.from(selectedConnectionIds as Set<string>),
    onDeleteNodes: handleDeleteNodes,
    onSelectAll: handleSelectAll, // 🎯 添加全选回
    isEditMode: isEditMode, // 🎯 修复：添加isEditMode参数，Space键需要它
    onDeleteConnections: (connectionIds: string[]) => {
      const updatedConnections = (canvas.connections || []).filter(
        conn => !connectionIds.includes(conn.id)
      );
      const updatedCanvas: Canvas = {
        ...canvas,
        connections: updatedConnections,
        updatedAt: Date.now()
      };
      updateCanvas(updatedCanvas);
      selectConnectionsAction([]);
    },
    // 🧠 思维导图键盘入口：Tab/Enter - 支持编辑状态下的快捷键
    onKeyDown: (event: KeyboardEvent) => {
      const isCtrlOrCmd = event.ctrlKey || event.metaKey;
      if (isCtrlOrCmd && event.shiftKey && event.key === 'Enter') {
        const selectedIds = Array.from(selectedNodeIds as Set<string>);
        if (selectedIds.length === 1) {
          const nodeId = selectedIds[0];
          const selectedNode = canvas.nodes.find((n) => n.id === nodeId);
          if (selectedNode && (selectedNode.type === 'text' || selectedNode.type === 'todo')) {
            event.preventDefault();
            handleOpenExpandedEditor(nodeId);
            return;
          }
        }
      }

      // 编辑模式Chat 模式都允许处理导图快捷键；区别在于：
      // - 编辑模式：Tab 创建子节
      // - Chat 模式：Shift+Tab 创建子节

      const selectId = (() => {
        // 优先使用 store 的单选，其次从集合取首个
        const sid = useCanvasStore.getState().selectedNodeId;
        if (sid) return sid;
        const arr = Array.from(selectedNodeIds as Set<string>);
        return arr.length ? arr[0] : null;
      })();
      if (!selectId) return;

      const currentNode = canvas.nodes.find(n => n.id === selectId);
      if (!currentNode) return;

      // 检查是否在思维导图群组
      const mindmapGroup = findMindmapGroupForNode(canvas, selectId);
      if (!mindmapGroup) {
        // 非编辑状态下的思维导图快捷键处
        const target = event.target as any;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

        if ((isEditMode && event.key === 'Tab' && !event.shiftKey) || (!isEditMode && event.key === 'Tab' && event.shiftKey)) {
          event.preventDefault();
          const _ensured = ensureMindmapGroup(selectId);
          addMindmapChild(selectId);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          addMindmapSibling(selectId);
          return;
        }
        return;
      }

      // 🎯 思维导图编辑状态下的键盘处
      const isCurrentNodeEditing = editingNodeId === selectId;
      const target = event.target as any;
      const isInEditor = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      // Tab/Shift+Tab：创建子节点（编辑模Tab，Chat模式=Shift+Tab
      if ((isEditMode && event.key === 'Tab' && !event.shiftKey) || (!isEditMode && event.key === 'Tab' && event.shiftKey)) {
        event.preventDefault();

        if (isCurrentNodeEditing && isInEditor) {
          // 🎯 UX优化：编辑状态下Tab，先保存内容再创建子节点
          const content = (target.value || target.textContent || '').trim();
          if (content !== currentNode.content?.trim()) {
            updateNodeAction(selectId, { content, updatedAt: Date.now() } as any);
          }
          // 退出编辑状态由统一编辑状态机管理
          cancelEdit();
        }

        addMindmapChild(selectId);
        return;
      }

      // Enter键：创建兄弟节点 (Shift+Enter在编辑器内换
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();

        if (isCurrentNodeEditing && isInEditor) {
          // 🎯 UX优化：编辑状态下Enter，先保存内容再创建兄弟节
          const content = (target.value || target.textContent || '').trim();
          if (content !== currentNode.content?.trim()) {
            updateNodeAction(selectId, { content, updatedAt: Date.now() } as any);
          }
          // 退出编辑状态由统一编辑状态机管理
          cancelEdit();
        }

        addMindmapSibling(selectId);
        return;
      }
    }
  });

  // 🎯 框选聚焦：将视图聚焦到当前选择的节点包围盒
  const focusOnSelection = useCallback(() => {
    try {
      const selectedIds = Array.from(selectedNodeIds as Set<string>);
      const hidden = viewModel.hiddenMindmapNodeIds || new Set<string>();
      const nodesForBounds = (canvas?.nodes || []).filter((n: any) => selectedIds.includes(n.id) && (n as any).type !== 'group' && !hidden.has(n.id));
      if (!nodesForBounds || nodesForBounds.length === 0) {
        // 无选区：回退到“按内容适配/居中
        try { fitToView(); } catch {}
        return;
      }
      const bounds = calculateGroupBounds(nodesForBounds as any);
      const container = getContainerBounds();
      if (!container || !transformRef.current) return;
      // 读取用户设置的聚焦参数（比率/边距
      let padding = 24;
      let fitRatio = 0.8;
      try {
        const st = useSettingsStore.getState();
        if (st?.focus?.padding !== undefined) padding = st.focus.padding as number;
        if (st?.focus?.fitRatio !== undefined) fitRatio = st.focus.fitRatio as number;
      } catch {}
      const availW = Math.max(1, container.width - padding * 2);
      const availH = Math.max(1, container.height - padding * 2);
      const scaleW = availW / Math.max(1, bounds.width);
      const scaleH = availH / Math.max(1, bounds.height);
      const unclamped = Math.min(scaleW, scaleH) * fitRatio;
      const scale = clampViewScale(unclamped, 0.1, 3);
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;
      const { positionX, positionY } = computePositionFromCenter(centerX, centerY, scale, { width: container.width, height: container.height });
      transformRef.current.setTransform(positionX, positionY, scale);
      try { setTransform({ scale, positionX, positionY }); } catch {}
    } catch (e) {
      // 兜底：失败时尝试按内容适配
      try { fitToView(); } catch {}
    }
  }, [canvas?.nodes, selectedNodeIds, viewModel.hiddenMindmapNodeIds, getContainerBounds, transformRef, fitToView, setTransform]);

  // ⌨️ 双空格触发“框选聚焦”（300ms窗口），避免输入控件
  useEffect(() => {
    const lastTapRef = { t: 0 };
    const isInputEl = (target: EventTarget | null): boolean => {
      if (!target || !(target as any).tagName) return false;
      const el = target as Element;
      const tag = el.tagName.toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag)) return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return !!el.closest('.cm-editor, .cm-content, [role="textbox"], .editor-textarea, .editable-input');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      try {
        if (e.code !== 'Space' || e.repeat) return;
        if (isInputEl(e.target)) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const now = Date.now();
        if (now - lastTapRef.t <= 300) {
          e.preventDefault();
          focusOnSelection();
          lastTapRef.t = 0;
        } else {
          lastTapRef.t = now;
        }
      } catch {}
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [focusOnSelection]);

  // 在只分享视图中强制使用手型工具，阻止切换到选择工具
  // Base mode from store (or read-only local state) for UI display
  const baseToolMode = readOnly ? roToolMode : toolMode;
  // Effective mode used by interactions (e.g., Space temporarily forces hand)
  const effectiveToolMode = readOnly ? roToolMode : keyboardToolMode;


  const handleEditNode = useCallback((nodeId: string) => {
    // 首先选中节点
    onNodeClick?.(nodeId);
    
    // 然后进入编辑模式
    setTimeout(() => {
      // 手型模式下禁用节点编
      if (effectiveToolMode === 'hand') {
        return;
      }
      
      enterEditMode('node', nodeId);
      setPanningLocked(true);
    }, 0);
  }, [onNodeClick, effectiveToolMode, enterEditMode, setPanningLocked]);

  const handleCreateNode = useCallback((type: 'text' | 'todo' | 'code' | 'html' | 'column' | 'table', position: Position) => {
    // 🏭 使用统一节点工厂创建节点，传递canvasId确保语义化ID生成
    const overrides = type === 'code'
      ? { codeType: 'mermaid' }
      : (type === 'html' ? { codeType: 'html' } : undefined);

    const newNode = createNodeAtPosition(
      type === 'html' ? 'code' : type,
      position,
      canvas.id,
      overrides as any
    );

    // 🎯 统一架构：通过Canvas Store管理状态，确保计数器同
    if (externalCanvas && onCanvasChange) {
      // 外部控制模式：通过回调更新
      const updatedCanvas = {
        ...canvas,
        nodes: [...canvas.nodes, newNode],
        updatedAt: Date.now()
      };
      onCanvasChange(updatedCanvas);
    } else {
      // 内部控制模式：通过Store统一管理，确保计数器和历史记录同
      const { addNode } = useCanvasStore.getState();
      addNode(newNode);
      
      // Store状态已通过addNode自动更新，无需手动设置
    }
  }, [canvas, externalCanvas, onCanvasChange]);


  // 📋 计算选中的节点数
  const selectedNodes = useMemo(() => {
    if (!canvas || !canvas.nodes || !Array.isArray(canvas.nodes)) {
      console.warn('InfiniteCanvas: canvas.nodes无效，返回空数组', { canvas, nodes: canvas?.nodes });
      return [];
    }
    return (canvas?.nodes || []).filter(node => (selectedNodeIds as Set<string>).has(node.id));
  }, [canvas, selectedNodeIds]);

  // 🔔 当选中节点变化时通知父组
  useEffect(() => {
    onSelectedNodesChange?.(selectedNodes);
  }, [selectedNodes, onSelectedNodesChange]);

  // 🔔 当选中组变化时通知父组
  const selectedGroupChangeRef = useRef(onSelectedGroupChange);
  selectedGroupChangeRef.current = onSelectedGroupChange;
  const lastNotifiedGroupIdRef = useRef<string | null>(null);

  useEffect(() => {
    const callback = selectedGroupChangeRef.current;
    if (!callback) return;

    // 仅在选中的组发生变化时通知，避免无意义重复调用
    if (selectedGroupId !== lastNotifiedGroupIdRef.current) {
      lastNotifiedGroupIdRef.current = selectedGroupId || null;
      if (!selectedGroupId) {
        callback(null);
      } else {
        const groupNode = (canvas.nodes || []).find(n => n.id === selectedGroupId && (n as any).type === 'group') || null;
        callback(groupNode || null);
      }
    }
  }, [selectedGroupId, canvas.nodes]);



  // 🔒 处理节点锁定切换
  const handleNodeLockToggle = useCallback((nodeId: string, locked: boolean) => {
    const nodeIndex = canvas?.nodes?.findIndex(n => n.id === nodeId) ?? -1;
    if (nodeIndex === -1) return;
    
    const updatedNode = { ...canvas.nodes[nodeIndex], locked };
    const newCanvas = {
      ...canvas,
      nodes: (canvas?.nodes || []).map((node, index) => 
        index === nodeIndex ? updatedNode : node
      )
    };
    
    const { updatedAt: _updatedAt, ...canvasWithoutTimestamp } = { ...newCanvas, updatedAt: Date.now() };
    if (externalCanvas && onCanvasChange) {
      onCanvasChange(canvasWithoutTimestamp as Canvas);
    } else {
      setCanvasState(canvasWithoutTimestamp as Canvas);
    }
  }, [canvas, externalCanvas, onCanvasChange, setCanvasState]);

  // 📋 初始化历史记- 简化版
  useEffect(() => {
    const storeState = useCanvasStore.getState();
    if (!storeState.historyData) {
      storeState.initializeHistory();
    }
  }, []);

  // 🎯 预建收集栏子节点Map（用于兼容已有逻辑，但框选不再过滤子节点
  const _collectedNodeMap = useMemo(() => {
    const map = new Map<string, boolean>();
    const sourceCanvas = externalCanvas || canvas;
    if (sourceCanvas?.nodes) {
      sourceCanvas.nodes.forEach(node => {
        if ((node as any).type === 'column' && (node as any).children) {
          (node as any).children.forEach((childId: string) => map.set(childId, true));
        }
      });
    }
    return map;
  }, [externalCanvas, canvas]);

  const hiddenMindmapNodeIds = viewModel.hiddenMindmapNodeIds;

  

  // ==================== 视口裁剪（大数据量时启用====================
  const CULL_THRESHOLD = 180;  // 节点数超过阈值才启用裁剪
  const viewportRect = viewModel.viewportRect;
  const userVisibleNodes = useMemo(() => {
    const nodes = canvas?.nodes || [];
    if (nodes.length === 0) return [];
    const hiddenIds = new Set<string>(hiddenMindmapNodeIds);
    nodes.forEach((node: any) => {
      if (node?.type === 'column' && node?.isCollapsed) {
        (node.children || []).forEach((childId: string) => hiddenIds.add(childId));
      }
    });
    return nodes.filter((node: any) => node && node.type !== 'group' && !hiddenIds.has(node.id));
  }, [canvas?.nodes, hiddenMindmapNodeIds]);
  const hasUserVisibleNodes = userVisibleNodes.length > 0;
  const userVisibleBounds = useMemo(() => {
    if (!hasUserVisibleNodes) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of userVisibleNodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }
    return { minX, minY, maxX, maxY };
  }, [hasUserVisibleNodes, userVisibleNodes]);
  const isViewportOutsideUserContent = useMemo(() => {
    if (!hasUserVisibleNodes || !userVisibleBounds || !viewTransform || !viewportSize) return false;
    const scale = viewTransform.scale || 1;
    if (!Number.isFinite(scale) || scale <= 0) return false;
    if (!viewportSize.width || !viewportSize.height) return false;
    const viewportLeft = -viewTransform.positionX / scale;
    const viewportTop = -viewTransform.positionY / scale;
    const viewportRight = viewportLeft + viewportSize.width / scale;
    const viewportBottom = viewportTop + viewportSize.height / scale;
    const edgeTolerance = 120;
    const noIntersection = (
      viewportRight < userVisibleBounds.minX - edgeTolerance ||
      viewportLeft > userVisibleBounds.maxX + edgeTolerance ||
      viewportBottom < userVisibleBounds.minY - edgeTolerance ||
      viewportTop > userVisibleBounds.maxY + edgeTolerance
    );
    return noIntersection;
  }, [hasUserVisibleNodes, userVisibleBounds, viewTransform, viewportSize]);
  const showViewportDriftHint = !readOnly && hasUserVisibleNodes && isViewportOutsideUserContent;

  // visibleNodes already defined above
  
  // 🚀 已迁移到Store：连接状态通过interactionState管理
  // const [isConnecting, setIsConnecting] = useState(false);
  // const [connectionStart, setConnectionStart] = useState<{ nodeId: string; handlePosition: 'top' | 'right' | 'bottom' | 'left'; screenPosition: { x: number; y: number }; } | null>(null);

  // 🟡 保留本地状态：临时连接终点是UI状
  const [tempConnectionEnd, setTempConnectionEnd] = useState<{ x: number; y: number } | null>(null);
  
  // ==================== 粘贴：记录最后的鼠标画布坐标 ====================
  const lastMouseCanvasPosRef = useRef<{ x: number; y: number } | null>(null);
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!coordinatesReady) return;
    try {
      const p = screenToCanvasCoords(e.clientX, e.clientY);
      lastMouseCanvasPosRef.current = p;
    } catch {}
  }, [coordinatesReady, screenToCanvasCoords]);

  // =============== 复制/剪切：稳定的状态引用（refs===============
  const selectedNodeIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => { selectedNodeIdsRef.current = new Set(selectedNodeIds as Set<string>); }, [selectedNodeIds]);

  
  // 移除了不再需要的 ref 逻辑，现在直接在 handleConnectionStart 中处
  
  // 🏷连接标签编辑状(已在上面定义，删除重复定
  
  // 🎯 悬停目标节点状
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // 🎯 思维导图拖拽预览状
  const [dragPreview, setDragPreview] = useState<MindmapDragPreview | null>(null);
  
  // 📦 拖拽状态管
  // 🚀 已迁移到Store：拖拽状态通过interactionState管理
  // const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  // const [dragTargetColumnId, setDragTargetColumnId] = useState<string | null>(null);

  // 🟡 保留本地状态：拖拽预览位置是临时UI状

  // 📐 列布局引擎：按children顺序栈式布局（x/width固定，y逐项累加
  // 列布局与插入索引已抽离为系统工具（保持行为不变


  // 🔧 处理缩放/平移变化：同步到全局视图状
  const handleZoomChange = useCallback((ref: ReactZoomPanPinchRef) => {
    const { scale: rawScale, positionX, positionY } = ref.state;
    const scale = clampViewScale(rawScale, 0.1, 3);
    if (scale !== rawScale && typeof ref.setTransform === 'function') {
      // 如果库未约束，主动修正一次，避免出现 < minScale 的状
      ref.setTransform(positionX, positionY, scale);
    }
    // 播放中：不写入store，也不持久化，避免整树重渲染
    if (playStateRef.current === 'playing') return;
    // 非播放态：同步全局transform并节流持久化
    setTransform({ scale, positionX, positionY });
    scheduleSaveView();
  }, [scheduleSaveView, setTransform]);

  // 播放结束后：一次性同步当前transform并保存视
  const prevPlayRef = useRef<'idle' | 'playing' | 'paused'>(playState);
  useEffect(() => {
    const prev = prevPlayRef.current;
    if (prev === 'playing' && playState !== 'playing') {
      const api: any = transformRef.current;
      const st = api?.state || api?.instance?.transformState;
      if (st) {
        const scale = clampViewScale(st.scale, 0.1, 3);
        setTransform({ scale, positionX: st.positionX, positionY: st.positionY });
        // 直接保存一次视
        try { (doSaveView as any)(); } catch {}
      }
    }
    prevPlayRef.current = playState;
  }, [playState, doSaveView, setTransform]);

  // ==================== 粘贴事件处理 ====================
  // ===== 粘贴所需的最新值存refs，避免反复绑解绑监听=====
  const canvasRef = useRef<Canvas>(canvas);
  useEffect(() => { canvasRef.current = canvas; }, [canvas]);
  const viewportRectRef = useRef(viewportRect);
  useEffect(() => { viewportRectRef.current = viewportRect; }, [viewportRect]);
  const screenToCanvasRef = useRef(screenToCanvasCoords);
  useEffect(() => { screenToCanvasRef.current = screenToCanvasCoords; }, [screenToCanvasCoords]);
  const coordinatesReadyRef = useRef(coordinatesReady);
  useEffect(() => { coordinatesReadyRef.current = coordinatesReady; }, [coordinatesReady]);
  const updateCanvasRef = useRef(updateCanvas);
  useEffect(() => { updateCanvasRef.current = updateCanvas; }, [updateCanvas]);

  // ==================== Shared helpers: media files handling ====================
  // Dedupe files by (name:size:type) to avoid duplicates when both items/files provide the same blob
  const dedupeFiles = useCallback((files: File[]): File[] => {
    const seen = new Set<string>();
    const out: File[] = [];
    for (const f of files) {
      const key = `${f.name || 'noname'}:${f.size}:${f.type || 'application/octet-stream'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
    return out;
  }, []);

  // Measure intrinsic dimensions for images/videos from a File object
  const measureIntrinsicDimensions = useCallback(async (file: File): Promise<{ w: number; h: number } | null> => {
    let url: string | null = null;
    try {
      url = URL.createObjectURL(file);
      const mime = (file.type || '').toLowerCase();
      if (mime.startsWith('image/')) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const img = new Image();
        const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
          img.onload = () => {
            const w = (img as any).naturalWidth || img.width || 0;
            const h = (img as any).naturalHeight || img.height || 0;
            resolve(w > 0 && h > 0 ? { w, h } : null);
          };
          img.onerror = () => resolve(null);
          img.src = url as string;
        });
        return dims;
      }
      if (mime.startsWith('video/')) {
        const video = document.createElement('video');
        video.preload = 'metadata';
        const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
          const cleanup = () => { try { video.src = ''; } catch {} };
          video.onloadedmetadata = () => {
            const w = (video as any).videoWidth || 0;
            const h = (video as any).videoHeight || 0;
            cleanup();
            resolve(w > 0 && h > 0 ? { w, h } : null);
          };
          video.onerror = () => { cleanup(); resolve(null); };
          video.src = url as string;
        });
        return dims;
      }
      return null;
    } catch {
      return null;
    } finally {
      try { if (url) URL.revokeObjectURL(url); } catch {}
    }
  }, []);

  // Adjust a media node's size to keep original aspect ratio (target width from DEFAULT_NODE_SIZES.media)
  const adjustMediaNodeSizeByIntrinsic = useCallback(async (nodeId: string, file: File) => {
    const dims = await measureIntrinsicDimensions(file);
    if (!dims) return;
    const targetW = DEFAULT_NODE_SIZES.media.width;
    const aspect = dims.w / (dims.h || 1);
    const targetH = Math.max(1, Math.round(targetW / (aspect || 1)));
    try { updateNodeAction(nodeId, { width: targetW, height: targetH } as any); } catch {}
  }, [measureIntrinsicDimensions, updateNodeAction]);

  const transcribeAudioForNode = useCallback(async (nodeId: string, audioFile: File) => {
    if (!audioFile) return;
    try {
      updateNodeAction(nodeId, { kbStatus: 'pending' } as any);
      const result = await transcribeAudio(audioFile);
      if (result?.text) {
        updateNodeAction(nodeId, { content: result.text, kbStatus: 'completed', updatedAt: Date.now() } as any);
      } else {
        updateNodeAction(nodeId, { kbStatus: 'failed' } as any);
      }
    } catch (error) {
      console.error('Audio transcription failed:', error);
      updateNodeAction(nodeId, { kbStatus: 'failed' } as any);
    }
  }, [updateNodeAction]);

  // Upload a media file to storage and optionally knowledge base; update media node status/urls
  const uploadMediaNodeAssets = useCallback(async (nodeId: string, file: File) => {
    try {
      // mark uploading
      updateNodeAction(nodeId, { uploadStatus: 'pending' } as any);
      const mimeLower = (file.type || '').toLowerCase();
      const uploadSource = mimeLower.startsWith('audio/') ? 'canvas-audio' : 'canvas';
      const { path, fileId } = await uploadFileToStorage(file, { source: uploadSource });
      const isImg = mimeLower.startsWith('image/');
      const isAudio = mimeLower.startsWith('audio/');
      if (isImg) {
        // 根本性修复：不再持久化短期签名URL，改为仅保存 storagePath
        updateNodeAction(nodeId, { uploadStatus: 'uploaded', storagePath: path, fileId, fileDownloadUrl: undefined, fileUrl: undefined } as any);
      } else if (isAudio) {
        updateNodeAction(nodeId, { uploadStatus: 'uploaded', storagePath: path, fileId, fileUrl: undefined, fileDownloadUrl: undefined } as any);
        await transcribeAudioForNode(nodeId, file);
      } else {
        // 非图片：也仅保存 storagePath，链接由渲染层基于稳定代理生
        updateNodeAction(nodeId, { uploadStatus: 'uploaded', kbStatus: 'pending', storagePath: path, fileId, fileUrl: undefined, fileDownloadUrl: undefined } as any);
        try {
          const DEFAULT_AGENT_ID = 'Zmind';
          await uploadFileToKnowledgeBase(DEFAULT_AGENT_ID, file, fileId);
          updateNodeAction(nodeId, { kbStatus: 'completed' } as any);
        } catch {
          updateNodeAction(nodeId, { kbStatus: 'failed' } as any);
        }
      }
    } catch (e) {
      try { updateNodeAction(nodeId, { uploadStatus: 'error' } as any); } catch {}
      console.error('Storage upload failed:', e);
    }
  }, [updateNodeAction, transcribeAudioForNode]);

  const activatePasteGroup = useCallback((nodes: CanvasNode[]) => {
    if (!nodes || nodes.length < 2) return;
    const leafNodes = nodes.filter((n) => (n as any).type !== 'group');
    if (leafNodes.length < 2) return;
    const ids = leafNodes.map((n) => n.id);
    try { selectNodesAction(ids); } catch {}
    try { selectConnectionsAction([]); } catch {}
    try { selectGroupAction(null); } catch {}
    try { createGroup(ids, leafNodes); } catch {}
  }, [createGroup, selectConnectionsAction, selectGroupAction, selectNodesAction]);

  // Unified media files handler for paste & drag
  const handleCanvasMediaFiles = useCallback(async (files: File[], base: { x: number; y: number }) => {
    if (!files || files.length === 0) return;
    // filter oversize and toast
    const allowed: File[] = [];
    for (const f of files) {
      if (f.size > maxFileBytes) {
        try { toast.error(`File exceeds ${(maxFileBytes / (1024 * 1024)).toFixed(0)}MB limit: ${f.name || 'file'}`); } catch {}
        continue;
      }
      allowed.push(f);
    }
    if (allowed.length === 0) return;
    let persistenceDisabled = false;
    try {
      setPersistenceDisabled(true);
      persistenceDisabled = true;
    } catch {}

    // create nodes first (stacked vertically) and persist via applyOps through store.addNode
    const pairs: Array<{ file: File; node: MediaNode }> = [];
    let currentY = base.y;
    for (const file of allowed) {
      try {
        const node = await createMediaNode(
          file,
          base.x - DEFAULT_NODE_SIZES.media.width / 2,
          currentY - DEFAULT_NODE_SIZES.media.height / 2
        );
        pairs.push({ file, node });
        // Persist add via store.applyOps pipeline
        try { addNodeAction(node as any); } catch {}
        currentY += DEFAULT_NODE_SIZES.media.height + 20; // vertical spacing
      } catch (err) {
        console.error('Failed to create media node:', err);
      }
    }
    if (!pairs.length) {
      if (persistenceDisabled) {
        try { setPersistenceDisabled(false); } catch {}
      }
      return;
    }
    const createdNodes = pairs.map(({ node }) => node);
    if (createdNodes.length >= 2) {
      activatePasteGroup(createdNodes);
    } else if (createdNodes[0]) {
      try { selectSingleNode(createdNodes[0].id); } catch {}
    }

    // async adjustment and upload
    Promise.resolve().then(async () => {
      try {
        for (const { file, node } of pairs) {
          await adjustMediaNodeSizeByIntrinsic(node.id, file);
        }
        for (const { file, node } of pairs) {
          await uploadMediaNodeAssets(node.id, file);
        }
      } finally {
        if (persistenceDisabled) {
          try { setPersistenceDisabled(false); } catch {}
        }
        // Schedule a single save to persist width/height and status changes
        try { await (useCanvasStore.getState() as any).saveCanvas?.(); } catch {}
      }
    });
  }, [adjustMediaNodeSizeByIntrinsic, uploadMediaNodeAssets, addNodeAction, selectSingleNode, setPersistenceDisabled, maxFileBytes, activatePasteGroup]);

  const insertNodeIntoColumn = useCallback((columnId: string, nodeId: string) => {
    if (externalCanvas && onCanvasChange) {
      return; // controlled mode manages layout externally
    }
    try {
      const latestStore = useCanvasStore.getState();
      const baseCanvas = latestStore.canvas;
      const column = baseCanvas.nodes.find((n) => n.id === columnId && n.type === 'column');
      if (!column) return;
      const now = Date.now();
      const existing = Array.isArray(column.children) ? column.children.filter(Boolean) : [];
      const nextChildren = existing.includes(nodeId) ? existing : [...existing, nodeId];
      let updated: Canvas = {
        ...baseCanvas,
        nodes: baseCanvas.nodes.map((n) => {
          if (n.id === columnId) {
            return {
              ...n,
              children: nextChildren,
              isCollapsed: false,
              updatedAt: now,
            } as CanvasNode;
          }
          return n;
        }),
        updatedAt: now,
      };
      updated = applyColumnLayout(updated, columnId);
      const latestNode = baseCanvas.nodes.find((n) => n.id === nodeId);
      updated = adjustNodeSizeForColumn(updated, nodeId, latestNode);
      updated = applyColumnLayout(updated, columnId);
      setCanvasState(updated);
    } catch (error) {
      console.warn('Failed to insert node into column:', error);
    }
  }, [setCanvasState, externalCanvas, onCanvasChange]);

  useEffect(() => {
    const isEditableElement = (el: Element | null): boolean => {
      if (!el) return false;
      if (!('tagName' in el)) return false as any;
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (el.hasAttribute('contenteditable')) return true;
      // 常见编辑类容
      let cur: Element | null = el;
      while (cur) {
        const cls = cur.classList || { contains: () => false } as any;
        if (cls.contains('cm-editor') || cls.contains('cm-content') || cls.contains('editor-textarea')) return true;
        cur = cur.parentElement;
      }
      return false;
    };

    const MAX_HTML_CHARS = 200_000; // HTML 内容上限
    const MAX_TABLE_CELLS = 2000;    // 表格单元格上限（防止超大粘贴

    const parseHtmlTable = (html: string): { rows: string[][] } | null => {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const table = doc.querySelector('table');
        if (!table) return null;
        const rows: string[][] = [];
        const trs = Array.from(table.querySelectorAll('tr'));
        if (trs.length === 0) return null;
        trs.forEach((tr) => {
          const cells = Array.from(tr.querySelectorAll('th,td'));
          const row = cells.map((c) => (c.textContent || '').trim());
          rows.push(row);
        });
        if (rows.length === 0) return null;
        const headerCells = rows[0] || [];
        const dataRows = rows.slice(1);
        // 限制单元格总数
        const cols = headerCells.length || (dataRows[0]?.length || 0);
        const maxRows = Math.max(0, Math.floor(MAX_TABLE_CELLS / Math.max(1, cols)));
        const safeRows = dataRows.slice(0, maxRows);
        const finalHeaders = headerCells.length > 0
          ? headerCells
          : (safeRows[0] ? safeRows[0].map((_, i) => `Column ${i + 1}`) : []);
        return { rows: [finalHeaders, ...safeRows] };
      } catch {
        return null;
      }
    };

    const parseTSV = (text: string): { rows: string[][] } | null => {
      const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length > 0);
      if (lines.length < 2) return null;
      const splitted = lines.map((l) => l.split('\t'));
      const headers = splitted[0];
      const dataRows = splitted.slice(1);
      const cols = headers.length || (dataRows[0]?.length || 0);
      const maxRows = Math.max(0, Math.floor(MAX_TABLE_CELLS / Math.max(1, cols)));
      const safeRows = dataRows.slice(0, maxRows);
      return { rows: [headers, ...safeRows] };
    };

    const detectCodeFence = (text: string): { type: 'mermaid' | 'html' | 'svg'; content: string } | null => {
      const m = text.match(/^```(mermaid|html|svg)\s*\n([\s\S]*?)\n```\s*$/i);
      if (m) {
        const type = m[1].toLowerCase() as 'mermaid' | 'html' | 'svg';
        const content = m[2];
        return { type, content };
      }
      return null;
    };

    const detectMermaidLoose = (text: string): boolean => {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return false;
      const first = lines[0];
      return /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|pie|journey|gantt|mindmap|timeline)\b/i.test(first);
    };

    const detectHtmlLoose = (text: string): boolean => {
      const t = text.trim();
      if (t.length < 10) return false;
      if (!t.startsWith('<')) return false;
      return /<!DOCTYPE|<html\b|<head\b|<body\b|<div\b|<section\b|<article\b/i.test(t);
    };

    const detectSvgLoose = (text: string): boolean => {
      const t = text.trim();
      if (t.length < 10) return false;
      // 检查是否以 <svg 开头（忽略大小写和空白
      if (!/^<svg\b/i.test(t)) return false;
      // 确保包含 xmlns 或基SVG 元素
      return /xmlns|<rect|<circle|<path|<line|<polygon|<polyline|<ellipse|<text|<g\b/i.test(t);
    };

    const computePasteCanvasPos = (): { x: number; y: number } => {
      if (lastMouseCanvasPosRef.current) return lastMouseCanvasPosRef.current;
      const vp = viewportRectRef.current;
      if (vp) {
        return { x: vp.x + vp.w / 2, y: vp.y + vp.h / 2 };
      }
      return { x: 0, y: 0 };
    };

    const decodeClipPayload = (encoded: string): any | null => {
      try {
        const decoded = atob(encoded);
        try {
          return JSON.parse(decodeURIComponent(escape(decoded)));
        } catch {
          return JSON.parse(decoded);
        }
      } catch {
        return null;
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      // 使用当前聚焦元素判断是否应交给原生（避免 document 作为 target 导致误判
      const activeEl = (document.activeElement as Element) || (e.target as Element | null);
      if (isEditableElement(activeEl)) return; // 输入场景交给原生

      const dt = e.clipboardData;
      const base = computePasteCanvasPos();
      const createdAt = Date.now();
      const currentCanvas = canvasRef.current;
      const doUpdate = (next: Canvas) => updateCanvasRef.current(next);

      // 0) Zmind内部复制格式（优先）
      const primaryMime = 'application/x-zmind-canvas';
      const candidateMimes = Array.from(
        new Set<string>([
          primaryMime,
          'application/x-aletheon-canvas',
          ...(dt.types ? Array.from(dt.types).filter((t) => /^application\/x-.*canvas$/i.test(t)) : []),
        ])
      );

      let raw: string | undefined;
      for (const mime of candidateMimes) {
        try {
          raw = dt.getData(mime);
        } catch {
          raw = undefined;
        }
        if (raw) break;
      }

      if (!raw) {
        const html = dt.getData('text/html') || '';
        const match = html.match(/<!--\s*(?:ZMIND_CLIP_V2|ALETHEON_CLIP_V2):([A-Za-z0-9+/=]+)\s*-->/);
        if (match) {
          const decoded = decodeClipPayload(match[1]);
          if (decoded) {
            raw = JSON.stringify(decoded);
          }
        }
      }
      if (raw) {
        try {
          const data = JSON.parse(raw);
          const nodes: CanvasNode[] = data.nodes || [];
          const conns = data.connections || [];
          const b = data.bounds || null;
          const dx = b ? base.x - (b.minX + (b.w || (b.maxX - b.minX)) / 2) : base.x;
          const dy = b ? base.y - (b.minY + (b.h || (b.maxY - b.minY)) / 2) : base.y;

          // 构建ID映射并重建节
          const idMap = new Map<string, string>();
          nodes.forEach(n => { idMap.set(n.id, NodeIds.generateNodeId(currentCanvas.id, n.type)); });

          const newNodes: CanvasNode[] = nodes.map((n) => {
            const mappedId = idMap.get(n.id)!;
            const cloned: any = { ...n };
            // 清理UI态并重置时间
            delete cloned.selected; delete cloned.isEditing;
            cloned.id = mappedId;
            cloned.x = (n.x || 0) + dx;
            cloned.y = (n.y || 0) + dy;
            cloned.createdAt = createdAt;
            cloned.updatedAt = createdAt;
            // remap parent group/column
            if (cloned.parentGroupId && idMap.has(cloned.parentGroupId)) {
              cloned.parentGroupId = idMap.get(cloned.parentGroupId);
            } else if (cloned.parentGroupId) {
              delete cloned.parentGroupId;
            }
            if (Array.isArray(cloned.children)) {
              cloned.children = (cloned.children as string[]).map((cid: string) => idMap.get(cid)).filter(Boolean);
            }
            return cloned as CanvasNode;
          });

          // 重建连接（新ID）：支持半自由端
          const newConns = (conns as any[]).map((c: any) => {
            const cloned: any = {
              id: NodeIds.generateConnectionId(currentCanvas.id),
              label: c.label || '',
              createdAt,
            };
            const isFreeish = Boolean(c.fromPoint || c.toPoint);
            if (c.fromPoint) cloned.fromPoint = { x: c.fromPoint.x + dx, y: c.fromPoint.y + dy };
            if (c.toPoint) cloned.toPoint = { x: c.toPoint.x + dx, y: c.toPoint.y + dy };
            if (!c.fromPoint && c.from) {
              const mapped = idMap.get(c.from);
              if (!mapped) return null;
              cloned.from = mapped;
            }
            if (!c.toPoint && c.to) {
              const mapped = idMap.get(c.to);
              if (!mapped) return null;
              cloned.to = mapped;
            }
            if (!cloned.fromPoint && !cloned.from) return null;
            if (!cloned.toPoint && !cloned.to) return null;
            if (c.curveAnchor) {
              cloned.curveAnchor = isFreeish
                ? { x: c.curveAnchor.x + dx, y: c.curveAnchor.y + dy }
                : { x: c.curveAnchor.x, y: c.curveAnchor.y };
            }
            if (Array.isArray(c.controlPoints)) {
              cloned.controlPoints = isFreeish
                ? c.controlPoints.map((p: any) => ({ x: p.x + dx, y: p.y + dy }))
                : c.controlPoints.map((p: any) => ({ x: p.x, y: p.y }));
            }
            if (c.anchorParams) cloned.anchorParams = { u: c.anchorParams.u, v: c.anchorParams.v };
            if (c.appearance) cloned.appearance = c.appearance;
            if (c.dashed !== undefined) cloned.dashed = c.dashed;
            if (c.style) cloned.style = c.style;
            return cloned;
          }).filter(Boolean) as any[];

          e.preventDefault();
          // 自动尺寸：仅在缺失宽高时估算，避免覆盖内部复制时的原尺寸
          let sizedNodes = newNodes;
          const needsAutoSize = newNodes.some(n => (n.type === 'text' || n.type === 'todo') && (!(n.width > 0) || !(n.height > 0)));
          if (needsAutoSize) {
            try {
              const { estimateAutoTextWidth, getTextLayoutPreset, DEFAULT_TEXT_LAYOUT_PRESET, calculateTextNodeHeight } = require('../../utils/canvasUtils');
              const presetId = currentCanvas.textLayoutPreset ?? DEFAULT_TEXT_LAYOUT_PRESET;
              const layout = getTextLayoutPreset ? getTextLayoutPreset(presetId) : undefined;
              const min = (layout?.metrics?.minWidth ?? DEFAULT_NODE_SIZES.text.width);
              sizedNodes = newNodes.map(n => {
                if ((n.type === 'text' || n.type === 'todo') && (!(n.width > 0) || !(n.height > 0))) {
                  const w = estimateAutoTextWidth(n.content || '', { layoutPreset: layout, nodeType: n.type as any, clamp: { min, max: Math.max(min, 600) } });
                  const h = calculateTextNodeHeight ? calculateTextNodeHeight(n.content || '', w, { layoutPreset: layout }) : (n.height || 60);
                  return { ...n, width: w, height: h } as any;
                }
                return n;
              });
            } catch {}
          }
          doUpdate({
            ...currentCanvas,
            nodes: [...currentCanvas.nodes, ...sizedNodes],
            connections: [...(currentCanvas.connections || []), ...newConns],
            updatedAt: createdAt,
          });
          activatePasteGroup(sizedNodes);
          return;
        } catch {
          // 解析失败则继续走后续分支
        }
      }

      // 1. 图片优先（files items 中的 image/*
      const pastedImageFiles: File[] = [];
      for (const item of Array.from(dt.items || [])) {
        if (item.kind === 'file' && item.type && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) pastedImageFiles.push(f);
        }
      }
      for (const f of Array.from(dt.files || [])) {
        if (f.type && f.type.startsWith('image/')) pastedImageFiles.push(f);
      }
      const uniquePastedImages = dedupeFiles(pastedImageFiles);
      if (uniquePastedImages.length > 0) {
        e.preventDefault();
        // Use unified handler to create nodes, adjust aspect ratio and upload assets.
        handleCanvasMediaFiles(uniquePastedImages, base);
        return;
      }

      const text = dt.getData('text/plain') || '';
      const trimmedText = text.trim();
      if (trimmedText) {
        if (/^(https?:\/\/)?(www\.)?b23\.tv\//i.test(trimmedText)) {
          e.preventDefault();
          try {
            toast.error('短链接无法解析，请粘贴完整的哔哩哔哩视频链接。', { position: 'bottom-right' });
          } catch {}
          return;
        }
        const externalVideo = parseExternalVideoUrl(trimmedText);
        if (externalVideo) {
          e.preventDefault();
          const videoSize = { width: 480, height: 270 };
          const pos = { x: base.x - videoSize.width / 2, y: base.y - videoSize.height / 2 };
          const fileName = externalVideo.provider === 'youtube' ? 'YouTube 视频' : '哔哩哔哩 视频';
          const node = createNodeAtPosition('media', pos, currentCanvas.id, {
            width: videoSize.width,
            height: videoSize.height,
            content: '',
            fileName,
            fileType: 'text/html',
            fileExtension: 'url',
            fileSize: 0,
            mediaType: 'video',
            uploadStatus: 'mock',
            mediaSource: 'external',
            externalUrl: externalVideo.sourceUrl,
            embedUrl: externalVideo.embedUrl,
            externalProvider: externalVideo.provider,
          });
          doUpdate({ ...currentCanvas, nodes: [...currentCanvas.nodes, node], updatedAt: createdAt });
          void (async () => {
            try {
              const metadata = await fetchExternalVideoMetadata(currentCanvas.id, externalVideo.sourceUrl);
              const title = (metadata?.title || '').trim();
              if (!title) return;
              const latestCanvas = useCanvasStore.getState().canvas;
              const target = latestCanvas?.nodes?.find((n) => n.id === node.id);
              if (!target || target.type !== 'media') return;
              const currentName = target.fileName || '';
              if (currentName && currentName !== fileName) return;
              if (currentName === title) return;
              useCanvasStore.getState().updateNode(node.id, { fileName: title, updatedAt: Date.now() });
            } catch {}
          })();
          return;
        }
      }

      // 2. 先尝试基于纯文本Markdown 思维导图
      if (text) {
        try {
          const md = buildMindmapFromMarkdown(text, currentCanvas.id, { x: base.x, y: base.y }, 180);
          if (md) {
            e.preventDefault();
            const next = {
              ...currentCanvas,
              nodes: [...currentCanvas.nodes, ...md.nodes, md.group],
              connections: [...(currentCanvas.connections || []), ...md.connections],
              updatedAt: createdAt,
            };
            doUpdate(next);
            activatePasteGroup(md.nodes);
            // 粘贴导图：仅对本次粘贴的导图节点自动调整一次，随后锁定为手动（不再跟随内容自动改宽
            // 取消：不在粘贴后切换manual 或自动优化尺
            setTimeout(() => {
              try {
                const latest = useCanvasStore.getState().canvas;
                const result = tidyLayout(latest, md.group.id);
                applyLayout(result);
              } catch {}
              // 稳健执行一次“优化节点尺寸”：等待渲染后多帧重试，测量 text-node-content 高度
              // 取消：不再自动运行“优化节点尺寸
            }, 0);
            try {
              toast.success(
                md.truncated
                ? '已将 Markdown 转为思维导图（部分内容已截断至 180 节点）'
                  : '已将 Markdown 转为思维导图',
                { position: 'bottom-right' }
              );
            } catch {}
            return;
          }
        } catch {}
      }

      // 3. HTML 表格（若非Markdown导图
      const html = (dt.getData('text/html') || '').trim();
      if (html) {
        const table = parseHtmlTable(html);
        if (table && table.rows && table.rows.length > 0) {
          e.preventDefault();
          const pos = { x: base.x - DEFAULT_NODE_SIZES.table.width / 2, y: base.y - DEFAULT_NODE_SIZES.table.height / 2 };
          const node = createNodeAtPosition('table', pos, currentCanvas.id, { data: table });
          doUpdate({ ...currentCanvas, nodes: [...currentCanvas.nodes, node], updatedAt: createdAt });
          return;
        }
      }

      // 4. 文本处理（无隐藏注释通道
      if (text) {
        // 3.1 Markdown Mindmap（优先于围栏/松散识别；代码块作为文本节点处理
        try {
          const md = buildMindmapFromMarkdown(text, currentCanvas.id, { x: base.x, y: base.y }, 180);
          if (md) {
            e.preventDefault();
            const next = {
              ...currentCanvas,
              nodes: [...currentCanvas.nodes, ...md.nodes, md.group],
              connections: [...(currentCanvas.connections || []), ...md.connections],
              updatedAt: createdAt,
            };
            doUpdate(next);
            activatePasteGroup(md.nodes);
            // removed auto-switch to manual after paste
            // 布局需基于最新store数据，异步一帧调用更稳妥
            setTimeout(() => {
              try {
                const latest = useCanvasStore.getState().canvas;
                const result = tidyLayout(latest, md.group.id);
                applyLayout(result);
                // 粘贴后的初排后做一次局部避让，减少重叠
                resolveOverlapsAfterChange(useCanvasStore.getState().canvas, md.group.id, md.nodes.map(n => n.id));
              } catch {}
            }, 0);
            try {
              toast.success(
                md.truncated
                ? '已将 Markdown 转为思维导图（部分内容已截断至 180 节点）'
                  : '已将 Markdown 转为思维导图',
                { position: 'bottom-right' }
              );
            } catch {}
            return;
          }
        } catch {}

        // 4.2 围栏代码
        const fenced = detectCodeFence(text);
        if (fenced) {
          e.preventDefault();
          let size;
          if (fenced.type === 'mermaid') {
            size = DEFAULT_NODE_SIZES.mermaid;
          } else if (fenced.type === 'svg') {
            // 🎨 SVG节点动态尺寸计
            size = calculateSvgNodeSize(fenced.content);
          } else {
            size = DEFAULT_NODE_SIZES.html;
          }
          const pos = { x: base.x - size.width / 2, y: base.y - size.height / 2 };
          const node = createNodeAtPosition('code', pos, currentCanvas.id, { codeType: fenced.type, content: fenced.content });
          doUpdate({ ...currentCanvas, nodes: [...currentCanvas.nodes, node], updatedAt: createdAt });
          return;
        }

        // 4.3 松散识别（默认开启）
        if (detectMermaidLoose(text)) {
          e.preventDefault();
          const size = DEFAULT_NODE_SIZES.mermaid;
          const pos = { x: base.x - size.width / 2, y: base.y - size.height / 2 };
          const node = createNodeAtPosition('code', pos, currentCanvas.id, { codeType: 'mermaid', content: text });
          doUpdate({ ...currentCanvas, nodes: [...currentCanvas.nodes, node], updatedAt: createdAt });
          return;
        }
        if (detectHtmlLoose(text) && text.length <= MAX_HTML_CHARS) {
          e.preventDefault();
          const size = DEFAULT_NODE_SIZES.html;
          const pos = { x: base.x - size.width / 2, y: base.y - size.height / 2 };
          const node = createNodeAtPosition('code', pos, currentCanvas.id, { codeType: 'html', content: text });
          doUpdate({ ...currentCanvas, nodes: [...currentCanvas.nodes, node], updatedAt: createdAt });
          return;
        }
        // SVG 松散识别
        if (detectSvgLoose(text)) {
          e.preventDefault();
          // 🎨 SVG节点动态尺寸计
          const size = calculateSvgNodeSize(text);
          const pos = { x: base.x - size.width / 2, y: base.y - size.height / 2 };
          const node = createNodeAtPosition('code', pos, currentCanvas.id, { codeType: 'svg', content: text });
          doUpdate({ ...currentCanvas, nodes: [...currentCanvas.nodes, node], updatedAt: createdAt });
          return;
        }

        // 4.4 TSV（Excel
        if (text.includes('\t') && text.includes('\n')) {
          const tsv = parseTSV(text);
          if (tsv && tsv.rows && tsv.rows.length > 0) {
            e.preventDefault();
            const pos = { x: base.x - DEFAULT_NODE_SIZES.table.width / 2, y: base.y - DEFAULT_NODE_SIZES.table.height / 2 };
            const node = createNodeAtPosition('table', pos, currentCanvas.id, { data: tsv });
            doUpdate({ ...currentCanvas, nodes: [...currentCanvas.nodes, node], updatedAt: createdAt });
            return;
          }
        }

      // 4.5 兜底：文本节点（Markdown 也按文本处理
        e.preventDefault();
        const pos = { x: base.x - DEFAULT_NODE_SIZES.text.width / 2, y: base.y - DEFAULT_NODE_SIZES.text.height / 2 };
        let node = createNodeAtPosition('text', pos, currentCanvas.id, { content: text });
        // 自动尺寸：按内容估算宽度并计算高度（非思维导图
        try {
          const { estimateAutoTextWidth, getTextLayoutPreset, DEFAULT_TEXT_LAYOUT_PRESET, calculateTextNodeHeight } = require('../../utils/canvasUtils');
          const presetId = currentCanvas.textLayoutPreset ?? DEFAULT_TEXT_LAYOUT_PRESET;
          const layout = getTextLayoutPreset ? getTextLayoutPreset(presetId) : undefined;
          const min = (layout?.metrics?.minWidth ?? DEFAULT_NODE_SIZES.text.width);
          const w = estimateAutoTextWidth(text, { layoutPreset: layout, nodeType: 'text', clamp: { min, max: Math.max(min, 600) } });
          const h = calculateTextNodeHeight ? calculateTextNodeHeight(text, w, { layoutPreset: layout }) : node.height;
          node = { ...node, width: w, height: h } as any;
        } catch {}
        doUpdate({ ...currentCanvas, nodes: [...currentCanvas.nodes, node], updatedAt: createdAt });
        return;
      }
    };

    // 仅绑定一次（捕获阶段），稳定可靠
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, [activatePasteGroup, dedupeFiles, handleCanvasMediaFiles]);

  // ==================== 复制 / 剪切（自定义MIME + 回退====================
  useEffect(() => {
    const PRIMARY_MIME = 'application/x-zmind-canvas';
    const LEGACY_MIME = 'application/x-aletheon-canvas';

    const isEditableElement = (el: Element | null): boolean => {
      if (!el) return false;
      if (!('tagName' in el)) return false as any;
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (el.hasAttribute('contenteditable')) return true;
      let cur: Element | null = el;
      while (cur) {
        const cls = cur.classList || { contains: () => false } as any;
        if (cls.contains('cm-editor') || cls.contains('cm-content') || cls.contains('editor-textarea')) return true;
        cur = cur.parentElement;
      }
      return false;
    };


    const encodeClipPayload = (payload: any): string | null => {
      try {
        return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      } catch {
        try {
          return btoa(JSON.stringify(payload));
        } catch {
          return null;
        }
      }
    };

    const onCopyOrCut = (e: ClipboardEvent, isCut: boolean) => {
      const activeEl = (document.activeElement as Element) || (e.target as Element | null);
      if (isEditableElement(activeEl)) return; // 输入场景交给原生
      if (!e.clipboardData) return;

      const currentCanvas = canvasRef.current;
      const sel = selectedNodeIdsRef.current;
      if (!currentCanvas || !currentCanvas.nodes) return;

      // 支持两种拷贝
      // 1) 选中节点 复制节点 + 其内部节点间连线
      // 2) 仅选中“自由连线”（fromPoint/toPoint复制这些
      const nodes = sel.size > 0 ? currentCanvas.nodes.filter(n => sel.has(n.id)) : [];
      const nodeIdSet = new Set(nodes.map(n => n.id));
      const nodesById = new Map<string, CanvasNode>((currentCanvas.nodes || []).map((n) => [n.id, n]));
      const storeSel = useCanvasStore.getState().selections;
      const selectedConnIds: string[] = Array.from(storeSel?.connectionIds || new Set<string>());
      const halfOrFreeSelectedRaw = (currentCanvas.connections || []).filter(
        (c: any) => selectedConnIds.includes(c.id) && (c.fromPoint || c.toPoint)
      );
      if (nodes.length === 0 && halfOrFreeSelectedRaw.length === 0) return; // 无可复制内容

      // 组合要复制的连接
      // - 节点-节点：两端均在选中节点集合
      // - 半自全自由：用户显式选择的连接（fromPoint toPoint 存在
      const nodeConns = (currentCanvas.connections || []).filter(c => nodeIdSet.has(c.from) && nodeIdSet.has(c.to) && !c.fromPoint && !c.toPoint);
      const serializeHalfFree = (conn: any) => {
        const clone: any = {
          id: conn.id,
          label: conn.label || '',
          appearance: conn.appearance ? { ...(conn.appearance as any) } : undefined,
          curveAnchor: conn.curveAnchor ? { x: conn.curveAnchor.x, y: conn.curveAnchor.y } : undefined,
          controlPoints: Array.isArray(conn.controlPoints) ? conn.controlPoints.map((p: any) => ({ x: p.x, y: p.y })) : undefined,
          dashed: conn.dashed,
          style: conn.style,
          createdAt: conn.createdAt,
        };
        const fromPt = conn.fromPoint ? { x: conn.fromPoint.x, y: conn.fromPoint.y } : (() => {
          const node = nodesById.get(conn.from);
          return node ? { x: node.x + node.width / 2, y: node.y + node.height / 2 } : null;
        })();
        const toPt = conn.toPoint ? { x: conn.toPoint.x, y: conn.toPoint.y } : (() => {
          const node = nodesById.get(conn.to);
          return node ? { x: node.x + node.width / 2, y: node.y + node.height / 2 } : null;
        })();
        if (!fromPt || !toPt) return null;
        clone.fromPoint = fromPt;
        clone.toPoint = toPt;
        return clone;
      };
      const halfOrFreeSelected = halfOrFreeSelectedRaw.map(serializeHalfFree).filter(Boolean);
      if (nodes.length === 0 && halfOrFreeSelected.length === 0) return;
      const connections = [...nodeConns.map((c) => ({ ...(c as any) })), ...halfOrFreeSelected];

      // 计算包围盒：包含节点与自由连线端锚点/控制
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach(n => {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.width);
        maxY = Math.max(maxY, n.y + n.height);
      });
      for (const c of halfOrFreeSelected as any[]) {
        const pts: Array<{ x:number; y:number }> = [];
        if (c.fromPoint) pts.push(c.fromPoint);
        if (c.toPoint) pts.push(c.toPoint);
        if (c.curveAnchor) pts.push(c.curveAnchor);
        if (Array.isArray(c.controlPoints)) pts.push(...c.controlPoints);
        for (const p of pts) {
          minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        }
      }
      if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
        // 回退：当仅自由线且可能无点时，使用视口中
        minX = 0; minY = 0; maxX = 0; maxY = 0;
      }
      const bounds = { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };

      // 过滤UI状态字
      const cleanNodes = nodes.map(n => {
        const { selected: _sel, isEditing: _edit, ...rest } = (n as any);
        return rest;
      });

      const payload = {
        app: 'Zmind',
        version: 1,
        copiedAt: Date.now(),
        sourceCanvasId: currentCanvas.id,
        bounds,
        nodes: cleanNodes,
        connections,
        selection: Array.from(sel),
      };

      // 主通道：结构化 JSON（即使后续回退失败也尽力设置）
      try {
        const payloadJson = JSON.stringify(payload);
        e.clipboardData!.setData(PRIMARY_MIME, payloadJson);
        e.clipboardData!.setData(LEGACY_MIME, payloadJson);
        e.preventDefault();
      } catch {}

      // 辅助通道：text/html 隐藏注释（内部粘贴兜底，外部文本仍可忽略
      try {
        const encoded = encodeClipPayload(payload);
        if (encoded) {
          const htmlComments = [
            `<!-- ZMIND_CLIP_V2:${encoded} -->`,
            `<!-- ALETHEON_CLIP_V2:${encoded} -->`,
          ];
          const existing = e.clipboardData!.getData('text/html');
          const merged = existing ? `${existing}\n${htmlComments.join('\n')}` : htmlComments.join('\n');
          e.clipboardData!.setData('text/html', merged);
        }
      } catch {}

      // 回退通道：text/plain
      // 粘贴到外部应用时仅输出节点正文，去掉类型/注释等附加信
      try {
        const plainText = (() => {
          const parts: string[] = [];
          if (cleanNodes.length > 0) {
            cleanNodes.forEach((n: CanvasNode) => {
              const body = (n.content || '').trim();
              if (body) {
                parts.push(body);
              }
            });
            return parts.join('\n\n');
          }
          // 仅自由连线时输出提示
          return connections.length ? `Connections: ${connections.length}` : '';
        })();
        e.clipboardData!.setData('text/plain', plainText);
      } catch {}

      // 剪切：复制后删除
      if (isCut) {
        const now = Date.now();
        const cutConnIds = new Set(connections.map((c: any) => c.id));
        const remainingNodes = currentCanvas.nodes.filter(n => !nodeIdSet.has(n.id));
        const remainingConns = (currentCanvas.connections || []).filter(
          c => (!nodeIdSet.has(c.from) && !nodeIdSet.has(c.to)) && !cutConnIds.has(c.id)
        );
        updateCanvasRef.current({ ...currentCanvas, nodes: remainingNodes, connections: remainingConns, updatedAt: now });
        // 清理选择状态与临时群组，避免剪切后仍残留框群组边框
        try {
          selectNodesAction([]);
          selectConnectionsAction([]);
          selectGroupAction(null);
        } catch {}
        try {
          destroyGroup();
        } catch {}
      }
    };

    const onCopy = (e: ClipboardEvent) => onCopyOrCut(e, false);
    const onCut = (e: ClipboardEvent) => onCopyOrCut(e, true);

    document.addEventListener('copy', onCopy, true);
    document.addEventListener('cut', onCut, true);
    return () => {
      document.removeEventListener('copy', onCopy, true);
      document.removeEventListener('cut', onCut, true);
    };
  }, [destroyGroup, selectConnectionsAction, selectGroupAction, selectNodesAction]);

  // 📐 监听容器尺寸变化，写入viewport尺寸
  useEffect(() => {
    const el = document.querySelector('.react-transform-wrapper') as HTMLElement | null;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      const current = useCanvasStore.getState().viewState.viewport;
      if (current.width !== w || current.height !== h) {
        setViewportSize({ width: w, height: h });
        // 容器尺寸变化后也保存一次视口（节流
        scheduleSaveView();
      }
    });
    ro.observe(el);
    // 初始化一次（避免无效更新
    const w0 = Math.round(el.clientWidth);
    const h0 = Math.round(el.clientHeight);
    const current = useCanvasStore.getState().viewState.viewport;
    if (current.width !== w0 || current.height !== h0) {
      setViewportSize({ width: w0, height: h0 });
      scheduleSaveView();
    }
    return () => ro.disconnect();
  }, [scheduleSaveView, setViewportSize, canvas?.id]);

  // One-time restore for canvases without an initial transform
  const restoredCanvasIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    try {
      const api: any = transformRef.current;
      const c = canvas;
      if (!api || !c?.id) return;
      if (restoredCanvasIdRef.current === c.id) return;
      const container = getContainerBounds();
      if (!container || container.width <= 0 || container.height <= 0) {
        // Wait until wrapper has stable size, otherwise fit-to-view can miss content.
        return;
      }
      if (hasInitialTransform && initialTransform) {
        try {
          setTransform({
            scale: initialTransform.scale,
            positionX: initialTransform.positionX,
            positionY: initialTransform.positionY,
          });
        } catch {}
        restoredCanvasIdRef.current = c.id;
        return;
      }
      const hasNodes = Array.isArray(c.nodes) && c.nodes.length > 0;
      if (hasNodes) {
        fitToView();
      } else if (typeof api.centerView === 'function') {
        api.centerView();
      }
      restoredCanvasIdRef.current = c.id;
    } catch {
      // ignore
    }
  }, [transformRef, canvas, canvas?.id, hasInitialTransform, initialTransform, fitToView, setTransform, getContainerBounds]);

  // 🧭 小地图导航：将世界中心定位到指定坐标（健壮获取scale/viewport，且同步store
  const handleMinimapNavigate = useCallback((center: { x: number; y: number }) => {
    const api: any = transformRef.current;
    const view = useCanvasStore.getState().viewState;
    const refState = api?.state || api?.instance?.transformState;
    const scale = clampViewScale(refState?.scale ?? view.transform.scale ?? 1, 0.1, 3);
    let { viewport } = view;
    if (!viewport || !viewport.width || !viewport.height) {
      const el = document.querySelector('.react-transform-wrapper') as HTMLElement | null;
      if (el) viewport = { width: el.clientWidth, height: el.clientHeight } as any;
    }
    if (!viewport || !viewport.width || !viewport.height) return;
    const posX = (viewport.width / 2) - center.x * scale;
    const posY = (viewport.height / 2) - center.y * scale;
    if (api && typeof api.setTransform === 'function') {
      api.setTransform(posX, posY, scale);
    }
    setTransform({ scale, positionX: posX, positionY: posY });
  }, [setTransform]);

  // 画布拖拽禁用逻辑由交互Hook处理（interactions.shouldDisablePanning

  // 🔒 键盘状态跟踪（Alt用于提示/内部逻辑；移除Ctrl锁定
  const [_isAltPressed, setIsAltPressed] = useState(false);
  
  // 📚 操作历史管理 - 已迁移到服务
  
  
  // 🎯 拖拽创建节点状
  const [_isDragOver, setIsDragOver] = useState(false);

  // 🖱右键拖动状态管- 精确
  // 右键拖拽状态由交互Hook管理

  // 🔒 键盘事件监听：Ctrl键多选功+ Alt键框选提
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {

      // Alt键框选模式提
      if (event.altKey) {
        setIsAltPressed(true);
      }

      // 删除组快捷键（选中组时
      // 仅在按下 Delete 键时删除，避免编辑标签时Backspace 误删
      // Chat 模式也允许删除组；输入框内不处理
      const tgt = event.target as Element | null;
      const inInput = !!(tgt && (['input','textarea','select'].includes(tgt.tagName.toLowerCase()) || tgt.hasAttribute('contenteditable')));
      if ((event.code === 'Delete') && !inInput && selectedGroupId) {
        event.preventDefault();
        const now = Date.now();
        const group = canvas.nodes.find(n => n.id === selectedGroupId && (n as any).type === 'group') as any;
        const childIds: string[] = group?.children || [];
        const cleanedNodes = canvas.nodes
          .filter(n => n.id !== selectedGroupId)
          .map(n => {
            if (childIds.includes(n.id)) {
              const { parentGroupId: _omit, ...rest } = n as any;
              return { ...rest, updatedAt: now } as any;
            }
            return n;
          });
        updateCanvas({ ...canvas, nodes: cleanedNodes, updatedAt: now });
        selectGroupAction(null);
      }
    };

    const handleKeyUp = (_event: KeyboardEvent) => {

      // Alt键释
      if (!_event.altKey) {
        setIsAltPressed(false);
      }

    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isPanningLocked, selectedGroupId, canvas, canvas.nodes, updateCanvas, selectGroupAction]);

  const createTextNodeAt = useCallback((pos: { x: number; y: number }) => {
    const newNode = createNodeAtPosition('text', { x: pos.x - 150, y: pos.y - 32 }, canvas.id);
    const newCanvas = { ...canvas, nodes: [...canvas.nodes, newNode], updatedAt: Date.now() };
    updateCanvas(newCanvas);
    try {
      selectSingleNode(newNode.id);
      enterEditMode('node', newNode.id);
    } catch {}
  }, [canvas, updateCanvas, selectSingleNode, enterEditMode]);

  // 📝 双击空白区域创建文本节点（还原原始行为）
  const handleDoubleClickEmpty = useCallback((event: React.MouseEvent) => {
    // 仅在空白处生
    const target = event.target as Element;
    const isNode = target.closest('[data-node-container]');
    if (isNode) return;

    event.preventDefault();
    event.stopPropagation();

    // 漂移到内容区外时，双击优先回到内容区
    if (showViewportDriftHint) {
      fitToView();
      return;
    }

    // 转换到画布坐标并创建文本节点
    const pos = screenToCanvasCoords(event.clientX, event.clientY);
    createTextNodeAt(pos);
  }, [screenToCanvasCoords, createTextNodeAt, showViewportDriftHint, fitToView]);

  // 🎯 处理节点选中
  const handleNodeSelect = useCallback((nodeId: string, multiSelect = false) => {
    // 手型模式下禁用节点选择
    if (effectiveToolMode === 'hand') {
      return;
    }

    // 🚀 单一数据流：直接使用Store状态管
    const storeState = useCanvasStore.getState();
    const currentSelected = Array.from(selectedNodeIds as Set<string>);

    if (multiSelect) {
      if (currentSelected.includes(nodeId)) {
        // 移除选中
        const newSelected = currentSelected.filter(id => id !== nodeId);
        storeState.selectNodes(newSelected);
      } else {
        // 添加选中
        storeState.selectNodes([...currentSelected, nodeId]);
      }
    } else {
      // 单
      storeState.selectSingleNode(nodeId);
    }

    // 无论单选还是多选节点，均清除组选中状态，避免“节点选中但组仍保持选中”导致的UI错觉
    storeState.selectGroup(null);

    
    // 触发节点点击回调
    onNodeClick?.(nodeId);
  }, [onNodeClick, effectiveToolMode, selectedNodeIds]);

  
  // 节点拖拽逻辑已抽离至 useNodesDnd

  // 🗑处理群组删除节点（增强版
  const handleGroupDeleteNodes = useCallback((nodeIds: string[]) => {
    if (!nodeIds || nodeIds.length === 0) return;
    
    
    // 🧹 清理群组状
    if (isGroupActive) {
      destroyGroup();
    }
    
    // 🎯 调用现有的删除函
    handleDeleteNodes(nodeIds);
  }, [handleDeleteNodes, isGroupActive, destroyGroup]);

  // 🎯 选择净+ 构建新组（祖先优先）：当同时包含组与其后代时，只保留
  function normalizeAndBuildGroup(selectedIds: string[], sourceCanvas: Canvas) {
    const nodes = sourceCanvas.nodes || [];
    const nodeMap = new Map<string, CanvasNode>();
    const groupMap = new Map<string, any>();
    nodes.forEach(n => {
      nodeMap.set(n.id, n);
      if ((n as any).type === 'group') groupMap.set(n.id, n);
    });

    const selectedSet = new Set(selectedIds);

    const getDescendantLeaves = (gid: string): CanvasNode[] => {
      const g = groupMap.get(gid);
      if (!g) return [];
      const out: CanvasNode[] = [];
      const stack: string[] = [...(g.children || [])];
      while (stack.length) {
        const id = stack.pop()!;
        const cg = groupMap.get(id);
        if (cg) {
          (cg.children || []).forEach((cid: string) => stack.push(cid));
        } else {
          const leaf = nodeMap.get(id);
          if (leaf && (leaf as any).type !== 'group') out.push(leaf);
        }
      }
      return out;
    };

    // 找出“被完全覆盖”的组（所有后代叶子都在选择中）
    const fullyCoveredGroups: string[] = [];
    groupMap.forEach((g, gid) => {
      const leaves = getDescendantLeaves(gid);
      if (leaves.length === 0) return;
      const covered = leaves.every(leaf => selectedSet.has(leaf.id));
      if (covered) fullyCoveredGroups.push(gid);
    });

    // 仅保留“顶层”的被覆盖组（其祖先不在 fullyCoveredGroups 中）
    const isAncestorCovered = (gid: string): boolean => {
      let p = groupMap.get(gid)?.parentGroupId;
      while (p) {
        if (fullyCoveredGroups.includes(p)) return true;
        p = groupMap.get(p)?.parentGroupId;
      }
      return false;
    };
    const topCoveredGroups = fullyCoveredGroups.filter(gid => !isAncestorCovered(gid));

    // 从选择中移除这些组的所有后代叶子，保留组ID
    const childIds: string[] = [...topCoveredGroups];
    const coveredLeaves = new Set<string>();
    topCoveredGroups.forEach(gid => getDescendantLeaves(gid).forEach(leaf => coveredLeaves.add(leaf.id)));
    // 添加剩余的被选叶
    selectedIds.forEach(id => {
      const n = nodeMap.get(id);
      if (!n) return;
      if ((n as any).type === 'group') return; // 已通过topCoveredGroups加入
      if (coveredLeaves.has(id)) return;       // 已纳入其祖先
      childIds.push(id);
    });

    // 列对齐：被选中的 column 应作为组的直接成员，但其内部叶子不应成为组的直接成员，
    // 否则服务端 reconcile 会清空 column.children（详见 BUG 修复）。
    // 移除每个被选 column 的 children，使其仅由 column 持有；column 本身保留在 childIds 中。
    const columnChildLeaves = new Set<string>();
    selectedIds.forEach(id => {
      const n = nodeMap.get(id);
      if (!n || (n as any).type !== 'column') return;
      ((n as any).children || []).forEach((cid: string) => columnChildLeaves.add(cid));
    });
    const childIdsFiltered = childIds.filter(id => !columnChildLeaves.has(id));
    childIds.length = 0;
    childIds.push(...childIdsFiltered);

    // 计算新组的边界（以全部后代叶子为准：组→后代叶子 + 直接叶子
    const leavesForBounds: CanvasNode[] = [];
    childIds.forEach(id => {
      const g = groupMap.get(id);
      if (g) {
        leavesForBounds.push(...getDescendantLeaves(id));
      } else {
        const leaf = nodeMap.get(id);
        if (leaf) leavesForBounds.push(leaf);
      }
    });
    const now = Date.now();
    const b = calculateCanvasBounds(leavesForBounds, 0);
    const nextIndex = (nodes.filter(n => (n as any).type === 'group').length || 0) + 1;
    const newGroupId = `group_${now}`;
    const newGroupNode: CanvasNode = {
      id: newGroupId,
      type: 'group',
      x: b.minX,
      y: b.minY,
      width: b.width,
      height: b.height,
      // 组标题语义改为 content 首行，不再使用 title
      content: `组${nextIndex}`,
      children: [...childIds],
      // 🎨 使用莫兰迪色板按序轮动（基于现有组数，0-based）
      accentColor: getRotatingGroupColorByIndex(nextIndex - 1),
      createdAt: now,
      updatedAt: now,
      locked: false,
    } as any;

    // 处理父子关系：将 childIds 的父设为新组，同时从原父组移除这些子节点
    const reparentedNodes = nodes.map(n => ({ ...n }));
    const idxMap = new Map<string, number>();
    reparentedNodes.forEach((n, idx) => idxMap.set(n.id, idx));

    const removeFromParent = (childId: string) => {
      const child = reparentedNodes[idxMap.get(childId)!] as any;
      const parentId = child?.parentGroupId;
      if (!parentId) return;
      const parentIdx = idxMap.get(parentId);
      if (parentIdx === undefined) return;
      const parent = reparentedNodes[parentIdx] as any;
      parent.children = (parent.children || []).filter((id: string) => id !== childId);
      parent.updatedAt = now;
    };

    childIds.forEach(id => {
      const idx = idxMap.get(id);
      if (idx === undefined) return;
      const item: any = reparentedNodes[idx];
      removeFromParent(id);
      item.parentGroupId = newGroupId;
      item.updatedAt = now;
    });

    return { childIds, now, nextIndex, newGroupId, newGroupNode, reparentedNodes };
  }

  const isPureFreeConnection = (conn?: CanvasConnection | null): boolean => {
    if (!conn) return false;
    const c: any = conn;
    return Boolean(c.fromPoint && c.toPoint);
  };

  // 📦 处理创建组合（永久组
  const handleCreateGroup = useCallback((nodeIds: string[], connectionIds?: string[]) => {
    // 允许
    // - 至少 2 个节点，
    // - 1 个节+ 至少 1 条显自动纳入的连
    if (!nodeIds || nodeIds.length < 1) return;
    const { childIds, now, newGroupId, newGroupNode, reparentedNodes } = normalizeAndBuildGroup(nodeIds, canvas);
    const nodeSet = new Set(childIds);
    const allConns = canvas.connections || [];
    const connectionsById = new Map<string, CanvasConnection>(allConns.map((c) => [c.id, c]));
    const manualPureConnIds = (connectionIds || []).filter((id) => isPureFreeConnection(connectionsById.get(id)));
    // 计算组边界（使用组内叶子节点AABB
    const leafNodes = canvas.nodes.filter(n => nodeSet.has(n.id) && (n as any).type !== 'group');
    let autoFreeConns: string[] = [];
    if (leafNodes.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      leafNodes.forEach(n => {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.width);
        maxY = Math.max(maxY, n.y + n.height);
      });
      const inRect = (p: {x:number;y:number}) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
      autoFreeConns = allConns
        .filter((c: any) => {
          if (!isPureFreeConnection(c)) return false;
          const pts: Array<{ x: number; y: number }> = [];
          if (c.fromPoint) pts.push(c.fromPoint);
          if (c.toPoint) pts.push(c.toPoint);
          if (c.curveAnchor) pts.push(c.curveAnchor);
          if (Array.isArray(c.controlPoints)) pts.push(...c.controlPoints);
          return pts.length > 0 && pts.every(inRect);
        })
        .map(c => c.id);
    }
    // 合并：显式传+ 自动收集
    const merged = new Set<string>([...manualPureConnIds, ...autoFreeConns]);
    // 若节点数不足 2，但存在要附加的连线，则也允许创建分
    if (childIds.length < 2 && merged.size === 0) return;
    let groupWithAttachments: any = { ...newGroupNode };
    if (merged.size > 0) {
      groupWithAttachments = { ...groupWithAttachments, attachedConnections: Array.from(merged) };
    }
    updateCanvas({ ...canvas, nodes: [...reparentedNodes, groupWithAttachments], updatedAt: now });
    selectGroupAction(newGroupId);
    if (isGroupActive) destroyGroup();
    // 清理原有选择，保持与节点分组合并后的选择一
    selectNodesAction([]);
    try { selectConnectionsAction([]); } catch {}
  }, [canvas, updateCanvas, isGroupActive, destroyGroup, selectGroupAction, selectNodesAction, selectConnectionsAction]);

  // 🧲 节点拖拽与列系统（大颗粒抽离）
  // Smart guides state (rendered in overlays)
  const [alignmentGuides, setAlignmentGuides] = useState<GuideLine[] | null>(null);
  const [alignmentDistances, setAlignmentDistances] = useState<DistanceHint[] | null>(null);
  const [forceGuideLines, setForceGuideLines] = useState(false);



  // 🎯 新的群组拖拽移动处理
  const handleNewGroupDragMove = useCallback((event: MouseEvent) => {
    const currentState = groupDragStateRef.current;
    if (!currentState.isDragging || !currentState.startMousePos || !currentState.startNodePositions) {
      return;
    }

    const deltaX = event.clientX - currentState.startMousePos.x;
    const deltaY = event.clientY - currentState.startMousePos.y;

    const canvasDeltaX = deltaX / (currentZoom / 100);
    const canvasDeltaY = deltaY / (currentZoom / 100);

    let adjDX = canvasDeltaX;
    let adjDY = canvasDeltaY;

    try {
      const nodeIds = currentState.nodeIds ? Array.from(currentState.nodeIds) : [];
      if (nodeIds.length > 0) {
        const selectedNodes = (canvas.nodes || []).filter(n => currentState.nodeIds!.has(n.id));
        if (selectedNodes.length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const n of selectedNodes) {
            const s = currentState.startNodePositions!.get(n.id);
            if (!s) continue;
            minX = Math.min(minX, s.x);
            minY = Math.min(minY, s.y);
            maxX = Math.max(maxX, s.x + n.width);
            maxY = Math.max(maxY, s.y + n.height);
          }
          if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
            const rect = { x: minX + canvasDeltaX, y: minY + canvasDeltaY, width: maxX - minX, height: maxY - minY };
            const scale = (currentZoom || 100) / 100;
            const options = getGuideOptions(!!event.altKey);
            const precisionMode = !!event.shiftKey;
            const shouldPreview = precisionMode || options.showLines;
            if (!options.enabled || options.modifierDisabled || !shouldPreview) {
              try {
                setAlignmentGuides([]);
                setAlignmentDistances([] as any);
                setForceGuideLines(false);
              } catch {}
              groupGuideSessionRef.current = null;
            } else {
              if (!guidesControllerRef.current) {
                guidesControllerRef.current = createGuidesController();
              }
              if (!groupGuideSessionRef.current) {
                groupGuideSessionRef.current = guidesControllerRef.current.startDrag({ ids: nodeIds, rect });
              }
              const previewOptions = { ...options, tolerancePx: precisionMode ? SNAP_PREVIEW_TOLERANCE_PX : options.tolerancePx };
              const baselineById = previewOptions.allowBaseline ? buildBaselineMap(canvas.nodes || [], fontStyle) : undefined;
              const canvasSnapshot = buildCanvasSnapshot(canvas.nodes || [], scale, { baselineById });
              const plan = guidesControllerRef.current.moveDrag(
                groupGuideSessionRef.current,
                canvasSnapshot,
                { ids: nodeIds, rect },
                previewOptions
              );
              adjDX = canvasDeltaX;
              adjDY = canvasDeltaY;
              try {
                setAlignmentGuides(plan.guideLines || []);
                setAlignmentDistances((previewOptions.showDistance ? (plan.distances || []) : []) as any);
                setForceGuideLines(precisionMode);
              } catch {}
            }
          }
        }
      } else {
        try { setAlignmentGuides([]); setAlignmentDistances([] as any); setForceGuideLines(false); } catch {}
      }
    } catch {}

    const updatedNodes = canvas.nodes.map(node => {
      if (currentState.nodeIds && currentState.nodeIds.has(node.id)) {
        const startPos = currentState.startNodePositions!.get(node.id);
        if (startPos) {
          const newPos = { x: startPos.x + adjDX, y: startPos.y + adjDY };
          return { ...node, x: newPos.x, y: newPos.y };
        }
      }
      return node;
    });

    const startConns = currentState.startConnectionPositions;
    const updatedConnections = (canvas.connections || []).map((c) => {
      if (!startConns || !startConns.has(c.id)) return c;
      const base = startConns.get(c.id)!;
      const moved = { ...(c as any) };
      if (base.from) moved.fromPoint = { x: base.from.x + adjDX, y: base.from.y + adjDY };
      if (base.to) moved.toPoint = { x: base.to.x + adjDX, y: base.to.y + adjDY };
      if (base.anchor) {
        moved.curveAnchor = { x: base.anchor.x + adjDX, y: base.anchor.y + adjDY };
      }
      if (Array.isArray(base.controls) && base.controls.length) {
        moved.controlPoints = base.controls.map(p => ({ x: p.x + adjDX, y: p.y + adjDY }));
      }
      return moved as any;
    });

    updateCanvas({
      ...canvas,
      nodes: updatedNodes,
      connections: updatedConnections,
      updatedAt: Date.now()
    });

    if (isGroupActive && activeGroup) {
      updateGroupBounds(updatedNodes);
    }
  }, [isGroupActive, activeGroup, canvas, updateCanvas, updateGroupBounds, currentZoom, fontStyle, setForceGuideLines]);

  const handleGroupDragEndNew = useCallback(() => {
    try {
      const latestCanvas = useCanvasStore.getState().canvas;
      const currentState = groupDragStateRef.current;
      const nodeIds = currentState.nodeIds ? Array.from(currentState.nodeIds) : [];
      if (nodeIds.length > 0) {
        const options = getGuideOptions(guidesAltPressedRef.current, { tolerancePx: SNAP_COMMIT_TOLERANCE_PX });
        if (options.enabled && !options.modifierDisabled) {
          const scale = (currentZoom || 100) / 100;
          const s = Math.max(scale, 0.01);
          const commitTol = SNAP_COMMIT_TOLERANCE_PX / s;
          const maxDelta = SNAP_MAX_DELTA_PX / s;
          const baselineById = options.allowBaseline ? buildBaselineMap(latestCanvas.nodes || [], fontStyle) : undefined;
          const canvasSnapshot = buildCanvasSnapshot(latestCanvas.nodes || [], scale, { baselineById });
          const nodesById = new Map(latestCanvas.nodes.map((n) => [n.id, n]));
          const selectionRect = (() => {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const id of nodeIds) {
              const node = nodesById.get(id);
              if (!node) continue;
              minX = Math.min(minX, node.x);
              minY = Math.min(minY, node.y);
              maxX = Math.max(maxX, node.x + node.width);
              maxY = Math.max(maxY, node.y + node.height);
            }
            if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
              return null;
            }
            return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
          })();

          if (selectionRect) {
            if (!guidesControllerRef.current) {
              guidesControllerRef.current = createGuidesController();
            }
            const snapSession =
              groupGuideSessionRef.current ||
              guidesControllerRef.current.startDrag({ ids: nodeIds, rect: selectionRect });
            const plan = guidesControllerRef.current.moveDrag(
              snapSession,
              canvasSnapshot,
              { ids: nodeIds, rect: selectionRect },
              options
            );
            const snapDx = Math.abs(plan.delta.x) <= commitTol && Math.abs(plan.delta.x) <= maxDelta ? plan.delta.x : 0;
            const snapDy = Math.abs(plan.delta.y) <= commitTol && Math.abs(plan.delta.y) <= maxDelta ? plan.delta.y : 0;
            if (snapDx !== 0 || snapDy !== 0) {
              const updatedNodes = (latestCanvas.nodes || []).map((node) => {
                if (currentState.nodeIds && currentState.nodeIds.has(node.id)) {
                  return { ...node, x: node.x + snapDx, y: node.y + snapDy };
                }
                return node;
              });

              const startConns = currentState.startConnectionPositions;
              const updatedConnections = (latestCanvas.connections || []).map((c) => {
                if (!startConns || !startConns.has(c.id)) return c;
                const moved = { ...(c as any) };
                if (moved.fromPoint) moved.fromPoint = { x: moved.fromPoint.x + snapDx, y: moved.fromPoint.y + snapDy };
                if (moved.toPoint) moved.toPoint = { x: moved.toPoint.x + snapDx, y: moved.toPoint.y + snapDy };
                if (moved.curveAnchor) moved.curveAnchor = { x: moved.curveAnchor.x + snapDx, y: moved.curveAnchor.y + snapDy };
                if (Array.isArray(moved.controlPoints) && moved.controlPoints.length) {
                  moved.controlPoints = moved.controlPoints.map((p: any) => ({ x: p.x + snapDx, y: p.y + snapDy }));
                }
                return moved as any;
              });

              updateCanvas({ ...latestCanvas, nodes: updatedNodes, connections: updatedConnections, updatedAt: Date.now() });
              if (isGroupActive && activeGroup) {
                try { updateGroupBounds(updatedNodes); } catch {}
              }
            }
          }
        }
      }
    } catch {}

    // Clear smart guides overlay on group drag end
    try { setAlignmentGuides(null); setAlignmentDistances(null); setForceGuideLines(false); } catch {}
    groupGuideSessionRef.current = null;
    
    // 清理拖拽状
    // 如果是由永久组发起的临时群组拖拽，结束后销毁临时群组，取消框选状
    if (groupDragStateRef.current.createdFromPermanent) {
      destroyGroup();
    }

    groupDragStateRef.current = {
      isDragging: false,
      startMousePos: null,
      startNodePositions: null,
      startConnectionPositions: null,
      nodeIds: null,
      createdFromPermanent: false,
      permanentGroupId: null
    };
    
    // 移除全局事件监听
    document.removeEventListener('mousemove', handleNewGroupDragMove);
    document.removeEventListener('mouseup', handleGroupDragEndNew);
    
    // 恢复节点独立拖拽能力
    setGroupDragging(false);

    // 拖拽结束后：anchorParams 反算 curveAnchor（节节点连线），保持冗余一
    try {
      const latest = useCanvasStore.getState().canvas;
      (async () => {
        try {
          const { getConnectionSettings } = await import('../../stores/settings.store');
          const { anchorFromParams } = await import('../../utils/dynamicConnectionRenderer');
          const settings = getConnectionSettings();
          const nodesById = new Map<string, any>((latest.nodes || []).map(n => [n.id, n]));
          const H_TOL = 10;
          const sidePoint = (n: any, side: 'left'|'right'|'top'|'bottom') => {
            const cx = n.x + n.width / 2, cy = n.y + n.height / 2;
            if (side === 'left') return { x: cx - n.width / 2, y: cy };
            if (side === 'right') return { x: cx + n.width / 2, y: cy };
            if (side === 'top') return { x: cx, y: cy - n.height / 2 };
            return { x: cx, y: cy + n.height / 2 };
          };
          let changed = false;
          const nextConns = (latest.connections || []).map((c) => {
            const anyC: any = c as any;
            if (!anyC.from || !anyC.to || anyC.fromPoint || anyC.toPoint) return c;
            const ap = anyC.anchorParams as { u:number; v:number } | undefined;
            if (!ap || typeof ap.u !== 'number' || typeof ap.v !== 'number') return c;
            const fromNode = nodesById.get(anyC.from);
            const toNode = nodesById.get(anyC.to);
            if (!fromNode || !toNode) return c;
            const cA = { x: fromNode.x + fromNode.width / 2, y: fromNode.y + fromNode.height / 2 };
            const cB = { x: toNode.x + toNode.width / 2, y: toNode.y + toNode.height / 2 };
            const sameGroup = fromNode.parentGroupId && toNode.parentGroupId && fromNode.parentGroupId === toNode.parentGroupId;
            const groupNode = sameGroup ? (latest.nodes || []).find(n => n.id === fromNode.parentGroupId && (n as any).type === 'group') as any : null;
            const forceSide = Boolean(groupNode && groupNode.groupMode === 'mindmap');
            const override = (((c as any).appearance?.endpointStrategy) as 'center-ray'|'side-midpoints'|undefined);
            const strategy = (forceSide || override === 'side-midpoints' || (!override && settings.endpointStrategy === 'side-midpoints')) ? 'side-midpoints' : 'center-ray';
            let P0 = cA, P3 = cB;
            if (strategy === 'side-midpoints') {
              const fromLeft = fromNode.x, fromRight = fromNode.x + fromNode.width;
              const toLeft = toNode.x, toRight = toNode.x + toNode.width;
              let gapX = 0;
              if (cB.x >= cA.x) gapX = Math.max(0, toLeft - fromRight); else gapX = Math.max(0, fromLeft - toRight);
              let fromSide: 'left'|'right'|'top'|'bottom';
              let toSide: 'left'|'right'|'top'|'bottom';
              if (gapX > H_TOL) { const dx = cB.x - cA.x; fromSide = dx >= 0 ? 'right' : 'left'; toSide = dx >= 0 ? 'left' : 'right'; }
              else { const dy = cB.y - cA.y; fromSide = dy >= 0 ? 'bottom' : 'top'; toSide = dy >= 0 ? 'top' : 'bottom'; }
              P0 = sidePoint(fromNode, fromSide);
              P3 = sidePoint(toNode, toSide);
            }
            const newAnchor = anchorFromParams(P0, P3, ap);
            if (!anyC.curveAnchor || Math.hypot(newAnchor.x - anyC.curveAnchor.x, newAnchor.y - anyC.curveAnchor.y) > 0.1) {
              changed = true;
              return { ...(c as any), curveAnchor: newAnchor } as any;
            }
            return c;
          });
          if (changed) {
            updateCanvas({ ...latest, connections: nextConns, updatedAt: Date.now() });
          }
        } catch {}
      })();
    } catch {}
  }, [handleNewGroupDragMove, destroyGroup, setGroupDragging, updateCanvas, currentZoom, fontStyle, isGroupActive, activeGroup, updateGroupBounds]);

  // 🎯 全新的群组拖拽系- 统一处理入口
  const startGroupDrag = useCallback((event: React.MouseEvent, group: any, createdFromPermanent = false, permanentGroupId?: string | null) => {
    
    // 记录初始鼠标位置
    const startMousePos = { x: event.clientX, y: event.clientY };
    
    // 记录群组中所有节点的初始位置
    const startNodePositions = new Map<string, Position>();
    group.nodeIds.forEach((nodeId: string) => {
      const node = canvas.nodes.find(n => n.id === nodeId);
      if (node) {
        startNodePositions.set(nodeId, { x: node.x, y: node.y });
      }
    });
    
    // 设置拖拽状
    // 记录被选中的自由连线初始位+ 群组范围内的自由连线
    let startConnectionPositions: Map<string, { from?: Position; to?: Position; anchor?: Position; controls?: Position[] }> | null = null;
    try {
      const store = useCanvasStore.getState();
      const selectedConnIds = Array.from(useCanvasStore.getState().selections.connectionIds || new Set<string>());
      if (selectedConnIds.length) {
        startConnectionPositions = new Map();
        selectedConnIds.forEach((id) => {
          const conn = (canvas.connections || []).find(c => c.id === id) as any;
          if (!conn) return;
          if (conn.fromPoint || conn.toPoint) {
            startConnectionPositions!.set(id, {
              from: conn.fromPoint ? { x: conn.fromPoint.x, y: conn.fromPoint.y } : undefined,
              to: conn.toPoint ? { x: conn.toPoint.x, y: conn.toPoint.y } : undefined,
              anchor: conn.curveAnchor ? { x: conn.curveAnchor.x, y: conn.curveAnchor.y } : undefined,
              controls: Array.isArray(conn.controlPoints) ? conn.controlPoints.map((p: any) => ({ x: p.x, y: p.y })) : undefined,
            });
          }
        });
      }
      // 将群组范围内的自由连线也纳入（两端点都在群组外框内），或属于该永久组的附属连
      try {
        const gb = group.bounds as { x: number; y: number; width: number; height: number } | undefined;
        if (gb) {
          const inRect = (p: Position) => p.x >= gb.x && p.x <= gb.x + gb.width && p.y >= gb.y && p.y <= gb.y + gb.height;
          for (const conn of (canvas.connections || [])) {
            const anyC: any = conn as any;
            if (anyC.fromPoint || anyC.toPoint) {
              const a = anyC.fromPoint as Position | undefined;
              const b = anyC.toPoint as Position | undefined;
              const bothIn = (!a || inRect(a)) && (!b || inRect(b));
              if (bothIn) {
                if (!startConnectionPositions) startConnectionPositions = new Map();
                if (!startConnectionPositions.has(conn.id)) {
                  startConnectionPositions.set(conn.id, {
                    from: a ? { x: a.x, y: a.y } : undefined,
                    to: b ? { x: b.x, y: b.y } : undefined,
                    anchor: anyC.curveAnchor ? { x: anyC.curveAnchor.x, y: anyC.curveAnchor.y } : undefined,
                    controls: Array.isArray(anyC.controlPoints) ? anyC.controlPoints.map((p: any) => ({ x: p.x, y: p.y })) : undefined,
                  });
                }
              }
            }
          }
        }
        // 如果是永久组发起拖拽，同时纳入该组声明的附属连接
        const permId = permanentGroupId || groupDragStateRef.current.permanentGroupId;
        if (createdFromPermanent && permId) {
          const gnode = (canvas.nodes || []).find(n => n.id === permId) as any;
          const attached: string[] = Array.isArray(gnode?.attachedConnections) ? gnode.attachedConnections : [];
          for (const cid of attached) {
            const conn = (canvas.connections || []).find(c => c.id === cid) as any;
            if (!conn || (!conn.fromPoint && !conn.toPoint)) continue;
            if (!startConnectionPositions) startConnectionPositions = new Map();
            if (!startConnectionPositions.has(cid)) {
              startConnectionPositions.set(cid, {
                from: conn.fromPoint ? { x: conn.fromPoint.x, y: conn.fromPoint.y } : undefined,
                to: conn.toPoint ? { x: conn.toPoint.x, y: conn.toPoint.y } : undefined,
                anchor: conn.curveAnchor ? { x: conn.curveAnchor.x, y: conn.curveAnchor.y } : undefined,
                controls: Array.isArray(conn.controlPoints) ? conn.controlPoints.map((p: any) => ({ x: p.x, y: p.y })) : undefined,
              });
            }
          }
        }
      } catch {}
      if (startConnectionPositions && startConnectionPositions.size === 0) startConnectionPositions = null;
    } catch {}

    groupDragStateRef.current = {
      isDragging: true,
      startMousePos,
      startNodePositions,
      startConnectionPositions,
      nodeIds: new Set(group.nodeIds),
      createdFromPermanent,
      permanentGroupId: permanentGroupId || null
    };
    
    // 添加全局事件监听
    document.addEventListener('mousemove', handleNewGroupDragMove);
    document.addEventListener('mouseup', handleGroupDragEndNew);
    
    // 禁用所有节点的独立拖拽能力
    setGroupDragging(true);
  }, [canvas.nodes, canvas.connections, handleNewGroupDragMove, handleGroupDragEndNew, setGroupDragging]);

  // 🎯 处理节点级别的群组拖拽启
  const handleNodeGroupDragStart = useCallback((event: React.MouseEvent, _nodeId: string) => {
    if (!isGroupActive || !activeGroup) {
      return;
    }
    
    startGroupDrag(event, activeGroup);
  }, [isGroupActive, activeGroup, startGroupDrag]);

  // 🎯 处理子节点选中
  const handleChildNodeSelect = useCallback((nodeId: string) => {
    handleNodeSelect(nodeId, false);
  }, [handleNodeSelect]);

  // 📦 处理子节点弹
  const handleChildNodeDragStart = useCallback((nodeId: string, columnId: string, popupPosition?: { x: number; y: number }) => {
    
    // 找到要弹出的子节
    const childNode = canvas.nodes.find(n => n.id === nodeId);
    if (!childNode) {
      return;
    }

    // 从收集栏中移除节
    const columnNode = canvas.nodes.find(n => n.id === columnId);
    if (columnNode && columnNode.type === 'column') {
      const updatedColumn = {
        ...columnNode,
        children: columnNode.children?.filter((childId: string) => childId !== nodeId) || []
      };
      
      // 将子节点设置到弹出位置，并确保高z-index
      const pos = popupPosition || { x: columnNode.x + columnNode.width + 50, y: columnNode.y + 50 };
      const updatedChildNode = {
        ...childNode,
        x: pos.x,
        y: pos.y,
        width: childNode.width || 250,
        height: childNode.height || 100,
        locked: false // 确保可以移动
      };

      const newCanvas = {
        ...canvas,
        nodes: (canvas?.nodes || []).map(node => {
          if (node.id === columnId) return updatedColumn;
          if (node.id === nodeId) return updatedChildNode;
          return node;
        }),
        updatedAt: Date.now()
      };
      
      updateCanvas(newCanvas);
      
      // 选中弹出的节点，确保它在前台显示
      selectSingleNode(nodeId);
    }
  }, [canvas, updateCanvas, selectSingleNode]);

  // 🎯 群组整体缩放：拖动边界框右下角手柄，对所有节点进行等比缩
  const handleGroupScaleMove = useCallback((event: MouseEvent) => {
    const state = groupScaleStateRef.current;
    if (!state || !state.isScaling) return;
    if (!coordinatesReady) return;

    const canvasPos = screenToCanvasCoords(event.clientX, event.clientY);
    const { groupCenter, baseRadius } = state;
    if (!baseRadius || !isFinite(baseRadius) || baseRadius <= 0) return;

    const dx = canvasPos.x - groupCenter.x;
    const dy = canvasPos.y - groupCenter.y;
    const dist = Math.hypot(dx, dy);
    if (!isFinite(dist) || dist <= 0) return;

    let scale = dist / baseRadius;
    if (!isFinite(scale) || scale <= 0) return;

    const MIN_SCALE = 0.2;
    const MAX_SCALE = 4;
    scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));

    const snapshotMap = new Map(state.nodeSnapshots.map((s) => [s.id, s]));
    const idSet = new Set(state.nodeSnapshots.map((s) => s.id));
    const now = Date.now();

    const updatedNodes = (canvas.nodes || []).map((node) => {
      if (!idSet.has(node.id)) return node;
      const snap = snapshotMap.get(node.id);
      if (!snap) return node;

      // 跳过锁定节点和容器节点（组本身）
      if (snap.locked) return node;
      if (snap.type === 'column' || snap.type === 'group') return node;

      const baseDx = snap.centerX - groupCenter.x;
      const baseDy = snap.centerY - groupCenter.y;
      const cx = groupCenter.x + baseDx * scale;
      const cy = groupCenter.y + baseDy * scale;

      const w = Math.max(10, snap.width * scale);
      const h = Math.max(10, snap.height * scale);
      const x = cx - w / 2;
      const y = cy - h / 2;

      return { ...node, x, y, width: w, height: h, updatedAt: now };
    });

    const newCanvas: Canvas = { ...canvas, nodes: updatedNodes, updatedAt: now };
    updateCanvas(newCanvas);

    try {
      updateGroupBounds(newCanvas.nodes);
    } catch {}
  }, [canvas, coordinatesReady, screenToCanvasCoords, updateCanvas, updateGroupBounds]);

  const handleGroupScaleEnd = useCallback((_event: MouseEvent) => {
    if (!groupScaleStateRef.current || !groupScaleStateRef.current.isScaling) {
      return;
    }
    groupScaleStateRef.current = null;
    document.removeEventListener('mousemove', handleGroupScaleMove);
    document.removeEventListener('mouseup', handleGroupScaleEnd);
  }, [handleGroupScaleMove]);

  const handleGroupScaleStart = useCallback((event: React.MouseEvent) => {
    if (!isGroupActive || !activeGroup) return;
    if (!coordinatesReady) return;

    event.preventDefault();
    event.stopPropagation();

    const ids = Array.from(activeGroup.nodeIds || []);
    if (!ids.length) return;

    const selectedNodes = (canvas.nodes || []).filter((n) => ids.includes(n.id));
    if (!selectedNodes.length) return;

    // 基于当前节点位置实时计算群组边界和中
    const bounds = calculateGroupBounds(selectedNodes.filter((n: any) => (n as any).type !== 'group'));
    const groupCenter: Position = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };

    const startPos = screenToCanvasCoords(event.clientX, event.clientY);
    let baseRadius = Math.hypot(startPos.x - groupCenter.x, startPos.y - groupCenter.y);
    if (!isFinite(baseRadius) || baseRadius <= 0) {
      baseRadius = Math.max(bounds.width, bounds.height) / 2 || 1;
    }

    const nodeSnapshots = selectedNodes.map((n) => ({
      id: n.id,
      centerX: n.x + n.width / 2,
      centerY: n.y + n.height / 2,
      width: n.width,
      height: n.height,
      locked: (n as any).locked,
      type: (n as any).type,
    }));

    groupScaleStateRef.current = {
      isScaling: true,
      groupCenter,
      baseRadius,
      nodeSnapshots,
    };

    document.addEventListener('mousemove', handleGroupScaleMove);
    document.addEventListener('mouseup', handleGroupScaleEnd);
  }, [isGroupActive, activeGroup, coordinatesReady, canvas.nodes, screenToCanvasCoords, handleGroupScaleMove, handleGroupScaleEnd]);

  // （此快捷键处理将移动handleMindmapAddChild 定义之后

  // 📂 获取可用画布列表
  const handleGetAvailableCanvases = link.getAvailableCanvases;

  // 🎯 显示画布选择界面（Canvas Link节点创建时调用）
  const handleShowCanvasSelection = link.showCanvasSelection;

  // ✏️ 处理节点编辑
  const handleNodeEdit = useCallback(async (nodeId: string, editing?: boolean) => {
    // 只读视图下完全禁用进入编
    if (readOnly) return;
    // 手型模式下禁用节点编
    if (effectiveToolMode === 'hand') {
      return;
    }
    
    const node = canvas.nodes.find(n => n.id === nodeId);
    const newEditingId = editingNodeId === nodeId ? null : nodeId;
    if (node?.locked && newEditingId) {
      return;
    }
    
    // 🔗 Canvas Link节点的特殊处理：编辑时自动检查并显示画布选择界面
    if (node?.type === 'canvas-link' && newEditingId && editing !== false) {
      try {
        // 🔍 首先检查当前链接是否已损坏
        let _needsRepair = false;
        const currentTargetId = node.targetCanvasId || node.content;
        
        if (currentTargetId) {
          const canvasExists = await onCanvasExists?.(currentTargetId);
          if (!canvasExists) {
            _needsRepair = true;
            console.warn('🔧 Canvas Link目标画布已损坏，将启动修复模式..');
          }
        }
        
        const targetInfo = await handleShowCanvasSelection(node.title || '');
        
        if (targetInfo) {
          // 更新Canvas Link节点的目标信息
          const updatedCanvas: Canvas = {
            ...canvas,
            nodes: canvas.nodes.map(n => 
              n.id === nodeId 
                ? {
                    ...n,
                    title: targetInfo.title,
                    content: targetInfo.id,
                    targetCanvasId: targetInfo.id,
                    thumbnailUrl: targetInfo.thumbnailUrl || '',
                    updatedAt: Date.now()
                  }
                : n
            ),
            updatedAt: Date.now()
          };
          
          updateCanvas(updatedCanvas);
        }
        
        // 无论用户是否选择，都退出编辑模式
        cancelEdit();
        setPanningLocked(false);
        return;
      } catch (_error) {
        console.error('🚨 Canvas Link编辑失败:', _error);
        cancelEdit();
        setPanningLocked(false);
        return;
      }
    }

    if (newEditingId) {
      enterEditMode('node', newEditingId);
    } else {
      cancelEdit();
    }

    // 编辑模式时锁定页面平
    if (newEditingId) {
      setPanningLocked(true);
    } else {
      setPanningLocked(false);
    }
  }, [editingNodeId, canvas, effectiveToolMode, handleShowCanvasSelection, updateCanvas, cancelEdit, setPanningLocked, enterEditMode, onCanvasExists, readOnly]);

  // 📚 添加到历史记- 已迁移到服务
  // 历史记录现在由Zustand Store统一管理


  // 📚 撤销重做操作 - 已迁移到服务
  // 现在由useCanvasKeyboard统一处理Ctrl+Z/Y快捷

  // 🎯 拖拽创建节点事件处理
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    // 只有当拖拽真正离开画布容器时才设置为false
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    
    try {
      const shouldUseStorePersistence = !(externalCanvas && onCanvasChange);
      // 🎯 处理来自列内子项的拖出：text/plain nodeId
      const draggedNodeId = event.dataTransfer.getData('text/plain');
      if (draggedNodeId) {
        const node = canvas.nodes.find(n => n.id === draggedNodeId);
        if (node) {
          // 画布坐标
          const canvasPos = screenToCanvasCoords(event.clientX, event.clientY);
          const parentColumn = getNodeParentColumn(canvas, draggedNodeId);

          // 更新节点位置，并从父收集栏children中移
          const now = Date.now();
          const updatedNodes = canvas.nodes.map(n =>
            n.id === draggedNodeId ? { ...n, x: canvasPos.x, y: canvasPos.y, updatedAt: now } : n
          ).map(n => {
            if (parentColumn && n.id === parentColumn.id) {
              return { ...n, children: (n.children || []).filter(id => id !== draggedNodeId), updatedAt: now } as CanvasNode;
            }
            return n;
          });

          let updated: Canvas = { ...canvas, nodes: updatedNodes, updatedAt: now };
          // 父列收纳减少后，重新布局并自动收缩高
          if (parentColumn) {
            updated = applyColumnLayout(updated, parentColumn.id);
          }
          updateCanvas(updated);
          // 选中该节
          selectSingleNode(draggedNodeId);
          return; // 已处drop
        }
      }

      // 允许 Chat 模式下的文件/JSON 拖拽创建（只读模式已在父层阻断）

      // 🎯 优先处理文件拖拽（直接从文件系统拖入
      const droppedFiles = getFilesFromDragEvent(event);
      if (droppedFiles.length > 0) {
        const canvasPos = screenToCanvasCoords(event.clientX, event.clientY);
        const uniqueFiles = dedupeFiles(droppedFiles);

        // 🌟 支持 .svg 文件作为 SVG 代码节点导入（而非媒体节点
        const svgTextFiles = uniqueFiles.filter((f) => {
          const name = (f.name || '').toLowerCase();
          const type = (f.type || '').toLowerCase();
          return type === 'image/svg+xml' || name.endsWith('.svg');
        });

        if (svgTextFiles.length > 0) {
          try {
            const now = Date.now();
            const newNodes: CanvasNode[] = [];

            let offset = 0;
            for (const file of svgTextFiles) {
              const text = await new Promise<string>((resolve, reject) => {
                try {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result || ''));
                  reader.onerror = () => reject(new Error('Failed to read SVG file'));
                  reader.readAsText(file);
                } catch (e) { reject(e as any); }
              });

              const size = calculateSvgNodeSize(text);
              const pos = { x: canvasPos.x + offset, y: canvasPos.y + offset };
              const node = createNodeAtPosition('code', pos, canvas.id, {
                codeType: 'svg',
                content: text,
                width: size.width,
                height: size.height,
              });
              (node as any).createdAt = now;
              (node as any).updatedAt = now;
              newNodes.push(node);
              offset += 24; // 轻微错位展开
            }

            if (shouldUseStorePersistence) {
              for (const node of newNodes) {
                try { addNodeAction(node as any); } catch {}
              }
            } else {
              const updated: Canvas = {
                ...canvas,
                nodes: [...canvas.nodes, ...newNodes],
                updatedAt: now,
              };
              updateCanvas(updated);
            }
            if (newNodes.length > 0) {
              selectSingleNode(newNodes[newNodes.length - 1].id);
            }
          } catch (e) {
            console.warn('导入 SVG 文件为代码节点失败', e);
          }
        }

        // 其余文件走媒体流
        const otherFiles = uniqueFiles.filter((f) => !svgTextFiles.includes(f));
        if (otherFiles.length > 0) {
          await handleCanvasMediaFiles(otherFiles, { x: canvasPos.x, y: canvasPos.y });
        }

        return; // 文件拖拽处理完成，不继续处理JSON拖拽
      }
      
      // 🎯 处理原有的JSON格式拖拽创建节点
      const jsonData = event.dataTransfer.getData('application/json');
      if (!jsonData) return; // 没有JSON数据，退出
      
      const data = JSON.parse(jsonData);
      // 来自素材库的媒体资产
      if (data.type === 'asset-media' && data.payload) {
        const { fileUrl, fileDownloadUrl, fileName, fileType, fileSize, extension, mediaType, storagePath } = data.payload || {};
        const canvasPos = screenToCanvasCoords(event.clientX, event.clientY);
        const now = Date.now();
        const nodeId = NodeIds.generateNodeId(canvas?.id, 'media');
        const width = DEFAULT_NODE_SIZES.media.width;
        const height = DEFAULT_NODE_SIZES.media.height;
        const mediaNode: CanvasNode = {
          id: nodeId,
          type: 'media',
          x: canvasPos.x - width / 2,
          y: canvasPos.y - height / 2,
          width,
          height,
          content: `File: ${fileName}`,
          fileName,
          fileType,
          fileExtension: extension,
          fileSize,
          mediaType: mediaType || 'document',
          uploadStatus: 'uploaded',
          localPath: fileUrl,
          fileUrl,
          fileDownloadUrl,
          storagePath,
          createdAt: now,
          updatedAt: now
        } as any;

        if (shouldUseStorePersistence) {
          try { addNodeAction(mediaNode as any); } catch {}
        } else {
          const newCanvas = {
            ...canvas,
            nodes: [...canvas.nodes, mediaNode],
            updatedAt: now
          };
          updateCanvas(newCanvas);
        }
        selectSingleNode(mediaNode.id);
        
        // 异步：按原始比例等比调整图片/视频节点尺寸（以宽度240为基准）
        Promise.resolve().then(async () => {
          const measureImageDimensions = (url: string): Promise<{ w: number; h: number } | null> => {
            return new Promise((resolve) => {
              try {
                const img = new Image();
                img.onload = () => {
                  const w = (img as any).naturalWidth || img.width || 0;
                  const h = (img as any).naturalHeight || img.height || 0;
                  resolve(w > 0 && h > 0 ? { w, h } : null);
                };
                img.onerror = () => resolve(null);
                img.src = fileUrl as string;
              } catch { resolve(null); }
            });
          };

          const measureVideoDimensions = (url: string): Promise<{ w: number; h: number } | null> => {
            return new Promise((resolve) => {
              try {
                const video = document.createElement('video');
                video.preload = 'metadata';
                const cleanup = () => { try { video.src = ''; } catch {} };
                video.onloadedmetadata = () => {
                  const w = (video as any).videoWidth || 0;
                  const h = (video as any).videoHeight || 0;
                  cleanup();
                  resolve(w > 0 && h > 0 ? { w, h } : null);
                };
                video.onerror = () => { cleanup(); resolve(null); };
                video.src = url;
              } catch { resolve(null); }
            });
          };

          try {
            if (mediaType === 'image' && fileUrl) {
              const dims = await measureImageDimensions(fileUrl);
              if (dims && dims.w > 0 && dims.h > 0) {
                const targetW = DEFAULT_NODE_SIZES.media.width; // 240
                const aspect = dims.w / dims.h;
                const targetH = Math.max(1, Math.round(targetW / (aspect || 1)));
                updateNodeAction(mediaNode.id, { width: targetW, height: targetH } as any);
              }
            } else if (mediaType === 'video' && fileUrl) {
              const dims = await measureVideoDimensions(fileUrl);
              if (dims && dims.w > 0 && dims.h > 0) {
                const targetW = DEFAULT_NODE_SIZES.media.width; // 240
                const aspect = dims.w / dims.h;
                const targetH = Math.max(1, Math.round(targetW / (aspect || 1)));
                updateNodeAction(mediaNode.id, { width: targetW, height: targetH } as any);
              }
            }
          } catch {
            // 忽略测量失败
          }
        });
        if (mediaType === 'audio' && fileUrl) {
          Promise.resolve().then(async () => {
            try {
              const response = await fetch(fileUrl);
              if (!response.ok) throw new Error('Failed to fetch audio asset');
              const blob = await response.blob();
              const audioFile = new File([blob], fileName || 'audio-recording.webm', { type: fileType || blob.type || 'audio/webm' });
              await transcribeAudioForNode(mediaNode.id, audioFile);
            } catch (error) {
              console.error('Failed to transcribe audio asset:', error);
            }
          });
        }
        return;
      }
      // 思维导图模板拖拽入口已移除（使用 Tab 扩展取代
      if (data.type === 'create-node') {
        // 🎯 使用坐标转换系统进行拖拽创建节点的坐标转
        const canvasPos = screenToCanvasCoords(event.clientX, event.clientY);
        const canvasX = canvasPos.x;
        const canvasY = canvasPos.y;
        
        // 创建新节
        let newNode: CanvasNode | null;
        
        // 🏭 使用统一节点工厂创建所有类型的节点 - 正确的nodeType映射
        const nodeTypeMap: Record<string, () => Promise<CanvasNode | null>> = {
          'text': async () => createNodeAtPosition('text', {
            x: canvasX - 150, // 居中对齐00/2
            y: canvasY - 32   // 居中对齐5/2
          }, canvas.id), // 🔑 修复：添加缺失的canvasId参数
          'todo': async () => createNodeAtPosition('todo', {
            x: canvasX - 150, // 居中对齐00/2
            y: canvasY - 32   // 居中对齐5/2
          }, canvas.id), // 🔑 修复：添加缺失的canvasId参数
          'column': async () => createNodeAtPosition('column', {
            x: canvasX - 100, // 居中对齐00/2
            y: canvasY - 50   // 居中对齐00/2
          }, canvas.id), // 🔑 修复：添加缺失的canvasId参数
          'table': async () => createNodeAtPosition('table', {
            x: canvasX - 75,  // 居中对齐50/2
            y: canvasY - 50   // 居中对齐00/2
          }, canvas.id), // 🔑 修复：添加缺失的canvasId参数
          'media-audio': async () => {
            const width = DEFAULT_NODE_SIZES.media.width;
            const height = DEFAULT_NODE_SIZES.media.height;
            return createNodeAtPosition('media', {
              x: canvasX - width / 2,
              y: canvasY - height / 2
            }, canvas.id, {
              width,
              height,
              content: '点击下方按钮开始录音，或添加备注文本',
              fileName: `音频录制-${new Date().toISOString().slice(0, 19)}.webm`,
              fileType: 'audio/webm',
              fileExtension: 'webm',
              fileSize: 0,
              mediaType: 'audio',
              uploadStatus: 'mock'
            } as any);
          },
          'canvas-link': async () => {
            // 🎯 Canvas Link节点必须在创建时选择目标画布
            try {
              // 先显示画布选择界面
              const targetInfo = await handleShowCanvasSelection();
              
              if (!targetInfo) {
                return null; // 用户取消，不创建节点
              }
              
              // 🎯 分离位置和覆盖参
              const position = {
                x: canvasX - 140,  // 居中对齐80/2
                y: canvasY - 90    // 居中对齐80/2
              };
              
              const overrides = {
                title: targetInfo.title,
                content: targetInfo.id, // 存储目标画布ID
                targetCanvasId: targetInfo.id,
                thumbnailUrl: targetInfo.thumbnailUrl || ''
              };
              
              // 创建节点，正确传递位置和覆盖参数
              return createNodeAtPosition('canvas-link', position, canvas.id, overrides);
              
            } catch (_error) {
              console.error('Canvas Link节点创建失败:', _error);
              return null;
            }
          },
          'mermaid': async () => createNodeAtPosition('code', {
            x: canvasX - 200, // 居中对齐
            y: canvasY - 150  // 居中对齐
          }, canvas.id, { // 🔑 修复：调整参数顺序，添加canvasId
            codeType: 'mermaid'
          }),
          'html': async () => createNodeAtPosition('code', {
            x: canvasX - 200, // 居中对齐
            y: canvasY - 150  // 居中对齐
          }, canvas.id, { // 🔑 修复：调整参数顺序，添加canvasId
            codeType: 'html'
          })
        };
        
        const createNodeFn = nodeTypeMap[data.nodeType];
        if (createNodeFn) {
          // 🎯 处理异步创建（Canvas Link节点需要用户选择）
          newNode = await createNodeFn();
          
          // 如果创建函数返回null，说明用户取消了操作
          if (newNode === null) {
            
            return;
          }
        } else {
          console.warn('未知的节点类型', data.nodeType);
          return;
        }
        
        // 历史记录已自动管理

        // 落点在列内则自动吸附到该列（除非新建的是列本身）
        const targetColumn = isPositionInColumn(canvas, canvasX, canvasY);
        if (targetColumn && targetColumn.type === 'column' && newNode.type !== 'column') {
          if (shouldUseStorePersistence) {
            try { addNodeAction(newNode as any); } catch {}
            insertNodeIntoColumn(targetColumn.id, newNode.id);
          } else {
            const now = Date.now();
            let updated: Canvas = {
              ...canvas,
              nodes: [...canvas.nodes, newNode],
              updatedAt: now,
            } as Canvas;
            if ((targetColumn as any).isCollapsed) {
              updated = {
                ...updated,
                nodes: updated.nodes.map((n) => (n.id === targetColumn.id ? { ...n, isCollapsed: false, updatedAt: now } as CanvasNode : n)),
                updatedAt: now,
              } as Canvas;
            }
            const children = ((targetColumn.children || []).filter(Boolean)).concat(newNode.id);
            updated = {
              ...updated,
              nodes: updated.nodes.map((n) => (n.id === targetColumn.id ? ({ ...n, children, updatedAt: now } as CanvasNode) : n)),
              updatedAt: now,
            } as Canvas;
            updated = applyColumnLayout(updated, targetColumn.id);
            updateCanvas(updated);
          }
        } else {
          if (shouldUseStorePersistence) {
            try { addNodeAction(newNode as any); } catch {}
          } else {
            const newCanvas = {
              ...canvas,
              nodes: [...canvas.nodes, newNode],
              updatedAt: Date.now(),
            };
            updateCanvas(newCanvas);
          }
        }
        
        // 自动选中并编辑新节点
        selectSingleNode(newNode.id);
        enterEditMode('node', newNode.id);
      }

      // 知识库条目：插入文本节点
      if (data.type === 'kb-entry' && data.payload) {
        const { title, content } = data.payload;
        const canvasPos = screenToCanvasCoords(event.clientX, event.clientY);
        const newNode = await createNodeAtPosition('text', {
          x: canvasPos.x - 150,
          y: canvasPos.y - 32
        }, canvas.id, { content: `# ${title}\n\n${String(content).slice(0, 2000)}` });

        if (shouldUseStorePersistence) {
          try { addNodeAction(newNode as any); } catch {}
        } else {
          const newCanvas = {
            ...canvas,
            nodes: [...canvas.nodes, newNode],
            updatedAt: Date.now()
          };
          updateCanvas(newCanvas);
        }
        selectSingleNode(newNode.id);
        return;
      }
    } catch (_error) {
      // 忽略节点创建错误
    }
  }, [
    canvas,
    updateCanvas,
    screenToCanvasCoords,
    handleCanvasMediaFiles,
    dedupeFiles,
    transcribeAudioForNode,
    updateNodeAction,
    addNodeAction,
    selectSingleNode,
    enterEditMode,
    externalCanvas,
    onCanvasChange,
    insertNodeIntoColumn,
    handleShowCanvasSelection,
  ]);



  // 节点位置更新逻辑已抽离至 useNodesDnd

  // 📏 处理节点尺寸变更
  const handleNodeSizeChange = useCallback((nodeId: string, size: { width: number; height: number }, options?: { fromResize?: boolean; resizeHandle?: ResizeHandle }) => {
    // 手型模式下禁用尺寸调
    if (effectiveToolMode === 'hand') {
      return;
    }
    
    const nodeIndex = canvas?.nodes?.findIndex(n => n.id === nodeId) ?? -1;
    if (nodeIndex === -1) return;
    
    const currentNode = canvas.nodes[nodeIndex];
    if (!currentNode) return; // 类型守卫
    
    // 基于当前请求尺寸，先应用可选的“调整大小吸附”逻辑
    const nextWidth = size.width;
    const nextHeight = size.height;
    const nextX = currentNode.x;
    const nextY = currentNode.y;

    if (options?.fromResize) {
      try {
        resizeHandleRef.current = options?.resizeHandle;
        const guideOptions = getGuideOptions(guidesAltPressedRef.current, { resizeHandle: options?.resizeHandle });
        const precisionMode = guidesShiftPressedRef.current;
        const shouldPreview = precisionMode || guideOptions.showLines;
        if (!guideOptions.enabled || guideOptions.modifierDisabled || !shouldPreview) {
          try {
            setAlignmentGuides(null);
            setAlignmentDistances(null);
            setForceGuideLines(false);
          } catch {}
        } else {
          if (!guidesControllerRef.current) {
            guidesControllerRef.current = createGuidesController();
          }
          const scale = useCanvasStore.getState().viewState?.transform?.scale || 1;
          const rect = { x: currentNode.x, y: currentNode.y, width: size.width, height: size.height };
          const previewOptions = { ...guideOptions, tolerancePx: precisionMode ? SNAP_PREVIEW_TOLERANCE_PX : guideOptions.tolerancePx };
          const baselineById = previewOptions.allowBaseline ? buildBaselineMap(canvas.nodes || [], fontStyle) : undefined;
          const canvasSnapshot = buildCanvasSnapshot(canvas.nodes || [], scale, { baselineById });
          if (!resizeGuideSessionRef.current) {
            resizeGuideSessionRef.current = guidesControllerRef.current.startResize({ ids: [nodeId], rect });
          }
          const plan = guidesControllerRef.current.moveResize(
            resizeGuideSessionRef.current,
            canvasSnapshot,
            { ids: [nodeId], rect },
            previewOptions
          );
          if (plan.guideLines && plan.guideLines.length > 0) {
            resizeSnapRef.current = { nodeId, guides: plan.guideLines };
            try {
              setAlignmentGuides(plan.guideLines);
              setAlignmentDistances(null);
              setForceGuideLines(precisionMode);
            } catch {}
          } else {
            try {
              setAlignmentGuides(null);
              setAlignmentDistances(null);
              setForceGuideLines(false);
            } catch {}
          }
        }
      } catch {
      }
    }


    // 检查尺寸是否真的发生了变化，避免无限循
    if (currentNode.width === nextWidth && currentNode.height === nextHeight && currentNode.x === nextX && currentNode.y === nextY) {
      return; // 尺寸没有变化，跳过更
    }
    
    const updatedNode = updateNode(currentNode, { width: nextWidth, height: nextHeight, x: nextX, y: nextY });
    // 若用户进行了横向尺寸调整，则标记为手动模式（停止自动宽度
    try {
      if (typeof currentNode.width === 'number' && currentNode.width !== size.width) {
        autoSizeModeRef.current.set(nodeId, 'manual');
        setAutoSizeVersion(v => v + 1);
      }
    } catch {}
    const newCanvas = {
      ...canvas,
      nodes: (canvas?.nodes || []).map((node, index) => 
        index === nodeIndex ? updatedNode : node
      ),
      updatedAt: Date.now() // 确保时间戳更
    };
    
    updateCanvas(newCanvas);

    // 若该节点属于某列，则对该列进行重排以适应新高
    const parentColumn = getNodeParentColumn(newCanvas, nodeId);
    if (parentColumn) {
      const relaid = applyColumnLayout(newCanvas, parentColumn.id);
      updateCanvas(relaid);
    } else {
      // 如果当前节点本身是列，被调整了宽高度，则重排该列
      const resizedNode = newCanvas.nodes.find(n => n.id === nodeId);
      if (resizedNode && resizedNode.type === 'column') {
        const relaid = applyColumnLayout(newCanvas, nodeId);
        updateCanvas(relaid);
      }
    }

    // 思维导图：节点尺寸变化后，轻微防抖触发布局（仅所属导图组
    try {
      const latest = useCanvasStore.getState().canvas;
      const group = findMindmapGroupForNode(latest, nodeId);
      if (group) {
        const timers = mindmapLayoutTimersRef.current;
        const gid = group.id;
        const prev = timers.get(gid);
        if (prev) clearTimeout(prev as any);
        const t = setTimeout(() => {
          try {
            const fresh = useCanvasStore.getState().canvas;
            const res = tidyLayout(fresh, gid);
            applyLayout(res);
            // 局部重排，避免与相邻子树重
            resolveOverlapsAfterChange(useCanvasStore.getState().canvas, gid, [nodeId]);
          } catch {}
        }, 150);
        timers.set(gid, t);
      }
    } catch {}
  }, [canvas, updateCanvas, effectiveToolMode, fontStyle]);

  // 🎯 批量节点尺寸调整
  const handleBatchNodeSizeChange = useCallback((updates: Array<{ nodeId: string; size: { width: number; height: number } }>) => {
    // 手型模式下禁用尺寸调
    if (effectiveToolMode === 'hand') {
      return;
    }

    if (updates.length === 0) return;

    // 创建节点ID到新尺寸的映
    const sizeMap = new Map<string, { width: number; height: number }>();
    updates.forEach(update => {
      sizeMap.set(update.nodeId, update.size);
    });

    // 批量更新所有指定节点的尺寸
    const updatedNodes = canvas.nodes.map(node => {
      const newSize = sizeMap.get(node.id);
      if (newSize) {
        return updateNode(node, { width: newSize.width, height: newSize.height });
      }
      return node;
    });

    let newCanvas: Canvas = {
      ...canvas,
      nodes: updatedNodes,
      updatedAt: Date.now(),
    };

    // 1) 列（column）内的节点：按列重排（每列一次）
    try {
      const affectedColumns = new Set<string>();
      for (const u of updates) {
        const targetNode = newCanvas.nodes.find((n) => n.id === u.nodeId);
        if (targetNode && targetNode.type === 'column') {
          affectedColumns.add(targetNode.id);
        }
        const col = getNodeParentColumn(newCanvas, u.nodeId);
        if (col) affectedColumns.add(col.id);
      }
      for (const colId of affectedColumns) {
        // 先调整子项高度以适配列宽，再重排
        const colNode = newCanvas.nodes.find((n) => n.id === colId);
        const children = (colNode?.children || []).filter(Boolean) as string[];
        for (const childId of children) {
          newCanvas = adjustNodeSizeForColumn(newCanvas, childId);
        }
        newCanvas = applyColumnLayout(newCanvas, colId);
      }
    } catch {}

    updateCanvas(newCanvas);

    // 2) 思维导图：分组聚合触发布局 + 局部避让（150ms 防抖
    try {
      const latest = useCanvasStore.getState().canvas;
      const affected = new Map<string, string[]>();
      for (const u of updates) {
        const g = findMindmapGroupForNode(latest, u.nodeId);
        if (g) {
          const list = affected.get(g.id) || [];
          list.push(u.nodeId);
          affected.set(g.id, list);
        }
      }
      const timers = mindmapLayoutTimersRef.current;
      for (const [gid, nodes] of affected.entries()) {
        const prev = timers.get(gid);
        if (prev) clearTimeout(prev as any);
        const t = setTimeout(() => {
          try {
            const fresh = useCanvasStore.getState().canvas;
            const res = tidyLayout(fresh, gid);
            applyLayout(res);
            resolveOverlapsAfterChange(useCanvasStore.getState().canvas, gid, nodes);
          } catch {}
        }, 150);
        timers.set(gid, t);
      }
    } catch {}

    // 3) 全局自由节点：做一次轻量避让（与列/导图无关的节点）
    try {
      const latest = useCanvasStore.getState().canvas;
      const ids = updates.map(u => u.nodeId);
      const pos = computeGlobalOverlapReflow(latest, { changedNodeIds: ids, minGapY: 16 });
      if (pos.size > 0) {
        pos.forEach((p, id) => updateNodeAction(id, { x: p.x, y: p.y } as any));
        try {
          // 同步所有组几何到后代叶子的包围
          const { computeSyncedGroupGeometry } = require('../../utils/mindmapLayout');
          const synced = computeSyncedGroupGeometry(useCanvasStore.getState().canvas);
          updateCanvas(synced);
        } catch {}
      }
    } catch {}
    
    // 🎉 显示批量调整完成的通知
    
  }, [canvas, updateCanvas, effectiveToolMode, updateNodeAction]);

  // 思维导图：设为根并切换模
  

  // 思维导图：添加子节点（向右）
  

  // ====== 自动尺寸模式（临时） ======
  // 使用ref存储每个节点的尺寸模式：'auto' | 'manual'，默认auto（不存则视为auto
  const autoSizeModeRef = useRef<Map<string, 'auto' | 'manual'>>(new Map());
  const [autoSizeVersion, setAutoSizeVersion] = useState(0); // 仅用于触发重渲染

  const handleAutoSizeModeChange = useCallback((nodeId: string, mode: 'auto' | 'manual') => {
    const map = autoSizeModeRef.current;
    const previousMode = map.get(nodeId) ?? 'auto';
    if (previousMode === mode) return;
    if (mode === 'auto') {
      map.delete(nodeId); // 默认auto，删除即
    } else {
      map.set(nodeId, 'manual');
    }
    setAutoSizeVersion(v => v + 1);
  }, []);

  // 🖱右键菜单Hook
  const { contextMenu, handleContextMenu, hideContextMenu } = useCanvasContextMenu({
    selectedNodes: Array.from(selectedNodeIds as Set<string>),
    selectedConnections: Array.from(selectedConnectionIds as Set<string>),
    nodes: canvas.nodes,
    connections: canvas.connections || [],
    groups: (canvas.nodes || []).filter(n => n.type === 'group').map((g: any) => ({ id: g.id, nodeIds: (g.children || []) as string[] })),
    onDeleteNodes: handleDeleteNodes,
    onDuplicateNodes: handleDuplicateNodes,
    onEditNode: handleEditNode,
    onOpenExpandedEditor: (nodeId: string) => {
      if (readOnly) return;
      const target = canvas.nodes.find((node) => node.id === nodeId);
      if (!target || (target.type !== 'text' && target.type !== 'todo')) return;
      setExpandedEditorNodeId(nodeId);
    },
    onLockToggle: handleNodeLockToggle,
    onSizeChange: handleNodeSizeChange,
    onBatchSizeChange: handleBatchNodeSizeChange,
    onAutoSizeModeChange: handleAutoSizeModeChange,
    onToggleNodeAI: (nodeIds: string[], ai: boolean) => {
      if (!nodeIds || nodeIds.length === 0) return;
      const now = Date.now();
      const idSet = new Set(nodeIds);
      const updatedNodes = canvas.nodes.map(n => idSet.has(n.id) ? ({ ...n, ai, updatedAt: now }) : n);
      updateCanvas({ ...canvas, nodes: updatedNodes, updatedAt: now });
    },
    onCreateGroup: (nodeIds: string[], connectionIds?: string[]) => {
      handleCreateGroup(nodeIds, connectionIds);
    },
    onCreateNode: handleCreateNode,
    onRenameGroup: (groupId: string) => {
      selectGroupAction(groupId);
      setRenameGroupRequestId(groupId);
    },
    onUngroup: (groupId: string) => {
      const now = Date.now();
      const group = canvas.nodes.find(n => n.id === groupId && (n as any).type === 'group') as any;
      const childIds: string[] = group?.children || [];
      const cleanedNodes = canvas.nodes
        .filter(n => n.id !== groupId)
        .map(n => {
          if (childIds.includes(n.id)) {
            const { parentGroupId: _omit, ...rest } = n as any;
            return { ...rest, updatedAt: now } as any;
          }
          return n;
        });
      updateCanvas({ ...canvas, nodes: cleanedNodes, updatedAt: now });
      if (selectedGroupId === groupId) selectGroupAction(null);
    },
    onSwitchGroupType: (groupId: string, toMindmap: boolean) => {
      const now = Date.now();
      const groupIndex = canvas.nodes.findIndex(n => n.id === groupId && (n as any).type === 'group');
      if (groupIndex === -1) return;

      const group = canvas.nodes[groupIndex] as any;
      const children = ((group.children || []) as string[]).filter((cid) => {
        const n = canvas.nodes.find(nn => nn.id === cid);
        return !!n && (n as any).type !== 'group';
      });

      if (toMindmap) {
        // 转换为思维导图
        if (children.length === 0) return;

        // 选择第一个“非群组”的节点作为根节
        const rootNodeId = children.find((id) => {
          const n = canvas.nodes.find(nn => nn.id === id);
          return !!n && (n as any).type !== 'group';
        });
        const rootNode = canvas.nodes.find(n => n.id === rootNodeId);
        if (!rootNode) return;

        // 检查群组内的连接情
        const groupConnections = canvas.connections?.filter(conn =>
          children.includes(conn.from) && children.includes(conn.to)
        ) || [];

        // 如果没有连接，创建基本的树状连接结构（根节点连接到其他所有节点）
        let needsNewConnections = false;
        if (groupConnections.length === 0 && children.length > 1) {
          needsNewConnections = true;
        }

        // 创建完整的思维导图配置
        const updatedGroup = {
          ...group,
          groupMode: 'mindmap',
          mindmap: {
            rootId: rootNodeId,
            spacingX: 96,
            spacingY: 30,
            orientation: 'right',
            showCrossLinks: true,
            collapsed: {},
          },
          groupStyles: {
            ...(group.groupStyles || {}),
            bgOpacity: 0
          },
          updatedAt: now
        };

        const updatedNodes = [...canvas.nodes];
        updatedNodes[groupIndex] = updatedGroup;
        // 确保导图成员节点标记 parentGroupId，便于吸端点/布局判定
        const memberIdSet = new Set(children);
        for (let i = 0; i < updatedNodes.length; i++) {
          const n = updatedNodes[i];
          if (!n) continue;
          if (memberIdSet.has(n.id) && (n as any).type !== 'group') {
            updatedNodes[i] = { ...(n as any), parentGroupId: groupId, updatedAt: now } as any;
          }
        }
        let updatedConnections = [...(canvas.connections || [])];

        // 如果需要，创建基本连接结构
        if (needsNewConnections) {
          const newConnections = children.filter((id) => id !== rootNodeId).map(childId => ({
            id: `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            from: rootNodeId,
            to: childId,
            createdAt: now,
            label: ''
          }));
          updatedConnections = [...updatedConnections, ...newConnections];
        }

        let updatedCanvas = {
          ...canvas,
          nodes: updatedNodes,
          connections: updatedConnections,
          updatedAt: now
        };
        // 进入思维导图后：规范化文待办节点宽高50..450优先变宽
        try {
          const latest = updatedCanvas;
          const { estimateAutoTextWidth, calculateTextNodeHeight, getTextLayoutPreset, DEFAULT_TEXT_LAYOUT_PRESET } = require('../../utils/canvasUtils');
          const presetId = latest.textLayoutPreset ?? DEFAULT_TEXT_LAYOUT_PRESET;
          const layout = getTextLayoutPreset ? getTextLayoutPreset(presetId) : undefined;
          const members = children;
          const normalizedNodes = latest.nodes.map((n) => {
            if (members.includes(n.id) && (n.type === 'text' || n.type === 'todo')) {
              const w = estimateAutoTextWidth(n.content || '', { layoutPreset: layout, nodeType: n.type as any, clamp: { min: 150, max: 450 } });
              const h = calculateTextNodeHeight ? calculateTextNodeHeight(n.content || '', w, { layoutPreset: layout }) : (n.height || 60);
              return { ...n, width: w, height: h, updatedAt: now } as any;
            }
            return n;
          });
          updatedCanvas = { ...latest, nodes: normalizedNodes } as any;
        } catch {}

        updateCanvas(updatedCanvas);

        // 重新计算思维导图布局
        setTimeout(() => {
          const latest = useCanvasStore.getState().canvas;
          const layoutResult = tidyLayout(latest, groupId);
          applyLayout(layoutResult);
        }, 0);
      } else {
        // 转换为普通群
        const updatedGroup = {
          ...group,
          groupMode: undefined,
          mindmap: undefined,
          groupStyles: {
            ...(group.groupStyles || {}),
            bgOpacity: group.groupStyles?.bgOpacity || 0.02
          },
          updatedAt: now
        };

        const updatedNodes = [...canvas.nodes];
        updatedNodes[groupIndex] = updatedGroup;
        updateCanvas({ ...canvas, nodes: updatedNodes, updatedAt: now });
      }
    },
    onDeleteConnections: (connectionIds: string[]) => {
      const updatedConnections = (canvas.connections || []).filter(
        conn => !connectionIds.includes(conn.id)
      );
      const updatedCanvas: Canvas = {
        ...canvas,
        connections: updatedConnections,
        updatedAt: Date.now()
      };
      updateCanvas(updatedCanvas);
    },
    onEditConnection: (connectionId: string) => {
      handleConnectionLabelEditWrapped(connectionId);
    },
    onAlignment: (alignedNodes: CanvasNode[], _alignmentType: AlignmentType) => {
      // 更新Canvas中的节点位置
      const updatedCanvas: Canvas = {
        ...canvas,
        nodes: canvas.nodes.map(node => {
          const alignedNode = alignedNodes.find(aligned => aligned.id === node.id);
          return alignedNode || node;
        }),
        updatedAt: Date.now()
      };
      updateCanvas(updatedCanvas);
      
    },
    onSwitchMindmapOrientation: (groupId: string, orientation: 'right' | 'both') => {
      const now = Date.now();
      const idx = canvas.nodes.findIndex(n => n.id === groupId && (n as any).type === 'group');
      if (idx === -1) return;
      const g = canvas.nodes[idx] as any;
      if (!g.mindmap) return;
      const updatedGroup = { ...g, mindmap: { ...g.mindmap, orientation }, updatedAt: now };
      const updatedNodes = [...canvas.nodes];
      updatedNodes[idx] = updatedGroup;
      updateCanvas({ ...canvas, nodes: updatedNodes, updatedAt: now });
      // 触发布局
      setTimeout(() => {
        const latest = useCanvasStore.getState().canvas;
        const result = tidyLayout(latest, groupId);
        applyLayout(result);
      }, 0);
    },
    onLeaveGroup: (nodeId: string) => {
      const now = Date.now();

      // 找到该节
      const node = canvas.nodes.find(n => n.id === nodeId);
      if (!node) return;

      // 方法1：通过parentGroupId查找父组
      const parentGroupId = (node as any).parentGroupId;

      // 方法2：通过groups数组查找包含该节点的
      const containingGroup = (canvas.nodes || [])
        .filter(n => n.type === 'group')
        .find((g: any) => (g.children || []).includes(nodeId));

      const targetGroupId = parentGroupId || containingGroup?.id;
      if (!targetGroupId) return; // 节点不在任何组中

      // 需要从目标组的 children 中移除的全部 id（离开节点 + 应随之一并脱离的后代）
      const detachIds = new Set<string>([nodeId]);
      // 应将 parentGroupId 改写为 column id（而非删除）的叶子集合，避免服务端 reconcile 前的 UI 闪烁
      const reparentToColumn = new Set<string>();
      // 子组离开时，应将后代 parentGroupId 改写回其真正父（子组/内部子组）的映射
      const reparentDescendants = new Map<string, string>();

      const nodeMap = new Map<string, any>();
      (canvas.nodes || []).forEach(n => nodeMap.set(n.id, n));

      if ((node as any).type === 'column') {
        // 防御性修复：治愈遗留/部分文档——column 离开组时，把仍直挂在组下、
        // 且属于该 column.children 的叶子一并从组里脱离，并重新归属到该 column。
        const colChildren: string[] = ((node as any).children || []);
        const colChildSet = new Set(colChildren);
        (canvas.nodes || []).forEach(n => {
          if ((n as any).parentGroupId === targetGroupId && colChildSet.has(n.id)) {
            detachIds.add(n.id);
            reparentToColumn.add(n.id);
          }
        });
      } else if ((node as any).type === 'group') {
        // group 离开组：把该子组的全部后代收集成集合，凡是仍“直挂”在目标组下
        // （parentGroupId === targetGroupId）的后代，应随子组一并从目标组脱离，
        // 并把 parentGroupId 改回其真正的父（子组或子组的内部子组），避免遗留文档下出现孤儿。
        // 注意：不动子组自身完好的内部层级（其后代本就指向子组，无需清除）。
        const descendantToParent = new Map<string, string>();
        const stack: string[] = [...(((node as any).children) || [])].map(id => id as string);
        const seen = new Set<string>();
        // 子组直接 children 的真正父就是子组自身
        (((node as any).children) || []).forEach((cid: string) => descendantToParent.set(cid, nodeId));
        while (stack.length) {
          const id = stack.pop()!;
          if (seen.has(id)) continue;
          seen.add(id);
          const child = nodeMap.get(id);
          if (child && (child as any).children) {
            ((child as any).children || []).forEach((cid: string) => {
              descendantToParent.set(cid, id);
              stack.push(cid);
            });
          }
        }
        descendantToParent.forEach((properParent, descId) => {
          const dn = nodeMap.get(descId);
          if (dn && (dn as any).parentGroupId === targetGroupId) {
            detachIds.add(descId);
            reparentDescendants.set(descId, properParent);
          }
        });
      }

      // 从群组中移除这些节点，并改写离开节点/后代的群组关系（不改动任何 x/y）
      const updatedNodes = canvas.nodes.map(n => {
        if (n.id === nodeId) {
          // 清除离开节点自身的父组关系
          const { parentGroupId: _omit, ...rest } = n as any;
          return { ...rest, updatedAt: now } as any;
        }
        if (reparentToColumn.has(n.id)) {
          // 叶子重新归属到 column（保留位置），由服务端后续 reconcile 收敛
          return { ...(n as any), parentGroupId: nodeId, updatedAt: now } as any;
        }
        const reparentTo = reparentDescendants.get(n.id);
        if (reparentTo !== undefined) {
          // 子组的后代重新归属到其真正的父（保留位置）
          return { ...(n as any), parentGroupId: reparentTo, updatedAt: now } as any;
        }
        if (n.id === targetGroupId && (n as any).type === 'group') {
          // 从组的 children 中移除所有应脱离的 id
          const updatedChildren = ((n as any).children || []).filter((childId: string) => !detachIds.has(childId));
          return { ...n, children: updatedChildren, updatedAt: now };
        }
        return n;
      });

      // 更新画布状
      const updatedCanvas = { ...canvas, nodes: updatedNodes, updatedAt: now };
      updateCanvas(updatedCanvas);
    },
    isEditMode: isEditMode || false,

  });

  // 思维导图快捷键逻辑已移除（将以通用 Tab 扩展替代

  // 📦 处理收集栏标题变
  const handleColumnTitleChange = useCallback((nodeId: string, title: string) => {
    const nodeIndex = canvas?.nodes?.findIndex(n => n.id === nodeId) ?? -1;
    if (nodeIndex === -1) return;
    
    const currentNode = canvas.nodes[nodeIndex];
    if (!currentNode) return; // 类型守卫
    if (currentNode.type !== 'column') return;
    
    const updatedNode = { ...currentNode, title, updatedAt: Date.now() };
    const newCanvas = {
      ...canvas,
      nodes: (canvas?.nodes || []).map((node, index) => 
        index === nodeIndex ? updatedNode : node
      ),
      updatedAt: Date.now()
    };
    
    updateCanvas(newCanvas);
  }, [canvas, updateCanvas]);
  
  // 📦 处理收集栏展开收起
  const handleColumnToggleCollapse = useCallback((nodeId: string) => {
    const nodeIndex = canvas?.nodes?.findIndex(n => n.id === nodeId) ?? -1;
    if (nodeIndex === -1) return;
    
    const currentNode = canvas.nodes[nodeIndex];
    if (!currentNode) return; // 类型守卫
    if (currentNode.type !== 'column') return;
    
    const updatedNode = { 
      ...currentNode, 
      isCollapsed: !currentNode.isCollapsed, 
      updatedAt: Date.now() 
    };
    const newCanvas = {
      ...canvas,
      nodes: (canvas?.nodes || []).map((node, index) => 
        index === nodeIndex ? updatedNode : node
      ),
      updatedAt: Date.now()
    };
    
    updateCanvas(newCanvas);
  }, [canvas, updateCanvas]);

  // 📦 处理拖拽到收集栏（HTML5 DnD from ColumnContainer 或其他来源）
  const handleDropNodeToColumn = useCallback((columnId: string, droppedNodeId: string) => {
    const node = canvas.nodes.find((n) => n.id === droppedNodeId);
    if (!node) {
      // 暂不处理外部ID的投放（如工作区卡片等），后续可扩展为创建新节点
      return;
    }
    if (node.type === 'column') return; // 不允许将收集栏放入收集栏

    // 记录源列，移动后对源/目标列都进行布局，确保两条投放路径一
    const sourceColumn = getNodeParentColumn(canvas, droppedNodeId);
    let updated = moveNodeToColumn(canvas, droppedNodeId, columnId);
    // 首次布局以获取列内容宽度
    updated = applyColumnLayout(updated, columnId);
    // 仅在从其他列或画布进入该列时进行尺寸自适应（同列内重复投放不触发）
    if (!sourceColumn || sourceColumn.id !== columnId) {
      // 自适应新列宽下的高
      updated = adjustNodeSizeForColumn(updated, droppedNodeId, node);
      // 重新布局，确保后续子项位置正
      updated = applyColumnLayout(updated, columnId);
    }
    if (sourceColumn && sourceColumn.id !== columnId) {
      updated = applyColumnLayout(updated, sourceColumn.id);
    }
    updateCanvas(updated);
  }, [canvas, updateCanvas]);

  // 📝 处理文本内容变更 - 使用正确的数据流（复用上方的 canvasRef

  const handleTextContentChange = useCallback((nodeId: string, content: string) => {
    const currentCanvas = canvasRef.current;
    const normalizeMarkdownForCompare = (input: string): string =>
      (input || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .trimEnd();

    // Mermaid connection placeholders are handled by their own editors.
    if (nodeId === '__NEW_NODE__'
      || nodeId === '__NEW_NODE_AND_CONNECT__'
      || nodeId === '__CONNECTION__'
      || nodeId === '__CONNECTION_LABEL__'
      || nodeId === '__NEW_CONNECTION__') {
      return;
    }

    const nodeToUpdate = currentCanvas.nodes.find((n) => n.id === nodeId);
    if (!nodeToUpdate) return;

    try {
      const parsedContent = JSON.parse(content);
      if (parsedContent && parsedContent.__tableData) {
        const previousDataJson = JSON.stringify((nodeToUpdate as any).data ?? null);
        const nextDataJson = JSON.stringify(parsedContent.__tableData ?? null);
        if (previousDataJson === nextDataJson) return;
        updateNodeAction(nodeId, { data: parsedContent.__tableData } as any);
        return;
      }
    } catch {
      // Not structured payload; continue as plain text.
    }

    const nextContent = nodeToUpdate.type === 'todo' ? normalizeTodoContent(content) : content;
    const patch: Record<string, any> = {};
    let hasEffectiveChange = false;

    if (nextContent !== (nodeToUpdate.content || '')) {
      patch.content = nextContent;
      hasEffectiveChange = true;
    }
    if (nodeToUpdate.type === 'todo') {
      const nextCompleted = computeTodoCompletion(nextContent);
      if (nextCompleted !== (nodeToUpdate as any).completed) {
        patch.completed = nextCompleted;
        hasEffectiveChange = true;
      }
    }
    if (!hasEffectiveChange) return;

    // Guard against stale rich snapshot drifting from canonical markdown content.
    // If markdown diverges, invalidate stored snapshot so next edit seeds from current content.
    try {
      const data = (nodeToUpdate as any)?.data;
      const expanded = data?.[EXPANDED_EDITOR_DATA_KEY];
      const expandedMarkdown = typeof expanded?.markdown === 'string' ? expanded.markdown : '';
      if (
        expanded
        && normalizeMarkdownForCompare(expandedMarkdown) !== normalizeMarkdownForCompare(nextContent)
      ) {
        const nextData = { ...(data || {}) } as Record<string, unknown>;
        delete nextData[EXPANDED_EDITOR_DATA_KEY];
        patch.data = nextData;
      }
    } catch {}

    let shouldScheduleMindmapLayout = false;

    // Text/todo sizing:
    // - Mindmap + auto mode + non-shape text: width can adapt.
    // - During inline editing: keep width stable to avoid caret/layout jitter.
    // - Height follows content for clipping prevention.
    try {
      if (nodeToUpdate.type === 'text' || nodeToUpdate.type === 'todo') {
        const inMindmap = Boolean(findMindmapGroupForNode(currentCanvas, nodeId));
        const auto = autoSizeModeRef.current.get(nodeId) !== 'manual';
        const isInlineEditing = editingNodeId === nodeId;
        const shapedText =
          nodeToUpdate.type === 'text'
          && nodeToUpdate?.shapeDecoration
          && nodeToUpdate?.shapeDecoration?.type
          && nodeToUpdate.shapeDecoration.type !== 'none';
        const layout = resolveTextLayoutPreset({
          layoutPresetId: currentCanvas.textLayoutPreset as any,
        });

        const currentWidth = typeof nodeToUpdate.width === 'number' ? nodeToUpdate.width : 240;
        let targetWidth = currentWidth;
        if (!isInlineEditing && inMindmap && auto && !shapedText) {
          const autoMode = (() => {
            try {
              return useSettingsStore.getState().mindmap?.autoWidthMode === 'auto';
            } catch {
              return false;
            }
          })();
          if (autoMode) {
            targetWidth = estimateMindmapAutoTextWidth({
              content: nextContent,
              layoutPreset: layout,
              nodeType: nodeToUpdate.type,
              clamp: { min: 150, max: 450 },
            });
          } else {
            targetWidth = 300;
          }
        }

        const hasAccentColor =
          Boolean((nodeToUpdate as any)?.textStyles?.accentColor)
          && (nodeToUpdate as any)?.textStyles?.accentColor !== 'transparent';
        let targetHeight = calculateTextHeightWithLayout({
          content: nextContent,
          width: targetWidth,
          layoutPreset: layout,
          hasAccentColor,
        });
        if (nodeToUpdate.type === 'todo') {
          try {
            const todoLines = parseTodoContent(nextContent || '');
            const minHeight = layout?.metrics?.minHeight ?? 60;
            const SINGLE_LINE_SLACK = 8;
            if (todoLines.length <= 1 && targetHeight <= minHeight + SINGLE_LINE_SLACK) {
              targetHeight = minHeight;
            }
          } catch {}
        }

        const needW = !isInlineEditing && Math.abs(currentWidth - targetWidth) > 0.5;
        const currentHeight = typeof nodeToUpdate.height === 'number' ? nodeToUpdate.height : 0;
        // While inline editing, height is driven by DOM measurement in TextNodeEditor.
        // Avoid heuristic height writes here to prevent oscillation/jitter.
        const needH = !isInlineEditing && Math.abs(currentHeight - targetHeight) > 0.5;
        if (needW) patch.width = targetWidth;
        if (needH) patch.height = targetHeight;
        shouldScheduleMindmapLayout = needW && inMindmap;
      }
    } catch {}

    updateNodeAction(nodeId, patch as any);

    if (shouldScheduleMindmapLayout) {
      try {
        const latest = useCanvasStore.getState().canvas;
        const group = findMindmapGroupForNode(latest, nodeId);
        if (!group) return;
        const timers = mindmapLayoutTimersRef.current;
        const gid = group.id;
        const prev = timers.get(gid);
        if (prev) clearTimeout(prev as any);
        const t = setTimeout(() => {
          try {
            const fresh = useCanvasStore.getState().canvas;
            const res = tidyLayout(fresh, gid);
            applyLayout(res);
            resolveOverlapsAfterChange(useCanvasStore.getState().canvas, gid, [nodeId]);
          } catch {}
        }, 150);
        timers.set(gid, t);
      } catch {}
    }
  }, [editingNodeId, updateNodeAction]); // 使用轻量节点更

  const handleTableCellCommit = useCallback(
    (nodeId: string, row: number, col: number, value: string) => {
      applyCanvasOpsAction([
        { op: 'update_table_cell', id: nodeId, row, col, value },
      ]);
    },
    [applyCanvasOpsAction],
  );

  const handleTableRowOp = useCallback(
    (nodeId: string, action: 'insert' | 'delete', index: number) => {
      applyCanvasOpsAction([{ op: 'table_row_op', id: nodeId, action, index }]);
    },
    [applyCanvasOpsAction],
  );

  const handleTableColOp = useCallback(
    (nodeId: string, action: 'insert' | 'delete', index: number) => {
      applyCanvasOpsAction([{ op: 'table_col_op', id: nodeId, action, index }]);
    },
    [applyCanvasOpsAction],
  );

  const inlineEditorAiGateway = useMemo(() => {
    if (!canvas?.id) return null;
    return new CanvasSelectionAiAdapter(canvas.id);
  }, [canvas?.id]);

  const handleInlineEditorAiGenerate = useCallback(
    async (request: NovelAiRequest) => {
      if (!inlineEditorAiGateway) {
        throw new Error('AI is unavailable: missing canvas context');
      }
      return await requestExpandedEditorAiCompletionUseCase(inlineEditorAiGateway, request);
    },
    [inlineEditorAiGateway],
  );

  const handleTextRichSnapshotPersist = useCallback(
    (nodeId: string, snapshot: NovelEditorSnapshot) => {
      const latestCanvas = useCanvasStore.getState().canvas;
      const target = latestCanvas.nodes.find((node) => node.id === nodeId);
      if (!target) return;
      if (target.type !== 'text' && target.type !== 'todo') return;

      const result = saveExpandedEditorUseCase(target, {
        markdown: snapshot.markdown,
        html: snapshot.html,
        json: snapshot.json,
      });

      if ((target.content || '') !== result.content) {
        handleTextContentChange(nodeId, result.content);
      }

      const prevDataJson = JSON.stringify((target as any).data ?? null);
      const nextDataJson = JSON.stringify(result.data ?? null);
      if (prevDataJson === nextDataJson) return;

      try {
        updateNodeAction(nodeId, { data: result.data } as any);
      } catch {}
    },
    [handleTextContentChange, updateNodeAction],
  );

  const handleOpenExpandedEditor = useCallback(
    (nodeId: string) => {
      if (readOnly) return;
      const target = canvas.nodes.find((node) => node.id === nodeId);
      if (!target || (target.type !== 'text' && target.type !== 'todo')) return;
      setExpandedEditorNodeId(nodeId);
    },
    [canvas.nodes, readOnly],
  );

  const lastExpandedEditorRequestRef = useRef(0);
  useEffect(() => {
    if (!openExpandedEditorRequestId) return;
    if (openExpandedEditorRequestId === lastExpandedEditorRequestRef.current) return;
    lastExpandedEditorRequestRef.current = openExpandedEditorRequestId;
    if (!openExpandedEditorNodeId) return;
    handleOpenExpandedEditor(openExpandedEditorNodeId);
  }, [openExpandedEditorRequestId, openExpandedEditorNodeId, handleOpenExpandedEditor]);

  const handleExpandedEditorSave = useCallback(
    (nodeId: string, result: SaveExpandedEditorResult) => {
      if (!result) return;
      const latestCanvas = useCanvasStore.getState().canvas;
      const target = latestCanvas.nodes.find((node) => node.id === nodeId);
      if (!target) return;

      if ((target.content || '') !== result.content) {
        handleTextContentChange(nodeId, result.content);
      }

      try {
        updateNodeAction(nodeId, { data: result.data } as any);
      } catch {}
    },
    [handleTextContentChange, updateNodeAction],
  );

  const expandedEditorNode = useMemo(() => {
    if (!expandedEditorNodeId) return null;
    const target = canvas.nodes.find((node) => node.id === expandedEditorNodeId);
    if (!target) return null;
    if (target.type !== 'text' && target.type !== 'todo') return null;
    return target;
  }, [canvas.nodes, expandedEditorNodeId]);

  useEffect(() => {
    onExpandedEditorStateChange?.({
      open: !!expandedEditorNode,
      nodeId: expandedEditorNode?.id ?? null,
    });
  }, [expandedEditorNode, onExpandedEditorStateChange]);

  // 🔗 处理Canvas Link节点导航（带自动检查和修复
  const handleCanvasNavigate = useCallback(async (targetCanvasId: string) => {
    try {
      // 🔍 检查目标画布是否存
      const canvasExists = await onCanvasExists?.(targetCanvasId);
      
      if (canvasExists) {
        // 画布存在，正常导
        if (onCanvasNavigate) {
          onCanvasNavigate(targetCanvasId);
        }
      } else {
        // 🚨 画布已损坏，需要修
        console.warn('🔧 Canvas Link目标画布已损坏，启动自动修复...');
        
        // 找到对应的Canvas Link节点
        const brokenNode = canvas.nodes.find(node => 
          node.type === 'canvas-link' && 
          (node.targetCanvasId === targetCanvasId || node.content === targetCanvasId)
        );
        
        if (brokenNode) {
          // 触发编辑模式，让用户重新选择目标
          toast.warning(
            t('canvas.link.brokenConfirm', {
              title: brokenNode.title || t('canvas.untitled', {default: 'Untitled Canvas'}),
              default: `The target canvas for link "${brokenNode.title || 'Untitled Canvas'}" was deleted. Please reselect or create a new target.`
            })
          );
          handleNodeEdit(brokenNode.id, true);
        } else {
          toast.error(
            t('canvas.link.brokenAlert', {
              default: 'Canvas link is broken and cannot be auto-repaired. Please delete and recreate.'
            })
          );
        }
      }
    } catch (_error) {
      console.error('Canvas Link导航检查失败', _error);
      // 降级：尝试直接导航
      if (onCanvasNavigate) {
        onCanvasNavigate(targetCanvasId);
      }
    }
  }, [onCanvasNavigate, onCanvasExists, canvas.nodes, handleNodeEdit, t]);

  // 🖼️ 处理Canvas Link缩略图刷新
  const handleRefreshThumbnail = useCallback((nodeId: string) => {
    if (onRefreshThumbnail) {
      onRefreshThumbnail(nodeId);
    }
  }, [onRefreshThumbnail]);

  // 🎨 处理创建新画
  const handleCreateCanvas = useCallback(async (name: string): Promise<string> => {
    if (onCreateCanvas) {
      try {
        return await onCreateCanvas(name);
      } catch (_error) {
        console.error('创建画布失败:', _error);
        throw _error;
      }
    } else {
      throw new Error('Create canvas handler not provided');
    }
  }, [onCreateCanvas]);

  // 🎯 弹窗选择/取消Hook 处理（link.onSelect/link.onCancel

  // 🎯 弹窗创建画布Hook 处理（link.onCreate

  // 🔗 处理Canvas Link节点标题更改
  const handleCanvasLinkTitleChange = link.updateCanvasLinkTitle;

  // 尺寸调整结束时清理对齐线
  const handleNodeResizeEnd = useCallback((nodeId: string) => {
    try {
      const latest = useCanvasStore.getState().canvas;
      const node = latest.nodes.find((n) => n.id === nodeId);
      if (node) {
        const guideOptions = getGuideOptions(guidesAltPressedRef.current, {
          resizeHandle: resizeHandleRef.current,
          tolerancePx: SNAP_COMMIT_TOLERANCE_PX,
        });
        if (guideOptions.enabled && !guideOptions.modifierDisabled) {
          const scale = useCanvasStore.getState().viewState?.transform?.scale || 1;
          const s = Math.max(scale, 0.01);
          const commitTol = SNAP_COMMIT_TOLERANCE_PX / s;
          const maxDelta = SNAP_MAX_DELTA_PX / s;
          const rect = { x: node.x, y: node.y, width: node.width, height: node.height };
          if (!guidesControllerRef.current) {
            guidesControllerRef.current = createGuidesController();
          }
          const baselineById = guideOptions.allowBaseline ? buildBaselineMap(latest.nodes || [], fontStyle) : undefined;
          const canvasSnapshot = buildCanvasSnapshot(latest.nodes || [], scale, { baselineById });
          const snapSession =
            resizeGuideSessionRef.current ||
            guidesControllerRef.current.startResize({ ids: [nodeId], rect });
          const plan = guidesControllerRef.current.moveResize(
            snapSession,
            canvasSnapshot,
            { ids: [nodeId], rect },
            guideOptions
          );
          const applyWidth = Math.abs(plan.widthDelta) <= commitTol && Math.abs(plan.widthDelta) <= maxDelta;
          const applyHeight = Math.abs(plan.heightDelta) <= commitTol && Math.abs(plan.heightDelta) <= maxDelta;
          const nextWidth = Math.max(1, node.width + (applyWidth ? plan.widthDelta : 0));
          const nextHeight = Math.max(1, node.height + (applyHeight ? plan.heightDelta : 0));
          const nextX = node.x + (applyWidth && typeof plan.xDelta === 'number' ? plan.xDelta : 0);
          const nextY = node.y + (applyHeight && typeof plan.yDelta === 'number' ? plan.yDelta : 0);

          if (nextWidth !== node.width || nextHeight !== node.height || nextX !== node.x || nextY !== node.y) {
            const now = Date.now();
            const nextCanvas = {
              ...latest,
              nodes: latest.nodes.map((n) =>
                n.id === nodeId ? ({ ...(n as any), width: nextWidth, height: nextHeight, x: nextX, y: nextY, updatedAt: now } as CanvasNode) : n
              ),
              updatedAt: now,
            };
            updateCanvas(nextCanvas);
            const parentColumn = getNodeParentColumn(nextCanvas, nodeId);
            if (parentColumn) {
              updateCanvas(applyColumnLayout(nextCanvas, parentColumn.id));
            } else if (node.type === 'column') {
              updateCanvas(applyColumnLayout(nextCanvas, nodeId));
            }
          }
        }
      }
    } catch {}

    if (resizeSnapRef.current && resizeSnapRef.current.nodeId === nodeId) {
      resizeSnapRef.current = null;
    }
    resizeGuideSessionRef.current = null;
    resizeHandleRef.current = undefined;
    try {
      setAlignmentGuides(null);
      setAlignmentDistances(null);
      setForceGuideLines(false);
    } catch {
      // 忽略对齐线清理错
    }
  }, [updateCanvas, fontStyle]);

  // Resize snapping session state (kept at canvas level to avoid flicker)
  const resizeSnapRef = useRef<{ nodeId: string; guides: GuideLine[] } | null>(null);
  const guidesControllerRef = useRef<ReturnType<typeof createGuidesController> | null>(null);
  const groupGuideSessionRef = useRef<GuideSession | null>(null);
  const resizeGuideSessionRef = useRef<GuideSession | null>(null);
  const resizeHandleRef = useRef<ResizeHandle | undefined>(undefined);
  const guidesAltPressedRef = useRef(false);
  const guidesShiftPressedRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) guidesAltPressedRef.current = true;
      if (e.shiftKey) guidesShiftPressedRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey) guidesAltPressedRef.current = false;
      if (!e.shiftKey) guidesShiftPressedRef.current = false;
    };
    const onBlur = () => {
      guidesAltPressedRef.current = false;
      guidesShiftPressedRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const dnd = useNodesDnd({
    canvas,
    updateCanvas,
    selectedNodeIds: selectedNodeIds as Set<string>,
    effectiveToolMode,
    editingNodeId,
    isGroupActive,
    activeGroup: activeGroup as any,
    setGroupDragging,
    updateGroupBounds,
    setDragPreview,
    setSmartGuides: (guides, distances, options) => {
      setAlignmentGuides(guides);
      setAlignmentDistances(distances || null);
      setForceGuideLines(!!options?.force);
    },
    fontStyle,
    nodeRefs,
    transientPositionsRef,
    scheduleTransientFlush,
  });

  // 🎨 渲染节点内容 - 使用新的编辑器管理架
  const renderNodeContent = useCallback((node: CanvasNode) => {
    // 🎯 构建正确的节点样式对
    const nodeStyles = {
      textStyles: (node as any).textStyles || {}, // 文本样式
      tableStyles: (node as any).tableStyles || {}, // 表格样式
      linkStyles: (node as any).linkStyles || {}, // 链接样式
      accentColor: (node as any).accentColor || 'transparent', // 强调
      mermaidTheme: (node as any).mermaidTheme || undefined, // Mermaid 主题
      mermaidThemeId: (node as any).mermaidThemeId || undefined // Mermaid 主题ID（mindmap调色
    };

    // 自动尺寸模式：默认auto（未记录即auto
    const autoSizeEnabled = autoSizeModeRef.current.get(node.id) !== 'manual';

    return (
      <EditorManager
        node={node}
        editing={editingNodeId === node.id}
        selected={(selectedNodeIds as Set<string>).has(node.id)} // 传递选中状
        readOnly={readOnly}
        fontStyle={fontStyle}
        cornerStyle={cornerStyle}
        nodeStyles={nodeStyles}  // 传递正确的样式对象
        onContentChange={handleTextContentChange}
        onEditToggle={handleNodeEdit}
        onSizeChange={handleNodeSizeChange}
        onRequestExpandedEdit={handleOpenExpandedEditor}
        onRichSnapshotPersist={handleTextRichSnapshotPersist}
        onAiGenerate={handleInlineEditorAiGenerate}
        autoSizeEnabled={autoSizeEnabled}
        onAutoSizeModeChange={handleAutoSizeModeChange}
        onSelect={handleNodeSelect} // 传递节点选中回调
        
        // Canvas Link节点专用props
        onTitleChange={handleCanvasLinkTitleChange}
        onNavigate={handleCanvasNavigate}
        onRefreshThumbnail={handleRefreshThumbnail}
        onCreateCanvas={handleCreateCanvas}
        onGetAvailableCanvases={handleGetAvailableCanvases}
      />
    );
  }, [editingNodeId, handleTextContentChange, handleNodeEdit, handleNodeSizeChange,
      fontStyle, cornerStyle, handleCanvasLinkTitleChange, handleCanvasNavigate,
      handleRefreshThumbnail, handleCreateCanvas, handleGetAvailableCanvases,
      handleAutoSizeModeChange, handleNodeSelect, handleOpenExpandedEditor,
      handleTextRichSnapshotPersist, handleInlineEditorAiGenerate, readOnly, selectedNodeIds]);

  // 🔗 处理连接开
  const handleConnectionStart = useCallback((
    event: React.MouseEvent | MouseEvent,
    nodeId: string,
    handlePosition: 'top' | 'right' | 'bottom' | 'left',
    _handleScreenPosition?: { x: number; y: number },
  ) => {
    // 手型模式下禁用连接创
    if (effectiveToolMode === 'hand') {
      return;
    }
    
    try {
      event.preventDefault();
      event.stopPropagation();
      
      const node = canvas.nodes.find(n => n.id === nodeId);
      if (!node) return;

      // 🎯 默认以节点中心作为连线起点
      const nodeElement = nodeRefs.current.get(nodeId) || document.querySelector(`[data-node-id="${nodeId}"]`);
      if (!nodeElement) return;
      
      const nodeRect = nodeElement.getBoundingClientRect();
      const startScreenPos = {
        x: nodeRect.left + nodeRect.width / 2,
        y: nodeRect.top + nodeRect.height / 2,
      };

      startConnection(nodeId, handlePosition, startScreenPos);

      // 注册鼠标事件
      const handleMouseMove = (e: MouseEvent) => {
        setTempConnectionEnd({ x: e.clientX, y: e.clientY });

        // 节点悬停检测（优先使用空间索引 + 画布坐标
        try {
          if (!coordinatesReady) return;
          const p = screenToCanvasCoords(e.clientX, e.clientY);
          const candidates = queryPoint(viewModel.spatialIndexRef.current, p.x, p.y);
          let hovered: string | null = null;
          for (const n of candidates) {
            if (n.id === nodeId) continue;
            if (p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height) {
              hovered = n.id; break;
            }
          }
          setHoveredNodeId(hovered);
        } catch {
          // 忽略错误
        }
      };

      const handleMouseUp = (e: MouseEvent) => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        // 若已被节点层 onMouseUp 处理并结束连线，则避免重复创建
        const latestInteraction = useCanvasStore.getState().interactionState;
        if (!latestInteraction.isConnecting || latestInteraction.connectionStart?.nodeId !== nodeId) {
          setTempConnectionEnd(null);
          setHoveredNodeId(null);
          return;
        }
        
        // 检查坐标系统是否就
        if (!coordinatesReady) {
          // 🎯 确保即使在错误情况下也重置连线状
          cancelConnection();
          setTempConnectionEnd(null);
          setHoveredNodeId(null);
          return;
        }
        
        // 🎯 使用坐标转换系统 + 空间索引定位目标
        const { x: canvasMouseX, y: canvasMouseY } = screenToCanvasCoords(e.clientX, e.clientY);
        let targetNodeId: string | null = null;
        try {
          const candidates = queryPoint(viewModel.spatialIndexRef.current, canvasMouseX, canvasMouseY);
          for (const n of candidates) {
            if (n.id === nodeId) continue;
            const inside = canvasMouseX >= n.x && canvasMouseX <= n.x + n.width && canvasMouseY >= n.y && canvasMouseY <= n.y + n.height;
            if (inside) { targetNodeId = n.id; break; }
          }
        } catch {
          // 忽略
        }
        
        // 如果找到目标节点，创建连
        if (targetNodeId) {
          const newConnection = createConnectionWithStyle(nodeId, targetNodeId);
          if (!newConnection) return;

          const updatedCanvas = {
            ...canvas,
            connections: [...(canvas.connections || []), newConnection],
            updatedAt: Date.now()
          };

          updateCanvas(updatedCanvas);
          if (effectiveToolMode === 'line') {
            exitLineModeToPrevious();
          }
        }
        
        // 🎯 重置连线状态（无论是否创建了连接）
        cancelConnection();
        setTempConnectionEnd(null);
        setHoveredNodeId(null);
      };

      // 立即注册事件监听
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      // 设置初始连线终点
      setTempConnectionEnd({
        x: startScreenPos.x,
        y: startScreenPos.y
      });
      
    } catch (_error) {
      // 忽略鼠标事件处理错误
    }
  }, [
    canvas,
    updateCanvas,
    effectiveToolMode,
    startConnection,
    cancelConnection,
    createConnectionWithStyle,
    screenToCanvasCoords,
    coordinatesReady,
    viewModel.spatialIndexRef,
    exitLineModeToPrevious,
  ]);

  // 🔗 处理连接结束
  const handleConnectionEnd = useCallback((targetNodeId: string) => {
    if (!isConnecting || !connectionStart || connectionStart.nodeId === targetNodeId) {
      cancelConnection();
      setTempConnectionEnd(null);
      return;
    }

    // 创建新连
    const newConnection = createConnectionWithStyle(connectionStart.nodeId, targetNodeId);
    if (!newConnection) return;

    const updatedCanvas = {
      ...canvas,
      connections: [...(canvas.connections || []), newConnection],
      updatedAt: Date.now()
    };

    updateCanvas(updatedCanvas);
    if (effectiveToolMode === 'line') {
      exitLineModeToPrevious();
    }

    // 重置连接状
    cancelConnection();
    setTempConnectionEnd(null);
    setHoveredNodeId(null);
    
  }, [isConnecting, connectionStart, canvas, updateCanvas, cancelConnection, createConnectionWithStyle, effectiveToolMode, exitLineModeToPrevious]);

  // 旧的鼠标移动处理逻辑已移handleConnectionStart 
  // 连接标签编辑函数已移到上面早期定义，删除重复定义

  // ==================== 遮挡阴影：检测是否被其他节点覆盖 ====================
  const overlapShadowMap = React.useMemo(() => {
    try {
      const renderIndex = new Map<string, number>();
      (canvas.nodes || []).forEach((n, idx) => renderIndex.set(n.id, idx));
      const selectedSet = selectedNodeIds as Set<string>;
      const draggingId = draggingNodeId;
      const stackLevel = (n: CanvasNode) => {
        if ((n as any).type === 'column') return 0;
        if (draggingId && n.id === draggingId) return 1001;
        if (selectedSet && selectedSet.has(n.id)) return 1000;
        return 1;
      };
      const nodeOpacity = (n: any) => {
        try {
          if (n?.type === 'media') return 0;
          if (n?.type === 'code' && n?.codeType === 'svg') {
            return n?.svgBgMode === 'auto' ? 1 : 0;
          }
          if (n?.type === 'group') {
            const bg = n?.groupStyles?.bgOpacity;
            return typeof bg === 'number' ? (isFinite(bg) ? bg : 0) : 0;
          }
          const ts = n?.textStyles;
          const op = typeof ts?.opacity === 'number' ? ts.opacity : 1;
          return isFinite(op) ? op : 1;
        } catch { return 1; }
      };
      const isFullyOpaque = (n: any) => {
        try {
          if (n?.type === 'media') return false;
          if (n?.type === 'code' && n?.codeType === 'svg') return n?.svgBgMode === 'auto';
          if (n?.type === 'group') {
            const bg = n?.groupStyles?.bgOpacity;
            return typeof bg === 'number' ? bg >= 0.999 : false;
          }
          return nodeOpacity(n) >= 0.999;
        } catch { return false; }
      };
      return computeOverlapShadowMap({
        spatialIndex: viewModel.spatialIndexRef.current,
        stackLevel,
        nodeOpacity,
        isFullyOpaque,
        renderIndex,
        visibleNodes: visibleNodes || [],
      });
    } catch {
      return {} as Record<string, boolean>;
    }
  }, [viewModel.spatialIndexRef, visibleNodes, canvas?.nodes, selectedNodeIds, draggingNodeId]);

  // 🎯 清除连线选中状
  const clearSelectedConnections = useCallback(() => {
    selectConnectionsAction([]);
  }, [selectConnectionsAction]);

  

  // 🎯 处理连线选中
  const handleConnectionClick = useCallback((connectionId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    // 如果正在编辑连接，不处理选中
    if (editMode === 'connection') return;
    
    
    if (event.ctrlKey || event.metaKey) {
      // Ctrl+点击：多选模
      const currentSelected = Array.from(selectedConnectionIds as Set<string>);
      if (currentSelected.includes(connectionId)) {
        // 移除选中
        const newSelected = currentSelected.filter(id => id !== connectionId);
        selectConnectionsAction(newSelected);
      } else {
        // 添加选中
        selectConnectionsAction([...currentSelected, connectionId]);
      }
    } else {
      // 普通点击：单选模
      selectConnectionsAction([connectionId]);
    }
    
    // 清除节点选中状
    clearSelectedNodes();
  }, [editMode, selectedConnectionIds, clearSelectedNodes, selectConnectionsAction]);

  // 连接编辑键盘与聚焦逻辑已在 useConnectionsEditing 内处

  // 框选逻辑已抽离至 useBoxSelection


  // 🎯 键盘事件监听已集成到useCanvasKeyboard

  // 🔄 处理画布点击事件（清除选中状态、上下文菜单和退出标签编辑模式）
  const handleCanvasClick = useCallback((event: React.MouseEvent) => {
    
    // 如果正在编辑连接标签，点击空白区域时保存并退出编
    if (editMode === 'connection') {
      // 🛡检查是否在保护时间内（防止双击事件冲突
      const timeSinceEditing = Date.now() - editingStartTimeRef.current;
      if (timeSinceEditing < 200) { // 200ms保护时间
        return;
      }
      
      const target = event.target as Element;
      // 检查点击的是否是编辑器相关元素
      const isEditingElement = target.closest('foreignObject') || target.tagName === 'input';
      if (!isEditingElement) {
        connectionsEditing.handleLabelSave();
      }
    }
    
    // 🛡检查框选保护期，避免清空刚框选的节点
    if (box.isJustFinished()) {
      return;
    }
    
    // 清除选中状态和上下文菜
    clearSelectedNodes();
    clearSelectedConnections();
    
    // 如果正在连接，取消连
    if (isConnecting) {
      cancelConnection();
      setTempConnectionEnd(null);
      setHoveredNodeId(null);
      return;
    }
    
    // 如果有正在编辑的节点，退出编辑模式并确保保存
    if (editingNodeId) {
      // 找到正在编辑的节
      const editingNode = canvas.nodes.find(n => n.id === editingNodeId);
      if (editingNode) {
        // 触发编辑切换回调，确保编辑器能够保存内容
        handleNodeEdit(editingNodeId);
      }
      cancelEdit();
      setPanningLocked(false);
    }

    // 检查是否点击的是空白区域（不是节点
    const target = event.target as Element;
    const isNode = target.closest('[data-node-container]');
    
    if (!isNode) {
      // 只有点击空白区域时才清除选中
      selectNodesAction([]);
      cancelEdit();

      // 🎯 清除临时群组状
      if (isGroupActive) {
        destroyGroup();
      }

      // 触发画布点击回调
      onCanvasClick?.();
    }
    
    // 关闭上下文菜
    hideContextMenu();
  }, [isConnecting, onCanvasClick, editingNodeId, canvas.nodes, editMode, connectionsEditing, handleNodeEdit, hideContextMenu, isGroupActive, destroyGroup, cancelConnection, cancelEdit, setPanningLocked, selectNodesAction, box, clearSelectedConnections, clearSelectedNodes]);

  // 🧹 组件卸载时清理所有防抖定时器
  React.useEffect(() => {
    return () => {
      const timeouts = positionUpdateTimeoutRef.current;
      Object.values(timeouts).forEach(timeout => {
        if (timeout) clearTimeout(timeout);
      });
      positionUpdateTimeoutRef.current = {};
    };
  }, []);

  // 统一交互（右键拖平移、工具模式委托、上下文菜单辅助
  const interactions = useCanvasInteractions({
    editingNodeId: editingLockId,
    effectiveToolMode,
    onToolModeChange,
    dragThreshold: DRAG_THRESHOLD,
  });

  // 组交互（选中/重命取消/拖拽起点桥接
  const groups = useGroups({
    canvas,
    updateCanvas,
    selectedGroupId,
    createGroup,
    startGroupDrag,
  });

  const computeRectExitPoint = useCallback((
    start: { x: number; y: number },
    end: { x: number; y: number },
    rect: DOMRect,
  ): { x: number; y: number } | null => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const EPS = 1e-6;
    if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return null;

    const candidates: number[] = [];
    if (dx > EPS) candidates.push((rect.right - start.x) / dx);
    else if (dx < -EPS) candidates.push((rect.left - start.x) / dx);
    if (dy > EPS) candidates.push((rect.bottom - start.y) / dy);
    else if (dy < -EPS) candidates.push((rect.top - start.y) / dy);

    const positives = candidates.filter((t) => Number.isFinite(t) && t > EPS);
    if (!positives.length) return null;
    const t = Math.min(...positives);
    return { x: start.x + dx * t, y: start.y + dy * t };
  }, []);

  const buildConnectionPreviewGeometry = useCallback((
    start: { x: number; y: number },
    end: { x: number; y: number },
    startNodeRect: DOMRect | null,
  ) => {
    const totalDistance = Math.hypot(end.x - start.x, end.y - start.y);
    if (!Number.isFinite(totalDistance) || totalDistance <= 0.1) {
      return {
        start,
        end,
        guideEnd: start,
        mainStart: start,
        midpoint: start,
        hasGuide: false,
        hasMain: false,
      };
    }

    if (!startNodeRect) {
      return {
        start,
        end,
        guideEnd: start,
        mainStart: start,
        midpoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
        hasGuide: false,
        hasMain: true,
      };
    }

    const exit = computeRectExitPoint(start, end, startNodeRect);
    if (!exit) {
      return {
        start,
        end,
        guideEnd: start,
        mainStart: start,
        midpoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
        hasGuide: false,
        hasMain: true,
      };
    }

    const guideDistance = Math.hypot(exit.x - start.x, exit.y - start.y);
    const insideOnly = totalDistance <= guideDistance + 0.5;
    const guideEnd = insideOnly ? end : exit;
    const mainStart = insideOnly ? end : exit;
    const mainDistance = Math.hypot(end.x - mainStart.x, end.y - mainStart.y);

    return {
      start,
      end,
      guideEnd,
      mainStart,
      midpoint: { x: (mainStart.x + end.x) / 2, y: (mainStart.y + end.y) / 2 },
      hasGuide: Math.hypot(guideEnd.x - start.x, guideEnd.y - start.y) > 0.5,
      hasMain: mainDistance > 0.5,
    };
  }, [computeRectExitPoint]);

  const buildFreeLinePreviewGeometry = useCallback((start: { x: number; y: number }, end: { x: number; y: number }) => {
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const hasMain = Number.isFinite(distance) && distance > 0.5;
    return {
      start,
      end,
      guideEnd: start,
      mainStart: start,
      midpoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      hasGuide: false,
      hasMain,
    };
  }, []);

  const tempConnectionPreview = useMemo(() => {
    if (!isConnecting || !connectionStart || !tempConnectionEnd) return null;
    let startNodeRect: DOMRect | null = null;
    try {
      const startNodeEl =
        nodeRefs.current.get(connectionStart.nodeId) ||
        document.querySelector(`[data-node-id="${connectionStart.nodeId}"]`);
      if (startNodeEl) startNodeRect = startNodeEl.getBoundingClientRect();
    } catch {}
    return buildConnectionPreviewGeometry(connectionStart.screenPosition, tempConnectionEnd, startNodeRect);
  }, [isConnecting, connectionStart, tempConnectionEnd, buildConnectionPreviewGeometry]);

  const freeLinePreview = useMemo(() => {
    if (!freeLine) return null;
    return buildFreeLinePreviewGeometry(freeLine.start, freeLine.end);
  }, [freeLine, buildFreeLinePreviewGeometry]);
  const previewMainStroke = isDark ? '#f8fafc' : '#2f3b4f';
  const previewGuideStroke = isDark ? 'rgba(248, 250, 252, 0.72)' : '#c1c7d0';
  const previewStartFill = isDark ? '#f8fafc' : '#2f3b4f';
  const previewStartStroke = isDark ? '#111827' : '#f8fafc';
  const previewShadowColor = isDark ? '#000000' : '#1f2937';
  const PREVIEW_ARROW_WIDTH = 13;
  const PREVIEW_ARROW_TAIL_X = 3;
  const PREVIEW_ARROW_TRIM = (PREVIEW_ARROW_WIDTH - PREVIEW_ARROW_TAIL_X) + 1.6;
  const trimPreviewSegmentEnd = useCallback((
    start: { x: number; y: number },
    end: { x: number; y: number },
    trimPx: number,
  ) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.hypot(dx, dy);
    if (!Number.isFinite(dist) || dist <= 0.5) return null;
    const t = Math.max(0, Math.min(1, (dist - trimPx) / dist));
    return {
      start,
      end: { x: start.x + dx * t, y: start.y + dy * t },
    };
  }, []);
  const tempConnectionMainSegment = useMemo(() => {
    if (!tempConnectionPreview?.hasMain) return null;
    return trimPreviewSegmentEnd(tempConnectionPreview.mainStart, tempConnectionPreview.end, PREVIEW_ARROW_TRIM);
  }, [PREVIEW_ARROW_TRIM, tempConnectionPreview, trimPreviewSegmentEnd]);
  const freeLineMainSegment = useMemo(() => {
    if (!freeLinePreview?.hasMain) return null;
    return trimPreviewSegmentEnd(freeLinePreview.mainStart, freeLinePreview.end, PREVIEW_ARROW_TRIM);
  }, [PREVIEW_ARROW_TRIM, freeLinePreview, trimPreviewSegmentEnd]);

  // 🎨 主画布内
  const renderCanvasContent = () => {
    // 获取当前的缩放比例，确保 transformRef.current 存在
    const _currentScale = transformRef.current?.state?.scale || 1;

    return (
    <div
      className="relative w-full h-full"
      data-canvas-container
      onContextMenuCapture={(e) => {
        // 顶层捕获右键事件：仅在非表格节点和空白区域时接管
        const targetEl = e.target as Element;
        const nodeEl = targetEl?.closest('[data-node-id]') as HTMLElement | null;
        const nodeId = nodeEl?.getAttribute('data-node-id') || undefined;

        // 如果命中表格节点，则放行事件给表格自身处理（TableNode 内部有专属右键菜单）
        if (nodeId) {
          const n = canvas.nodes.find(n => n.id === nodeId);
          if (n && (n as any).type === 'table') {
            // 允许冒泡TableNode onContextMenu；不拦截
            return;
          }
        }

        // 其他情况：统一接管右键事件，阻止原生菜单，交给画布菜单处理
        if (readOnly) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        handleContextMenu(e as unknown as React.MouseEvent, nodeId, undefined, { isRightDragging: interactions.isRightDragging, hasRightDragged: interactions.hasRightDragged });
      }}
    >

      {/* 🌐 基础背景色（提供全屏过渡色） */}
      <div
        className="absolute inset-0"
        aria-hidden="true"
        style={{
          backgroundColor: backgroundColor || '#eeeded',
          pointerEvents: 'none'
        }}
      />

      {!hasUserVisibleNodes && (
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute left-1/2 top-[52%] w-[70vw] max-w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/30 dark:bg-white/10 blur-[80px]" />
          <div className="absolute left-1/2 top-[48%] w-[60vw] max-w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-100/40 blur-[120px]" />
        </div>
      )}

      {/* 🪧 Empty Canvas Hint (always centered when no user-visible nodes) */}
      {!hasUserVisibleNodes && (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-20 w-[92vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 select-none text-muted-foreground"
          role="note"
          aria-label={t('canvas.emptyHint.a11y', { default: 'Input: double-click, drag, paste. Organize: connect or AI tidy. Output: slides, video, images.' })}
        >
          <div className="text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-muted-foreground/60">
            {t('canvas.emptyHint.title', { default: 'How to start' })}
          </div>
          <div className="mt-1 text-center text-sm font-medium text-foreground/80 md:text-base">
            {t('canvas.emptyHint.subtitle', { default: 'Input / Organize / Output' })}
          </div>
          <div className="mt-6 grid grid-cols-1 items-stretch gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <div className="rounded-2xl border-2 border-dashed border-muted-foreground/40 bg-background/30 p-5 text-center backdrop-blur-sm">
              <div className="flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted-foreground/15 text-foreground/80">
                  1
                </span>
                <span>{t('canvas.emptyHint.inputLabel', { default: 'Input' })}</span>
              </div>
              <div className="mt-3 rounded-xl border border-border/40 bg-background/80 p-3">
                <div className="flex items-center gap-2 rounded-lg border border-muted-foreground/20 bg-background/90 px-2 py-1.5">
                  <Type className="h-3.5 w-3.5 text-muted-foreground" />
                  <div className="h-2 w-24 rounded bg-muted-foreground/20" />
                  <div className="ml-auto h-3 w-px bg-muted-foreground/40 animate-pulse" />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="flex h-10 items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 bg-muted-foreground/10">
                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex h-10 items-center justify-center rounded-lg border border-muted-foreground/20 bg-muted-foreground/10">
                    <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {t('canvas.emptyHint.inputDesc', { default: 'Double-click / Drag / Paste' })}
              </div>
            </div>
            <div className="hidden md:flex items-center justify-center text-muted-foreground/50">
              <ArrowRight className="h-4 w-4" />
            </div>
            <div className="rounded-2xl border-2 border-dashed border-muted-foreground/40 bg-background/30 p-5 text-center backdrop-blur-sm">
              <div className="flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted-foreground/15 text-foreground/80">
                  2
                </span>
                <span>{t('canvas.emptyHint.processLabel', { default: 'Organize' })}</span>
              </div>
              <div className="mt-3 rounded-xl border border-border/40 bg-background/80 p-3">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Link2 className="h-3 w-3" />
                    <div className="h-2 w-10 rounded bg-muted-foreground/20" />
                  </div>
                  <div className="flex h-6 w-6 items-center justify-center rounded-full border border-muted-foreground/20 bg-background/80">
                    <Sparkles className="h-3 w-3 text-muted-foreground" />
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-7 w-12 rounded-lg bg-muted-foreground/15" />
                  <div className="relative h-px flex-1 bg-muted-foreground/30">
                    <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-muted-foreground/50" />
                  </div>
                  <div className="h-7 w-12 rounded-lg bg-muted-foreground/15" />
                </div>
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {t('canvas.emptyHint.processDesc', { default: 'Connect / AI tidy' })}
              </div>
            </div>
            <div className="hidden md:flex items-center justify-center text-muted-foreground/50">
              <ArrowRight className="h-4 w-4" />
            </div>
            <div className="rounded-2xl border-2 border-dashed border-muted-foreground/40 bg-background/30 p-5 text-center backdrop-blur-sm">
              <div className="flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted-foreground/15 text-foreground/80">
                  3
                </span>
                <span>{t('canvas.emptyHint.outputLabel', { default: 'Output' })}</span>
              </div>
              <div className="mt-3 rounded-xl border border-border/40 bg-background/80 p-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-border/40 bg-background/90 p-2 text-center">
                    <FileText className="mx-auto h-4 w-4 text-muted-foreground" />
                    <div className="mt-2 h-3 w-full rounded bg-muted-foreground/10" />
                  </div>
                  <div className="rounded-lg border border-border/40 bg-background/90 p-2 text-center">
                    <Play className="mx-auto h-4 w-4 text-muted-foreground" />
                    <div className="mt-2 h-2 w-full rounded-full bg-muted-foreground/10">
                      <div className="h-2 w-2/5 rounded-full bg-muted-foreground/30" />
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/40 bg-background/90 p-2 text-center">
                    <ImageIcon className="mx-auto h-4 w-4 text-muted-foreground" />
                    <div className="mt-2 grid grid-cols-2 gap-1">
                      <div className="h-3 rounded bg-muted-foreground/10" />
                      <div className="h-3 rounded bg-muted-foreground/10" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {t('canvas.emptyHint.outputDesc', { default: 'Slides / Video / Images' })}
              </div>
            </div>
          </div>
        </div>
      )}

      {showViewportDriftHint && (
        <div
          className="pointer-events-none absolute bottom-5 left-1/2 z-30 -translate-x-1/2 select-none"
          role="status"
          aria-label={t('canvas.driftHint.a11y', { default: 'You are outside the content area. Double-click empty space to jump back to your canvas content.' })}
        >
          <div className="rounded-full border border-border/60 bg-background/90 px-4 py-2 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm">
            {t('canvas.driftHint.message', { default: 'You are outside the content area. Double-click empty space to jump back.' })}
          </div>
        </div>
      )}
      
      {/* 🎨 TransformWrapper - 核心缩放平移容器 */}
        <TransformWrapper
        key={canvas?.id ?? 'canvas'}
        ref={transformRef}
        initialScale={initialTransform?.scale ?? 1}
        initialPositionX={initialTransform ? initialTransform.positionX : undefined}
        initialPositionY={initialTransform ? initialTransform.positionY : undefined}
        minScale={0.1}
        maxScale={3}
        wheel={{
          step: 0.1,
          disabled: !!editingLockId || isWheelLocked,
          wheelDisabled: true,
          touchPadDisabled: false,
        }}
        pinch={{
          step: 5,
          disabled: !!editingLockId
        }}
        panning={{
          disabled: !!editingLockId || isWheelLocked,
          // 左键：仅手型模式（含按住空格）时允许平移
          allowLeftClickPan: !editingLockId && (effectiveToolMode === 'hand'),
          // 右键：允许平移（支持拖动平移 + 点击显示菜单
          allowRightClickPan: !editingLockId,
          allowMiddleClickPan: false,
          wheelPanning: true,
        }}
        doubleClick={{ disabled: true }}
        onTransformed={handleZoomChange}
        onPanningStart={interactions.onPanningStart}
        onPanning={interactions.onPanning}
        onPanningStop={interactions.onPanningStop}
        limitToBounds={false}
        centerOnInit={!hasInitialTransform}
      >
        <TransformComponent
          wrapperStyle={{ 
            width: '100%', 
            height: '100%',
            // Use default cursor at wrapper; inner canvas layer decides contextually
            cursor: 'default'
          }}
          contentStyle={{
            width: '100%',
            height: '100%',
            position: 'relative',
            // Keep default and let interactive layers/nodes set cursor when needed
            cursor: 'default'
          }}
        >
          {/* 🌐 背景图案：放置于 Transform 内部以随缩放移动 */}
          <div
            className="absolute"
            aria-hidden="true"
            style={{
              left: BACKGROUND_WORLD_OFFSET,
              top: BACKGROUND_WORLD_OFFSET,
              width: BACKGROUND_WORLD_SIZE,
              height: BACKGROUND_WORLD_SIZE,
              zIndex: 0,
              pointerEvents: 'none',
              ...generateBackgroundStyle(
                backgroundStyle || BACKGROUND_STYLES[0],
                backgroundColor,
                patternColor
              ),
            }}
          />

          {/* 📋 真正无限的画布点击区域 */}
          {/* 保持原结构，避免覆盖节点渲染 */}
          <div
            className="absolute"
            onClick={(e) => { if (!readOnly) handleCanvasClick(e); else if (effectiveToolMode === 'select') handleCanvasClick(e); }}
            onMouseMove={(e) => {
              if (readOnly) return;
              if (freeLine) {
                const startCanvas = screenToCanvasCoords(freeLine.start.x, freeLine.start.y);
                const currentCanvas = screenToCanvasCoords(e.clientX, e.clientY);
                const snapped = snapFreeLineToAxis(startCanvas, currentCanvas, FREE_LINE_SNAP_THRESHOLD_DEG);
                let previewEnd = { x: e.clientX, y: e.clientY };
                if (snapped.snapped && canvasToScreen) {
                  const { x, y } = canvasToScreen(snapped.point.x, snapped.point.y);
                  previewEnd = { x, y };
                }
                setFreeLine({ start: freeLine.start, end: previewEnd });
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              handleCanvasMouseMove(e);
            }}
            onMouseDown={(e) => {
              if (readOnly) {
                if (effectiveToolMode !== 'hand') {
                  box.handleMouseDown(e as any);
                }
                return;
              }
              // 线条工具：在空白处按下开始自由连线
              if (effectiveToolMode === 'line') {
                if (e.button !== 0) return;
                setFreeLine({ start: { x: e.clientX, y: e.clientY }, end: { x: e.clientX, y: e.clientY } });
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              if (effectiveToolMode !== 'hand') box.handleMouseDown(e as any);
            }}
            onMouseUp={(e) => {
              if (readOnly) return;
              if (freeLine) {
                // 结束自由连线：转换为画布坐标并创建连接（fromPoint/toPoint）
                try {
                  const start = screenToCanvasCoords(freeLine.start.x, freeLine.start.y);
                  const rawEnd = screenToCanvasCoords(e.clientX, e.clientY);
                  const snapped = snapFreeLineToAxis(start, rawEnd, FREE_LINE_SNAP_THRESHOLD_DEG);
                  const end = snapped.point;
                  const dx = end.x - start.x; const dy = end.y - start.y;
                  const dist = Math.hypot(dx, dy);
                  const MIN_DIST = 8;
                  if (dist >= MIN_DIST) {
                    const id = NodeIds.generateConnectionId(canvas.id);
                    const defApp = (useSettingsStore.getState()?.connection as any)?.appearanceDefault;
                    const appearance = mergeConnectionAppearance(undefined, defApp);
                    const newConn = {
                      id,
                      fromPoint: { x: start.x, y: start.y },
                      toPoint: { x: end.x, y: end.y },
                      createdAt: Date.now(),
                      ...(appearance ? { appearance } : {}),
                    } as any; // CanvasConnection with free endpoints
                    const updatedCanvas = {
                      ...canvas,
                      connections: [...(canvas.connections || []), newConn],
                      updatedAt: Date.now()
                    };
                    updateCanvas(updatedCanvas);
                    // 画完一条线后自动退出线条模式
                    exitLineModeToPrevious();
                  }
                } catch {}
                setFreeLine(null);
                e.preventDefault();
                e.stopPropagation();
                return;
              }
            }}
            onDoubleClick={(e) => { if (!readOnly) handleDoubleClickEmpty(e); }}
            onContextMenu={(e) => { if (!readOnly) handleContextMenu(e, undefined, undefined, { isRightDragging: interactions.isRightDragging, hasRightDragged: interactions.hasRightDragged }); else { e.preventDefault(); e.stopPropagation(); } }}
            onDragOver={(e) => { if (!readOnly) handleDragOver(e); }}
            onDragLeave={(e) => { if (!readOnly) handleDragLeave(e); }}
            onDrop={(e) => { if (!readOnly) handleDrop(e); }}
            style={{ 
              cursor: isPanningLocked
                ? 'not-allowed'
                : box.isBoxSelecting
                  ? 'crosshair'
                  : (interactions.isHandDragging || interactions.isRightDragging)
                    ? 'grabbing'
                    : (effectiveToolMode === 'hand')
                      ? 'grab'
                      : (effectiveToolMode === 'line')
                        ? 'crosshair'
                      : 'default',
              left: canvasBounds.minX,
              top: canvasBounds.minY,
              width: canvasBounds.width,
              height: canvasBounds.height
            }}
          >
          </div>

          {/* 🎯 渲染所有节点 */}
            {/* 下层：组背景 */}
            {(canvas.nodes?.some(n => (n as any).type === 'group')) && (
              <GroupBackgrounds
                canvas={canvas}
                onSelectGroup={groups.onSelectGroup}
                onGroupDragStart={groups.onGroupDragStart}
                lockedGroupId={lockedGroupId}
              />
            )}
            
            {/* 中层：节点（移至独立组件） */}
            <div style={{ pointerEvents: readOnly ? (effectiveToolMode === 'select' ? 'auto' as const : 'none' as const) : 'auto' as const }}>
            <NodesLayer
              canvas={canvas}
              visibleNodes={visibleNodes}
              selectedNodeIds={selectedNodeIds as Set<string>}
              previewSelectedNodes={previewSelectedNodes}
              editingNodeId={editingNodeId}
              isConnecting={isConnecting}
              hoveredNodeId={hoveredNodeId}
              setHoveredNodeId={(id) => setHoveredNodeId(id)}
              effectiveToolMode={effectiveToolMode}
              cornerStyle={cornerStyle || DEFAULT_CORNER_STYLE}
              fontStyle={fontStyle}
              draggingNodeId={draggingNodeId}
              dragTargetColumnId={dragTargetColumnId}
              dragInsertionIndex={dnd.dragInsertionIndex}
              dragSourceColumnId={dnd.dragSourceColumnId}
              playState={playState}
              playbackFocusId={playbackFocusId}
              dragPreview={dragPreview}
              isGroupActive={isGroupActive}
              activeGroupNodeIds={activeGroup?.nodeIds || null}
              onNodeGroupDragStart={handleNodeGroupDragStart}
              getNodeParentColumn={getNodeParentColumn}
              sanitizeChildren={dnd.sanitizeChildren}
              computeInsertionIndex={computeInsertionIndex}
              onConnectionEnd={(id) => handleConnectionEnd(id as any)}
              onContextMenuForNode={(e, nodeId) => { if (readOnly) { e.preventDefault(); e.stopPropagation(); return; } handleContextMenu(e, nodeId, undefined, { isRightDragging: interactions.isRightDragging, hasRightDragged: interactions.hasRightDragged }); }}
              onNodeSelect={handleNodeSelect}
              onNodeEdit={handleNodeEdit}
              onContentChange={handleTextContentChange}
              onNodePositionChange={dnd.handleNodePositionChange}
              onNodeSizeChange={handleNodeSizeChange}
              onAutoSizeModeChange={handleAutoSizeModeChange}
              onConnectionStart={handleConnectionStart}
              onLockToggle={handleNodeLockToggle}
              onTableCellCommit={handleTableCellCommit}
              onTableRowOp={handleTableRowOp}
              onTableColOp={handleTableColOp}
              onDragStart={dnd.handleDragStart}
              onDragEnd={dnd.handleDragEnd}
              onColumnTitleChange={(id, title) => {
                if ((canvas.nodes.find((n) => n.id === id)?.type || '') === 'canvas-link') {
                  handleCanvasLinkTitleChange(id, title);
                } else {
                  handleColumnTitleChange(id, title);
                }
              }}
              onColumnToggleCollapse={handleColumnToggleCollapse}
              onDropNodeToColumn={handleDropNodeToColumn}
              renderNodeContent={renderNodeContent}
              onChildNodeSelect={handleChildNodeSelect}
              onChildNodeDragStart={handleChildNodeDragStart}
              onCanvasNavigate={handleCanvasNavigate}
              onRefreshThumbnail={handleRefreshThumbnail}
              onCreateCanvas={handleCreateCanvas}
              onGetAvailableCanvases={handleGetAvailableCanvases}
              setWheelLocked={(locked) => setIsWheelLocked(locked)}
              readOnly={readOnly}
              globalEditingLock={!!editingLockId}
              overlapShadowMap={overlapShadowMap}
              onNodeResizeEnd={handleNodeResizeEnd}
              registerNodeRef={handleRegisterNodeRef}
            />
            </div>

            {focusHighlight && (
              <div
                className="absolute pointer-events-none rounded-lg border-2 border-brand-500/80 shadow-lg shadow-brand-500/30 animate-pulse"
                style={{
                  left: focusHighlight.x,
                  top: focusHighlight.y,
                  width: focusHighlight.w,
                  height: focusHighlight.h,
                  zIndex: 1200,
                }}
              />
            )}

            {/* 叠加层：选择反馈 + 组边框与标签 */}
            <OverlaysLayer
              canvas={canvas}
              containerScale={currentZoom / 100}
              alignmentGuides={alignmentGuides || []}
              alignmentDistances={alignmentDistances || []}
              forceGuideLines={forceGuideLines}
              showSelectionOverlay={!box.isBoxSelecting}
              selectedNodeIds={selectedNodeIds as Set<string>}
              selectedGroupId={selectedGroupId}
              onSelectGroup={groups.onSelectGroup}
              onRenameGroup={groups.onRenameGroup}
              onGroupDragStart={groups.onGroupDragStart}
              onUngroup={groups.onUngroup}
              isEditMode={isEditMode}
              onOpenContextMenu={(e) => { if (readOnly) { e.preventDefault(); e.stopPropagation(); return; } handleContextMenu(e, undefined, undefined, { isRightDragging: interactions.isRightDragging, hasRightDragged: interactions.hasRightDragged }); }}
              renameRequestId={renameGroupRequestId}
              onRenameRequestConsumed={() => setRenameGroupRequestId(null)}
              onGroupLabelEditingChange={(gid) => setLockedGroupId(gid)}
            />

            {/* 👥 远端协作者的选区/光标叠加层 */}
            <RemoteSelectionLayer
              canvas={canvas}
              collaborators={collaborators}
              containerScale={currentZoom / 100}
            />

            {/* 思维导图句柄层：两种模式均可显示（Chat/编辑） */}
            {(canvas.nodes?.some(n => (n as any).type === 'group' && (n as any).mindmap)) && (
              <MindmapHandles
                canvas={canvas}
                containerScale={currentZoom / 100}
                hoveredNodeId={hoveredNodeId}
                isEditMode={isEditMode}
                onKeepHover={(id) => setHoveredNodeId(id)}
              />
            )}


            

            {/* 📦 框选视觉反馈 - 移至顶层使用屏幕坐标 */}
            {/* 这个div已经移到顶层渲染 */}

            {/* 思维导图独立渲染已移除 */}

            {/* 🔗 真正无限的连接线渲染（移至独立组件） */}
            <ConnectionsLayer
              canvas={canvas}
              canvasBounds={{ minX: canvasBounds.minX, minY: canvasBounds.minY, width: canvasBounds.width, height: canvasBounds.height }}
              selectedConnectionIds={selectedConnectionIds as Set<string>}
              hiddenMindmapNodeIds={hiddenMindmapNodeIds}
              transientPositionsRef={transientPositionsRef}
              transientVersion={transientVersion}
              dragPreview={dragPreview}
              draggingNodeId={draggingNodeId}
              viewportRect={viewportRect}
              cullThreshold={CULL_THRESHOLD}
              editMode={editMode}
              editingEntityId={editingEntityId as any}
              connectionLabelInput={connectionsEditing.connectionLabelInput}
              connectionInputRef={connectionsEditing.connectionInputRef}
              onConnectionClick={(id, e) => connectionsEditing.handleConnectionClick(id, e)}
              onLabelEdit={(id) => handleConnectionLabelEditWrapped(id)}
              onLabelSave={() => connectionsEditing.handleLabelSave()}
              onLabelCancel={() => connectionsEditing.handleLabelCancel()}
              onLabelKeyDown={(ev) => connectionsEditing.handleLabelKeyDown(ev)}
              onLabelInputChange={connectionsEditing.setConnectionLabelInput}
              onConnectionContextMenu={(e, id) => {
                if (!Array.from(selectedConnectionIds as Set<string>).includes(id)) {
                  selectConnectionsAction([id]);
                  clearSelectedNodes();
                }
                handleContextMenu(e, undefined, id, { isRightDragging: interactions.isRightDragging, hasRightDragged: interactions.hasRightDragged });
              }}
              screenToCanvas={screenToCanvasCoords}
              containerScale={currentZoom / 100}
            />
            
            {/* 🎯 群组边界框组件 */}
            {activeGroup && isGroupActive && !groupDragStateRef.current.createdFromPermanent && (
              <GroupBoundingBox
                group={activeGroup}
                isVisible={true}
                nodes={canvas.nodes} // 🎯 传入最新的节点数据，支持实时边界计算
                connections={canvas.connections}
                selectedConnectionIds={selectedConnectionIds as Set<string>}
                // 使用 TransformWrapper 的实际缩放比例，保证右下角弧线在屏幕上尺寸恒
                containerScale={_currentScale}
                onDeleteNodes={handleGroupDeleteNodes}
                onCreateGroup={handleCreateGroup}
                onGroupDragStart={(e) => startGroupDrag(e, activeGroup)}
                onGroupScaleStart={handleGroupScaleStart}
              />
            )}
        </TransformComponent>
      </TransformWrapper>



      {/* 🖱️ 右键上下文菜单 */}
      <UnifiedContextMenu state={contextMenu as any} onClose={hideContextMenu} />


      {/* 🛠️ 工具模式选择器 - 播放中隐藏，其余模式均可见（Chat/编辑） */}
      {playState !== 'playing' && (
        <ToolModeSelector
          // Show the base mode in the UI to avoid confusion when holding Space
          currentMode={baseToolMode as any}
          onModeChange={(mode) => {
            if (readOnly) {
              if (mode === 'select' || mode === 'hand') {
                setRoToolMode(mode);
              }
              return;
            }
            handleToolModeChange(mode);
          }}
          currentZoom={currentZoom}
          onFitToView={fitToView}
          isPanningLocked={isPanningLocked}
          onPanningLockToggle={() => setPanningLocked(!isPanningLocked)}
          isEditMode={isEditMode}
          {...(backgroundStyle && { backgroundStyle })}
          backgroundColor={backgroundColor}
          onMinimapNavigate={handleMinimapNavigate}
        />
      )}



      {/* 🎯 方案二：独立HTML覆盖层 - 临时连线渲染 */}
      {tempConnectionPreview && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: 'none',
            zIndex: 1000
          }}
        >
          <svg 
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              pointerEvents: 'none'
            }}
          >
            <defs>
              <marker
                id="connection-preview-arrow"
                markerWidth="13"
                markerHeight="13"
                refX="3"
                refY="6.5"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <path
                  d="M3,1 L3,12 L12,6.5 z"
                  fill={previewMainStroke}
                />
              </marker>
              <filter id="connection-preview-start-shadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor={previewShadowColor} floodOpacity="0.35" />
              </filter>
            </defs>
            {tempConnectionPreview.hasGuide && (
              <line
                x1={tempConnectionPreview.start.x}
                y1={tempConnectionPreview.start.y}
                x2={tempConnectionPreview.guideEnd.x}
                y2={tempConnectionPreview.guideEnd.y}
                stroke={previewGuideStroke}
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeDasharray="1 12"
                opacity="0.95"
              />
            )}
            {tempConnectionPreview.hasMain && tempConnectionMainSegment && (
              <>
                <line
                  x1={tempConnectionMainSegment.start.x}
                  y1={tempConnectionMainSegment.start.y}
                  x2={tempConnectionMainSegment.end.x}
                  y2={tempConnectionMainSegment.end.y}
                  stroke={previewMainStroke}
                  strokeWidth="3.2"
                  opacity="0.98"
                  strokeLinecap="butt"
                  markerEnd="url(#connection-preview-arrow)"
                />
              </>
            )}
            <circle
              cx={tempConnectionPreview.start.x}
              cy={tempConnectionPreview.start.y}
              r="5"
              fill={previewStartFill}
              stroke={previewStartStroke}
              strokeWidth="1.2"
              filter="url(#connection-preview-start-shadow)"
            />
          </svg>
        </div>
      )}

      {/* 自由连线预览（线条工具） */}
      {freeLinePreview && (
        <div
          style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1000 }}
          data-screenshot-exclude="true"
        >
          <svg style={{ position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none' }}>
            <defs>
              <marker id="free-line-preview-arrow" markerWidth="13" markerHeight="13" refX="3" refY="6.5" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M3,1 L3,12 L12,6.5 z" fill={previewMainStroke} />
              </marker>
              <filter id="free-line-preview-start-shadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor={previewShadowColor} floodOpacity="0.35" />
              </filter>
            </defs>
            {freeLinePreview.hasMain && freeLineMainSegment && (
              <>
                <line
                  x1={freeLineMainSegment.start.x}
                  y1={freeLineMainSegment.start.y}
                  x2={freeLineMainSegment.end.x}
                  y2={freeLineMainSegment.end.y}
                  stroke={previewMainStroke}
                  strokeWidth="3.2"
                  opacity="0.98"
                  strokeLinecap="butt"
                  markerEnd="url(#free-line-preview-arrow)"
                />
              </>
            )}
          </svg>
        </div>
      )}

      {/* 📦 框选视觉反馈 - 顶层绝对定位，使用屏幕坐标 */}
      {box.isBoxSelecting && box.screenBoxSelection && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(box.screenBoxSelection.startX, box.screenBoxSelection.currentX),
            top: Math.min(box.screenBoxSelection.startY, box.screenBoxSelection.currentY),
            width: Math.abs(box.screenBoxSelection.currentX - box.screenBoxSelection.startX),
            height: Math.abs(box.screenBoxSelection.currentY - box.screenBoxSelection.startY),
            // 使用统一灰色半透明风格
            border: '2px solid rgba(128, 128, 128, 0.5)',
            backgroundColor: 'rgba(128, 128, 128, 0.12)',
            borderRadius: '0px',
            pointerEvents: 'none',
            zIndex: 1001,
            transition: 'none', // 确保拖拽时没有动画延迟
          }}
          data-screenshot-exclude="true"
        />
      )}

    </div>
  );
  };

  // 🎬 根据enablePlayback决定是否包装播放容器
  const modalComponent = (
    <CanvasSelectionModal
      isVisible={link.modal.isVisible}
      availableCanvases={link.modal.availableCanvases}
      onSelect={link.onSelect}
      onCancel={link.onCancel}
      onCreateCanvas={link.onCreate}
      loading={link.modal.loading}
      currentNodeTitle={link.modal.currentNodeTitle || ''}
    />
  );

  const expandedEditorModal = (
    <ExpandedTextEditorDialog
      open={!!expandedEditorNode}
      node={expandedEditorNode}
      canvasId={canvas.id}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setExpandedEditorNodeId(null);
        }
      }}
      onSave={handleExpandedEditorSave}
    />
  );

  return enablePlayback ? (
    <>
      <PlaybackContainer
        canvas={canvas}
        className="w-full h-full"
        transformRef={transformRef}
        playState={playState}
        {...(onPlayStateChange && { onPlayStateChange })}
      >
        {renderCanvasContent()}
      </PlaybackContainer>
      {/** Settings modal mounted globally in dashboard layout */}
      {modalComponent}
      {expandedEditorModal}
    </>
  ) : (
    <>
      {renderCanvasContent()}
      {/** Settings modal mounted globally in dashboard layout */}
      

      
      {/* 🔗 Canvas Link 选择弹窗 */}
      {modalComponent}
      {expandedEditorModal}
    </>
  );
};

export default InfiniteCanvas;
