/**
 * 🕰️ Canvas对齐操作历史记录服务
 * 
 * 专门处理节点对齐操作的撤销重做功能
 * 与现有的画布历史系统集成，为对齐操作提供精确的历史记录支持
 * 
 * @version 1.0.0
 * @author ZhenZhi Canvas Team
 */

import type { CanvasNode } from '../types/canvas';
import { AlignmentType, type AlignmentOptions, type AlignmentResult } from './canvas-node-alignment.service';
import { NodeAlignmentService } from './canvas-node-alignment.service';

// ==================== 接口定义 ====================

export interface AlignmentHistoryEntry {
  /** 历史记录ID */
  id: string;
  /** 对齐操作类型 */
  alignmentType: AlignmentType;
  /** 操作时间戳 */
  timestamp: number;
  /** 操作前的节点状态 */
  beforeNodes: CanvasNode[];
  /** 操作后的节点状态 */
  afterNodes: CanvasNode[];
  /** 对齐选项 */
  options: AlignmentOptions;
  /** 移动的节点数量 */
  movedCount: number;
  /** 操作描述 */
  description: string;
}

export interface AlignmentHistoryState {
  /** 历史记录栈 */
  entries: AlignmentHistoryEntry[];
  /** 当前历史索引 */
  currentIndex: number;
  /** 最大历史记录数 */
  maxEntries: number;
}

export interface AlignmentUndoRedoResult {
  /** 是否成功 */
  success: boolean;
  /** 恢复的节点状态 */
  nodes?: CanvasNode[];
  /** 错误信息 */
  error?: string;
  /** 操作类型 */
  operation: 'undo' | 'redo';
  /** 恢复的历史记录 */
  entry?: AlignmentHistoryEntry;
}

// ==================== 核心服务类 ====================

export class CanvasAlignmentHistoryService {
  private historyState: AlignmentHistoryState = {
    entries: [],
    currentIndex: -1,
    maxEntries: 50
  };

  // ==================== 历史记录管理 ====================

  /**
   * 记录对齐操作到历史
   */
  public recordAlignment(
    beforeNodes: CanvasNode[],
    afterNodes: CanvasNode[],
    alignmentType: AlignmentType,
    options: AlignmentOptions = {}
  ): string {
    const movedCount = this.calculateMovedCount(beforeNodes, afterNodes);
    
    const entry: AlignmentHistoryEntry = {
      id: this.generateId(),
      alignmentType,
      timestamp: Date.now(),
      beforeNodes: this.cloneNodes(beforeNodes),
      afterNodes: this.cloneNodes(afterNodes),
      options,
      movedCount,
      description: this.generateDescription(alignmentType, movedCount)
    };

    // 截断当前索引之后的历史记录（如果有的话）
    if (this.historyState.currentIndex < this.historyState.entries.length - 1) {
      this.historyState.entries = this.historyState.entries.slice(0, this.historyState.currentIndex + 1);
    }

    // 添加新的历史记录
    this.historyState.entries.push(entry);
    this.historyState.currentIndex = this.historyState.entries.length - 1;

    // 限制历史记录数量
    if (this.historyState.entries.length > this.historyState.maxEntries) {
      this.historyState.entries.shift();
      this.historyState.currentIndex = this.historyState.entries.length - 1;
    }

    // 对齐操作已记录到历史
    return entry.id;
  }

  /**
   * 撤销上一次对齐操作
   */
  public undo(): AlignmentUndoRedoResult {
    if (!this.canUndo()) {
      return {
        success: false,
        error: '没有可撤销的对齐操作',
        operation: 'undo'
      };
    }

    const entry = this.historyState.entries[this.historyState.currentIndex];
    this.historyState.currentIndex--;

    // 撤销对齐操作

    return {
      success: true,
      nodes: this.cloneNodes(entry.beforeNodes),
      operation: 'undo',
      entry
    };
  }

  /**
   * 重做下一次对齐操作
   */
  public redo(): AlignmentUndoRedoResult {
    if (!this.canRedo()) {
      return {
        success: false,
        error: '没有可重做的对齐操作',
        operation: 'redo'
      };
    }

    this.historyState.currentIndex++;
    const entry = this.historyState.entries[this.historyState.currentIndex];

    // 重做对齐操作

    return {
      success: true,
      nodes: this.cloneNodes(entry.afterNodes),
      operation: 'redo',
      entry
    };
  }

  // ==================== 状态查询 ====================

  /**
   * 是否可以撤销
   */
  public canUndo(): boolean {
    return this.historyState.currentIndex >= 0;
  }

  /**
   * 是否可以重做
   */
  public canRedo(): boolean {
    return this.historyState.currentIndex < this.historyState.entries.length - 1;
  }

  /**
   * 获取历史记录统计信息
   */
  public getHistoryInfo() {
    return {
      totalEntries: this.historyState.entries.length,
      currentIndex: this.historyState.currentIndex,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      maxEntries: this.historyState.maxEntries,
      nextUndoDescription: this.canUndo() 
        ? this.historyState.entries[this.historyState.currentIndex]?.description 
        : null,
      nextRedoDescription: this.canRedo() 
        ? this.historyState.entries[this.historyState.currentIndex + 1]?.description 
        : null
    };
  }

  /**
   * 获取历史记录列表（用于调试）
   */
  public getHistoryList(): AlignmentHistoryEntry[] {
    return this.historyState.entries.map(entry => ({ ...entry }));
  }

