/**
 * 🕰️ 节点对齐历史记录 Hook
 * 
 * 提供节点对齐操作的撤销重做功能
 * 与React组件状态同步，支持键盘快捷键
 * 
 * @version 1.0.0
 * @author ZhenZhi Canvas Team
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Canvas, CanvasNode } from '../../types/canvas';
import { AlignmentType, type AlignmentOptions, type AlignmentResult } from '../services/canvas-node-alignment.service';
import { 
  canvasAlignmentHistoryService, 
  type AlignmentHistoryEntry,
  type AlignmentUndoRedoResult 
} from '../services/canvas-alignment-history.service';

// ==================== 接口定义 ====================

export interface UseAlignmentHistoryOptions {
  /** 是否启用键盘快捷键 (默认: true) */
  enableKeyboardShortcuts?: boolean;
  /** 是否自动压缩历史记录 (默认: false) */
  autoCompressHistory?: boolean;
  /** 压缩历史记录的间隔时间(ms) (默认: 10000) */
  compressInterval?: number;
  /** 撤销操作回调 */
  onUndo?: (result: AlignmentUndoRedoResult) => void;
  /** 重做操作回调 */
  onRedo?: (result: AlignmentUndoRedoResult) => void;
  /** 历史记录变化回调 */
  onHistoryChange?: (historyInfo: any) => void;
}

export interface UseAlignmentHistoryReturn {
  // ==================== 历史状态 ====================
  /** 是否可以撤销 */
  canUndo: boolean;
  /** 是否可以重做 */
  canRedo: boolean;
  /** 下一个撤销操作的描述 */
  nextUndoDescription: string | null;
  /** 下一个重做操作的描述 */
  nextRedoDescription: string | null;
  /** 历史记录总数 */
  totalEntries: number;
  /** 当前历史索引 */
  currentIndex: number;

  // ==================== 操作方法 ====================
  /** 记录对齐操作到历史 */
  recordAlignment: (
    beforeNodes: CanvasNode[],
    afterNodes: CanvasNode[],
    alignmentType: AlignmentType,
    options?: AlignmentOptions
  ) => string;
  /** 撤销上一次对齐操作 */
  undo: () => AlignmentUndoRedoResult;
  /** 重做下一次对齐操作 */
  redo: () => AlignmentUndoRedoResult;
  /** 清空历史记录 */
  clearHistory: () => void;
  /** 一键执行对齐并记录历史 */
  alignAndRecord: (
    nodes: CanvasNode[],
    alignmentType: AlignmentType,
    options?: AlignmentOptions
  ) => Promise<{ result: AlignmentResult; historyId: string }>;

  // ==================== 工具方法 ====================
  /** 获取历史记录信息 */
  getHistoryInfo: () => any;
  /** 获取历史记录列表 */
  getHistoryList: () => AlignmentHistoryEntry[];
  /** 跳转到指定历史记录 */
  jumpToHistory: (id: string) => AlignmentUndoRedoResult;
  /** 压缩历史记录 */
  compressHistory: () => void;
}

// ==================== Hook实现 ====================

