/**
 * 🎹 对齐快捷键Hook
 * 
 * 为节点对齐功能提供键盘快捷键支持
 * 支持自定义快捷键组合和禁用状态
 * 
 * @version 1.0.0
 * @author ZhenZhi Canvas Team
 */

import { useEffect, useCallback, useRef } from 'react';
import type { Canvas, CanvasNode } from '../../types/canvas';
import { 
  AlignmentType, 
  type KeyboardShortcuts, 
  DEFAULT_KEYBOARD_SHORTCUTS 
} from '../types/node-alignment';

// ==================== 接口定义 ====================

interface UseAlignmentKeyboardOptions {
  /** 选中的节点列表 */
  selectedNodes: CanvasNode[];
  /** 对齐回调函数 */
  onAlignment: (nodes: CanvasNode[], type: AlignmentType) => void;
  /** 自定义快捷键映射 */
  shortcuts?: Partial<KeyboardShortcuts>;
  /** 是否启用快捷键 */
  enabled?: boolean;
  /** 是否在输入框聚焦时禁用快捷键 */
  disableInInputs?: boolean;
  /** 是否需要编辑模式才能使用快捷键 */
  requireEditMode?: boolean;
  /** 当前是否处于编辑模式 */
  isEditMode?: boolean;
}

interface UseAlignmentKeyboardReturn {
  /** 是否启用快捷键 */
  isEnabled: boolean;
  /** 当前快捷键映射 */
  shortcuts: KeyboardShortcuts;
  /** 手动触发快捷键 */
  triggerShortcut: (type: AlignmentType) => void;
  /** 启用/禁用快捷键 */
  setEnabled: (enabled: boolean) => void;
}

// ==================== 工具函数 ====================

/**
 * 解析快捷键字符串为键值组合
 */
function parseShortcut(shortcut: string): {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
} {
  const parts = shortcut.toLowerCase().split('+').map(part => part.trim());
  
  return {
    ctrl: parts.includes('ctrl') || parts.includes('control'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
    meta: parts.includes('meta') || parts.includes('cmd'),
    key: parts[parts.length - 1] // 最后一个部分是实际的键
  };
}

/**
 * 检查快捷键是否匹配
 */
function isShortcutMatch(
  event: KeyboardEvent,
  shortcut: string
): boolean {
  const { ctrl, alt, shift, meta, key } = parseShortcut(shortcut);
  
  return (
    event.ctrlKey === ctrl &&
    event.altKey === alt &&
    event.shiftKey === shift &&
    event.metaKey === meta &&
    event.key.toLowerCase() === key
  );
}

/**
 * 检查是否在输入元素中
 */
function isInInputElement(): boolean {
  const activeElement = document.activeElement;
  if (!activeElement) return false;
  
  const tagName = activeElement.tagName.toLowerCase();
  const inputTypes = ['input', 'textarea', 'select'];
  const contentEditable = activeElement.getAttribute('contenteditable') === 'true';
  
  return inputTypes.includes(tagName) || contentEditable;
}

/**
 * 快捷键映射到对齐类型
 */
const SHORTCUT_TO_ALIGNMENT: Record<keyof KeyboardShortcuts, AlignmentType> = {
  alignLeft: AlignmentType.LEFT,
  alignRight: AlignmentType.RIGHT,
  alignTop: AlignmentType.TOP,
  alignBottom: AlignmentType.BOTTOM,
  alignCenterH: AlignmentType.CENTER_H,
  alignCenterV: AlignmentType.CENTER_V,
  distributeH: AlignmentType.DISTRIBUTE_H,
  distributeV: AlignmentType.DISTRIBUTE_V,
  undo: AlignmentType.LEFT, // 占位，撤销功能单独处理
  redo: AlignmentType.LEFT  // 占位，重做功能单独处理
};

// ==================== Hook实现 ====================

/**
 * 对齐快捷键Hook
 */
export function useAlignmentKeyboard(options?: UseAlignmentKeyboardOptions): UseAlignmentKeyboardReturn {
  const {
    selectedNodes = [],
    onAlignment: onAlignmentRaw,
    shortcuts: customShortcuts = {},
    enabled: initialEnabled = true,
    disableInInputs = true,
    requireEditMode = false,
    isEditMode = true
  } = options ?? {};

  const hasOptions = Boolean(options);
  const hasValidOnAlignment = typeof onAlignmentRaw === 'function';

  useEffect(() => {
    if (!hasOptions) {
      console.warn('useAlignmentKeyboard: options not provided, using defaults');
    }
  }, [hasOptions]);

  useEffect(() => {
    if (hasOptions && !hasValidOnAlignment) {
      console.warn('useAlignmentKeyboard: onAlignment callback not provided or invalid');
    }
  }, [hasOptions, hasValidOnAlignment]);

  const onAlignment = hasValidOnAlignment ? onAlignmentRaw : undefined;

// ==================== 状态管理 ====================
  
  const enabledRef = useRef(initialEnabled);
  const shortcutsRef = useRef<KeyboardShortcuts>({
    ...DEFAULT_KEYBOARD_SHORTCUTS,
    ...customShortcuts
  });

  // 更新快捷键映射
  useEffect(() => {
    shortcutsRef.current = {
      ...DEFAULT_KEYBOARD_SHORTCUTS,
      ...customShortcuts
    };
  }, [customShortcuts]);

  // ==================== 核心功能 ====================
  
  const triggerShortcut = useCallback((type: AlignmentType) => {
    if (!onAlignment) return;
    // 检查基础对齐是否可以执行
    if (selectedNodes.length < 2) {
      console.warn('需要选择至少2个节点才能执行对齐操作');
      return;
    }

    // 检查分布对齐是否可以执行
    if ((type === AlignmentType.DISTRIBUTE_H || type === AlignmentType.DISTRIBUTE_V) && selectedNodes.length < 3) {
      console.warn('等距分布对齐需要选择至少3个节点');
      return;
    }

    // 执行对齐
    try {
      onAlignment(selectedNodes, type);
    } catch (error) {
      console.error('快捷键对齐操作失败:', error);
    }
  }, [selectedNodes, onAlignment]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!onAlignment) return;
    // 检查快捷键是否启用
    if (!enabledRef.current) return;
    
    // 检查是否需要编辑模式
    if (requireEditMode && !isEditMode) return;
    
    // 检查是否在输入框中
    if (disableInInputs && isInInputElement()) return;
    
    // 检查节点选择状态
    if (selectedNodes.length < 2) return;

    // 遍历快捷键映射
    const shortcuts = shortcutsRef.current;
    
    // 检查对齐快捷键
    Object.entries(shortcuts).forEach(([shortcutKey, shortcutValue]) => {
      if (shortcutKey === 'undo' || shortcutKey === 'redo') return; // 跳过撤销重做
      
      if (isShortcutMatch(event, shortcutValue)) {
        const alignmentType = SHORTCUT_TO_ALIGNMENT[shortcutKey as keyof KeyboardShortcuts];
        
        // 检查分布对齐的特殊要求
        if ((alignmentType === AlignmentType.DISTRIBUTE_H || alignmentType === AlignmentType.DISTRIBUTE_V) && selectedNodes.length < 3) {
          console.warn(`等距分布对齐需要选择至少3个节点，当前已选择${selectedNodes.length}个`);
          return;
        }
        
        event.preventDefault();
        event.stopPropagation();
        
        if (alignmentType) {
          triggerShortcut(alignmentType);
        }
      }
    });
  }, [selectedNodes, triggerShortcut, disableInInputs, requireEditMode, isEditMode, onAlignment]);

  // ==================== 事件监听 ====================
  
  useEffect(() => {
    if (enabledRef.current && onAlignment) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [handleKeyDown, onAlignment]);

  // ==================== 控制方法 ====================
  
  const setEnabled = useCallback((enabled: boolean) => {
    if (!onAlignment) return;
    enabledRef.current = enabled;
  }, [onAlignment]);

  // ==================== 返回接口 ====================
  
  return {
    isEnabled: Boolean(onAlignment) ? enabledRef.current : false,
    shortcuts: shortcutsRef.current,
    triggerShortcut: onAlignment ? triggerShortcut : () => {},
    setEnabled: onAlignment ? setEnabled : () => {}
  };
}

