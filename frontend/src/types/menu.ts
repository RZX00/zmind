import React from 'react';

export type ContextMenuIconName =
  | 'Type'
  | 'FileCode2'
  | 'FolderPlus'
  | 'Edit'
  | 'Copy'
  | 'Trash2'
  | 'CheckSquare'
  | 'MoreHorizontal'
  | 'Lock'
  | 'Unlock'
  | 'Table'
  | 'Maximize2'
  | 'Code'
  | 'AlignStartHorizontal'
  | 'AlignEndHorizontal'
  | 'AlignStartVertical'
  | 'AlignEndVertical'
  | 'AlignHorizontalJustifyCenter'
  | 'AlignVerticalJustifyCenter'
  | 'ArrowRightLeft'
  | 'ArrowLeftRight'
  | 'ArrowRight'
  | 'ArrowUpDown'
  | 'ChevronRight'
  | 'FileText'
  | 'FolderX'
  | 'Split'
  | 'Sparkles'
  | 'Ban'
  | 'ArrowUpFromLine'
  | 'SquareStack'
  | 'Link'
  | 'Workflow'
  | 'Folder'
  | 'Edit2'
  | 'Star'
  | 'Download'
  | 'FolderOpen'
  | 'Tag'
  | 'ExternalLink'
  | 'Scissors'
  | 'Link2';

// Unified menu item definition used by the unified context menu system
export interface MenuItem {
  id: string;
  label: string;
  icon?: ContextMenuIconName | React.ReactNode;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
  danger?: boolean;
  shortcut?: string;
  checked?: boolean;
  submenu?: MenuItem[];
  hasSubmenu?: boolean; // optional hint; computed from submenu when not provided
}

export interface MenuState {
  visible: boolean;
  x: number;
  y: number;
  items: MenuItem[];
  // optional metadata to help callers keep track of source context (nodeId, row, col, etc.)
  meta?: Record<string, unknown>;
}

