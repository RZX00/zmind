/**
 * 🎯 节点对齐Hook
 * 
 * 提供节点对齐功能的React Hook，简化组件中的对齐操作
 * 包含状态管理、预览效果、撤销重做等功能
 * 
 * @version 1.0.0
 * @author ZhenZhi Canvas Team
 */

import { useState, useCallback, useRef } from 'react';
import type { Canvas, CanvasNode } from '../../types/canvas';
import { 
  AlignmentType, 
  type AlignmentOptions, 
  type AlignmentResult,
  type AlignmentPreview,
  type AlignmentHistoryItem,
  DEFAULT_ALIGNMENT_OPTIONS 
} from '../types/node-alignment';
import { NodeAlignmentService } from '../services/canvas-node-alignment.service';
import { generateId } from '../utils/canvasUtils';

// ==================== Hook接口定义 ====================

interface UseNodeAlignmentOptions {
  /** 默认对齐选项 */
  defaultOptions?: AlignmentOptions;
  /** 是否启用预览效果 */
  enablePreview?: boolean;
  /** 是否启用历史记录 */
  enableHistory?: boolean;
  /** 最大历史记录数量 */
  maxHistorySize?: number;
}

interface UseNodeAlignmentReturn {
  /** 当前是否正在对齐 */
  isAligning: boolean;
  /** 对齐预览状态 */
  preview: AlignmentPreview | null;
  /** 历史记录 */
  history: AlignmentHistoryItem[];
  /** 当前历史索引 */
  historyIndex: number;
  
  // 对齐操作方法
  /** 执行对齐操作 */
  align: (nodes: CanvasNode[], type: AlignmentType, options?: AlignmentOptions) => Promise<AlignmentResult>;
  /** 开始预览对齐效果 */
  startPreview: (nodes: CanvasNode[], type: AlignmentType, options?: AlignmentOptions) => void;
  /** 清除预览效果 */
  clearPreview: () => void;
  /** 撤销上一次对齐 */
  undo: () => AlignmentHistoryItem | null;
  /** 重做下一次对齐 */
  redo: () => AlignmentHistoryItem | null;
  /** 清除历史记录 */
  clearHistory: () => void;
  /** 是否可以撤销 */
  canUndo: boolean;
  /** 是否可以重做 */
  canRedo: boolean;
}

// ==================== Hook实现 ====================

/**
 * 节点对齐Hook
 */
