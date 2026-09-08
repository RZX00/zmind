// 🎨 Canvas Zustand Store - 高性能状态管理 (扁平化重构版本)
// 提供Canvas状态管理、自动保存、撤销重做等功能，完全适配新的扁平化类型系统

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Canvas, CanvasNode, CanvasConnection } from '../../types/canvas';
import { createEmptyCanvas, getCurrentTimestamp } from '../utils/canvasUtils';
import { calculateTextHeightWithLayout } from '../domain/text-layout/textLayoutService';
import { migrationWorkerService } from '../services/migration-worker.service';
import { NodeIds } from '../utils/nodeIdUtils';
import { getCurrentCanvasRepository } from '../services/canvas-repository-factory.service';
import { debugLog } from '../utils/devLogger';
import { canvasHistoryService, type CanvasHistoryData } from '../services/canvas-history.service';
import { areCanvasEqual } from '../utils/shallowEqual';
import { DEFAULT_PLACEHOLDER_CANVAS_ID } from '../constants';
import {
  DEFAULT_TEXT_LAYOUT_PRESET,
  DEFAULT_TEXT_OPACITY_PRESET,
  applyOpacityToTextStyles,
  getTextLayoutPreset,
  getTextOpacityPreset,
  type TextLayoutPresetId,
  type TextOpacityPresetId
} from '../constants/textNodePresets';
import { canvasCache } from '../cache/canvas-cache';
import {
  CanvasRepositoryError,
  type CanvasMetadata,
  type UpdateCanvasData,
} from '../types/canvas-repository';
import { canvasDraftService, type CanvasDraftEntry } from '../services/canvas-draft.service';
import {
  applyMetadataToCanvas,
  applyMermaidThemeDefaults,
  ensureMermaidThemeForNode,
  migrateAnchorParams,
  shouldMigrateAnchors,
} from '../utils/canvasNormalization';
import { updateDocFromCanvas } from '@/lib/canvas/realtime/canvasYDoc';
import { applyOpsToYDoc } from '@/lib/canvas/realtime/applyOpsToYDoc';
import { CANVAS_REALTIME_INCREMENTAL_SYNC } from '@/lib/canvas/realtime/config';
import { normalizeCanvasOps } from '@/lib/canvas/realtime/opsContract';
import { getCanvasRealtimeAdapter, isCanvasRealtimeLive } from './canvasRealtimeBridge';
import { getCanvasWriteQueue } from '../services/canvas-write-queue';
import { trackEvent } from '@/lib/telemetry';


// 🎯 工具模式类型定义
export type ToolMode = 'select' | 'hand' | 'line' | 'text' | 'code' | 'mermaid' | 'table' | 'todo';

// 🎯 编辑状态类型定义
export interface EditState {
  mode: 'none' | 'node' | 'connection';
  entityId: string | null;
  content: string;
  isActive: boolean;
}

// 🎯 选择状态类型定义
export interface SelectionState {
  nodeIds: Set<string>;
  connectionIds: Set<string>;
  groupId: string | null;
}

// 🎯 视图状态类型定义
export interface ViewState {
  zoom: number;
  isPanningLocked: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  // 画布当前变换（来自 react-zoom-pan-pinch）
  transform: { scale: number; positionX: number; positionY: number };
  // 视口像素尺寸（TransformWrapper容器大小）
  viewport: { width: number; height: number };
  outlineOpen?: boolean;
}

// 🎯 交互状态类型定义
export interface InteractionState {
  toolMode: ToolMode;
  isConnecting: boolean;
  connectionStart: {
    nodeId: string;
    side: 'top' | 'right' | 'bottom' | 'left';
    screenPosition: { x: number; y: number };
  } | null;
  draggingNodeId: string | null;
  dragTargetColumnId: string | null;
}

// 🎯 AI状态类型定义
export interface AIState {
  isProcessing: boolean;
  results: any[];
}

// 🎯 Store状态接口定义（扩展版）
interface CanvasState {
  // 核心状态
  canvas: Canvas;
  currentFileId: string | null;
  isLoading: boolean;
  error: string | null;
  isSwitchingCanvas: boolean;
  pendingCanvasId: string | null;
  pendingCanvasTitle: string | null;
  canvasLoadError: string | null;
  lastSwitchTimestamp: number | null;

  // 🚀 新增：统一选择状态管理
  selections: SelectionState;

  // 🚀 新增：编辑状态机
  editState: EditState;

  // 🚀 新增：视图状态管理
  viewState: ViewState;

  // 🚀 新增：交互状态管理
  interactionState: InteractionState;

  // 🚀 新增：AI状态集成
  aiState: AIState;

  // 历史状态（由服务层管理）
  historyData: CanvasHistoryData | null;

  // 自动保存状态
  isDirty: boolean;
  lastSaved: Date | null;
  autoSaveEnabled: boolean;
  // 🔒 禁用持久化（只读/分享视图等场景防止写入）
  persistenceDisabled: boolean;
  saveState: 'idle' | 'saving' | 'saved' | 'draft' | 'error';
  saveError: string | null;
  lastDraftSavedAt: number | null;
  draftRecovery: CanvasDraftEntry | null;

  // 🔄 兼容性：保留旧接口
  selectedNodeId: string | null; // 从selections.nodeIds派生
}

// 🎯 Store操作接口定义（扩展版）
interface CanvasActions {
  // Canvas文件操作
  createNewCanvas: (title?: string) => Promise<void>;
  openCanvas: (fileId: string) => Promise<void>;
  getAllCanvases: () => Promise<Canvas[]>;
  setCanvas: (canvas: Canvas, fileId?: string) => void;
  updateCanvas: (updates: Partial<Canvas>) => void;
  resetCanvas: () => void;

  // 节点操作
  addNode: (node: CanvasNode) => void;
  updateNode: (nodeId: string, updates: Partial<CanvasNode>) => void;
  /** 细粒度 canvas ops（表格格编辑 / 增删行列等） */
  applyCanvasOps: (ops: any[]) => void;
  updateNodePosition: (nodeId: string, x: number, y: number, updatedAt?: number) => void;
  removeNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => void;

  // 连接操作
  addConnection: (connection: CanvasConnection) => void;
  updateConnection: (connectionId: string, updates: Partial<CanvasConnection>) => void;
  removeConnection: (connectionId: string) => void;


  // 🚀 新增：选择状态管理
  selectNodes: (nodeIds: string[]) => void;
  selectSingleNode: (nodeId: string | null) => void;
  toggleNodeSelection: (nodeId: string) => void;
  selectConnections: (connectionIds: string[]) => void;
  selectGroup: (groupId: string | null) => void;
  clearAllSelections: () => void;

  // 🚀 新增：编辑状态机
  enterEditMode: (mode: 'node' | 'connection', entityId: string, initialContent?: string) => void;
  updateEditContent: (content: string) => void;
  commitEdit: () => void;
  cancelEdit: () => void;

  // 🚀 新增：视图状态管理
  setZoom: (zoom: number) => void;
  setPanningLocked: (locked: boolean) => void;
  updateViewBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
  setTransform: (transform: { scale: number; positionX: number; positionY: number }) => void;
  setViewportSize: (viewport: { width: number; height: number }) => void;
  updateViewState: (partial: Partial<ViewState>) => void;

  // 🚀 新增：交互状态管理
  setToolMode: (mode: ToolMode) => void;
  startConnection: (
    nodeId: string,
    side: 'top' | 'right' | 'bottom' | 'left',
    screenPosition: { x: number; y: number },
  ) => void;
  updateConnectionPosition: (position: { x: number; y: number }) => void;
  commitConnection: (targetNodeId: string, targetSide: string) => void;
  cancelConnection: () => void;
  startNodeDrag: (nodeId: string) => void;
  updateNodeDrag: (targetColumnId: string | null) => void;
  endNodeDrag: () => void;

  // 🚀 新增：AI状态集成
  setAIProcessing: (processing: boolean) => void;
  addAIResult: (result: any) => void;
  clearAIResults: () => void;

  // 🔄 兼容性：保留旧接口
  selectNode: (nodeId: string | null) => void;
  clearSelection: () => void;

  // 历史操作（使用服务层）
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: () => boolean;
  canRedo: () => boolean;
  addToHistory: () => Promise<void>;
  clearHistory: () => void;
  initializeHistory: (canvasId?: string) => Promise<void>;
  // 视图仅用的注水：不触发保存、不标脏
  hydrateCanvasForView: (canvas: Canvas, options?: { setFileId?: string | null }) => void;
  // 切换持久化开关
  setPersistenceDisabled: (disabled: boolean) => void;

  // 保存操作（使用服务层）
  persistDraft: (reason?: string, options?: { force?: boolean }) => void;
  clearDraft: (canvasId?: string) => void;
  setDraftRecovery: (draft: CanvasDraftEntry | null) => void;
  markDirty: () => void;
  markClean: () => void;
  saveCanvas: () => Promise<void>;
  loadCanvas: () => Promise<void>;

  // 加载状态
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  beginCanvasSwitch: (canvasId: string, title?: string | null) => void;
  finishCanvasSwitch: () => void;
  failCanvasSwitch: (error: string) => void;

  // 全局文本节点样式
  setTextOpacityPreset: (preset: TextOpacityPresetId) => void;
  setTextLayoutPreset: (preset: TextLayoutPresetId) => void;
}

// 🎯 完整的Store类型
export type CanvasStore = CanvasState & CanvasActions;

function buildUndoRedoPersistencePayload(canvas: Canvas): UpdateCanvasData {
  const anchors: Record<string, { x: number; y: number }> = {};
  const anchorParams: Record<string, { u: number; v: number }> = {};
  const styles: Record<string, any> = {};
  const groupAttachments: Record<string, string[]> = {};

  for (const connection of canvas.connections || []) {
    const anchor = (connection as any).curveAnchor as
      | { x: number; y: number }
      | undefined;
    if (anchor && typeof anchor.x === 'number' && typeof anchor.y === 'number') {
      anchors[connection.id] = { x: anchor.x, y: anchor.y };
    }

    const params = (connection as any).anchorParams as
      | { u: number; v: number }
      | undefined;
    if (params && typeof params.u === 'number' && typeof params.v === 'number') {
      anchorParams[connection.id] = { u: params.u, v: params.v };
    }

    const appearance = (connection as any).appearance;
    if (appearance && typeof appearance === 'object') {
      styles[connection.id] = appearance;
    }
  }

  for (const node of canvas.nodes || []) {
    const anyNode = node as any;
    if (
      anyNode?.type === 'group' &&
      Array.isArray(anyNode.attachedConnections) &&
      anyNode.attachedConnections.length > 0
    ) {
      groupAttachments[node.id] = [...anyNode.attachedConnections];
    }
  }

  const metadata: CanvasMetadata = {
    ...(canvas.metadata || {}),
    connectionAnchors: anchors,
    connectionAnchorParams: anchorParams,
    connectionStyles: styles,
    groupAttachments,
  };

  return {
    title: canvas.title,
    nodes: canvas.nodes,
    connections: canvas.connections,
    version: canvas.version,
    serverVersion: canvas.serverVersion,
    backgroundColor: canvas.backgroundColor,
    backgroundStyleId: canvas.backgroundStyleId,
    patternColor: canvas.patternColor,
    cornerStyle: canvas.cornerStyle,
    fontStyle: canvas.fontStyle,
    textOpacityPreset: canvas.textOpacityPreset,
    textLayoutPreset: canvas.textLayoutPreset,
    metadata,
  };
}

// 📦 默认状态（扩展版）
const defaultState: CanvasState = {
  canvas: createEmptyCanvas('My Canvas', DEFAULT_PLACEHOLDER_CANVAS_ID),
  currentFileId: null,
  isLoading: false,
  error: null,
  isSwitchingCanvas: false,
  pendingCanvasId: null,
  pendingCanvasTitle: null,
  canvasLoadError: null,
  lastSwitchTimestamp: null,

  // 🚀 新增：统一选择状态
  selections: {
    nodeIds: new Set<string>(),
    connectionIds: new Set<string>(),
    groupId: null,
  },

  // 🚀 新增：编辑状态机
  editState: {
    mode: 'none',
    entityId: null,
    content: '',
    isActive: false,
  },

  // 🚀 新增：视图状态
  viewState: {
    zoom: 100,
    isPanningLocked: false,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    transform: { scale: 1, positionX: 0, positionY: 0 },
    viewport: { width: 0, height: 0 },
    outlineOpen: false,
  },

  // 🚀 新增：交互状态
  interactionState: {
    toolMode: 'select',
    isConnecting: false,
    connectionStart: null,
    draggingNodeId: null,
    dragTargetColumnId: null,
  },

  // 🚀 新增：AI状态
  aiState: {
    isProcessing: false,
    results: [],
  },

  // 历史状态
  historyData: null,

  // 保存状态
  isDirty: false,
  lastSaved: null,
  autoSaveEnabled: true,
  persistenceDisabled: false,
  saveState: 'idle',
  saveError: null,
  lastDraftSavedAt: null,
  draftRecovery: null,

  // 🔄 兼容性：派生状态
  selectedNodeId: null, // 从selections.nodeIds派生
};

