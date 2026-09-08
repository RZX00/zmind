// 🖱️ 工作台通用右键菜单Hook
// 处理空白区域和通用区域的右键菜单

import { useState, useEffect, useCallback } from 'react';
import {useTranslations} from 'next-intl';
import type { MenuItem, MenuState } from '@/types/menu';

// 🎯 工作台右键菜单选项接口
export interface WorkspaceContextMenuOptions {
  // 创建操作
  onCreateCanvas?: () => void;
  onCreateFolder?: () => void;
  
  // 文件夹操作
  onExpandAllFolders?: () => void;
  onCollapseAllFolders?: () => void;
}

// 🎯 Hook返回接口
export interface UseWorkspaceContextMenuReturn {
  contextMenu: MenuState;
  handleWorkspaceContextMenu: (event: React.MouseEvent) => void;
  hideContextMenu: () => void;
}

export const useWorkspaceContextMenu = (
  options: WorkspaceContextMenuOptions
): UseWorkspaceContextMenuReturn => {
  
  // 🎯 菜单状态
  const [contextMenu, setContextMenu] = useState<MenuState>({
    visible: false,
    x: 0,
    y: 0,
    items: [],
    meta: undefined,
  });

  // 📋 生成工作台菜单项
  const t = useTranslations();

  const generateWorkspaceMenuItems = useCallback((): MenuItem[] => {
    const items: MenuItem[] = [];
    
    // 创建操作组
    if (options.onCreateCanvas) {
      items.push({
        id: 'create-canvas',
        label: t('workspace.menu.newCanvas', {default: 'New Canvas'}),
        icon: 'FileText',
        action: options.onCreateCanvas,
      });
    }

    if (options.onCreateFolder) {
      items.push({
        id: 'create-folder',
        label: t('workspace.menu.newFolder', {default: 'New Folder'}),
        icon: 'FolderOpen',
        action: options.onCreateFolder,
      });
    }

    // 如果有创建操作且有文件夹操作，添加分隔符
    if ((options.onCreateCanvas || options.onCreateFolder) &&
        (options.onExpandAllFolders || options.onCollapseAllFolders)) {
      items.push({
        id: 'separator-1',
        label: '',
        separator: true,
        action: () => {},
      });
    }

    // 文件夹操作组
    if (options.onExpandAllFolders) {
      items.push({
        id: 'expand-all-folders',
        label: t('workspace.menu.expandAll', {default: 'Expand All Folders'}),
        icon: 'FolderOpen',
        action: options.onExpandAllFolders,
      });
    }

    if (options.onCollapseAllFolders) {
      items.push({
        id: 'collapse-all-folders',
        label: t('workspace.menu.collapseAll', {default: 'Collapse All Folders'}),
        icon: 'FolderOpen',
        action: options.onCollapseAllFolders,
      });
    }
    
    return items;
  }, [options, t]);

  // 🖱️ 处理工作台右键菜单
  const handleWorkspaceContextMenu = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    
    // 检查是否点击在以下元素上，如果是则不显示菜单：
    // - 卡片相关元素 (包含 'group', 'card', 'canvas' 等类名的元素)
    // - 按钮元素
    // - 输入框元素  
    // - 可交互元素
    const shouldIgnore = (
      target.closest('[role="button"]') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('textarea') ||
      target.closest('[contenteditable]') ||
      target.closest('.group') ||  // 卡片容器通常有group类
      target.closest('[class*="card"]') ||
      target.closest('[class*="canvas"]') ||
      target.closest('[draggable="true"]') ||
      target.hasAttribute('draggable')
    );

    // 如果点击在可交互元素上，不显示菜单
    if (shouldIgnore) {
      return;
    }
    
    event.preventDefault();
    event.stopPropagation();
    
    const menuItems = generateWorkspaceMenuItems();
    
    // 如果没有菜单项，不显示菜单
    if (menuItems.length === 0) {
      return;
    }
    
    setContextMenu({ visible: true, x: event.clientX, y: event.clientY, items: menuItems });
  }, [generateWorkspaceMenuItems]);

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
    handleWorkspaceContextMenu,
    hideContextMenu,
  };
};
