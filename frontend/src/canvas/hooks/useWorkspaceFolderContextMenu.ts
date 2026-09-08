// 🖱️ 工作台文件夹右键菜单Hook
// 为文件夹和画布提供完整的上下文菜单功能

import { useState, useEffect, useCallback } from 'react';
import {useTranslations} from 'next-intl';
import type { LayerItem } from '../types/workspace-folder';
import type { MenuItem, MenuState } from '@/types/menu';

// 为了兼容现有代码，创建类型别名和扩展接口
interface FolderContextMenuItem extends MenuItem {
  danger?: boolean;
}
interface FolderContextMenuState extends MenuState {
  targetItem?: LayerItem;
}

// 🎯 操作选项接口
export interface FolderContextMenuOptions {
  // 文件夹操作
  onCreateSubFolder: (parentId: string) => void;
  onRenameFolder: (folderId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onExpandFolder: (folderId: string) => void;
  onCollapseFolder: (folderId: string) => void;
  
  // 画布操作
  onOpenCanvas: (canvasId: string) => void;
  onOpenCanvasInNewTab: (canvasId: string) => void;
  onDuplicateCanvas: (canvasId: string) => void;
  onDeleteCanvas: (canvasId: string) => void;
  
  // 状态查询
  isExpanded: (folderId: string) => boolean;
  
  // 自定义对话框
  confirmDialog?: {
    warning: (message: string) => Promise<boolean>;
  };
}

// 🎯 Hook返回接口
export interface UseWorkspaceFolderContextMenuReturn {
  // 菜单状态
  contextMenu: FolderContextMenuState;
  
  // 事件处理器
  handleContextMenu: (event: React.MouseEvent, item: LayerItem) => void;
  hideContextMenu: () => void;
}

export const useWorkspaceFolderContextMenu = (
  options: FolderContextMenuOptions
): UseWorkspaceFolderContextMenuReturn => {
  const t = useTranslations();
  
  // 🎯 菜单状态
  const [contextMenu, setContextMenu] = useState<FolderContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    items: [],
    targetItem: undefined,
  });

  // 📋 生成文件夹菜单项
  const generateFolderMenuItems = useCallback((item: LayerItem): FolderContextMenuItem[] => {
    const isExpanded = options.isExpanded(item.id);
    
    return [
      // 📝 编辑组
      { id: 'rename-folder', label: t('canvas.menu.renameFolder', {default: 'Rename Folder'}), icon: 'Edit2', action: () => options.onRenameFolder(item.id) },
      
      // 分隔符
      {
        id: 'separator-1',
        label: '',
        icon: '',
        separator: true,
        action: () => {},
      },
      
      // 📂 展开控制组
      { id: isExpanded ? 'collapse-folder' : 'expand-folder', label: isExpanded ? t('canvas.menu.collapseFolder', {default: 'Collapse Folder'}) : t('canvas.menu.expandFolder', {default: 'Expand Folder'}), icon: isExpanded ? 'FolderX' : 'FolderOpen', action: () => { if (isExpanded) { options.onCollapseFolder(item.id); } else { options.onExpandFolder(item.id); } } },
      { id: 'create-subfolder', label: t('canvas.menu.createSubfolder', {default: 'Create Subfolder'}), icon: 'FolderPlus', action: () => options.onCreateSubFolder(item.id) },
      
      // 分隔符
      {
        id: 'separator-2',
        label: '',
        icon: '',
        separator: true,
        action: () => {},
      },
      
      // 🗑️ 危险操作
      {
        id: 'delete-folder',
        label: t('canvas.menu.deleteFolder', {default: 'Delete Folder'}),
        icon: 'Trash2',
        danger: true,
        action: async () => {
          if (!options.confirmDialog) return;
          const folderName = item.folder?.name || t('canvas.menu.thisFolder', {default: 'this folder'});
          const message = t('canvas.menu.confirmDeleteFolder.message', {
            name: folderName,
            default: `Delete folder "${folderName}"?\n\nItems inside will be moved to the parent.`
          });
          const confirmed = await options.confirmDialog.warning(message);
          if (confirmed) {
            options.onDeleteFolder(item.id);
          }
        }
      },
    ];
  }, [options, t]);

  // 📋 生成画布菜单项
  const generateCanvasMenuItems = useCallback((item: LayerItem): FolderContextMenuItem[] => {
    return [
      // 🔗 打开组
      { id: 'open-canvas', label: t('canvas.menu.open', {default: 'Open Canvas'}), icon: 'ExternalLink', action: () => options.onOpenCanvas(item.id) },
      { id: 'open-canvas-new-tab', label: t('canvas.menu.openNew', {default: 'Open in New Tab'}), icon: 'ExternalLink', action: () => options.onOpenCanvasInNewTab(item.id) },
      
      // 分隔符
      {
        id: 'separator-1',
        label: '',
        icon: '',
        separator: true,
        action: () => {},
      },
      
      // 📋 操作组
      { id: 'duplicate-canvas', label: t('canvas.menu.duplicate', {default: 'Duplicate Canvas'}), icon: 'Copy', action: () => options.onDuplicateCanvas(item.id) },
      
      // 分隔符
      {
        id: 'separator-2',
        label: '',
        icon: '',
        separator: true,
        action: () => {},
      },
      
      // 🗑️ 危险操作
      {
        id: 'delete-canvas',
        label: t('canvas.menu.delete', {default: 'Delete Canvas'}),
        icon: 'Trash2',
        danger: true,
        action: async () => {
          if (!options.confirmDialog) return;
          const canvasTitle = item.canvas?.title || t('canvas.untitled', {default: 'Untitled Canvas'});
          const confirmed = await options.confirmDialog.warning(
            `Delete canvas "${canvasTitle}"?\n\nThis action cannot be undone.`
          );
          if (confirmed) {
            options.onDeleteCanvas(item.id);
          }
        }
      },
    ];
  }, [options, t]);

  // 🖱️ 处理右键菜单
  const handleContextMenu = useCallback((
    event: React.MouseEvent, 
    item: LayerItem
  ) => {
    event.preventDefault();
    event.stopPropagation();
    
    let menuItems: FolderContextMenuItem[] = [];
    
    if (item.type === 'folder') {
      menuItems = generateFolderMenuItems(item);
    } else if (item.type === 'canvas') {
      menuItems = generateCanvasMenuItems(item);
    }
    
    setContextMenu({ visible: true, x: event.clientX, y: event.clientY, items: menuItems, targetItem: item });
  }, [generateFolderMenuItems, generateCanvasMenuItems]);

  // 🔌 隐藏菜单
  const hideContextMenu = useCallback(() => {
    setContextMenu(prev => ({ 
      ...prev, 
      visible: false 
    }));
  }, []);

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