export function useNodeAlignment(options: UseNodeAlignmentOptions = {}): UseNodeAlignmentReturn {
  const {
    defaultOptions = DEFAULT_ALIGNMENT_OPTIONS,
    enablePreview = true,
    enableHistory = true,
    maxHistorySize = 50
  } = options;

  // ==================== 状态管理 ====================
  
  const [isAligning, setIsAligning] = useState(false);
  const [preview, setPreview] = useState<AlignmentPreview | null>(null);
  const [history, setHistory] = useState<AlignmentHistoryItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  // 使用ref避免闭包问题
  const historyRef = useRef(history);
  const historyIndexRef = useRef(historyIndex);
  historyRef.current = history;
  historyIndexRef.current = historyIndex;

  // ==================== 核心对齐方法 ====================
  
  const align = useCallback(async (
    nodes: CanvasNode[], 
    type: AlignmentType, 
    alignOptions?: AlignmentOptions
  ): Promise<AlignmentResult> => {
    if (isAligning) {
      throw new Error('对齐操作正在进行中');
    }

    setIsAligning(true);
    
    try {
      // 合并选项
      const finalOptions = { ...defaultOptions, ...alignOptions };
      
      // 记录操作前状态（如果启用历史）
      const beforeState = enableHistory ? new Map(
        nodes.map(node => [node.id, { x: node.x, y: node.y }])
      ) : new Map();
      
      // 执行对齐
      const result = NodeAlignmentService.align(nodes, type, finalOptions);
      
      // 记录到历史（如果启用）
      if (enableHistory && result.movedCount > 0) {
        const afterState = new Map(
          result.alignedNodes.map(node => [node.id, { x: node.x, y: node.y }])
        );
        
        const historyItem: AlignmentHistoryItem = {
          id: generateId(),
          type,
          beforeState,
          afterState,
          timestamp: Date.now(),
          options: finalOptions
        };
        
        // 添加到历史记录
        setHistory(prev => {
          const newHistory = prev.slice(0, historyIndexRef.current + 1);
          newHistory.push(historyItem);
          
          // 限制历史记录大小
          if (newHistory.length > maxHistorySize) {
            newHistory.shift();
            return newHistory;
          }
          
          return newHistory;
        });
        
        setHistoryIndex(prev => prev + 1);
      }
      
      // 清除预览（如果有）
      if (preview) {
        setPreview(null);
      }
      
      return result;
      
    } finally {
      setIsAligning(false);
    }
  }, [isAligning, defaultOptions, enableHistory, maxHistorySize, preview]);

  // ==================== 预览功能 ====================
  
  const startPreview = useCallback((
    nodes: CanvasNode[], 
    type: AlignmentType, 
    alignOptions?: AlignmentOptions
  ) => {
    if (!enablePreview) return;
    
    try {
      const finalOptions = { ...defaultOptions, ...alignOptions };
      const result = NodeAlignmentService.align(nodes, type, finalOptions);
      
      // 计算预览位置映射
      const positions = new Map(
        result.alignedNodes.map(node => [node.id, { x: node.x, y: node.y }])
      );
      
      setPreview({
        positions,
        alignmentLine: result.alignmentLine,
        alignmentType: type,
        showPreview: true
      });
      
    } catch (error) {
      console.error('生成预览失败:', error);
    }
  }, [enablePreview, defaultOptions]);

  const clearPreview = useCallback(() => {
    setPreview(null);
  }, []);

  // ==================== 历史操作 ====================
  
  const undo = useCallback((): AlignmentHistoryItem | null => {
    if (!enableHistory || historyIndexRef.current < 0) return null;
    
    const item = historyRef.current[historyIndexRef.current];
    setHistoryIndex(prev => prev - 1);
    return item;
  }, [enableHistory]);

  const redo = useCallback((): AlignmentHistoryItem | null => {
    if (!enableHistory || historyIndexRef.current >= historyRef.current.length - 1) return null;
    
    const item = historyRef.current[historyIndexRef.current + 1];
    setHistoryIndex(prev => prev + 1);
    return item;
  }, [enableHistory]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setHistoryIndex(-1);
  }, []);

  // ==================== 计算属性 ====================
  
  const canUndo = enableHistory && historyIndex >= 0;
  const canRedo = enableHistory && historyIndex < history.length - 1;

  // ==================== 返回接口 ====================
  
  return {
    isAligning,
    preview,
    history,
    historyIndex,
    align,
    startPreview,
    clearPreview,
    undo,
    redo,
    clearHistory,
    canUndo,
    canRedo
  };
}

// ==================== 导出 ====================

export default useNodeAlignment;

/**
 * 🎯 使用示例：
 * 
 * ```tsx
 * function MyComponent() {
 *   const {
 *     isAligning,
 *     preview,
 *     align,
 *     startPreview,
 *     clearPreview,
 *     undo,
 *     redo,
 *     canUndo,
 *     canRedo
 *   } = useNodeAlignment({
 *     enablePreview: true,
 *     enableHistory: true,
 *     maxHistorySize: 50
 *   });
 *   
 *   const handleAlign = async (nodes: CanvasNode[], type: AlignmentType) => {
 *     try {
 *       const result = await align(nodes, type);
 *       console.log(`对齐完成，移动了 ${result.movedCount} 个节点`);
 *     } catch (error) {
 *       console.error('对齐失败:', error);
 *     }
 *   };
 *   
 *   return (
 *     <div>
 *       <button onClick={() => handleAlign(selectedNodes, AlignmentType.LEFT)}>
 *         左对齐
 *       </button>
 *       {preview && <AlignmentPreviewComponent preview={preview} />}
 *       <button onClick={undo} disabled={!canUndo}>撤销</button>
 *       <button onClick={redo} disabled={!canRedo}>重做</button>
 *     </div>
 *   );
 * }
 * ```
 */