  // ==================== 工具方法 ====================

  /**
   * 清空历史记录
   */
  public clearHistory(): void {
    this.historyState.entries = [];
    this.historyState.currentIndex = -1;
    // 对齐操作历史记录已清空
  }

  /**
   * 一键执行对齐并记录历史
   */
  public async alignAndRecord(
    nodes: CanvasNode[],
    alignmentType: AlignmentType,
    options: AlignmentOptions = {}
  ): Promise<{ result: AlignmentResult; historyId: string }> {
    // 保存操作前的状态
    const beforeNodes = this.cloneNodes(nodes);

    // 执行对齐
    const result = NodeAlignmentService.align(nodes, alignmentType, options);

    // 记录到历史
    const historyId = this.recordAlignment(beforeNodes, result.alignedNodes, alignmentType, options);

    return { result, historyId };
  }

  // ==================== 私有方法 ====================

  private cloneNodes(nodes: CanvasNode[]): CanvasNode[] {
    return nodes.map(node => ({ ...node }));
  }

  private calculateMovedCount(beforeNodes: CanvasNode[], afterNodes: CanvasNode[]): number {
    if (beforeNodes.length !== afterNodes.length) {
      return afterNodes.length;
    }

    let movedCount = 0;
    for (let i = 0; i < beforeNodes.length; i++) {
      const before = beforeNodes[i];
      const after = afterNodes[i];
      
      if (before.x !== after.x || before.y !== after.y) {
        movedCount++;
      }
    }

    return movedCount;
  }

  private generateDescription(alignmentType: AlignmentType, movedCount: number): string {
    const typeMap = {
      [AlignmentType.LEFT]: '左对齐',
      [AlignmentType.RIGHT]: '右对齐',
      [AlignmentType.TOP]: '顶部对齐',
      [AlignmentType.BOTTOM]: '底部对齐',
      [AlignmentType.CENTER_H]: '水平居中',
      [AlignmentType.CENTER_V]: '垂直居中'
    };

    return `${typeMap[alignmentType]}（移动${movedCount}个节点）`;
  }

  private generateId(): string {
    return `align_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ==================== 高级功能 ====================

  /**
   * 获取指定历史记录的详细信息
   */
  public getHistoryEntry(id: string): AlignmentHistoryEntry | null {
    return this.historyState.entries.find(entry => entry.id === id) || null;
  }

  /**
   * 跳转到指定的历史记录
   */
  public jumpToHistory(id: string): AlignmentUndoRedoResult {
    const targetIndex = this.historyState.entries.findIndex(entry => entry.id === id);
    
    if (targetIndex === -1) {
      return {
        success: false,
        error: '指定的历史记录不存在',
        operation: targetIndex < this.historyState.currentIndex ? 'undo' : 'redo'
      };
    }

    const entry = this.historyState.entries[targetIndex];
    this.historyState.currentIndex = targetIndex;

    // 跳转到历史记录

    return {
      success: true,
      nodes: this.cloneNodes(entry.afterNodes),
      operation: targetIndex < this.historyState.currentIndex ? 'undo' : 'redo',
      entry
    };
  }

  /**
   * 压缩历史记录（移除重复或相似的操作）
   */
  public compressHistory(): void {
    const compressed: AlignmentHistoryEntry[] = [];
    let lastEntry: AlignmentHistoryEntry | null = null;

    for (const entry of this.historyState.entries) {
      if (!lastEntry || !this.areEntriesSimilar(lastEntry, entry)) {
        compressed.push(entry);
        lastEntry = entry;
      }
    }

    const removedCount = this.historyState.entries.length - compressed.length;
    this.historyState.entries = compressed;
    this.historyState.currentIndex = Math.min(this.historyState.currentIndex, compressed.length - 1);

    if (removedCount > 0) {
      // 历史记录压缩完成
    }
  }

  private areEntriesSimilar(entry1: AlignmentHistoryEntry, entry2: AlignmentHistoryEntry): boolean {
    // 检查是否为相同类型的对齐操作，且在短时间内执行
    const timeDiff = Math.abs(entry2.timestamp - entry1.timestamp);
    const isSameType = entry1.alignmentType === entry2.alignmentType;
    const isQuickSequence = timeDiff < 1000; // 1秒内

    return isSameType && isQuickSequence && entry1.movedCount === entry2.movedCount;
  }
}

// ==================== 导出 ====================

export const canvasAlignmentHistoryService = new CanvasAlignmentHistoryService();

/**
 * 🎯 使用示例：
 * 
 * ```tsx
 * // 记录对齐操作
 * const historyId = canvasAlignmentHistoryService.recordAlignment(
 *   originalNodes,
 *   alignedNodes,
 *   AlignmentType.LEFT,
 *   { preserveZIndex: true }
 * );
 * 
 * // 撤销操作
 * const undoResult = canvasAlignmentHistoryService.undo();
 * if (undoResult.success) {
 *   updateCanvasNodes(undoResult.nodes);
 * }
 * 
 * // 重做操作
 * const redoResult = canvasAlignmentHistoryService.redo();
 * if (redoResult.success) {
 *   updateCanvasNodes(redoResult.nodes);
 * }
 * 
 * // 检查状态
 * const info = canvasAlignmentHistoryService.getHistoryInfo();
 * // 检查状态：info.canUndo, info.canRedo
 * ```
 */