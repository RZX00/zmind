// 🎯 Canvas选择器Hook - 性能优化的状态选择
// 提供细粒度的状态选择，避免不必要的重渲染

import { useCanvasStore } from '../stores/canvas.store';
import { shallow } from 'zustand/shallow';
import type { Canvas, CanvasNode } from '../types/canvas';
import { DEFAULT_PLACEHOLDER_CANVAS_ID } from '../constants';
import { createEmptyCanvas } from '../utils/canvasUtils';

// 🎯 基础选择器 - 添加安全检查和默认值
export const useCanvas = () =>
  useCanvasStore(state => state.canvas || createEmptyCanvas('默认画布', DEFAULT_PLACEHOLDER_CANVAS_ID));
export const useCanvasData = () =>
  useCanvasStore(state => state.canvas || createEmptyCanvas('默认画布', DEFAULT_PLACEHOLDER_CANVAS_ID)); // 别名，保持兼容
export const useCanvasNodes = () => useCanvasStore(state => state.canvas?.nodes || []);
export const useCanvasConnections = () => useCanvasStore(state => state.canvas?.connections || []);
export const useCanvasError = () => useCanvasStore(state => state.error);
export const useCanvasLoading = () => useCanvasStore(state => state.isLoading);
export const useCanvasSwitching = () => useCanvasStore(state => state.isSwitchingCanvas);
export const useCanvasPendingTitle = () => useCanvasStore(state => state.pendingCanvasTitle);
export const useCanvasPendingId = () => useCanvasStore(state => state.pendingCanvasId);
export const useCanvasLoadError = () => useCanvasStore(state => state.canvasLoadError);
export const useCanvasLastSwitchTimestamp = () => useCanvasStore(state => state.lastSwitchTimestamp);

// 🚀 新增：统一选择状态选择器
export const useSelectedNodeIds = () => useCanvasStore(state => state.selections.nodeIds);
export const useSelectedConnectionIds = () => useCanvasStore(state => state.selections.connectionIds);
export const useSelectedGroupId = () => useCanvasStore(state => state.selections.groupId);
export const useSelectedNodeId = () => useCanvasStore(state => state.selectedNodeId); // 兼容性保留

// 🚀 新增：编辑状态选择器
export const useEditMode = () => useCanvasStore(state => state.editState.mode);
export const useEditingEntityId = () => useCanvasStore(state => state.editState.entityId);
export const useEditingContent = () => useCanvasStore(state => state.editState.content);
export const useIsEditing = () => useCanvasStore(state => state.editState.isActive);

// 🚀 新增：视图状态选择器
export const useViewZoom = () => useCanvasStore(state => state.viewState.zoom);
export const useIsPanningLocked = () => useCanvasStore(state => state.viewState.isPanningLocked);
export const useViewBounds = () => useCanvasStore(state => state.viewState.bounds);
export const useViewTransform = (): { scale: number; positionX: number; positionY: number } =>
  useCanvasStore(state => state.viewState.transform);
export const useViewportSize = (): { width: number; height: number } =>
  useCanvasStore(state => state.viewState.viewport);

// 🚀 新增：交互状态选择器
export const useToolMode = () => useCanvasStore(state => state.interactionState.toolMode);
export const useIsConnecting = () => useCanvasStore(state => state.interactionState.isConnecting);
export const useConnectionStart = () => useCanvasStore(state => state.interactionState.connectionStart);
export const useDraggingNodeId = () => useCanvasStore(state => state.interactionState.draggingNodeId);
export const useDragTargetColumnId = () => useCanvasStore(state => state.interactionState.dragTargetColumnId);

// 🚀 新增：AI状态选择器
export const useAIProcessing = () => useCanvasStore(state => state.aiState.isProcessing);
export const useAIResults = () => useCanvasStore(state => state.aiState.results);

// 🎯 派生选择器 - 添加安全检查
export const useSelectedNode = (): CanvasNode | null => {
  return useCanvasStore(state => {
    const { canvas, selectedNodeId } = state;
    if (!selectedNodeId || !canvas || !canvas.nodes) {
      return null;
    }
    return canvas.nodes.find(node => node.id === selectedNodeId) || null;
  });
};

export const useCanvasTitle = () => useCanvasStore(state => state.canvas?.title || '');
export const useNodeCount = () => useCanvasStore(state => state.canvas?.nodes?.length || 0);

// 🎯 操作选择器 - 现在已移除，直接使用store.getState()访问操作
// 原useCanvasActions选择器已删除，避免函数引用导致的无限循环
// 使用方式：const store = useCanvasStore.getState(); store.addNode(...)

// 🎯 历史状态选择器 - 分离为单个选择器，避免对象引用问题
export const useCanUndo = () => {
  return useCanvasStore(state => {
    const hd = state.historyData;
    const cv = state.canvas;
    if (!hd || !cv || hd.canvasId !== cv.id) return false;
    return hd.historyIndex > 0;
  });
};

export const useCanRedo = () => {
  return useCanvasStore(state => {
    const hd = state.historyData;
    const cv = state.canvas;
    if (!hd || !cv || hd.canvasId !== cv.id) return false;
    return hd.historyIndex < hd.history.length - 1;
  });
};
export const useHistoryIndex = () => useCanvasStore(state => 
  state.historyData ? state.historyData.historyIndex : -1
);
export const useHistoryLength = () => useCanvasStore(state => 
  state.historyData ? state.historyData.history.length : 0
);

// 🎯 历史操作方法 - 通过直接访问store获取
export const getCanvasHistoryActions = () => {
  const store = useCanvasStore.getState();
  return {
    undo: store.undo,
    redo: store.redo,
  };
};

// 🎯 保存状态选择器 - 分离为单个选择器，避免对象引用问题  
export const useIsDirty = () => useCanvasStore(state => state.isDirty);
export const useLastSaved = () => useCanvasStore(state => state.lastSaved);

// 🎯 保存操作方法 - 通过直接访问store获取
export const getCanvasSaveActions = () => {
  const store = useCanvasStore.getState();
  return {
    saveCanvas: store.saveCanvas,
    loadCanvas: store.loadCanvas,
  };
};

// ⚡ Canvas操作工具函数 - 直接访问store，避免Hook依赖
export const getCanvasActions = () => {
  const store = useCanvasStore.getState();
  return {
    setCanvas: store.setCanvas,
    updateCanvas: store.updateCanvas,
    addNode: store.addNode,
    updateNode: store.updateNode,
    removeNode: store.removeNode,
    selectNode: store.selectNode,
    clearSelection: store.clearSelection,
  };
};

// 📝 使用说明注释
/* 
🔧 新的使用方式（避免无限循环）：

❌ 旧方式（会导致无限循环）：
const { addNode, updateNode } = useCanvasActions();

✅ 新方式（稳定的直接访问）：
const actions = getCanvasActions();
actions.addNode(newNode);

✅ 或者直接使用store：
const store = useCanvasStore.getState();
store.addNode(newNode);

✅ 历史操作使用方式：
const historyActions = getCanvasHistoryActions();
historyActions.undo();

✅ 保存操作使用方式：
const saveActions = getCanvasSaveActions();
saveActions.saveCanvas();
*/
