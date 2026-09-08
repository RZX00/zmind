// 🔄 自动保存Hook - 防抖保存机制
// 监听Canvas状态变化，自动保存到localStorage，支持防抖和错误处理

import { useEffect, useRef, useCallback } from 'react';
import { useCanvasStore } from '../stores/canvas.store';

interface AutoSaveOptions {
  enabled?: boolean;
  debounceMs?: number;
  onSave?: () => void;
  onError?: (error: Error) => void;
}

export const useAutoSave = (options: AutoSaveOptions = {}) => {
  const {
    enabled = true,
    debounceMs = 1000, // 默认1秒防抖
    onSave,
    onError,
  } = options;

  const isDirty = useCanvasStore(state => state.isDirty);
  const saveCanvas = useCanvasStore(state => state.saveCanvas);
  const persistDraft = useCanvasStore(state => state.persistDraft);
  const autoSaveEnabled = useCanvasStore(state => state.autoSaveEnabled);
  
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const isActiveRef = useRef(true);

  // 清理定时器
  const clearDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  // 执行保存
  const performSave = useCallback(async () => {
    if (!isActiveRef.current) return;

    try {
      await saveCanvas();
      onSave?.();
      console.log('Auto-save completed');
    } catch (error) {
      persistDraft('save_error', { force: true });
      console.error('Auto-save failed:', error);
      onError?.(error as Error);
    }
  }, [saveCanvas, onSave, onError, persistDraft]);

  // 防抖保存
  const debouncedSave = useCallback(() => {
    if (!enabled || !autoSaveEnabled || !isDirty) return;

    clearDebounce();
    debounceRef.current = setTimeout(() => {
      performSave();
    }, debounceMs);
  }, [enabled, autoSaveEnabled, isDirty, debounceMs, performSave, clearDebounce]);

  // 监听状态变化 - 移除debouncedSave依赖，避免循环
  useEffect(() => {
    if (!enabled || !autoSaveEnabled || !isDirty) return;

    clearDebounce();
    debounceRef.current = setTimeout(() => {
      performSave();
    }, debounceMs);
  }, [isDirty, enabled, autoSaveEnabled, debounceMs, performSave, clearDebounce]);

  // 组件卸载时清理
  useEffect(() => {
    isActiveRef.current = true;
    
    return () => {
      isActiveRef.current = false;
      clearDebounce();
      
      // 组件卸载时如果有未保存的更改，立即保存
      if (isDirty && enabled && autoSaveEnabled) {
        persistDraft('before_unload', { force: true });
        performSave();
      }
    };
  }, [clearDebounce, isDirty, enabled, autoSaveEnabled, performSave, persistDraft]);

  // 页面关闭前保存
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isDirty && enabled && autoSaveEnabled) {
        // Note: 页面关闭时只能进行同步操作，所以这里可能无法使用async saveCanvas
        // Use synchronous localStorage for a last-chance draft.
        persistDraft('before_unload', { force: true });
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty, enabled, autoSaveEnabled, persistDraft]);

  return {
    isDirty,
    isAutoSaveEnabled: enabled && autoSaveEnabled,
    forceSave: performSave,
    clearPendingSave: clearDebounce,
  };
};