// ==================== 高级Hook ====================

/**
 * 带撤销重做功能的对齐快捷键Hook
 */
export function useAlignmentKeyboardWithHistory(
  options: UseAlignmentKeyboardOptions & {
    onUndo?: () => void;
    onRedo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
  }
) {
  const {
    onUndo,
    onRedo,
    canUndo = false,
    canRedo = false,
    ...alignmentOptions
  } = options;

  const baseHook = useAlignmentKeyboard(alignmentOptions);

  // 扩展快捷键处理以支持撤销重做
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!baseHook.isEnabled) return;
      if (alignmentOptions.disableInInputs !== false && isInInputElement()) return;
      
      // 撤销快捷键
      if (isShortcutMatch(event, baseHook.shortcuts.undo) && canUndo && onUndo) {
        event.preventDefault();
        event.stopPropagation();
        onUndo();
        return;
      }
      
      // 重做快捷键
      if (isShortcutMatch(event, baseHook.shortcuts.redo) && canRedo && onRedo) {
        event.preventDefault();
        event.stopPropagation();
        onRedo();
        return;
      }
    };

    if (baseHook.isEnabled) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [baseHook, onUndo, onRedo, canUndo, canRedo, alignmentOptions.disableInInputs]);

  return {
    ...baseHook,
    canUndo,
    canRedo
  };
}

// ==================== 导出 ====================

export default useAlignmentKeyboard;

/**
 * 🎯 使用示例：
 * 
 * ```tsx
 * function MyComponent() {
 *   const [selectedNodes, setSelectedNodes] = useState<CanvasNode[]>([]);
 *   const [isEditMode, setIsEditMode] = useState(true);
 *   
 *   const {
 *     isEnabled,
 *     shortcuts,
 *     triggerShortcut,
 *     setEnabled
 *   } = useAlignmentKeyboard({
 *     selectedNodes,
 *     onAlignment: (nodes, type) => {
 *       console.log(`对齐类型: ${type}, 节点数量: ${nodes.length}`);
 *       // 执行对齐操作
 *     },
 *     shortcuts: {
 *       alignLeft: 'Ctrl+Shift+L', // 自定义快捷键
 *     },
 *     enabled: true,
 *     disableInInputs: true,
 *     requireEditMode: true,
 *     isEditMode
 *   });
 *   
 *   return (
 *     <div>
 *       <div>快捷键状态: {isEnabled ? '启用' : '禁用'}</div>
 *       <div>左对齐快捷键: {shortcuts.alignLeft}</div>
 *       <button onClick={() => setEnabled(!isEnabled)}>
 *         {isEnabled ? '禁用' : '启用'}快捷键
 *       </button>
 *       <button onClick={() => triggerShortcut(AlignmentType.LEFT)}>
 *         手动左对齐
 *       </button>
 *     </div>
 *   );
 * }
 * 
 * // 带历史功能的使用
 * const withHistoryHook = useAlignmentKeyboardWithHistory({
 *   selectedNodes,
 *   onAlignment: handleAlignment,
 *   onUndo: () => console.log('撤销'),
 *   onRedo: () => console.log('重做'),
 *   canUndo: true,
 *   canRedo: false
 * });
 * ```
 */
