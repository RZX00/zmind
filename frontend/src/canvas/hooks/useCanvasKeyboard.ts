// ⌨️ Canvas键盘快捷键Hook - 完整重新实现
// 修复无限重渲染问题，恢复所有键盘快捷键功能

import { useState, useEffect, useCallback, useRef } from 'react';
import { useCanvasStore } from '../stores/canvas.store';
import { useCanUndo, useCanRedo, useToolMode } from './useCanvasSelector';
import type { Canvas, CanvasNode, CanvasToolMode } from '../types/canvas';

interface KeyboardOptions {
  enabled?: boolean;
  enableHistory?: boolean;
  enableSave?: boolean;
  enableDeleteKey?: boolean;
  onKeyDown?: (event: KeyboardEvent) => void;
  
  // 工具模式控制
  toolMode?: CanvasToolMode;
  onToolModeChange?: (mode: CanvasToolMode) => void;
  
  // 节点操作
  selectedNodes?: string[];
  onDeleteNodes?: (nodeIds: string[]) => void;
  onSelectAll?: () => void;
  
  // 连线操作
  selectedConnections?: string[];
  onDeleteConnections?: (connectionIds: string[]) => void;
  
  // 编辑模式状态
  isEditMode?: boolean;
}

export interface UseCanvasKeyboardReturn {
  isEnabled: boolean;
  isSpacePressed: boolean;
  effectiveToolMode: CanvasToolMode;
  shortcuts: Record<string, string>;
}