export function useAlignmentHistory(
  options: UseAlignmentHistoryOptions = {}
): UseAlignmentHistoryReturn {
  const {
    enableKeyboardShortcuts = true,
    autoCompressHistory = false,
    compressInterval = 10000,
    onUndo,
    onRedo,
    onHistoryChange
  } = options;

  // ==================== 状态管理 ====================

  const [historyState, setHistoryState] = useState(() => 
    canvasAlignmentHistoryService.getHistoryInfo()
  );

  // 定时器引用
  const compressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const keyboardListenerAttached = useRef(false);

  // ==================== 状态更新 ====================

  const updateHistoryState = useCallback(() => {
    const newState = canvasAlignmentHistoryService.getHistoryInfo();
    setHistoryState(newState);
    onHistoryChange?.(newState);
  }, [onHistoryChange]);

  // ==================== 操作方法 ====================

  const recordAlignment = useCallback((
    beforeNodes: CanvasNode[],
    afterNodes: CanvasNode[],
    alignmentType: AlignmentType,
    options: AlignmentOptions = {}
  ): string => {
    const historyId = canvasAlignmentHistoryService.recordAlignment(
      beforeNodes,
      afterNodes,
      alignmentType,
      options
    );
    updateHistoryState();
    return historyId;
  }, [updateHistoryState]);

  const undo = useCallback((): AlignmentUndoRedoResult => {
    const result = canvasAlignmentHistoryService.undo();
    updateHistoryState();
    onUndo?.(result);
    return result;
  }, [updateHistoryState, onUndo]);

  const redo = useCallback((): AlignmentUndoRedoResult => {
    const result = canvasAlignmentHistoryService.redo();
    updateHistoryState();
    onRedo?.(result);
    return result;
  }, [updateHistoryState, onRedo]);

  const clearHistory = useCallback((): void => {
    canvasAlignmentHistoryService.clearHistory();
    updateHistoryState();
  }, [updateHistoryState]);

  const alignAndRecord = useCallback(async (
    nodes: CanvasNode[],
    alignmentType: AlignmentType,
    options: AlignmentOptions = {}
  ): Promise<{ result: AlignmentResult; historyId: string }> => {
    const result = await canvasAlignmentHistoryService.alignAndRecord(nodes, alignmentType, options);
    updateHistoryState();
    return result;
  }, [updateHistoryState]);

  // ==================== 工具方法 ====================

  const getHistoryInfo = useCallback(() => {
    return canvasAlignmentHistoryService.getHistoryInfo();
  }, []);

  const getHistoryList = useCallback(() => {
    return canvasAlignmentHistoryService.getHistoryList();
  }, []);

  const jumpToHistory = useCallback((id: string): AlignmentUndoRedoResult => {
    const result = canvasAlignmentHistoryService.jumpToHistory(id);
    updateHistoryState();
    return result;
  }, [updateHistoryState]);

  const compressHistory = useCallback((): void => {
    canvasAlignmentHistoryService.compressHistory();
    updateHistoryState();
  }, [updateHistoryState]);

  // ==================== 键盘快捷键 ====================

  const handleKeyboardShortcuts = useCallback((event: KeyboardEvent) => {
    // 只处理对齐历史相关的快捷键
    if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
      switch (event.key.toLowerCase()) {
        case 'z': // Ctrl+Shift+Z - 重做对齐
          event.preventDefault();
          redo();
          break;
      }
    } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
      switch (event.key.toLowerCase()) {
        case 'z': // Ctrl+Z - 撤销对齐
          // 检查是否有可撤销的对齐操作
          if (canvasAlignmentHistoryService.canUndo()) {
            event.preventDefault();
            undo();
          }
          break;
      }
    }
  }, [undo, redo]);

  // ==================== 副作用 ====================

  // 键盘快捷键监听
  useEffect(() => {
    if (enableKeyboardShortcuts && !keyboardListenerAttached.current) {
      document.addEventListener('keydown', handleKeyboardShortcuts);
      keyboardListenerAttached.current = true;

      return () => {
        document.removeEventListener('keydown', handleKeyboardShortcuts);
        keyboardListenerAttached.current = false;
      };
    }
  }, [enableKeyboardShortcuts, handleKeyboardShortcuts]);

  // 自动压缩历史记录
  useEffect(() => {
    if (autoCompressHistory) {
      compressTimerRef.current = setInterval(() => {
        compressHistory();
      }, compressInterval);

      return () => {
        if (compressTimerRef.current) {
          clearInterval(compressTimerRef.current);
          compressTimerRef.current = null;
        }
      };
    }
  }, [autoCompressHistory, compressInterval, compressHistory]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (compressTimerRef.current) {
        clearInterval(compressTimerRef.current);
        compressTimerRef.current = null;
      }
    };
  }, []);

  // ==================== 返回值 ====================

  return {
    // 历史状态
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    nextUndoDescription: historyState.nextUndoDescription,
    nextRedoDescription: historyState.nextRedoDescription,
    totalEntries: historyState.totalEntries,
    currentIndex: historyState.currentIndex,

    // 操作方法
    recordAlignment,
    undo,
    redo,
    clearHistory,
    alignAndRecord,

    // 工具方法
    getHistoryInfo,
    getHistoryList,
    jumpToHistory,
    compressHistory,
  };
}

/**
 * 🎯 使用示例：
 * 
 * ```tsx
 * function AlignmentComponent() {
 *   const {
 *     canUndo,
 *     canRedo,
 *     nextUndoDescription,
 *     nextRedoDescription,
 *     recordAlignment,
 *     undo,
 *     redo,
 *     alignAndRecord
 *   } = useAlignmentHistory({
 *     enableKeyboardShortcuts: true,
 *     onUndo: (result) => {
 *       if (result.success) {
 *         updateCanvasNodes(result.nodes);
 *       }
 *     },
 *     onRedo: (result) => {
 *       if (result.success) {
 *         updateCanvasNodes(result.nodes);
 *       }
 *     }
 *   });
 * 
 *   const handleAlignment = async (alignmentType) => {
 *     const { result } = await alignAndRecord(selectedNodes, alignmentType);
 *     updateCanvasNodes(result.alignedNodes);
 *   };
 * 
 *   return (
 *     <div>
 *       <button onClick={() => handleAlignment(AlignmentType.LEFT)}>
 *         左对齐
 *       </button>
 *       <button onClick={undo} disabled={!canUndo} title={nextUndoDescription}>
 *         撤销
 *       </button>
 *       <button onClick={redo} disabled={!canRedo} title={nextRedoDescription}>
 *         重做
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */