// 🖱️ 文件夹右键菜单 Hook
// 提供对单个文件夹的常用操作：重命名 / 展开/收起 / 新建子文件夹 / 删除

import { useCallback, useEffect, useState } from 'react';
import {useTranslations} from 'next-intl';
import type { Folder } from '../types/folder';
import type { MenuItem, MenuState } from '@/types/menu';

export interface UseFolderContextMenuOptions {
  onStartRenameFolder: (folder: Folder) => void;
  onToggleFolder: (folderId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onCreateSubfolder?: (parentId: string) => void;
  confirmDialog?: { warning: (message: string, options?: { title?: string; confirmText?: string; cancelText?: string }) => Promise<boolean>; };
}

export interface UseFolderContextMenuReturn {
  contextMenu: MenuState;
  handleContextMenu: (event: React.MouseEvent, folder: Folder) => void;
  hideContextMenu: () => void;
}

export function useFolderContextMenu(options: UseFolderContextMenuOptions): UseFolderContextMenuReturn {
  const t = useTranslations();
  const [contextMenu, setContextMenu] = useState<MenuState>({
    visible: false,
    x: 0,
    y: 0,
    items: [],
    meta: undefined,
  });

  const hideContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }));
  }, []);

  const generateItems = useCallback((folder: Folder): MenuItem[] => {
    const items: MenuItem[] = [
      {
        id: 'rename-folder',
        label: t('canvas.menu.renameFolder', {default: 'Rename Folder'}),
        icon: 'Edit2',
        action: () => { options.onStartRenameFolder(folder); hideContextMenu(); },
      },
      {
        id: 'toggle-expand',
        label: folder.isExpanded ? t('canvas.menu.collapseFolder', {default: 'Collapse Folder'}) : t('canvas.menu.expandFolder', {default: 'Expand Folder'}),
        icon: 'FolderOpen',
        action: () => { options.onToggleFolder(folder.id); hideContextMenu(); },
      },
    ];

    if (options.onCreateSubfolder) {
      items.push({ id: 'separator-1', label: '', separator: true, action: () => {} });
      items.push({
        id: 'create-subfolder',
        label: t('canvas.menu.createSubfolder', {default: 'Create Subfolder'}),
        icon: 'FolderOpen',
        action: () => { options.onCreateSubfolder?.(folder.id); hideContextMenu(); },
      });
    }

    items.push({ id: 'separator-2', label: '', separator: true, action: () => {} });
    items.push({
      id: 'delete-folder',
      label: t('canvas.menu.deleteFolder', {default: 'Delete Folder'}),
      icon: 'Trash2',
      action: async () => {
        let ok = false;
        if (options.confirmDialog) {
          const name = folder.name || t('canvas.menu.thisFolder', {default: 'this folder'});
          ok = await options.confirmDialog.warning(
            t('canvas.menu.confirmDeleteFolder.message', {name, default: `Delete folder "${name}"?\n\nItems inside will be moved to the parent.`}),
            { title: t('canvas.menu.confirmDelete.title', {default: 'Confirm Deletion'}), confirmText: t('common.delete', {default: 'Delete'}), cancelText: t('common.cancel', {default: 'Cancel'}) }
          );
        }
        if (ok) options.onDeleteFolder(folder.id);
        hideContextMenu();
      },
    });

    return items;
  }, [options, hideContextMenu, t]);

  const handleContextMenu = useCallback((event: React.MouseEvent, folder: Folder) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ visible: true, x: event.clientX, y: event.clientY, items: generateItems(folder) });
  }, [generateItems]);

  // 监听全局关闭
  useEffect(() => {
    const handleClickOutside = () => { if (contextMenu.visible) hideContextMenu(); };
    const handleEscapeKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && contextMenu.visible) hideContextMenu(); };
    const handleScroll = () => { if (contextMenu.visible) hideContextMenu(); };

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

  return { contextMenu, handleContextMenu, hideContextMenu };
}