// 🔧 工具函数已移除，使用直接的对象展开运算符

// 🔒 防止无限循环的标志
let isAddingToHistory = false;

// 💾 保存调度（节流/防抖混合）
let saveDebounceTimer: NodeJS.Timeout | null = null;
let lastSaveTs = 0;
let saveCanvasInFlight: Promise<void> | null = null;
let saveCanvasQueued = false;
let openRequestSeq = 0;
let openAbortController: AbortController | null = null;
const SAVE_DEBOUNCE_MS = 500; // 文本编辑等
const SAVE_THROTTLE_MS = 200; // 拖拽等高频
const NODE_PATCH_DEBOUNCE_MS = 350;
const NODE_PATCH_IGNORE_KEYS = new Set([
  'x',
  'y',
  'selected',
  'isEditing',
  'localPath',
  'dragging',
  'hovered',
  'tempId',
  'updatedAt',
]);

const DRAFT_THROTTLE_MS = 1000;
let draftWriteTimer: NodeJS.Timeout | null = null;
let pendingDraftCanvas: Canvas | null = null;
let pendingDraftReason: string | undefined;
let lastDraftWriteAt = 0;
const notifiedDrafts = new Set<string>();

const isDraftRecoveryEnabled = () => {
  if (typeof process === 'undefined') return true;
  return process.env.NEXT_PUBLIC_CANVAS_DRAFT_RECOVERY !== 'false';
};

const writeDraftNow = (
  get: () => CanvasStore,
  set: (partial: Partial<CanvasState>) => void,
  reason?: string,
  options?: { canvas?: Canvas | null },
) => {
  if (!isDraftRecoveryEnabled()) return;
  const state = get();
  if (state.persistenceDisabled) return;
  const canvas = options?.canvas || pendingDraftCanvas || state.canvas;
  pendingDraftCanvas = null;
  pendingDraftReason = undefined;
  if (!canvas || !canvas.id) return;
  const entry = canvasDraftService.writeDraft(canvas, { reason });
  if (!entry) return;
  lastDraftWriteAt = entry.savedAt;
  const next: Partial<CanvasState> = {
    lastDraftSavedAt: entry.savedAt,
    saveError: null,
  };
  if (state.saveState !== 'saving' && state.saveState !== 'error') {
    next.saveState = 'draft';
  }
  set(next);
};

const queueDraftPersist = (
  get: () => CanvasStore,
  set: (partial: Partial<CanvasState>) => void,
  reason?: string,
) => {
  if (!isDraftRecoveryEnabled()) return;
  const state = get();
  if (state.persistenceDisabled) return;
  pendingDraftCanvas = state.canvas;
  pendingDraftReason = reason;
  const now = Date.now();
  const elapsed = now - lastDraftWriteAt;
  if (elapsed >= DRAFT_THROTTLE_MS) {
    writeDraftNow(get, set, reason);
    return;
  }
  if (draftWriteTimer) return;
  const wait = Math.max(0, DRAFT_THROTTLE_MS - elapsed);
  draftWriteTimer = setTimeout(() => {
    draftWriteTimer = null;
    writeDraftNow(get, set, pendingDraftReason);
  }, wait);
};

const clearDraftForCanvas = (
  get: () => CanvasStore,
  set: (partial: Partial<CanvasState>) => void,
  canvasId?: string,
) => {
  const state = get();
  const targetId = canvasId || state.currentFileId || state.canvas?.id;
  if (!targetId) return;
  canvasDraftService.clearDraft(targetId);
  const next: Partial<CanvasState> = {
    lastDraftSavedAt: null,
  };
  if (state.draftRecovery?.canvasId === targetId) {
    next.draftRecovery = null;
  }
  if (!state.isDirty && state.saveState !== 'error') {
    next.saveState = 'saved';
  }
  set(next);
};

const maybeSetDraftRecovery = (
  get: () => CanvasStore,
  set: (partial: Partial<CanvasState>) => void,
  canvasId: string,
  canvas: Canvas,
) => {
  if (!isDraftRecoveryEnabled()) return;
  if (!canvasId) return;
  const draft = canvasDraftService.readDraft(canvasId);
  if (!draft) {
    if (get().draftRecovery?.canvasId === canvasId) {
      set({ draftRecovery: null });
    }
    return;
  }
  if (!canvasDraftService.isDraftNewer(draft, canvas)) return;
  if (areCanvasEqual(draft.doc, canvas)) return;
  const next: Partial<CanvasState> = {
    draftRecovery: draft,
    lastDraftSavedAt: draft.savedAt,
  };
  if (get().saveState !== 'saving') {
    next.saveState = 'draft';
  }
  set(next);
  if (!notifiedDrafts.has(draft.canvasId)) {
    notifiedDrafts.add(draft.canvasId);
    trackEvent('canvas.draft.detected', {
      canvasId: draft.canvasId,
      ageMs: Date.now() - (draft.savedAt || Date.now()),
      reason: draft.reason,
    });
  }
};

const markSaveSuccess = (
  get: () => CanvasStore,
  set: (partial: Partial<CanvasState>) => void,
  canvasId?: string,
  options?: { track?: boolean },
) => {
  clearDraftForCanvas(get, set, canvasId);
  set({ saveState: 'saved', saveError: null });
  if (options?.track) {
    const id = canvasId || get().currentFileId || get().canvas?.id;
    if (id) {
      trackEvent('canvas.save.success', { canvasId: id });
    }
  }
};

const markSaveFailed = (
  get: () => CanvasStore,
  set: (partial: Partial<CanvasState>) => void,
  error: unknown,
  canvasId?: string,
) => {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  set({ saveState: 'error', saveError: message });
  writeDraftNow(get, set, 'save_error');
  const id = canvasId || get().currentFileId || get().canvas?.id;
  if (id) {
    trackEvent('canvas.save.failed', { canvasId: id, message });
  }
};

// 仅在极少数场景需要深克隆时使用（保底），优先避免 JSON stringify
const cloneCanvas = (canvas: Canvas): Canvas =>
  typeof structuredClone === 'function' ? structuredClone(canvas) : JSON.parse(JSON.stringify(canvas));

const applyOpsToCanvasModel = (canvas: Canvas, ops: any[]): Canvas => {
  // Lazy shallow-clone to avoid full deep copies on every op
  let nodes = canvas.nodes || [];
  let connections = canvas.connections || [];
  let nodesCloned = false;
  let connectionsCloned = false;
  const clonedNodeIds = new Set<string>();

  const ensureNodesArray = () => {
    if (!nodesCloned) {
      nodes = [...nodes];
      nodesCloned = true;
    }
  };

  const ensureConnectionsArray = () => {
    if (!connectionsCloned) {
      connections = [...connections];
      connectionsCloned = true;
    }
  };

  const getMutableNodeByIndex = (idx: number): CanvasNode | null => {
    if (idx < 0 || idx >= nodes.length) return null;
    ensureNodesArray();
    const existing = nodes[idx];
    if (!existing) return null;
    if (!clonedNodeIds.has(existing.id)) {
      nodes[idx] = { ...existing };
      clonedNodeIds.add(existing.id);
    }
    return nodes[idx];
  };

  const now = Date.now();
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    switch (op.op) {
      case 'update_node': {
        const idx = nodes.findIndex((n) => n.id === op.id);
        const node = getMutableNodeByIndex(idx);
        if (!node) break;
        Object.assign(node, op.patch || {});
        node.updatedAt = now;
        break;
      }
      case 'move_node': {
        const idx = nodes.findIndex((n) => n.id === op.id);
        const node = getMutableNodeByIndex(idx);
        if (!node) break;
        if (typeof op.x === 'number') node.x = op.x;
        if (typeof op.y === 'number') node.y = op.y;
        node.updatedAt = now;
        break;
      }
      case 'delete_node': {
        ensureNodesArray();
        nodes = nodes.filter((n) => n.id !== op.id);
        nodesCloned = true;
        ensureConnectionsArray();
        connections = connections.filter(
          (c) => c.from !== op.id && c.to !== op.id && c.id !== op.id,
        );
        connectionsCloned = true;
        break;
      }
      case 'add_connection': {
        const id = op.id || NodeIds.generateConnectionId(canvas.id);
        ensureConnectionsArray();
        connections.push({
          id,
          from: op.from,
          to: op.to,
          createdAt: now,
          updatedAt: now,
        } as any);
        break;
      }
      case 'delete_connection': {
        ensureConnectionsArray();
        connections = connections.filter((c) => c.id !== op.id);
        connectionsCloned = true;
        break;
      }
      case 'update_table_cell': {
        const idx = nodes.findIndex((n) => n.id === op.id);
        const node = getMutableNodeByIndex(idx);
        if (!node || (node as any).type !== 'table') break;
        const data =
          typeof structuredClone === 'function'
            ? structuredClone((node as any).data || { rows: [] })
            : JSON.parse(JSON.stringify((node as any).data || { rows: [] }));
        const rows = Array.isArray(data.rows) ? data.rows : null;
        const row = Number(op.row);
        const col = Number(op.col);
        if (
          !rows ||
          !Number.isInteger(row) ||
          !Number.isInteger(col) ||
          row < 0 ||
          col < 0 ||
          row >= rows.length ||
          !Array.isArray(rows[row]) ||
          col >= rows[row].length
        ) {
          break;
        }
        rows[row][col] = op.value == null ? '' : String(op.value);
        (node as any).data = data;
        node.updatedAt = now;
        break;
      }
      case 'table_row_op':
      case 'table_col_op': {
        const idx = nodes.findIndex((n) => n.id === op.id);
        const node = getMutableNodeByIndex(idx);
        if (!node || (node as any).type !== 'table') break;
        const action = op.action;
        if (action !== 'insert' && action !== 'delete') break;
        const data =
          typeof structuredClone === 'function'
            ? structuredClone((node as any).data || { rows: [] })
            : JSON.parse(JSON.stringify((node as any).data || { rows: [] }));
        const rows = Array.isArray(data.rows) ? data.rows : null;
        if (!rows) break;
        const index = Number(op.index);
        if (!Number.isInteger(index) || index < 0) break;
        if (op.op === 'table_row_op') {
          const colCount = rows.length
            ? rows[0].length
            : Array.isArray(op.rowData)
              ? op.rowData.length
              : 0;
          if (action === 'insert') {
            if (index > rows.length) break;
            const wasEmpty = rows.length === 0;
            const newRow = Array.from({ length: colCount }, (_, i) => {
              const v = Array.isArray(op.rowData) ? op.rowData[i] : undefined;
              return v == null ? '' : String(v);
            });
            rows.splice(index, 0, newRow);
            if (Array.isArray(data.rowHeights)) {
              data.rowHeights.splice(index, 0, data.rowHeights[0] ?? 40);
            }
            if (wasEmpty && Array.isArray(data.columnWidths)) {
              while (data.columnWidths.length < newRow.length) data.columnWidths.push(160);
            }
          } else {
            if (index >= rows.length) break;
            rows.splice(index, 1);
            if (Array.isArray(data.rowHeights)) data.rowHeights.splice(index, 1);
          }
        } else {
          const colCount = rows.length ? rows[0].length : 0;
          if (action === 'insert') {
            if (rows.length === 0 || index > colCount) break;
            const header = op.header == null ? '' : String(op.header);
            rows.forEach((r: any, i: number) => {
              if (Array.isArray(r)) r.splice(index, 0, i === 0 ? header : '');
            });
            if (Array.isArray(data.columnWidths)) {
              data.columnWidths.splice(index, 0, data.columnWidths[0] ?? 160);
            }
          } else {
            if (index >= colCount) break;
            rows.forEach((r: any) => {
              if (Array.isArray(r)) r.splice(index, 1);
            });
            if (Array.isArray(data.columnWidths)) data.columnWidths.splice(index, 1);
          }
        }
        (node as any).data = data;
        node.updatedAt = now;
        break;
      }
      default:
        break;
    }
  }

  return {
    ...canvas,
    nodes,
    connections,
    updatedAt: now,
  };
};

const applyOpsViaRealtime = (ops: any[], get: () => CanvasStore): boolean => {
  if (!isCanvasRealtimeLive()) return false;
  const adapter = getCanvasRealtimeAdapter();
  if (!adapter) return false;
  if (!CANVAS_REALTIME_INCREMENTAL_SYNC) {
    const state = get();
    const currentCanvas = state.canvas;
    const nextCanvas = applyOpsToCanvasModel(currentCanvas, ops);
    adapter.transact((doc) => {
      updateDocFromCanvas(doc, nextCanvas);
    }, 'ops');
    adapter.notifyLocalEdit?.();
    return true;
  }
  adapter.transact((doc) => {
    applyOpsToYDoc(doc, ops);
  }, 'ops');
  adapter.notifyLocalEdit?.();
  return true;
};

type NodePatchMap = Record<string, Partial<CanvasNode>>;
let pendingNodePatches: NodePatchMap = {};
let nodePatchTimer: NodeJS.Timeout | null = null;
let isFlushingNodePatches = false;
let flushNodePatchesPromise: Promise<void> | null = null;

