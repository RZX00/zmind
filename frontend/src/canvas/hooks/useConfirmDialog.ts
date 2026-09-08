// 🎯 自定义确认对话框Hook
// 提供简洁的API替换原生alert、confirm、prompt

import { useState, useCallback } from 'react';

export type DialogType = 'confirm' | 'warning' | 'error' | 'success' | 'alert' | 'prompt';

export interface DialogState {
  isOpen: boolean;
  type: DialogType;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  placeholder: string;
  defaultValue: string;
  showCancel: boolean;
}

interface DialogOptions {
  type?: DialogType;
  title?: string;
  confirmText?: string;
  cancelText?: string;
  placeholder?: string;
  defaultValue?: string;
  showCancel?: boolean;
}

const DEFAULT_STATE: DialogState = {
  isOpen: false,
  type: 'confirm',
  title: 'Confirm',
  message: '',
  confirmText: 'OK',
  cancelText: 'Cancel',
  placeholder: '',
  defaultValue: '',
  showCancel: true,
};

export const useConfirmDialog = () => {
  const [dialogState, setDialogState] = useState<DialogState>(DEFAULT_STATE);
  const [resolvePromise, setResolvePromise] = useState<{
    resolve: (value: string | boolean | null) => void;
  } | null>(null);

  // 🎯 显示确认对话框 (替换confirm)
  const confirm = useCallback((message: string, options: DialogOptions = {}): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialogState({
        ...DEFAULT_STATE,
        isOpen: true,
        type: 'confirm',
        title: options.title || 'Confirm Action',
        message,
        confirmText: options.confirmText || 'OK',
        cancelText: options.cancelText || 'Cancel',
        showCancel: options.showCancel !== false,
      });
      
      setResolvePromise({ resolve: resolve as (value: boolean) => void });
    });
  }, []);

  // 🚨 显示警告确认对话框
  const warning = useCallback((message: string, options: DialogOptions = {}): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialogState({
        ...DEFAULT_STATE,
        isOpen: true,
        type: 'warning',
        title: options.title || 'Warning',
        message,
        confirmText: options.confirmText || 'OK',
        cancelText: options.cancelText || 'Cancel',
        showCancel: options.showCancel !== false,
      });
      
      setResolvePromise({ resolve: resolve as (value: boolean) => void });
    });
  }, []);

  // ❌ 显示错误对话框 (替换alert - 错误类型)
  const error = useCallback((message: string, options: DialogOptions = {}): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialogState({
        ...DEFAULT_STATE,
        isOpen: true,
        type: 'error',
        title: options.title || 'Error',
        message,
        confirmText: options.confirmText || 'Got it',
        showCancel: false,
      });
      
      setResolvePromise({ resolve: resolve as (value: boolean) => void });
    });
  }, []);

  // ✅ 显示成功对话框
  const success = useCallback((message: string, options: DialogOptions = {}): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialogState({
        ...DEFAULT_STATE,
        isOpen: true,
        type: 'success',
        title: options.title || 'Success',
        message,
        confirmText: options.confirmText || 'OK',
        showCancel: false,
      });
      
      setResolvePromise({ resolve: resolve as (value: boolean) => void });
    });
  }, []);

  // ℹ️ 显示信息对话框 (替换alert - 信息类型)
  const alert = useCallback((message: string, options: DialogOptions = {}): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialogState({
        ...DEFAULT_STATE,
        isOpen: true,
        type: 'alert',
        title: options.title || 'Notice',
        message,
        confirmText: options.confirmText || 'Got it',
        showCancel: false,
      });
      
      setResolvePromise({ resolve: resolve as (value: boolean) => void });
    });
  }, []);

  // 📝 显示输入对话框 (替换prompt)
  const prompt = useCallback((message: string, options: DialogOptions = {}): Promise<string | null> => {
    return new Promise((resolve) => {
      setDialogState({
        ...DEFAULT_STATE,
        isOpen: true,
        type: 'prompt',
        title: options.title || 'Input',
        message,
        confirmText: options.confirmText || 'OK',
        cancelText: options.cancelText || 'Cancel',
        placeholder: options.placeholder || '',
        defaultValue: options.defaultValue || '',
        showCancel: options.showCancel !== false,
      });
      
      setResolvePromise({ resolve: resolve as (value: string | null) => void });
    });
  }, []);

  // 🎯 处理确认
  const handleConfirm = useCallback((value?: string) => {
    if (resolvePromise) {
      if (dialogState.type === 'prompt') {
        resolvePromise.resolve(value || '');
      } else {
        resolvePromise.resolve(true);
      }
      
      setResolvePromise(null);
    }
    
    setDialogState(DEFAULT_STATE);
  }, [resolvePromise, dialogState.type]);

  // ❌ 处理取消
  const handleCancel = useCallback(() => {
    if (resolvePromise) {
      if (dialogState.type === 'prompt') {
        resolvePromise.resolve(null);
      } else {
        resolvePromise.resolve(false);
      }
      
      setResolvePromise(null);
    }
    
    setDialogState(DEFAULT_STATE);
  }, [resolvePromise, dialogState.type]);

  return {
    // 对话框状态
    dialogState,
    
    // 事件处理
    handleConfirm,
    handleCancel,
    
    // API方法
    confirm,
    warning,
    error,
    success,
    alert,
    prompt,
  };
};
