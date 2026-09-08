// 🖱️ 工作台右键菜单Hook
// 基于useCanvasContextMenu模式，适配工作台画布管理

import { useState, useEffect, useCallback } from 'react';
import {useTranslations} from 'next-intl';
import type { Canvas } from '../types/canvas';
import type { MenuState, MenuItem } from '@/types/menu';

export interface UseWorkspaceContextMenuOptions {
  // 画布操作
  onRenameCanvas: (canvasId: string) => void;
  onDeleteCanvas: (canvasId: string) => void;
  onPinCanvas: (canvasId: string, pinned: boolean) => void;
  onOpenInNewTab: (canvasId: string) => void;
  onDuplicateCanvas: (canvasId: string) => void;

  // 状态查询
  getPinnedStatus: (canvasId: string) => boolean;

  // 自定义对话框
  confirmDialog?: {
    warning: (message: string, options?: { title?: string; confirmText?: string; cancelText?: string }) => Promise<boolean>;
  };
}

export interface UseWorkspaceContextMenuReturn {
  contextMenu: MenuState;
  handleContextMenu: (event: React.MouseEvent, canvasId: string, canvas: Canvas) => void;
  hideContextMenu: () => void;
}

export const useWorkspaceContextMenu = ({
  onRenameCanvas,
  onDeleteCanvas,
  onPinCanvas,
  onOpenInNewTab,
  onDuplicateCanvas,
  getPinnedStatus,
  confirmDialog,
}: UseWorkspaceContextMenuOptions): UseWorkspaceContextMenuReturn => {

  // 🎯 菜单状态
  const [contextMenu, setContextMenu] = useState<MenuState>({
    visible: false,
    x: 0,
    y: 0,
    items: [],
    meta: undefined,
  });
  const t = useTranslations();

  // 🔌 隐藏菜单 - 需要在generateCanvasMenuItems之前定义
  const hideContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }));
  }, []);

  // 📋 生成画布菜单项
  const generateCanvasMenuItems = useCallback((canvasId: string, canvas: Canvas): MenuItem[] => {
    const isPinned = getPinnedStatus(canvasId);

    return [
      // 📝 编辑组
      {
        id: 'rename',
        label: t('canvas.menu.rename', {default: 'Rename'}),
        icon: 'Edit2',
        action: () => {
          onRenameCanvas(canvasId);
          hideContextMenu();
        },
      },

      // 分隔符
      {
        id: 'separator-1',
        label: '',
        separator: true,
        action: () => {},
      },

      // 📌 管理组
      {
        id: isPinned ? 'unpin' : 'pin',
        label: isPinned ? 'unpin' : 'pin',
        icon: 'Star',
        action: () => {
          onPinCanvas(canvasId, !isPinned);
          hideContextMenu();
        },
      },
      {
        id: 'duplicate',
        label: t('canvas.menu.duplicate', {default: 'Duplicate Canvas'}),
        icon: 'Copy',
        action: () => {
          onDuplicateCanvas(canvasId);
          hideContextMenu();
        },
      },
      {
        id: 'open-new-tab',
        label: t('canvas.menu.openNew', {default: 'Open in New Tab'}),
        icon: 'ExternalLink',
        action: () => {
          onOpenInNewTab(canvasId);
          hideContextMenu();
        },
      },

      // 分隔符
      {
        id: 'separator-2',
        label: '',
        separator: true,
        action: () => {},
      },

      // 🗑️ 危险操作
      {
        id: 'delete',
        label: t('canvas.menu.delete', {default: 'Delete Canvas'}),
        icon: 'Trash2',
        action: async () => {
          // 确认删除
          const canvasTitle = canvas.title || t('canvas.untitled', {default: 'Untitled Canvas'});
          let confirmed = false;

          if (confirmDialog) {
            // 使用自定义对话框
            confirmed = await confirmDialog.warning(
              t('canvas.menu.confirmDelete.message', {title: canvasTitle, default: `Delete canvas "${canvasTitle}"?\n\nThis action cannot be undone.`}),
              {
                title: t('canvas.menu.confirmDelete.title', {default: 'Confirm Deletion'}),
                confirmText: t('common.delete', {default: 'Delete'}),
                cancelText: t('common.cancel', {default: 'Cancel'})
              }
            );
          }

          if (confirmed) {
            onDeleteCanvas(canvasId);
            hideContextMenu();
          }
        },
      },
    ];
  }, [
    onRenameCanvas, onDeleteCanvas, onPinCanvas,
    onOpenInNewTab, onDuplicateCanvas, getPinnedStatus, confirmDialog, hideContextMenu, t
  ]);

  // 🖱️ 处理右键菜单
  const handleContextMenu = useCallback((
    event: React.MouseEvent,
    canvasId: string,
    canvas: Canvas
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const menuItems = generateCanvasMenuItems(canvasId, canvas);
    setContextMenu({ visible: true, x: event.clientX, y: event.clientY, items: menuItems, meta: { canvasId } });
  }, [generateCanvasMenuItems]);


  // 🎧 全局事件监听
  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu.visible) {
        hideContextMenu();
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && contextMenu.visible) {
        hideContextMenu();
      }
    };

    const handleScroll = () => {
      if (contextMenu.visible) {
        hideContextMenu();
      }
    };

    if (contextMenu.visible) {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleEscapeKey);
      window.addEventListener('scroll', handleScroll, true);

      return () => {
        document.removeEventListener('click', handleClickOutside);
        document.removeEventListener('keydown', handleEscapeKey);
        window.removeEventListener('scroll', handleScroll, true);
      };
    }
  }, [contextMenu.visible, hideContextMenu]);

  return {
    contextMenu,
    handleContextMenu,
    hideContextMenu,
  };
};