const scheduleRepositorySave = (get: () => CanvasStore, isThrottled = false) => {
  // 当禁用持久化时，直接跳过保存调度
  try { if (get().persistenceDisabled) return; } catch {}
  const now = Date.now();
  if (isThrottled && now - lastSaveTs < SAVE_THROTTLE_MS) {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
      scheduleRepositorySave(get, false);
    }, SAVE_THROTTLE_MS);
    return;
  }
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    try { await get().saveCanvas(); lastSaveTs = Date.now(); } catch {}
  }, SAVE_DEBOUNCE_MS);
};

const scheduleBackgroundSave = (get: () => CanvasStore) => {
  // Avoid blocking canvas open on migrations; save opportunistically.
  try { if (get().persistenceDisabled) return; } catch {}
  const run = () => { try { void get().saveCanvas().catch(() => {}); } catch {} };
  if (typeof window !== 'undefined') {
    const requestIdle = (window as any).requestIdleCallback as ((cb: () => void, options?: { timeout: number }) => void) | undefined;
    if (typeof requestIdle === 'function') {
      requestIdle(run, { timeout: 2000 });
      return;
    }
  }
  setTimeout(run, 0);
};

const isPlainObject = (value: unknown): value is Record<string, any> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const mergeNestedObjects = (target: any, source: any) => {
  if (!isPlainObject(source)) return source;
  const base = isPlainObject(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(source)) {
    if (isPlainObject(v)) {
      base[k] = mergeNestedObjects(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
};

const sanitizeNodePatch = (updates: Partial<CanvasNode>): Partial<CanvasNode> | null => {
  if (!updates) return null;
  const patch: Record<string, any> = {};
  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined || NODE_PATCH_IGNORE_KEYS.has(key)) {
      return;
    }
    if (key === 'textStyles' && isPlainObject(value)) {
      patch.textStyles = mergeNestedObjects(patch.textStyles, value);
      return;
    }
    if (key === 'shapeDecoration' && isPlainObject(value)) {
      patch.shapeDecoration = mergeNestedObjects(patch.shapeDecoration, value);
      return;
    }
    if (key === 'metadata' && isPlainObject(value)) {
      patch.metadata = mergeNestedObjects(patch.metadata, value);
      return;
    }
    patch[key] = value;
  });
  return Object.keys(patch).length ? patch : null;
};

const scheduleNodePatchPersist = (
  get: () => CanvasStore,
  set: (partial: Partial<CanvasState>) => void,
  nodeId: string,
  updates: Partial<CanvasNode>,
) => {
  try {
    const state = get();
    if (state.isSwitchingCanvas) {
      if (pendingNodePatches[nodeId]) delete pendingNodePatches[nodeId];
      return;
    }
  } catch {}
  const patch = sanitizeNodePatch(updates);
  if (!patch) return;
  const current = pendingNodePatches[nodeId];
  pendingNodePatches[nodeId] = current ? mergeNestedObjects(current, patch) : patch;
  if (nodePatchTimer) clearTimeout(nodePatchTimer);
  nodePatchTimer = setTimeout(() => {
    void flushNodePatches(get, set);
  }, NODE_PATCH_DEBOUNCE_MS);
  queueDraftPersist(get, set, 'edit');
};

const flushNodePatches = (
  get: () => CanvasStore,
  set: (partial: Partial<CanvasState>) => void,
): Promise<void> => {
  if (flushNodePatchesPromise) {
    return flushNodePatchesPromise;
  }

  flushNodePatchesPromise = (async () => {
    try {
      const state = get();
      if (state.isSwitchingCanvas) {
        pendingNodePatches = {};
        if (nodePatchTimer) {
          clearTimeout(nodePatchTimer);
          nodePatchTimer = null;
        }
        return;
      }
    } catch {}

    if (!Object.keys(pendingNodePatches).length) return;

    const patches = pendingNodePatches;
    pendingNodePatches = {};
    isFlushingNodePatches = true;

    try {
      const state = get();
      const fileId = state.currentFileId || state.canvas.id;
      if (!fileId) {
        pendingNodePatches = { ...patches, ...pendingNodePatches };
        return;
      }
      const ops = Object.entries(patches)
        .map(([id, patch]) => (Object.keys(patch).length ? ({ op: 'update_node', id, patch } as any) : null))
        .filter(Boolean);
      if (!ops.length) {
        return;
      }

      const usedRealtime = state.persistenceDisabled && applyOpsViaRealtime(ops as any[], get);
      if (usedRealtime) return;
      if (state.persistenceDisabled) {
        pendingNodePatches = { ...patches, ...pendingNodePatches };
        return;
      }

      await persistQueuedOps(get, set, ops as any[]);
    } catch (error) {
      console.error('[CanvasStore] flushNodePatches failed:', error);
      markSaveFailed(get, set, error, get().currentFileId || get().canvas?.id);
    } finally {
      isFlushingNodePatches = false;
    }
  })().finally(() => {
    flushNodePatchesPromise = null;
  });

  return flushNodePatchesPromise;
};

const ackQueuedWrite = (
  result: { canvas?: Canvas; serverVersion?: number } | Canvas | null | undefined,
  fileId: string,
  get: () => CanvasStore,
  set: (partial: Partial<CanvasState>) => void,
) => {
  const remote = (result as any)?.canvas || result;
  const version =
    typeof (result as any)?.serverVersion === 'number'
      ? (result as any).serverVersion
      : typeof remote?.serverVersion === 'number'
        ? remote.serverVersion
        : undefined;
  if (typeof version === 'number') {
    getCanvasWriteQueue(fileId).acknowledge(version);
  }
  const current = get().canvas;
  const queueBusy =
    getCanvasWriteQueue(fileId).inFlight > 1 || Object.keys(pendingNodePatches).length > 0;
  if (queueBusy || !remote?.id) {
    if (typeof version === 'number') {
      set({
        canvas: {
          ...current,
          serverVersion: version,
          updatedAt: remote?.updatedAt ?? current.updatedAt,
        } as Canvas,
      });
    }
    markSaveSuccess(get, set, fileId);
    return;
  }
  if (remote.id === fileId) {
    const themed = applyMermaidThemeDefaults(remote);
    set({ canvas: themed, isDirty: false, lastSaved: new Date(themed.updatedAt) });
    syncRealtimeSnapshotIfNeeded(themed, get, { force: true });
    markSaveSuccess(get, set, fileId);
  }
};

const persistQueuedOps = (
  get: () => CanvasStore,
  set: (partial: Partial<CanvasState>) => void,
  ops: any[],
): Promise<void> => {
  if (!Array.isArray(ops) || ops.length === 0) return Promise.resolve();
  const state = get();
  if (state.persistenceDisabled) return Promise.resolve();
  const fileId = state.currentFileId || state.canvas.id;
  if (!fileId) return Promise.resolve();
  const baseVersion = state.canvas.serverVersion;
  if (typeof baseVersion !== 'number') {
    const error = new CanvasRepositoryError('serverVersion missing for applyOps', 'INVALID_DATA');
    markSaveFailed(get, set, error, fileId);
    return Promise.reject(error);
  }
  const repository = getCurrentCanvasRepository();
  const queue = getCanvasWriteQueue(fileId);
  queue.acknowledge(baseVersion);
  return queue
    .enqueueApply({
      canvasId: fileId,
      ops,
      fallbackVersion: baseVersion,
      apply: (nextOps, version, key) =>
        (repository as any).applyOps(fileId, nextOps, version, key),
    })
    .then((res) => {
      ackQueuedWrite(res as any, fileId, get, set);
    })
    .catch((error) => {
      console.error('[CanvasStore] persistQueuedOps failed:', error);
      markSaveFailed(get, set, error, fileId);
      throw error;
    });
};

const syncRealtimeDocFromCanvas = (canvas?: Canvas | null): boolean => {
  if (!canvas) return false;
  if (!isCanvasRealtimeLive()) return false;
  const adapter = getCanvasRealtimeAdapter();
  if (!adapter) return false;
  adapter.transact((doc) => {
    updateDocFromCanvas(doc, canvas);
  }, 'zustand-store');
  adapter.notifyLocalEdit?.();
  return true;
};

const syncRealtimeSnapshotIfNeeded = (
  canvas: Canvas | null | undefined,
  get: () => CanvasStore,
  options: { force?: boolean } = {},
): boolean => {
  if (!canvas) return false;
  if (!options.force && CANVAS_REALTIME_INCREMENTAL_SYNC && get().persistenceDisabled) {
    return false;
  }
  return syncRealtimeDocFromCanvas(canvas);
};

// 🕰️ 防抖工具函数
const debounce = <T extends (...args: any[]) => any>(
  func: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  let timeoutId: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
};

// 📊 防抖的历史记录添加函数
let debouncedAddToHistoryFn: (() => void) | null = null;

// 🚀 批处理状态更新队列
interface BatchUpdate {
  type: 'node' | 'connection' | 'canvas';
  nodeId?: string;
  connectionId?: string;
  updates: any;
}

let batchQueue: BatchUpdate[] = [];
let batchTimer: NodeJS.Timeout | null = null;

