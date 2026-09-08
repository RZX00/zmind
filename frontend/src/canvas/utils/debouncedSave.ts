// 🎯 防抖保存工具 - 优化Canvas高频保存性能
// 解决拖拽过程中的频繁保存问题

import type { Canvas, CanvasNode } from '../../types/canvas';
import { debugLog } from './devLogger';

interface DebouncedSaveOptions {
  delay?: number;
  immediate?: boolean;
  onSaveStart?: () => void;
  onSaveComplete?: () => void;
  onSaveError?: (error: any) => void;
}

/**
 * 创建防抖保存函数
 * @param saveFunction 实际的保存函数
 * @param options 配置选项
 */
export function createDebouncedSave<T extends any[]>(
  saveFunction: (...args: T) => Promise<void>,
  options: DebouncedSaveOptions = {}
) {
  const {
    delay = 500, // 默认500ms防抖延迟
    immediate = false, // 是否立即执行第一次
    onSaveStart,
    onSaveComplete,
    onSaveError
  } = options;

  let timeoutId: NodeJS.Timeout | null = null;
  let lastArgs: T | null = null;
  let isFirstCall = true;
  let isSaving = false;

  const debouncedFunction = async (...args: T) => {
    lastArgs = args;

    // 如果正在保存中，只更新参数，不重新开始计时
    if (isSaving) {
      debugLog('⏳ 保存进行中，更新参数', '', 'DebouncedSave');
      return;
    }

    // 清除之前的定时器
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    const execute = async () => {
      if (!lastArgs) return;
      
      try {
        isSaving = true;
        onSaveStart?.();
        debugLog('💾 执行防抖保存', '', 'DebouncedSave');
        
        await saveFunction(...lastArgs);
        
        onSaveComplete?.();
        debugLog('✅ 防抖保存完成', '', 'DebouncedSave');
      } catch (error) {
        onSaveError?.(error);
        console.error('❌ 防抖保存失败:', error);
      } finally {
        isSaving = false;
      }
    };

    // 立即执行首次调用
    if (immediate && isFirstCall) {
      isFirstCall = false;
      await execute();
    } else {
      // 防抖延迟执行
      timeoutId = setTimeout(execute, delay);
    }
  };

  // 提供手动清除防抖的方法
  debouncedFunction.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  // 提供立即执行的方法
  debouncedFunction.flush = async () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (lastArgs) {
      await debouncedFunction(...lastArgs);
    }
  };

  return debouncedFunction;
}

/**
 * Canvas专用的防抖保存工具
 */
export function createCanvasDebouncedSave(
  saveFunction: (canvas: Canvas) => Promise<void>,
  options: DebouncedSaveOptions = {}
) {
  return createDebouncedSave(saveFunction, {
    delay: 300, // Canvas操作使用更短的延迟
    ...options
  });
}