export const useCanvasKeyboard = (options: KeyboardOptions = {}): UseCanvasKeyboardReturn => {
  // 🚀 单一数据流：直接使用Store状态
  const toolMode = useToolMode();

  const {
    enabled = true,
    enableHistory = true,
    enableSave = true,
    enableDeleteKey = true,
    onToolModeChange,
    selectedNodes = [],
    onDeleteNodes,
    onSelectAll,
    selectedConnections = [],
    onDeleteConnections,
    isEditMode = false,
    onKeyDown,
  } = options;

  // 🎯 本地状态管理 - 只管理临时状态
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  
  // 🔧 使用refs缓存回调和状态，避免重渲染
  const callbacksRef = useRef({
    onToolModeChange,
    onDeleteNodes,
    onSelectAll,
    onDeleteConnections,
    selectedConnections,
    onKeyDown,
  });
  
  // 更新refs但不触发重渲染
  callbacksRef.current = {
    onToolModeChange,
    onDeleteNodes,
    onSelectAll,
    onDeleteConnections,
    selectedConnections,
    onKeyDown,
  };

  // 🔍 从store获取选中的节点ID
  const selectedNodeId = useCanvasStore(state => state.selectedNodeId);
  
  // 🔍 获取历史状态 - 使用稳定的选择器，避免无限循环
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  // 🔍 检查是否在输入元素中 - 稳定的函数，无依赖
  const isInputElement = useCallback((target: EventTarget | null): boolean => {
    if (!target || !(target instanceof Element)) return false;
    
    const tagName = target.tagName.toLowerCase();
    const inputElements = ['input', 'textarea', 'select'];
    
    // 检查是否是输入元素
    if (inputElements.includes(tagName)) return true;
    
    // 检查是否有contenteditable属性
    if (target.hasAttribute('contenteditable')) return true;
    
    // 检查父元素是否有输入类的class（如编辑器组件）
    let element: Element | null = target;
    while (element) {
      if (element.classList?.contains('cm-editor') ||
          element.classList?.contains('cm-content') ||
          element.getAttribute('role') === 'textbox' ||
          element.classList?.contains('editor-textarea') ||
          element.classList?.contains('editable-input')) {
        return true;
      }
      element = element.parentElement;
    }
    
    return false;
  }, []);

  // ⌨️ 键盘事件处理函数 - 使用useCallback确保稳定引用
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // 基础检查
    if (!enabled || isInputElement(event.target)) {
      return;
    }
    
    // 如果正在输入法组合，不处理
    if (event.isComposing || event.keyCode === 229) {
      return;
    }

    const isCtrlOrCmd = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;

    // 阻止默认行为的快捷键
    // 不要阻止 Ctrl/Cmd+V（粘贴）。仅在无需粘贴时阻止默认行为。
    const shouldPreventDefault = [
      'KeyZ', 'KeyY', 'KeyS', 'KeyD', 'KeyA', 'Delete', 'Backspace', 'Escape', 'KeyH', 'Space', 'KeyG'
    ].includes(event.code) && (isCtrlOrCmd || ['Delete', 'Backspace', 'Escape', 'KeyH', 'Space', 'KeyG'].includes(event.code));

    if (shouldPreventDefault) {
      event.preventDefault();
    }

    try {
      // 🎯 工具模式切换快捷键
      switch (event.code) {
        case 'KeyV':
          // 仅在非 Ctrl/Cmd 场景下切换到选择工具；Ctrl/Cmd+V 用于粘贴
          if (!isCtrlOrCmd) {
            if (toolMode !== 'select') {
              const store = useCanvasStore.getState();
              store.setToolMode('select');
            }
            return;
          }
          break; // 允许继续，交给系统粘贴

        case 'KeyH':
          if (toolMode !== 'hand') {
            const store = useCanvasStore.getState();
            store.setToolMode('hand');
          }
          return;
          
        case 'Space':
          // 空格键按下：临时切换到手型模式（Chat 模式同样允许）
          setIsSpacePressed(prev => {
            if (!prev) {
              return true;
            }
            return prev;
          });
          return;
          
        case 'Delete':
        case 'Backspace':
          // Chat 模式也允许删除（只要不在输入框内）
          if (enableDeleteKey) {
            // 优先处理多选节点删除
            if (callbacksRef.current.onDeleteNodes && selectedNodes.length > 0) {
              callbacksRef.current.onDeleteNodes(selectedNodes);
            } 
            // 处理连线删除
            else if (callbacksRef.current.onDeleteConnections && callbacksRef.current.selectedConnections && callbacksRef.current.selectedConnections.length > 0) {
              callbacksRef.current.onDeleteConnections(callbacksRef.current.selectedConnections);
            }
            // 处理单个节点删除
            else if (selectedNodeId) {
              const store = useCanvasStore.getState();
              store.removeNode(selectedNodeId);
            }
          }
          return;
          
        case 'Escape': {
          // 清除选择
          const store = useCanvasStore.getState();
          store.clearSelection();
          return;
        }
      }

      // 💾 Ctrl/Cmd组合键操作
      if (isCtrlOrCmd) {
        switch (event.code) {
          case 'KeyZ':
            if (enableHistory) {
              const store = useCanvasStore.getState();
              if (!isShift && canUndo) {
                // 撤销
                store.undo();
              } else if (isShift && canRedo) {
                // 重做 (Ctrl+Shift+Z)
                store.redo();
              }
            }
            return;
            
          case 'KeyY':
            if (enableHistory && canRedo) {
              // 重做 (Ctrl+Y)
              const store = useCanvasStore.getState();
              store.redo();
            }
            return;
            
          case 'KeyS':
            if (enableSave) {
              // 保存
              const store = useCanvasStore.getState();
              store.saveCanvas();
            }
            return;
            
          case 'KeyD':
            if (isEditMode && selectedNodeId) {
              // 🎯 检查选中节点类型，如果是todo节点则跳过，让NodeContainer处理
              const store = useCanvasStore.getState();
              const selectedNode = store.canvas.nodes.find(node => node.id === selectedNodeId);
              
              if (selectedNode?.type === 'todo') {
                // Todo节点的Ctrl+D在NodeContainer中处理状态切换
                console.log('🎯 Todo节点Ctrl+D跳过复制逻辑，交给NodeContainer处理');
                return;
              }
              
              // 其他类型节点正常复制
              store.duplicateNode(selectedNodeId);
            }
            return;
            
          case 'KeyA':
            // 全选功能 - Chat 模式也允许（输入框内已提前返回）
            callbacksRef.current.onSelectAll?.();
            return;

          case 'KeyG': {
            // Ctrl/Cmd+G: 切换智能吸附（Smart Guides）开关
            try {
              const settingsStore = require('../stores/settings.store') as typeof import('../stores/settings.store');
              const current = settingsStore.useSettingsStore.getState().guides;
              const setGuides = settingsStore.useSettingsStore.getState().setGuides;
              if (setGuides) {
                setGuides({ enabled: !(current?.enabled !== false) });
              }
            } catch {
              // 忽略快捷键错误
            }
            return;
          }
        }
      }

      // 自定义键盘事件处理
      callbacksRef.current.onKeyDown?.(event);

    } catch (error) {
      console.error('❌ 键盘快捷键处理失败:', error);
    }
  }, [
    // 最小化依赖数组，只包含真正影响逻辑的值
    enabled,
    isEditMode,
    enableHistory,
    enableSave,
    enableDeleteKey,
    toolMode,
    selectedNodeId,
    selectedNodes,
    canUndo,
    canRedo,
    isInputElement,
  ]);

  // ⌨️ 键盘释放事件处理
  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    // 只处理空格键释放
    if (event.code === 'Space') {
      setIsSpacePressed(prev => {
        if (prev) {
          return false;
        }
        return prev;
      });
    }
  }, []);

  // 🎮 全局事件监听 - 最小依赖
  useEffect(() => {
    if (!enabled) {
      return;
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [enabled, handleKeyDown, handleKeyUp]);

  // 🎯 计算有效的工具模式
  // Respect all tool modes from store (select | hand | line | ...)
  const baseMode: CanvasToolMode = toolMode as CanvasToolMode;
  const effectiveToolMode: CanvasToolMode = isSpacePressed ? 'hand' : baseMode;

  // ⚡ 返回稳定的对象，避免重渲染
  return {
    isEnabled: enabled,
    isSpacePressed,
    effectiveToolMode,
    shortcuts: {
      // 工具模式切换
      select: 'V (选择工具)',
      hand: 'H (手型工具)', 
      tempHand: 'Space (临时手型工具，按住)',
      // 编辑操作
      undo: 'Ctrl+Z / ⌘+Z',
      redo: 'Ctrl+Y / ⌘+Y / Ctrl+Shift+Z / ⌘+Shift+Z',
      save: 'Ctrl+S / ⌘+S',
      delete: 'Delete/Backspace',
      duplicate: 'Ctrl+D / ⌘+D (复制节点，Todo节点为切换状态)',
      expandedEdit: 'Ctrl+Shift+Enter / ⌘+Shift+Enter (展开编辑)',
      clearSelection: 'Escape',
    },
  };
};

// 📋 默认快捷键列表（用于显示帮助）
export const DEFAULT_KEYBOARD_SHORTCUTS = [
  { key: 'V', action: 'select', description: '选择工具' },
  { key: 'H', action: 'hand', description: '手型工具' },
  { key: 'Space', action: 'temp-hand', description: '临时手型工具（按住）' },
  { key: 'Delete/Backspace', action: 'delete', description: '删除选中节点' },
  { key: 'Ctrl+Z', action: 'undo', description: '撤销' },
  { key: 'Ctrl+Y', action: 'redo', description: '重做' },
  { key: 'Ctrl+S', action: 'save', description: '保存' },
  { key: 'Ctrl+D', action: 'duplicate', description: '复制节点 / Todo节点切换状态' },
  { key: 'Ctrl+Shift+Enter', action: 'expanded-edit', description: '打开展开编辑' },
  { key: 'Escape', action: 'clear', description: '清除选择' },
] as const;