// 🎨 创建Canvas Store - 集成服务层存储 (扁平化重构版本)
export const useCanvasStore = create<CanvasStore>()(
  devtools(
    (set, get) => ({
      ...defaultState,

      // ==================== Canvas操作 ====================
      
      // 初始化方法 - 加载Canvas和历史数据
      initializeHistory: async (canvasId?: string) => {
        try {
          const state = get();
          const targetCanvasId = canvasId || state.canvas?.id;
          if (!targetCanvasId) return;

          // 加载现有历史（全局存储，旧实现）
          const loaded = await canvasHistoryService.loadHistory();

          if (loaded && loaded.canvasId === targetCanvasId) {
            // 历史与当前画布一致
            set({ historyData: loaded });
            return;
          }

          // 历史缺失或属于其它画布：基于当前画布创建新的首条历史
          const currentCanvas = state.canvas;
          if (currentCanvas && currentCanvas.id === targetCanvasId) {
            const newHistoryData = canvasHistoryService.addToHistory(currentCanvas, [], -1);
            await canvasHistoryService.saveHistory(newHistoryData);
            set({ historyData: newHistoryData });
          }
        } catch (_err) {
          set({ error: '初始化历史记录失败' });
        }
      },

      // ==================== Canvas文件操作 ====================
      
      // 只读视图注水：不触发保存、不标脏
      hydrateCanvasForView: (input: Canvas, options?: { setFileId?: string | null }) => {
        try {
          const cleaned = (() => {
            const c = { ...input } as Canvas;
            if (typeof (c as any).createdAt !== 'number') (c as any).createdAt = Date.now();
            if (typeof (c as any).updatedAt !== 'number') (c as any).updatedAt = Date.now();
            return c;
          })();
          const normalized = applyMetadataToCanvas(cleaned);
          const migration = migrateAnchorParams(normalized);
          const now = getCurrentTimestamp();
          const hydratedCanvas = applyMermaidThemeDefaults({ ...migration.out, updatedAt: now });
          set((state) => ({
            canvas: hydratedCanvas,
            currentFileId: options?.setFileId ?? state.currentFileId,
            isDirty: false,
            saveState: 'saved',
            saveError: null,
            isLoading: false,
            error: null,
            persistenceDisabled: true,
          }));
          try { NodeIds.initialize(cleaned.id, hydratedCanvas.nodes, hydratedCanvas.connections); } catch {}
        } catch {}
      },

      setPersistenceDisabled: (disabled: boolean) => {
        const wasDisabled = get().persistenceDisabled;
        set({ persistenceDisabled: disabled });
        if (wasDisabled && !disabled) {
          try { void flushNodePatches(get, set); } catch {}
        }
      },

      createNewCanvas: async (title = 'New Canvas') => {
        try {
          set({ isLoading: true, error: null });
          
          const repository = getCurrentCanvasRepository();
          const newCanvas = createEmptyCanvas(title);
          const entity = await repository.create({
            title: newCanvas.title,
            nodes: newCanvas.nodes,
            connections: newCanvas.connections,
            textOpacityPreset: newCanvas.textOpacityPreset,
            textLayoutPreset: newCanvas.textLayoutPreset
          });
          
          const createdCanvas = applyMermaidThemeDefaults({
            ...entity,
            textOpacityPreset: entity.textOpacityPreset ?? newCanvas.textOpacityPreset,
            textLayoutPreset: entity.textLayoutPreset ?? newCanvas.textLayoutPreset
          });
          set({
            canvas: createdCanvas,
            currentFileId: entity.id,
            isDirty: false,
            saveState: 'saved',
            saveError: null,
            lastSaved: new Date(),
            isLoading: false
          });
          syncRealtimeSnapshotIfNeeded(createdCanvas, get, { force: true });
          markSaveSuccess(get, set, entity.id, { track: true });
          try {
            canvasCache.set(entity.id, {
              canvas: entity,
              version: String(entity.version || '1.0.0'),
              updatedAt: entity.updatedAt || Date.now(),
              lastVerifiedAt: Date.now(),
            });
          } catch {}
          try { localStorage.setItem('last_canvas_id', entity.id); } catch {}
          
          // 初始化节点计数器（新Canvas从空开始）
          NodeIds.initialize(entity.id, entity.nodes, entity.connections);
          
          // 重置历史记录
          const newHistoryData = canvasHistoryService.addToHistory(entity, [], -1);
          await canvasHistoryService.saveHistory(newHistoryData);
          set({ historyData: newHistoryData });
          
        } catch (error) {
          set({ 
            error: 'Failed to create canvas: ' + (error as Error).message,
            isLoading: false 
          });
        }
      },

      openCanvas: async (fileId: string) => {
        const requestId = ++openRequestSeq;
        if (openAbortController) {
          try { openAbortController.abort(); } catch {}
        }
        openAbortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const isStale = () => requestId !== openRequestSeq;
        try {
          const { beginCanvasSwitch } = get();
          beginCanvasSwitch(fileId);
          set({ isLoading: true, error: null });

          const repository = getCurrentCanvasRepository();
          const entity = await repository.findById(fileId, { signal: openAbortController?.signal });

          if (isStale()) {
            return;
          }

          if (!entity) {
            throw new Error('File not found');
          }

          // 轻量化打开路径：先注入基础数据，重清理/迁移延后处理
          const hasGroups = Array.isArray((entity as any).nodes) && (entity as any).nodes.some((n: any) => (n as any).type === 'group');
          const metadataApplied = applyMetadataToCanvas(entity as Canvas);
          const needMigrate = shouldMigrateAnchors(metadataApplied);
          const shouldDeferMigration = hasGroups || needMigrate;

          let mergedSanitized: Canvas = metadataApplied as Canvas;
          let migrated = 0;
          if (!shouldDeferMigration) {
            const r = needMigrate ? migrateAnchorParams(metadataApplied) : ({ out: metadataApplied, migrated: 0 } as any);
            mergedSanitized = r.out as Canvas;
            migrated = r.migrated as number;
          }

          if (isStale()) {
            return;
          }

          set({
            canvas: mergedSanitized,
            currentFileId: entity.id,
            isDirty: false,
            saveState: 'saved',
            saveError: null,
            lastSaved: new Date((mergedSanitized as any).updatedAt || entity.updatedAt),
            isLoading: false
          });
          syncRealtimeSnapshotIfNeeded(mergedSanitized, get, { force: true });
          maybeSetDraftRecovery(get, set, entity.id, mergedSanitized);
          try {
            canvasCache.set(entity.id, {
              canvas: mergedSanitized,
              version: String((mergedSanitized as any).version || entity.version || '1.0.0'),
              updatedAt: mergedSanitized.updatedAt || entity.updatedAt || Date.now(),
              lastVerifiedAt: Date.now(),
            });
          } catch {}
          // 成功打开后：允许持久化，写入只读快照用于失败回退
          try { get().setPersistenceDisabled(false); } catch {}
          try { localStorage.setItem(`canvas_snapshot:${entity.id}`, JSON.stringify(mergedSanitized)); } catch {}
          // 若发生迁移，后台保存一次，避免阻塞打开体验
          try { if (migrated > 0) scheduleBackgroundSave(get); } catch {}
          try { localStorage.setItem('last_canvas_id', entity.id); } catch {}

          // 初始化节点计数器，基于现有节点ID
          NodeIds.initialize(entity.id, mergedSanitized.nodes, mergedSanitized.connections);

          if (shouldDeferMigration) {
            const openedUpdatedAt = mergedSanitized.updatedAt;
            const openedVersion = (mergedSanitized as any).version;
            void (async () => {
              try {
                const res = await migrationWorkerService.migrate(metadataApplied as Canvas);
                if (isStale()) return;
                if (!res.migrated && !res.groupsCleaned) return;
                const current = get().canvas;
                if (!current || current.id !== entity.id) return;
                if (get().isDirty) return;
                if (
                  (typeof openedUpdatedAt === 'number' && current.updatedAt !== openedUpdatedAt) ||
                  (openedVersion && (current as any).version !== openedVersion)
                ) {
                  return;
                }
                const updatedCanvas = applyMermaidThemeDefaults({
                  ...(metadataApplied as any),
                  nodes: res.nodes,
                  connections: res.connections,
                }) as Canvas;
                set({
                  canvas: updatedCanvas,
                  isDirty: false,
                  lastSaved: new Date((updatedCanvas as any).updatedAt || entity.updatedAt),
                });
                syncRealtimeSnapshotIfNeeded(updatedCanvas, get, { force: true });
                try {
                  canvasCache.set(entity.id, {
                    canvas: updatedCanvas,
                    version: String((updatedCanvas as any).version || entity.version || '1.0.0'),
                    updatedAt: updatedCanvas.updatedAt || entity.updatedAt || Date.now(),
                    lastVerifiedAt: Date.now(),
                  });
                } catch {}
                try { localStorage.setItem(`canvas_snapshot:${entity.id}`, JSON.stringify(updatedCanvas)); } catch {}
                try { NodeIds.initialize(updatedCanvas.id, updatedCanvas.nodes, updatedCanvas.connections); } catch {}
                try { scheduleBackgroundSave(get); } catch {}
              } catch {}
            })();
          }

          // 加载/初始化对应画布的历史（旧实现为全局存储，这里按画布切换）
          const historyData = await canvasHistoryService.loadHistory();
          if (isStale()) {
            return;
          }
          if (historyData && historyData.canvasId === entity.id) {
            set({ historyData });
          } else {
            const newHistoryData = canvasHistoryService.addToHistory(mergedSanitized, [], -1);
            await canvasHistoryService.saveHistory(newHistoryData);
            if (isStale()) {
              return;
            }
            set({ historyData: newHistoryData });
          }

          if (isStale()) {
            return;
          }
          get().finishCanvasSwitch();

        } catch (error) {
          if (isStale()) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          // 本地快照回退
          let recovered = false;
          try {
            const raw = (typeof window !== 'undefined') ? localStorage.getItem(`canvas_snapshot:${fileId}`) : null;
            if (raw) {
              const snap = JSON.parse(raw);
              try { get().setPersistenceDisabled(true); } catch {}
              try { get().hydrateCanvasForView(snap as Canvas, { setFileId: fileId }); } catch {}
              set({ isLoading: false, error: null });
              try { maybeSetDraftRecovery(get, set, fileId, snap as Canvas); } catch {}
              if (isStale()) {
                return;
              }
              get().finishCanvasSwitch();
              recovered = true;
            }
          } catch {}
          if (!recovered) {
            if (isStale()) {
              return;
            }
            set({
              error: 'Failed to open file: ' + message,
              isLoading: false
            });
            get().failCanvasSwitch(message || 'Unknown error');
          }
        }
      },

      getAllCanvases: async () => {
        try {
          const repository = getCurrentCanvasRepository();
          return await repository.findAll({
            order_by: 'updatedAt',
            order_direction: 'desc'
          });
        } catch (error) {
          console.error('Failed to fetch canvas list:', error);
          return [];
        }
      },
        
      setCanvas: (canvas: Canvas, fileId?: string) => {
        const currentState = get();
        
        // 🚀 使用高性能浅比较替代JSON.stringify - 性能提升95%
        const isEqual = areCanvasEqual(currentState.canvas, canvas);
        
        if (isEqual) {
          return; // 如果canvas没有变化，直接返回
        }
        
        // 🧹 设置前清理一次群组数据，避免悬挂children/空组/失效root
        const sanitized = (function sanitizeCanvasGroups(input: Canvas): Canvas {
          try {
            const now = getCurrentTimestamp();
            const nodes = Array.isArray(input.nodes) ? [...input.nodes] : [];
            const byId = new Map<string, CanvasNode>(nodes.map(n => [n.id, n]));

            const groupsToRemove = new Set<string>();
            const updatedNodesStep1 = nodes.map((n) => {
              if ((n as any).type !== 'group') return n;
              const g = { ...(n as any) } as CanvasNode;
              const raw = Array.isArray(g.children) ? (g.children as string[]) : [];
              const seen = new Set<string>();
              const cleaned = raw.filter((cid) => {
                if (!cid || seen.has(cid)) return false;
                seen.add(cid);
                return byId.has(cid) && cid !== g.id;
              });
              if (cleaned.length === 0) {
                groupsToRemove.add(g.id);
                return g;
              }
              if ((g as any).mindmap) {
                const meta = (g as any).mindmap as any;
                if (!cleaned.includes(meta?.rootId)) {
                  const memberSet = new Set(cleaned);
                  const edges = (input.connections || []).filter(e => memberSet.has(e.from) && memberSet.has(e.to));
                  const inDeg = new Map<string, number>();
                  cleaned.forEach(id => inDeg.set(id, 0));
                  edges.forEach(e => inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1));
                  const candidates = cleaned.filter(id => (inDeg.get(id) || 0) === 0);
                  const pool = (candidates.length ? candidates : cleaned)
                    .map(id => byId.get(id)!)
                    .filter(Boolean);
                  pool.sort((a, b) => {
                    const ca = a.createdAt || 0, cb = b.createdAt || 0;
                    if (ca !== cb) return ca - cb;
                    if (a.x !== b.x) return a.x - b.x;
                    if (a.y !== b.y) return a.y - b.y;
                    return (a.title || a.content || '').localeCompare(b.title || b.content || '');
                  });
                  const newRoot = pool[0]?.id;
                  (g as any).mindmap = { ...meta, rootId: newRoot };
                  g.updatedAt = now;
                }
              }
              (g as any).children = cleaned;
              return g;
            });

            const survivors = updatedNodesStep1.filter(n => !(groupsToRemove.has(n.id) && (n as any).type === 'group'));
            const survivorGroupIds = new Set<string>(survivors.filter(n => (n as any).type === 'group').map(n => n.id));
            const updatedNodesStep2 = survivors.map(n => {
              const p = (n as any).parentGroupId as string | undefined;
              if (!p) return n;
              if (!survivorGroupIds.has(p)) {
                const { parentGroupId: _omit, ...rest } = (n as any);
                return { ...(rest as any), updatedAt: now } as CanvasNode;
              }
              return n;
            });

            const connections = Array.isArray(input.connections) ? input.connections : [];
            let connectionsChanged = false;
            const cleanedConnections = connections.map((c) => {
              const anyC = c as any;
              if (anyC?.fromPoint && anyC?.toPoint && (anyC.from != null || anyC.to != null)) {
                connectionsChanged = true;
                const { from: _from, to: _to, ...rest } = anyC;
                return rest as any;
              }
              return c;
            });

            return {
              ...input,
              nodes: updatedNodesStep2,
              connections: connectionsChanged ? cleanedConnections : connections,
              updatedAt: now,
            } as Canvas;
          } catch {
            return input;
          }
        })(canvas);

        const normalizedCanvas = {
          ...sanitized,
          textOpacityPreset: sanitized.textOpacityPreset ?? DEFAULT_TEXT_OPACITY_PRESET,
          textLayoutPreset: sanitized.textLayoutPreset ?? DEFAULT_TEXT_LAYOUT_PRESET
        };
        const themedCanvas = applyMermaidThemeDefaults(normalizedCanvas);

        set({
          canvas: themedCanvas,
          currentFileId: fileId || currentState.currentFileId,
          isDirty: true,
          error: null,
        });
        syncRealtimeSnapshotIfNeeded(themedCanvas, get, { force: true });
        queueDraftPersist(get, set, 'edit');

        // 初始化节点计数器，基于清理后的节点/连接
        NodeIds.initialize(themedCanvas.id, themedCanvas.nodes, themedCanvas.connections);
        
        // 调度保存（防抖）
        scheduleRepositorySave(get, false);
        
        // 🕰️ 防抖添加历史记录
        if (!debouncedAddToHistoryFn) {
          debouncedAddToHistoryFn = debounce(async () => {
            try {
              const currentState = get();
              if (!isAddingToHistory && currentState.historyData) {
                await currentState.addToHistory();
              }
            } catch (error) {
              set({ error: 'Failed to add history entry' });
            }
          }, 500);
        }
        debouncedAddToHistoryFn();
      },

      updateCanvas: (updates: Partial<Canvas>) => {
        const currentState = get();
        if (currentState.isSwitchingCanvas && currentState.persistenceDisabled) {
          return;
        }
        const updatedCanvas = applyMermaidThemeDefaults({
          ...currentState.canvas,
          ...updates,
          updatedAt: getCurrentTimestamp(),  // use numeric timestamp
        });
        set({
          canvas: updatedCanvas,
          isDirty: true,
        });
        const hasStructuralUpdates =
          Object.prototype.hasOwnProperty.call(updates, 'nodes') ||
          Object.prototype.hasOwnProperty.call(updates, 'connections');
        const updateOp = { op: 'update_canvas', patch: { ...updates } } as any;
        const shouldUseRealtimeOps = get().persistenceDisabled && !hasStructuralUpdates;
        const usedRealtime = shouldUseRealtimeOps && applyOpsViaRealtime([updateOp], get);
        if (!usedRealtime) {
          syncRealtimeSnapshotIfNeeded(updatedCanvas, get, { force: hasStructuralUpdates });
        }
        queueDraftPersist(get, set, 'edit');
        // Debounced history entry
        if (debouncedAddToHistoryFn) {
          debouncedAddToHistoryFn();
        }
        // Regular update: debounce save
        scheduleRepositorySave(get, false);
      },

      resetCanvas: () => {
        const newCanvas = applyMermaidThemeDefaults(createEmptyCanvas('New Canvas'));
        set({
          canvas: newCanvas,
          selectedNodeId: null,
          isDirty: true,
          error: null,
        });
        syncRealtimeSnapshotIfNeeded(newCanvas, get, { force: true });
        queueDraftPersist(get, set, 'edit');
      },

      // ==================== 节点操作 (扁平化结构) ====================
      addNode: (node: CanvasNode) => {
        const currentState = get();
        const now = getCurrentTimestamp();
        const nodeWithTheme = ensureMermaidThemeForNode(node, currentState.canvas.nodes);
        const nodeWithId = { 
          ...nodeWithTheme, 
          id: node.id || NodeIds.generateNodeId(currentState.canvas.id, node.type),
          createdAt: now,
          updatedAt: now 
        };
        // Optimistic local update
        const optimisticCanvas = applyMermaidThemeDefaults({
          ...currentState.canvas,
          nodes: [...currentState.canvas.nodes, nodeWithId],
          updatedAt: now,
        });
        set({
          canvas: optimisticCanvas,
          isDirty: true,
        });
        const addOp = { op: 'add_node', node: { ...nodeWithId } } as any;
        const usedRealtime = get().persistenceDisabled && applyOpsViaRealtime([addOp], get);
        if (!usedRealtime) {
          syncRealtimeSnapshotIfNeeded(optimisticCanvas, get);
        }
        queueDraftPersist(get, set, 'edit');
        void persistQueuedOps(get, set, [addOp]).catch(() => {});
      },

      updateNode: (nodeId: string, updates: Partial<CanvasNode>) => {
        debugLog('🎯 Zustand updateNode 被调用', { nodeId, updates }, 'CanvasStore');
        try {
          const guardState = get();
          if (guardState.isSwitchingCanvas && guardState.persistenceDisabled) {
            return;
          }
        } catch {}
        
        // 🚀 对于频繁的位置更新（拖拽），使用批处理优化
        // 样式更新需要即时显示，不能延迟批处理
        const isFrequentUpdate = (Object.prototype.hasOwnProperty.call(updates, 'x') || Object.prototype.hasOwnProperty.call(updates, 'y'))
          && !Object.prototype.hasOwnProperty.call(updates, 'textStyles')
          && !Object.prototype.hasOwnProperty.call(updates, 'shapeDecoration');
        
        if (isFrequentUpdate) {
          // 将更新添加到批处理队列
          batchQueue.push({ type: 'node', nodeId, updates });
          
          // 防抖批处理执行
          if (batchTimer) clearTimeout(batchTimer);
          batchTimer = setTimeout(() => {
            const currentState = get();
            let hasChanges = false;
            const updatedNodes = [...currentState.canvas.nodes];
            const now = getCurrentTimestamp();
            const ops: any[] = [];
            
            // 批量处理队列中的所有更新
            for (const batchUpdate of batchQueue) {
              if (batchUpdate.type === 'node' && batchUpdate.nodeId) {
                const nodeIndex = updatedNodes.findIndex(n => n.id === batchUpdate.nodeId);
                if (nodeIndex !== -1) {
                  updatedNodes[nodeIndex] = {
                    ...updatedNodes[nodeIndex],
                    ...batchUpdate.updates,
                    updatedAt: (batchUpdate.updates as Partial<CanvasNode>)?.updatedAt ?? now
                  };
                  hasChanges = true;
                  ops.push({
                    op: 'update_node',
                    id: batchUpdate.nodeId,
                    patch: {
                      ...batchUpdate.updates,
                      updatedAt: (batchUpdate.updates as Partial<CanvasNode>)?.updatedAt ?? now,
                    },
                  });
                }
              }
            }
            
            if (hasChanges) {
              const updatedCanvas = {
                ...currentState.canvas,
                nodes: updatedNodes,
                updatedAt: now,
              };
              
              set({
                canvas: updatedCanvas,
                isDirty: true,
              });

              const usedRealtime = get().persistenceDisabled && ops.length > 0 && applyOpsViaRealtime(ops, get);
              if (!usedRealtime) {
                syncRealtimeSnapshotIfNeeded(updatedCanvas, get);
              }
              queueDraftPersist(get, set, 'drag');
            }
            
            // 清空批处理队列
            batchQueue = [];
            batchTimer = null;
          }, 16); // 60fps 的批处理间隔
          
          return; // 批处理模式，直接返回
        }
        
        // 🎯 非频繁更新（内容变更等）仍使用即时更新
        const currentState = get();
        const nodeIndex = currentState.canvas.nodes.findIndex(n => n.id === nodeId);
        debugLog('📍 找到节点索引', nodeIndex, 'CanvasStore');
        if (nodeIndex !== -1) {
          const now = getCurrentTimestamp();
          const updatedNodes = [...currentState.canvas.nodes];
          const mergedNode = {
            ...updatedNodes[nodeIndex],
            ...updates
          } as CanvasNode;
          mergedNode.updatedAt = updates.updatedAt ?? now;
          updatedNodes[nodeIndex] = mergedNode;
          const updatedCanvas = {
            ...currentState.canvas,
            nodes: updatedNodes,
            updatedAt: now,  // 更新画布时间戳
          };
        set({
          canvas: updatedCanvas,
          isDirty: true,
        });
        const updateOp = {
          op: 'update_node',
          id: nodeId,
          patch: { ...updates, updatedAt: mergedNode.updatedAt },
        } as any;
        const usedRealtime = get().persistenceDisabled && applyOpsViaRealtime([updateOp], get);
        if (!usedRealtime) {
          syncRealtimeSnapshotIfNeeded(updatedCanvas, get);
        }
        queueDraftPersist(get, set, 'edit');
        if (!get().persistenceDisabled) {
          scheduleNodePatchPersist(get, set, nodeId, updates);
        }
        
        // 使用防抖机制（编辑内容常常连续变化）
        if (debouncedAddToHistoryFn) {
          debouncedAddToHistoryFn();
        }
        } else {
          debugLog('❌ 未找到节点', nodeId, 'CanvasStore');
        }
      },

      applyCanvasOps: (ops: any[]) => {
        try {
          const guardState = get();
          if (guardState.isSwitchingCanvas && guardState.persistenceDisabled) {
            return;
          }
        } catch {}
        if (!Array.isArray(ops) || ops.length === 0) return;
        const { operations } = normalizeCanvasOps(ops.map((op) => ({ ...op })));
        if (!operations.length) return;

        const currentState = get();
        const nextCanvas = applyOpsToCanvasModel(currentState.canvas, operations);
        set({ canvas: nextCanvas, isDirty: true });

        const usedRealtime =
          currentState.persistenceDisabled && applyOpsViaRealtime(operations, get);
        if (!usedRealtime) {
          syncRealtimeSnapshotIfNeeded(nextCanvas, get);
        }
        queueDraftPersist(get, set, 'edit');
        void persistQueuedOps(get, set, operations).catch(() => {});

        if (debouncedAddToHistoryFn) {
          debouncedAddToHistoryFn();
        }
      },

      updateNodePosition: (nodeId: string, x: number, y: number, updatedAt?: number) => {
        try {
          const state = get();
          const idx = state.canvas.nodes.findIndex((n) => n.id === nodeId);
          if (idx === -1) return;
          const now = typeof updatedAt === 'number' ? updatedAt : getCurrentTimestamp();
          const nodes = [...state.canvas.nodes];
          nodes[idx] = { ...(nodes[idx] as any), x, y, updatedAt: now } as CanvasNode;
          const updatedCanvas = { ...state.canvas, nodes, updatedAt: now };
          set({ canvas: updatedCanvas, isDirty: true });
          const moveOp = { op: 'move_node', id: nodeId, x, y } as any;
          const usedRealtime = get().persistenceDisabled && applyOpsViaRealtime([moveOp], get);
          if (!usedRealtime) {
            syncRealtimeSnapshotIfNeeded(updatedCanvas, get);
          }
          queueDraftPersist(get, set, 'drag');
          scheduleRepositorySave(get, true);
        } catch {}
      },

      removeNode: (nodeId: string) => {
        const currentState = get();
        const now = getCurrentTimestamp();
        // 1) 移除节点与相关连线
        let updatedNodes = currentState.canvas.nodes.filter(n => n.id !== nodeId);
        const updatedConnections = currentState.canvas.connections.filter(
          c => c.from !== nodeId && c.to !== nodeId
        );

        // 2) 同步清理群组成员与空组
        const idSet = new Set(updatedNodes.map(n => n.id));
        const groupsToRemove = new Set<string>();
        updatedNodes = updatedNodes.map((n) => {
          if ((n as any).type !== 'group') return n;
          const g = { ...(n as any) } as CanvasNode;
          const cleaned = ((g as any).children || []).filter((cid: string) => cid && cid !== nodeId && idSet.has(cid));
          (g as any).children = cleaned;
          if (cleaned.length === 0) groupsToRemove.add(g.id);

          // 思维导图 root 若被删，尝试校正到仍存在的成员
          if ((g as any).mindmap && cleaned.length > 0) {
            const meta = (g as any).mindmap as any;
            if (!cleaned.includes(meta?.rootId)) {
              const pool = cleaned.map(id => updatedNodes.find(nn => nn.id === id)!).filter(Boolean);
              pool.sort((a, b) => {
                const ca = a.createdAt || 0, cb = b.createdAt || 0;
                if (ca !== cb) return ca - cb;
                if (a.x !== b.x) return a.x - b.x;
                if (a.y !== b.y) return a.y - b.y;
                return (a.title || a.content || '').localeCompare(b.title || b.content || '');
              });
              const newRoot = pool[0]?.id;
              (g as any).mindmap = { ...meta, rootId: newRoot };
              g.updatedAt = now;
            }
          }
          return g;
        }).filter(n => !(groupsToRemove.has(n.id) && (n as any).type === 'group'));

        // 3) 清理节点的 parentGroupId：若父组被删除则去掉引用
        const aliveGroups = new Set(updatedNodes.filter(n => (n as any).type === 'group').map(n => n.id));
        updatedNodes = updatedNodes.map(n => {
          const p = (n as any).parentGroupId as string | undefined;
          if (!p) return n;
          if (!aliveGroups.has(p)) {
            const { parentGroupId: _omit, ...rest } = (n as any);
            return { ...(rest as any), updatedAt: now } as CanvasNode;
          }
          return n;
        });

        const updatedCanvas = {
          ...currentState.canvas,
          nodes: updatedNodes,
          connections: updatedConnections,
          updatedAt: now,
        };
        set({
          canvas: updatedCanvas,
          selectedNodeId: currentState.selectedNodeId === nodeId ? null : currentState.selectedNodeId,
          isDirty: true,
        });
        const deleteOp = { op: 'delete_node', id: nodeId } as any;
        const usedRealtime = get().persistenceDisabled && applyOpsViaRealtime([deleteOp], get);
        if (!usedRealtime) {
          syncRealtimeSnapshotIfNeeded(updatedCanvas, get);
        }
        queueDraftPersist(get, set, 'edit');
        void persistQueuedOps(get, set, [deleteOp]).catch(() => {});
        
        // 立即添加历史（删除是重要操作）
        if (!isAddingToHistory) {
          setTimeout(() => {
            if (!isAddingToHistory) {
              get().addToHistory();
            }
          }, 100);
        }
      },

      duplicateNode: (nodeId: string) => {
        const { canvas } = get();
        const node = canvas.nodes.find(n => n.id === nodeId);
        if (node) {
          const duplicatedNode: CanvasNode = {
            ...node,
            id: NodeIds.generateNodeId(canvas.id, node.type),
            x: node.x + 20,  // 扁平化位置访问
            y: node.y + 20,  // 扁平化位置访问
            createdAt: getCurrentTimestamp(),
            updatedAt: getCurrentTimestamp(),
          };
          get().addNode(duplicatedNode);
        }
      },

      // ==================== 连接操作 (扁平化结构) ====================
      addConnection: (connection: CanvasConnection) => {
        const currentState = get();
        const now = getCurrentTimestamp();
        const connectionWithId = {
          ...connection,
          id: connection.id || NodeIds.generateConnectionId(currentState.canvas.id),
          createdAt: now,
        };
        const updatedCanvas = applyMermaidThemeDefaults({
          ...currentState.canvas,
          connections: [...currentState.canvas.connections, connectionWithId],
          updatedAt: now,
        });
        set({
          canvas: updatedCanvas,
          isDirty: true,
        });
        const addConnOp = { op: 'add_connection', ...connectionWithId } as any;
        const usedRealtime = get().persistenceDisabled && applyOpsViaRealtime([addConnOp], get);
        if (!usedRealtime) {
          syncRealtimeSnapshotIfNeeded(updatedCanvas, get);
        }
        queueDraftPersist(get, set, 'edit');
        void persistQueuedOps(get, set, [addConnOp]).catch(() => {});
      },

      updateConnection: (connectionId: string, updates: Partial<CanvasConnection>) => {
        const currentState = get();
        const now = getCurrentTimestamp();
        const connections = (currentState.canvas.connections || []).map((c) => {
          if (c.id !== connectionId) return c;
          const mergedAppearance = (updates as any)?.appearance
            ? { ...(c as any).appearance, ...(updates as any).appearance }
            : (c as any).appearance;
          const { appearance: _omit, ...rest } = updates as any;
          return {
            ...(c as any),
            ...rest,
            ...(mergedAppearance ? { appearance: mergedAppearance } : {}),
          } as CanvasConnection;
        });
        const updatedCanvas = applyMermaidThemeDefaults({ ...currentState.canvas, connections, updatedAt: now });
        set({ canvas: updatedCanvas, isDirty: true });
        const patch = { ...updates };
        const updateConnOp = { op: 'update_connection', id: connectionId, patch } as any;
        const usedRealtime = get().persistenceDisabled && applyOpsViaRealtime([updateConnOp], get);
        if (!usedRealtime) {
          syncRealtimeSnapshotIfNeeded(updatedCanvas, get);
        }
        queueDraftPersist(get, set, 'edit');
        void persistQueuedOps(get, set, [updateConnOp]).catch(() => {});
      },

      removeConnection: (connectionId: string) => {
        const currentState = get();
        const now = getCurrentTimestamp();
        const connections = currentState.canvas.connections.filter(c => c.id !== connectionId);
        // 同步清理 metadata.connectionAnchors 的残留
        const meta = { ...(currentState.canvas.metadata || {}) } as any;
        if (meta.connectionAnchors && typeof meta.connectionAnchors === 'object') {
          const nextAnchors: Record<string, { x: number; y: number }> = {};
          for (const c of connections) {
            const a = meta.connectionAnchors[c.id];
            if (a) nextAnchors[c.id] = a;
          }
          meta.connectionAnchors = nextAnchors;
        }
        if (meta.connectionAnchorParams && typeof meta.connectionAnchorParams === 'object') {
          const nextParams: Record<string, { u: number; v: number }> = {};
          for (const c of connections) {
            const ap = meta.connectionAnchorParams[c.id];
            if (ap) nextParams[c.id] = ap;
          }
          meta.connectionAnchorParams = nextParams;
        }
        const updatedCanvas = applyMermaidThemeDefaults({ ...currentState.canvas, connections, metadata: meta, updatedAt: now });
        set({
          canvas: updatedCanvas,
          isDirty: true,
        });
        const deleteConnOp = { op: 'delete_connection', id: connectionId } as any;
        const usedRealtime = get().persistenceDisabled && applyOpsViaRealtime([deleteConnOp], get);
        if (!usedRealtime) {
          syncRealtimeSnapshotIfNeeded(updatedCanvas, get);
        }
        queueDraftPersist(get, set, 'edit');
        void persistQueuedOps(get, set, [deleteConnOp]).catch(() => {});
      },


      // ==================== 选择操作 ====================
      selectNode: (nodeId: string | null) => {
        set({
          selectedNodeId: nodeId,
        });
      },

      clearSelection: () => {
        set({
          selectedNodeId: null,
        });
      },

      // ==================== 历史操作 ====================
      addToHistory: async () => {
        // 切换画布期间不写入历史，防止误入新画布
        const { isSwitchingCanvas } = get();
        if (isSwitchingCanvas || isAddingToHistory) return;

        isAddingToHistory = true;
        try {
          const { canvas, historyData } = get();
          if (!canvas || !canvas.id) { isAddingToHistory = false; return; }

          // 若历史不存在或属于其它画布，则为当前画布创建/重建历史
          if (!historyData || historyData.canvasId !== canvas.id) {
            const newHistoryData = canvasHistoryService.addToHistory(canvas, [], -1);
            await canvasHistoryService.saveHistory(newHistoryData);
            set({ historyData: newHistoryData });
            return;
          }

          // 正常追加
          const newHistoryData = canvasHistoryService.addToHistory(
            canvas,
            historyData.history,
            historyData.historyIndex
          );
          await canvasHistoryService.saveHistory(newHistoryData);
          set({ historyData: newHistoryData });
        } catch (error) {
          set({ error: 'Failed to save history: ' + (error as Error).message });
        } finally {
          isAddingToHistory = false;
        }
      },

      undo: async () => {
        const state = get();
        const { isSwitchingCanvas, canvas } = state;
        if (isSwitchingCanvas) return;

        // 确保历史与当前画布一致
        let { historyData } = state;
        if (!historyData || (canvas && historyData.canvasId !== canvas.id)) {
          await get().initializeHistory(canvas?.id);
          historyData = get().historyData;
        }
        if (!historyData || (canvas && historyData.canvasId !== canvas.id)) return;

        try {
          const undoResult = canvasHistoryService.undo(historyData);
          if (undoResult) {
            const updatedHistoryData = { ...historyData, historyIndex: undoResult.newIndex };
            const themedUndoCanvas = applyMermaidThemeDefaults(undoResult.canvas);
            set({ canvas: themedUndoCanvas, historyData: updatedHistoryData, isDirty: true });
            syncRealtimeSnapshotIfNeeded(themedUndoCanvas, get, { force: true });
            queueDraftPersist(get, set, 'edit');

            // 立即保存Canvas和历史数据（仅当文件ID匹配当前画布）
            const { currentFileId } = get();
            if (currentFileId && !get().persistenceDisabled) {
              const repository = getCurrentCanvasRepository();
              await repository.update(
                currentFileId,
                buildUndoRedoPersistencePayload(themedUndoCanvas)
              );
            }
            await canvasHistoryService.saveHistory(updatedHistoryData);
          }
        } catch (error) {
          set({ error: 'Undo failed: ' + (error as Error).message });
        }
      },

      redo: async () => {
        const state = get();
        const { isSwitchingCanvas, canvas } = state;
        if (isSwitchingCanvas) return;

        // 确保历史与当前画布一致
        let { historyData } = state;
        if (!historyData || (canvas && historyData.canvasId !== canvas.id)) {
          await get().initializeHistory(canvas?.id);
          historyData = get().historyData;
        }
        if (!historyData || (canvas && historyData.canvasId !== canvas.id)) return;

        try {
          const redoResult = canvasHistoryService.redo(historyData);
          if (redoResult) {
            const updatedHistoryData = { ...historyData, historyIndex: redoResult.newIndex };
            const themedRedoCanvas = applyMermaidThemeDefaults(redoResult.canvas);
            set({ canvas: themedRedoCanvas, historyData: updatedHistoryData, isDirty: true });
            syncRealtimeSnapshotIfNeeded(themedRedoCanvas, get, { force: true });
            queueDraftPersist(get, set, 'edit');

            const { currentFileId } = get();
            if (currentFileId && !get().persistenceDisabled) {
              const repository = getCurrentCanvasRepository();
              await repository.update(
                currentFileId,
                buildUndoRedoPersistencePayload(themedRedoCanvas)
              );
            }
            await canvasHistoryService.saveHistory(updatedHistoryData);
          }
        } catch (error) {
          set({ error: 'Redo failed: ' + (error as Error).message });
        }
      },

      canUndo: () => {
        const { historyData, canvas, isSwitchingCanvas } = get();
        if (isSwitchingCanvas) return false;
        if (!historyData || !canvas || historyData.canvasId !== canvas.id) return false;
        return canvasHistoryService.canUndo(historyData);
      },

      canRedo: () => {
        const { historyData, canvas, isSwitchingCanvas } = get();
        if (isSwitchingCanvas) return false;
        if (!historyData || !canvas || historyData.canvasId !== canvas.id) return false;
        return canvasHistoryService.canRedo(historyData);
      },

      clearHistory: () => {
        canvasHistoryService.clearHistory();
        set({ historyData: null });
      },

      // ==================== 保存操作 ====================
      persistDraft: (reason?: string, options?: { force?: boolean }) => {
        if (options?.force) {
          writeDraftNow(get, set, reason);
          return;
        }
        queueDraftPersist(get, set, reason);
      },

      clearDraft: (canvasId?: string) => {
        clearDraftForCanvas(get, set, canvasId);
      },

      setDraftRecovery: (draft: CanvasDraftEntry | null) => {
        set({ draftRecovery: draft });
      },

      markDirty: () => {
        set({
          isDirty: true,
        });
        queueDraftPersist(get, set, 'edit');
      },

      markClean: () => {
        set({
          isDirty: false,
          lastSaved: new Date(),
          saveState: 'saved',
          saveError: null,
        });
      },

      saveCanvas: async () => {
        if (saveCanvasInFlight) {
          saveCanvasQueued = true;
          return saveCanvasInFlight;
        }

        saveCanvasQueued = false;

        const run = async () => {
          set({ saveState: 'saving', saveError: null });
          // 全局只读保护：当禁用持久化时，任何保存请求直接返回
          if (get().persistenceDisabled) {
            const synced = syncRealtimeSnapshotIfNeeded(get().canvas, get, { force: true });
            if (synced) {
              get().markClean();
              set({ error: null });
              markSaveSuccess(get, set, get().currentFileId || get().canvas?.id);
            }
            return;
          }

          await flushNodePatches(get, set);
          const { canvas, currentFileId } = get();

          const stripLocalPaths = (nodes: CanvasNode[]) =>
            (nodes || []).map((n) => {
              const c: any = { ...n };
              if (c.localPath) delete c.localPath;
              return c as CanvasNode;
            });

          try {
            if (currentFileId) {
              const repository = getCurrentCanvasRepository();
              const includeDocContent = !isCanvasRealtimeLive();
              const queue = getCanvasWriteQueue(currentFileId);
              queue.acknowledge(canvas.serverVersion);

              // 同步保存 connectionAnchors/Styles 元数据（冗余存储，防后端清洗）
              const anchors: Record<string, { x: number; y: number }> = {};
              const anchorParams: Record<string, { u: number; v: number }> = {};
              const styles: Record<string, any> = {};
              const groupAttachments: Record<string, string[]> = {};
              for (const c of canvas.connections || []) {
                const a = (c as any).curveAnchor as { x: number; y: number } | undefined;
                if (a && typeof a.x === 'number' && typeof a.y === 'number') anchors[c.id] = { x: a.x, y: a.y };
                const ap = (c as any).anchorParams as { u: number; v: number } | undefined;
                if (ap && typeof ap.u === 'number' && typeof ap.v === 'number') anchorParams[c.id] = { u: ap.u, v: ap.v };
                const app = (c as any).appearance;
                if (app && typeof app === 'object') styles[c.id] = app;
              }
              // 采集组的附属连线
              for (const n of canvas.nodes || []) {
                const anyN: any = n as any;
                if (
                  anyN?.type === 'group' &&
                  Array.isArray(anyN.attachedConnections) &&
                  anyN.attachedConnections.length > 0
                ) {
                  groupAttachments[n.id] = [...anyN.attachedConnections];
                }
              }
              const nextMeta = {
                ...(canvas.metadata || {}),
                connectionAnchors: anchors,
                connectionAnchorParams: anchorParams,
                connectionStyles: styles,
                groupAttachments,
              } as any;

              const updateData: any = {
                title: canvas.title,
                ...(includeDocContent ? { nodes: stripLocalPaths(canvas.nodes || []), connections: canvas.connections } : {}),
                version: canvas.version,
                serverVersion: canvas.serverVersion,
                // 全局样式：背景/圆角/字体
                ...(canvas.backgroundColor ? { backgroundColor: canvas.backgroundColor } : {}),
                ...(canvas.backgroundStyleId ? { backgroundStyleId: canvas.backgroundStyleId } : {}),
                ...(canvas.patternColor ? { patternColor: canvas.patternColor } : {}),
                ...(canvas.cornerStyle ? { cornerStyle: canvas.cornerStyle } : {}),
                ...(canvas.fontStyle ? { fontStyle: canvas.fontStyle } : {}),
                // 全局文本预设
                textOpacityPreset: canvas.textOpacityPreset,
                textLayoutPreset: canvas.textLayoutPreset,
                metadata: nextMeta,
              };

              const applyRemoteMeta = (remote: any) => {
                try {
                  const current = get().canvas;
                  const next = applyMermaidThemeDefaults({
                    ...current,
                    serverVersion: remote?.serverVersion ?? (current as any).serverVersion,
                    version: remote?.version ?? current.version,
                    updatedAt: remote?.updatedAt ?? current.updatedAt,
                  } as Canvas);
                  set({
                    canvas: next,
                    isDirty: false,
                    lastSaved: new Date(next.updatedAt),
                    error: null,
                  });
                  syncRealtimeSnapshotIfNeeded(next, get, { force: true });
                  markSaveSuccess(get, set, currentFileId, { track: true });
                  try {
                    canvasCache.set(currentFileId, {
                      canvas: { ...next, nodes: stripLocalPaths(next.nodes || []) } as any,
                      version: String((next as any).version || '1.0.0'),
                      updatedAt: (next as any).updatedAt || Date.now(),
                      lastVerifiedAt: Date.now(),
                    });
                  } catch {}
                } catch {}
              };

              try {
                const updatedRemote = await queue.enqueueUpdate({
                  fallbackVersion: canvas.serverVersion,
                  payload: updateData,
                  update: (payload, version) =>
                    repository.update(currentFileId, {
                      ...(payload as UpdateCanvasData),
                      serverVersion: version,
                    }),
                });
                applyRemoteMeta((updatedRemote as any)?.canvas || updatedRemote);
              } catch (err: any) {
                throw err;
              }
            } else {
              // 如果没有文件ID，创建新文件
              const repository = getCurrentCanvasRepository();
              const sanitizedNodes = stripLocalPaths(canvas.nodes || []);
              // 同步保存 connectionAnchors/Styles 元数据
              const anchors: Record<string, { x: number; y: number }> = {};
              const anchorParams: Record<string, { u: number; v: number }> = {};
              const styles: Record<string, any> = {};
              const groupAttachments: Record<string, string[]> = {};
              for (const c of canvas.connections || []) {
                const a = (c as any).curveAnchor as { x: number; y: number } | undefined;
                if (a && typeof a.x === 'number' && typeof a.y === 'number') anchors[c.id] = { x: a.x, y: a.y };
                const ap = (c as any).anchorParams as { u: number; v: number } | undefined;
                if (ap && typeof ap.u === 'number' && typeof ap.v === 'number') anchorParams[c.id] = { u: ap.u, v: ap.v };
                const app = (c as any).appearance;
                if (app && typeof app === 'object') styles[c.id] = app;
              }
              for (const n of canvas.nodes || []) {
                const anyN: any = n as any;
                if (anyN?.type === 'group' && Array.isArray(anyN.attachedConnections) && anyN.attachedConnections.length > 0) {
                  groupAttachments[n.id] = [...anyN.attachedConnections];
                }
              }
              const entity = await repository.create({
                title: canvas.title,
                nodes: sanitizedNodes,
                connections: canvas.connections,
                // 初次创建时也要写入全局样式，避免第一版缺失
                ...(canvas.backgroundColor ? { backgroundColor: canvas.backgroundColor } : {}),
                ...(canvas.backgroundStyleId ? { backgroundStyleId: canvas.backgroundStyleId } : {}),
                ...(canvas.patternColor ? { patternColor: canvas.patternColor } : {}),
                ...(canvas.cornerStyle ? { cornerStyle: canvas.cornerStyle } : {}),
                ...(canvas.fontStyle ? { fontStyle: canvas.fontStyle } : {}),
                textOpacityPreset: canvas.textOpacityPreset,
                textLayoutPreset: canvas.textLayoutPreset,
                metadata: { ...(canvas.metadata || {}), connectionAnchors: anchors, connectionAnchorParams: anchorParams, connectionStyles: styles, groupAttachments },
              });
              set({ currentFileId: entity.id });
              try {
                canvasCache.set(entity.id, {
                  canvas: { ...canvas, id: entity.id, nodes: sanitizedNodes } as any,
                  version: String(entity.version || canvas.version || '1.0.0'),
                  updatedAt: entity.updatedAt || canvas.updatedAt || Date.now(),
                  lastVerifiedAt: Date.now(),
                });
              } catch {}
              try { localStorage.setItem('last_canvas_id', entity.id); } catch {}
              get().markClean();
              set({ error: null });
              syncRealtimeSnapshotIfNeeded(entity as any, get, { force: true });
              markSaveSuccess(get, set, entity.id, { track: true });
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            get().setError('Save failed: ' + message);
            markSaveFailed(get, set, error, get().currentFileId || get().canvas?.id);
          }
        };

        saveCanvasInFlight = run().finally(() => {
          saveCanvasInFlight = null;
          if (saveCanvasQueued) {
            saveCanvasQueued = false;
            try {
              void get().saveCanvas().catch(() => {});
            } catch {}
          }
        });

        return saveCanvasInFlight;
      },

      loadCanvas: async () => {
        try {
          set({ isLoading: true, error: null });

          // 尝试从localStorage获取最后打开的画布ID
          let lastCanvasId: string | null = null;
          try {
            lastCanvasId = localStorage.getItem('last_canvas_id');
          } catch {}

          const { beginCanvasSwitch } = get();
          beginCanvasSwitch(lastCanvasId ?? 'initial-load');

          const repository = getCurrentCanvasRepository();

          // 如果有最后打开的画布ID，尝试打开它
          if (lastCanvasId) {
            try {
              const entity = await repository.findById(lastCanvasId);
          if (entity) {
            const mergedEntityBase = applyMetadataToCanvas(entity as Canvas);
            const { out: mergedEntity, migrated } = shouldMigrateAnchors(mergedEntityBase)
              ? migrateAnchorParams(mergedEntityBase)
              : { out: mergedEntityBase, migrated: 0 };
            get().beginCanvasSwitch(entity.id, entity.title);
          set({
            canvas: mergedEntity,
            currentFileId: entity.id,
            isDirty: false,
            saveState: 'saved',
            saveError: null,
            error: null,
            lastSaved: new Date(entity.updatedAt),
            isLoading: false,
          });
          maybeSetDraftRecovery(get, set, entity.id, mergedEntity as Canvas);
          try {
            canvasCache.set(entity.id, {
              canvas: mergedEntity,
              version: String((mergedEntity as any).version || entity.version || '1.0.0'),
              updatedAt: mergedEntity.updatedAt || entity.updatedAt || Date.now(),
              lastVerifiedAt: Date.now(),
            });
          } catch {}
            // 缓存只读快照以便失败/离线回退
            try { localStorage.setItem(`canvas_snapshot:${entity.id}`, JSON.stringify(mergedEntity)); } catch {}
            try { if (migrated > 0) scheduleBackgroundSave(get); } catch {}

                // 初始化节点计数器，基于现有节点ID
                NodeIds.initialize(entity.id, mergedEntity.nodes, mergedEntity.connections);

                // 加载/初始化对应画布的历史
                const historyData = await canvasHistoryService.loadHistory();
                if (historyData && historyData.canvasId === entity.id) {
                  set({ historyData });
                } else {
                  const newHistoryData = canvasHistoryService.addToHistory(mergedEntity, [], -1);
                  await canvasHistoryService.saveHistory(newHistoryData);
                  set({ historyData: newHistoryData });
                }

                get().finishCanvasSwitch();

                return;
              }
            } catch (error) {
              console.warn('Failed to load last canvas; trying latest:', error);
            }
          }

          // 尝试加载最新的Canvas文件
          const entities = await repository.findAll({
            order_by: 'updatedAt',
            order_direction: 'desc',
            limit: 1
          });

          if (entities.length > 0) {
            const entity = entities[0];
            const anchors = (entity as any).metadata?.connectionAnchors as Record<string, { x: number; y: number }> | undefined;
            const anchorParams = (entity as any).metadata?.connectionAnchorParams as Record<string, { u: number; v: number }> | undefined;
            const styles = (entity as any).metadata?.connectionStyles as Record<string, any> | undefined;
            const attachments = (entity as any).metadata?.groupAttachments as Record<string, string[]> | undefined;
            const mergedEntity = (anchors || anchorParams || styles || attachments) ? {
              ...entity,
              nodes: attachments ? ((entity.nodes || []).map((n: any) => (
                (n?.type === 'group' && (!Array.isArray(n.attachedConnections) || n.attachedConnections.length === 0) && attachments[n.id])
                  ? ({ ...n, attachedConnections: attachments[n.id] })
                  : n
              ))) : entity.nodes,
              connections: (entity.connections || []).map((c) => (
                {
                  ...(c as any),
                  ...(anchors && !(c as any).curveAnchor && anchors[c.id] ? { curveAnchor: { x: anchors[c.id].x, y: anchors[c.id].y } } : {}),
                  ...(anchorParams && !(c as any).anchorParams && anchorParams[c.id] ? { anchorParams: { u: anchorParams[c.id].u, v: anchorParams[c.id].v } } : {}),
                  ...(styles && !(c as any).appearance && styles[c.id] ? { appearance: styles[c.id] } : {}),
                }
              ))
            } : entity;
            get().beginCanvasSwitch(entity.id, entity.title);
            set({
              canvas: mergedEntity,
              currentFileId: entity.id,
              isDirty: false,
              saveState: 'saved',
              saveError: null,
              error: null,
              lastSaved: new Date(entity.updatedAt),
              isLoading: false,
            });
            maybeSetDraftRecovery(get, set, entity.id, mergedEntity as Canvas);
            try {
              canvasCache.set(entity.id, {
                canvas: mergedEntity,
                version: String((mergedEntity as any).version || entity.version || '1.0.0'),
                updatedAt: mergedEntity.updatedAt || entity.updatedAt || Date.now(),
                lastVerifiedAt: Date.now(),
              });
            } catch {}

            // 初始化节点计数器，基于现有节点ID
            NodeIds.initialize(entity.id, entity.nodes, entity.connections);

            // 加载/初始化对应画布的历史
            const historyData = await canvasHistoryService.loadHistory();
            if (historyData && historyData.canvasId === entity.id) {
              set({ historyData });
            } else {
              const newHistoryData = canvasHistoryService.addToHistory(mergedEntity, [], -1);
              await canvasHistoryService.saveHistory(newHistoryData);
              set({ historyData: newHistoryData });
            }

            // 更新localStorage
            try { localStorage.setItem('last_canvas_id', entity.id); } catch {}
            get().finishCanvasSwitch();
          } else {
            // 如果没有找到任何画布，创建一个新的默认Canvas
            console.log('No existing canvases found; creating a new one');
            const defaultCanvas = createEmptyCanvas('My Canvas');
            get().beginCanvasSwitch(defaultCanvas.id, defaultCanvas.title);
          set({
            canvas: defaultCanvas,
            currentFileId: null,
            isDirty: false,
            saveState: 'saved',
            saveError: null,
            error: null,
            lastSaved: null,
            isLoading: false,
          });
            maybeSetDraftRecovery(get, set, defaultCanvas.id, defaultCanvas);
            try { localStorage.setItem(`canvas_snapshot:${defaultCanvas.id}`, JSON.stringify(defaultCanvas)); } catch {}

            // 初始化空Canvas的计数器
            NodeIds.initialize(defaultCanvas.id, [], []);

            // 创建初始历史记录
            const newHistoryData = canvasHistoryService.addToHistory(defaultCanvas, [], -1);
            await canvasHistoryService.saveHistory(newHistoryData);
            set({ historyData: newHistoryData });
            get().finishCanvasSwitch();
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          set({
            error: 'Load failed: ' + message,
            isLoading: false
          });
          get().failCanvasSwitch(message || 'Unknown error');
        }
      },

      // ==================== 全局文本样式 ====================
      setTextOpacityPreset: (presetId: TextOpacityPresetId) => {
        const state = get();
        const preset = getTextOpacityPreset(presetId);
        const currentCanvas = state.canvas;
        const currentId = currentCanvas.textOpacityPreset ?? DEFAULT_TEXT_OPACITY_PRESET;
        const targetOpacity = preset.value;

        let nodesChanged = false;
        const changedNodeOps: Array<{ id: string; patch: Record<string, any> }> = [];
        const now = getCurrentTimestamp();

        const updatedNodes = currentCanvas.nodes.map((node) => {
          if (node.type !== 'text' && node.type !== 'todo') {
            return node;
          }
          const currentOpacity = (node.textStyles && typeof node.textStyles.opacity === 'number')
            ? node.textStyles.opacity
            : 1;

          if (Math.abs(currentOpacity - targetOpacity) < 0.001) {
            return node;
          }

          nodesChanged = true;
          const nextStyles = applyOpacityToTextStyles(node.textStyles, targetOpacity);
          changedNodeOps.push({ id: node.id, patch: { textStyles: nextStyles } });

          return {
            ...node,
            textStyles: nextStyles,
            updatedAt: now
          };
        });

        if (!nodesChanged && currentId === presetId) {
          return;
        }

        const updatedCanvas: Canvas = {
          ...currentCanvas,
          nodes: nodesChanged ? updatedNodes : currentCanvas.nodes,
          textOpacityPreset: presetId,
          updatedAt: now
        };

        set({
          canvas: updatedCanvas,
          isDirty: true
        });
        queueDraftPersist(get, set, 'edit');

        // Broadcast through the realtime channel during collaboration so the preset
        // scalar AND the dependent node textStyles propagate (LWW); fall back to REST
        // persistence only when not collaborating. Without this, presets live only in
        // local Zustand and are reverted by the next inbound applyDocSnapshot.
        const presetOps: any[] = [
          { op: 'update_canvas', patch: { textOpacityPreset: presetId } },
          ...changedNodeOps.map(({ id, patch }) => ({ op: 'update_node', id, patch })),
        ];
        const usedRealtime = get().persistenceDisabled && applyOpsViaRealtime(presetOps, get);
        if (!usedRealtime) {
          scheduleRepositorySave(get, false);
        }

        if (debouncedAddToHistoryFn) {
          debouncedAddToHistoryFn();
        }
      },

      setTextLayoutPreset: (presetId: TextLayoutPresetId) => {
        const state = get();
        const layoutPreset = getTextLayoutPreset(presetId);
        const currentCanvas = state.canvas;
        const currentId = currentCanvas.textLayoutPreset ?? DEFAULT_TEXT_LAYOUT_PRESET;
        const metrics = layoutPreset.metrics;
        const now = getCurrentTimestamp();

        let nodesChanged = false;
        const changedNodeOps: Array<{ id: string; patch: Record<string, any> }> = [];

        const updatedNodes = currentCanvas.nodes.map((node) => {
          if (node.type !== 'text' && node.type !== 'todo') {
            return node;
          }

          const hasAccent =
            Boolean((node as any).textStyles?.accentColor) &&
            (node as any).textStyles?.accentColor !== 'transparent';

          // 思维导图内文本节点：保持固定宽度 150（不被全局预设最小宽拉大）
          const inMindmap = (() => {
            try {
              const g = (node as any).parentGroupId && currentCanvas.nodes.find(n => n.id === (node as any).parentGroupId && (n as any).type === 'group');
              return !!(g && ((g as any).groupMode === 'mindmap' || (g as any).mindmap));
            } catch { return false; }
          })();
          let targetWidth = Math.max(metrics.minWidth, node.width || metrics.minWidth);
          if (inMindmap) {
            // Keep existing width but clamp to [150, 450] to avoid being dragged below/above on preset changes
            const w = typeof node.width === 'number' ? node.width : 150;
            targetWidth = Math.max(150, Math.min(450, w));
          }
          const targetHeight = Math.max(
            metrics.minHeight,
            calculateTextHeightWithLayout({
              content: node.content || '',
              width: targetWidth,
              hasAccentColor: hasAccent,
              layoutPreset,
            })
          );

          if (
            Math.abs(targetWidth - node.width) < 0.5 &&
            Math.abs(targetHeight - node.height) < 0.5
          ) {
            return node;
          }

          nodesChanged = true;
          changedNodeOps.push({ id: node.id, patch: { width: targetWidth, height: targetHeight } });
          return {
            ...node,
            width: targetWidth,
            height: targetHeight,
            updatedAt: now
          };
        });

        if (!nodesChanged && currentId === presetId) {
          return;
        }

        const updatedCanvas: Canvas = {
          ...currentCanvas,
          nodes: nodesChanged ? updatedNodes : currentCanvas.nodes,
          textLayoutPreset: presetId,
          updatedAt: now
        };

        set({
          canvas: updatedCanvas,
          isDirty: true
        });
        queueDraftPersist(get, set, 'edit');

        // Broadcast through the realtime channel during collaboration so the preset
        // scalar AND the dependent node width/height propagate (LWW); fall back to REST
        // persistence only when not collaborating. Without this, presets live only in
        // local Zustand and are reverted by the next inbound applyDocSnapshot.
        const presetOps: any[] = [
          { op: 'update_canvas', patch: { textLayoutPreset: presetId } },
          ...changedNodeOps.map(({ id, patch }) => ({ op: 'update_node', id, patch })),
        ];
        const usedRealtime = get().persistenceDisabled && applyOpsViaRealtime(presetOps, get);
        if (!usedRealtime) {
          scheduleRepositorySave(get, false);
        }

        if (debouncedAddToHistoryFn) {
          debouncedAddToHistoryFn();
        }
      },

      // ==================== 加载状态 ====================
      setLoading: (loading: boolean) => {
        set({
          isLoading: loading,
        });
      },

      setError: (error: string | null) => {
        set({
          error,
        });
      },

      beginCanvasSwitch: (canvasId: string, title?: string | null) => {
        // 切换开始：标记切换中并清理待写入的历史批处理
        // 防止上一个画布的防抖写入在切换后落到新画布
        batchQueue = [];
        if (batchTimer) { clearTimeout(batchTimer); batchTimer = null as any; }
        pendingNodePatches = {};
        if (nodePatchTimer) { clearTimeout(nodePatchTimer); nodePatchTimer = null; }
        debouncedAddToHistoryFn = null;
        set(state => ({
          isSwitchingCanvas: true,
          pendingCanvasId: canvasId,
          pendingCanvasTitle: title !== undefined ? (title ?? null) : state.pendingCanvasTitle,
          canvasLoadError: null,
          lastSwitchTimestamp: Date.now(),
          draftRecovery: null,
        }));
      },

      finishCanvasSwitch: () => {
        set({
          isSwitchingCanvas: false,
          pendingCanvasId: null,
          pendingCanvasTitle: null,
          canvasLoadError: null,
          lastSwitchTimestamp: null,
        });
        // 切换完成：确保历史与当前画布对齐
        try { get().initializeHistory(get().canvas?.id); } catch {}
      },

      failCanvasSwitch: (error: string) => {
        set({
          isSwitchingCanvas: false,
          canvasLoadError: error,
          lastSwitchTimestamp: null,
        });
      },

      // ==================== 🚀 新增状态管理Actions ====================

      // 选择状态管理
      selectNodes: (nodeIds: string[]) => {
        const newNodeIds = new Set(nodeIds);
        const firstNodeId = nodeIds.length > 0 ? (nodeIds[0] || null) : null;

        set((state) => ({
          selections: {
            ...state.selections,
            nodeIds: newNodeIds,
          },
          selectedNodeId: firstNodeId, // 兼容性支持
        }));
      },

      selectSingleNode: (nodeId: string | null) => {
        const newNodeIds = nodeId ? new Set([nodeId]) : new Set<string>();

        set((state) => ({
          selections: {
            ...state.selections,
            nodeIds: newNodeIds,
          },
          selectedNodeId: nodeId, // 兼容性支持
        }));
      },

      toggleNodeSelection: (nodeId: string) => {
        set((state) => {
          const newNodeIds = new Set(state.selections.nodeIds);
          if (newNodeIds.has(nodeId)) {
            newNodeIds.delete(nodeId);
          } else {
            newNodeIds.add(nodeId);
          }
          const firstNodeId = newNodeIds.size > 0 ? (Array.from(newNodeIds)[0] || null) : null;

          return {
            selections: {
              ...state.selections,
              nodeIds: newNodeIds,
            },
            selectedNodeId: firstNodeId, // 兼容性支持
          };
        });
      },

      selectConnections: (connectionIds: string[]) => {
        set((state) => ({
          selections: {
            ...state.selections,
            connectionIds: new Set(connectionIds),
          },
        }));
      },

      selectGroup: (groupId: string | null) => {
        set((state) => ({
          selections: {
            ...state.selections,
            groupId,
          },
        }));
      },

      clearAllSelections: () => {
        set({
          selections: {
            nodeIds: new Set<string>(),
            connectionIds: new Set<string>(),
            groupId: null,
          },
          selectedNodeId: null, // 兼容性支持
        });
      },

      // 编辑状态机
      enterEditMode: (mode: 'node' | 'connection', entityId: string, initialContent = '') => {
        set({
          editState: {
            mode,
            entityId,
            content: initialContent,
            isActive: true,
          },
        });
      },

      updateEditContent: (content: string) => {
        set((state) => ({
          editState: {
            ...state.editState,
            content,
          },
        }));
      },

      commitEdit: () => {
        // 提交编辑内容到对应的节点或连接
        const state = get();
        const { editState } = state;

        if (editState.mode === 'node' && editState.entityId) {
          // 更新节点内容
          get().updateNode(editState.entityId, { content: editState.content });
        } else if (editState.mode === 'connection' && editState.entityId) {
          // 更新连接标签
          const updatedConnections = state.canvas.connections.map(conn =>
            conn.id === editState.entityId
              ? { ...conn, label: editState.content }
              : conn
          );
          set((state) => ({
            canvas: {
              ...state.canvas,
              connections: updatedConnections,
              updatedAt: getCurrentTimestamp(),
            },
            isDirty: true,
          }));
          queueDraftPersist(get, set, 'edit');
        }

        // 退出编辑模式
        set({
          editState: {
            mode: 'none',
            entityId: null,
            content: '',
            isActive: false,
          },
        });
      },

      cancelEdit: () => {
        set({
          editState: {
            mode: 'none',
            entityId: null,
            content: '',
            isActive: false,
          },
        });
      },

      // 视图状态管理
      setZoom: (zoom: number) => {
        set((state) => ({
          viewState: {
            ...state.viewState,
            zoom,
          },
        }));
      },

      setPanningLocked: (locked: boolean) => {
        set((state) => ({
          viewState: {
            ...state.viewState,
            isPanningLocked: locked,
          },
        }));
      },

      updateViewBounds: (bounds: { x: number; y: number; width: number; height: number }) => {
        set((state) => ({
          viewState: {
            ...state.viewState,
            bounds,
          },
        }));
      },

      setTransform: (transform: { scale: number; positionX: number; positionY: number }) => {
        set((state) => ({
          viewState: {
            ...state.viewState,
            transform,
            // 同步派生 zoom（百分比整数）
            zoom: Math.round(transform.scale * 100),
          },
        }));
      },

      setViewportSize: (viewport: { width: number; height: number }) => {
        set((state) => ({
          viewState: {
            ...state.viewState,
            viewport,
          },
        }));
      },

      updateViewState: (partial: Partial<ViewState>) => {
        set((state) => ({
          viewState: {
            ...state.viewState,
            ...partial,
          }
        }));
      },

      // 交互状态管理
      setToolMode: (mode: ToolMode) => {
        set((state) => ({
          interactionState: {
            ...state.interactionState,
            toolMode: mode,
          },
        }));
      },

      startConnection: (
        nodeId: string,
        side: 'top' | 'right' | 'bottom' | 'left',
        screenPosition: { x: number; y: number },
      ) => {
        set((state) => ({
          interactionState: {
            ...state.interactionState,
            isConnecting: true,
            connectionStart: { nodeId, side, screenPosition },
          },
        }));
      },

      updateConnectionPosition: (_position: { x: number; y: number }) => {
        // 这里可以更新临时连接线的位置，具体实现可能需要额外的状态
        // 暂时保持简单实现
      },

      commitConnection: (targetNodeId: string, _targetSide: string) => {
        const { connectionStart } = get().interactionState;

        if (connectionStart) {
          const op = {
            op: 'add_connection',
            id: NodeIds.generateConnectionId(get().canvas.id),
            from: connectionStart.nodeId,
            to: targetNodeId,
          } as any;
          void persistQueuedOps(get, set, [op]).catch(() => {});
        }

        // 清除连接状态
        set((state) => ({
          interactionState: {
            ...state.interactionState,
            isConnecting: false,
            connectionStart: null,
          },
        }));
      },

      cancelConnection: () => {
        set((state) => ({
          interactionState: {
            ...state.interactionState,
            isConnecting: false,
            connectionStart: null,
          },
        }));
      },

      startNodeDrag: (nodeId: string) => {
        set((state) => ({
          interactionState: {
            ...state.interactionState,
            draggingNodeId: nodeId,
          },
        }));
      },

      updateNodeDrag: (targetColumnId: string | null) => {
        set((state) => ({
          interactionState: {
            ...state.interactionState,
            dragTargetColumnId: targetColumnId,
          },
        }));
      },

      endNodeDrag: () => {
        const draggingId = get().interactionState.draggingNodeId;
        // 先清理拖拽状态
        set((state) => ({
          interactionState: {
            ...state.interactionState,
            draggingNodeId: null,
            dragTargetColumnId: null,
          },
        }));
        if (!draggingId) return;
        // 使用当前节点最终位置，提交 move_node
        const node = get().canvas.nodes.find(n => n.id === draggingId);
        if (!node) return;
        const op = { op: 'move_node', id: draggingId, x: node.x, y: node.y } as any;
        void persistQueuedOps(get, set, [op]).catch(() => {});
      },

      // AI状态集成
      setAIProcessing: (processing: boolean) => {
        set((state) => ({
          aiState: {
            ...state.aiState,
            isProcessing: processing,
          },
        }));
      },


      addAIResult: (result: any) => {
        set((state) => ({
          aiState: {
            ...state.aiState,
            results: [...state.aiState.results, result],
          },
        }));
      },

      clearAIResults: () => {
        set((state) => ({
          aiState: {
            ...state.aiState,
            results: [],
          },
        }));
      },
    }),
    { name: 'CanvasStore' }
  )
);

// 🎯 选择器函数已迁移到 useCanvasSelector.ts
// 使用 import { useCanvasData, useSelectedNode } from '../hooks/useCanvasSelector'

// 🎯 历史选择器已迁移到 src/hooks/useCanvasSelector.ts
// 避免重复定义，使用 import { useCanvasHistoryState } from '../hooks/useCanvasSelector'

export const useCanvasStatus = () => {
  return useCanvasStore((state) => ({
    isLoading: state.isLoading,
    error: state.error,
    isDirty: state.isDirty,
    lastSaved: state.lastSaved,
    saveState: state.saveState,
    saveError: state.saveError,
    lastDraftSavedAt: state.lastDraftSavedAt,
  }));
};
