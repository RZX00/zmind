// UnifiedContextMenu - a unified right-click context menu with submenu support
// This component is presentation-only; it expects callers to manage state and actions.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Type,
  FileCode2,
  FolderPlus,
  Edit,
  Edit2,
  Copy,
  Trash2,
  CheckSquare,
  MoreHorizontal,
  Lock,
  Unlock,
  Table,
  Maximize2,
  Code,
  AlignStartHorizontal,
  AlignEndHorizontal,
  AlignStartVertical,
  AlignEndVertical,
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  ArrowRightLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpDown,
  ChevronRight,
  FileText,
  FolderX,
  Split,
  Sparkles,
  Ban,
  ArrowUpFromLine,
  SquareStack,
  Link,
  Workflow,
  Folder,
  Star,
  Download,
  FolderOpen,
  Tag,
  ExternalLink,
  Scissors,
  Link2,
  Check,
} from 'lucide-react';
import type { MenuItem, MenuState } from '@/types/menu';

export interface UnifiedContextMenuProps {
  state: MenuState;
  onClose: () => void;
  withOverlay?: boolean;
}

const ICONS = {
  Type,
  FileCode2,
  FolderPlus,
  Edit,
  Copy,
  Trash2,
  CheckSquare,
  MoreHorizontal,
  Lock,
  Unlock,
  Table,
  Maximize2,
  Code,
  AlignStartHorizontal,
  AlignEndHorizontal,
  AlignStartVertical,
  AlignEndVertical,
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  ArrowRightLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpDown,
  ChevronRight,
  FileText,
  FolderX,
  Split,
  Sparkles,
  Ban,
  ArrowUpFromLine,
  SquareStack,
  Link,
  Workflow,
  Folder,
  Edit2,
  Star,
  Download,
  FolderOpen,
  Tag,
  ExternalLink,
  Scissors,
  Link2,
} as const;
type ContextMenuIconName = keyof typeof ICONS;

const ITEM_HEIGHT = 30; // smaller row height with 5px padding above/below text
const SEPARATOR_HEIGHT = 1; // divider matches 1px line height
const MENU_MIN_WIDTH = 220; // consistent width for all menus

const UnifiedContextMenu: React.FC<UnifiedContextMenuProps> = ({ state, onClose, withOverlay = false }) => {
  const [hoveredSubmenu, setHoveredSubmenu] = useState<string | null>(null);
  const idRef = useRef<symbol>(Symbol('unified-context-menu'));

  const visible = Boolean(state?.visible);
  const items = useMemo<MenuItem[]>(() => state?.items ?? [], [state?.items]);
  const menuX = state?.x ?? 0;
  const menuY = state?.y ?? 0;
  const surfaceStyles: React.CSSProperties = useMemo(
    () => ({
      backgroundColor: 'var(--popover)',
      color: 'var(--popover-foreground)',
      borderColor: 'var(--border)',
    }),
    []
  );

  const totalHeight = useMemo(() => {
    return items.reduce((sum, it) => sum + (it.separator ? SEPARATOR_HEIGHT : ITEM_HEIGHT), 0);
  }, [items]);


  const getItemHeight = (item: MenuItem) => (item.separator ? SEPARATOR_HEIGHT : ITEM_HEIGHT);
  const getCumulativeHeight = (menuItems: MenuItem[], targetIndex: number): number => {
    let height = 0;
    for (let i = 0; i < targetIndex; i++) height += getItemHeight(menuItems[i]);
    return height;
  };
  const getMenuTotalHeight = (menuItems: MenuItem[]) => menuItems.reduce((h, it) => h + getItemHeight(it), 0);

  const getMenuStyle = (isSubmenu = false, parentItemIndex = 0, submenuItems?: MenuItem[]): React.CSSProperties => {
    const menuWidth = MENU_MIN_WIDTH;
    const menuHeight = isSubmenu && submenuItems ? getMenuTotalHeight(submenuItems) : totalHeight;
    let x = menuX;
    let y = menuY;

    if (isSubmenu) {
      x = menuX + menuWidth;
      const menuPaddingTop = 6; // py-1.5
      const submenuPaddingTop = 6; // py-1.5
      const parentItemY = getCumulativeHeight(items, parentItemIndex);
      y = menuY + menuPaddingTop + parentItemY - submenuPaddingTop;
      if (x + menuWidth > window.innerWidth) x = menuX - menuWidth; // flip horizontally
    } else {
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10; // flip vertically
    x = Math.max(10, x);
    y = Math.max(10, y);

    return { position: 'fixed', left: `${x}px`, top: `${y}px`, zIndex: isSubmenu ? 4001 : 4000 };
  };

  const renderMenuItem = (item: MenuItem, index: number, isSubmenu = false) => {
    if (item.separator) {
      return <div key={`separator-${index}`} className="mx-2 my-0 h-px bg-border/80" />;
    }
    const hasSubmenu = item.hasSubmenu || (item.submenu && item.submenu.length > 0);
    const isHovered = hoveredSubmenu === item.id;
    const iconName =
      typeof item.icon === 'string' && Object.prototype.hasOwnProperty.call(ICONS, item.icon)
        ? (item.icon as ContextMenuIconName)
        : undefined;
    const IconComponent = iconName ? ICONS[iconName] : null;
    const LeftIcon = () => {
      if (React.isValidElement(item.icon)) return <div className="w-4 h-4 mr-3 flex-shrink-0">{item.icon}</div>;
      if (!IconComponent) return <div className="w-4 h-4 mr-3 flex-shrink-0" />;
      return (
        <div className="w-4 h-4 mr-3 flex-shrink-0">
          <IconComponent size={16} className="text-muted-foreground group-hover:text-foreground" />
        </div>
      );
    };

    return (
      <div key={item.id} className="relative" onMouseEnter={() => hasSubmenu && setHoveredSubmenu(item.id)} onMouseLeave={() => hasSubmenu && setHoveredSubmenu(null)}>
        <button
          onClick={() => {
            if (!hasSubmenu && !item.disabled) {
              item.action?.();
              onClose();
            }
          }}
          disabled={item.disabled}
          className={`relative flex w-full items-center px-3 py-[5px] text-left text-sm leading-5 transition-colors duration-200 group
            ${item.disabled ? 'cursor-not-allowed text-muted-foreground/70' : 'cursor-pointer text-foreground hover:bg-muted/70 hover:text-foreground'}
            ${item.danger ? 'hover:bg-red-500/10 text-red-500 hover:text-red-500' : ''}
            ${hasSubmenu ? 'cursor-default' : ''}`}
        >
          <LeftIcon />
          <span className="flex-1">{item.label}</span>
          {item.checked && (
            <Check size={14} className="ml-3 flex-shrink-0 text-primary" />
          )}
          {item.shortcut && !hasSubmenu && (
            <span className="ml-3 font-mono text-xs text-muted-foreground">{item.shortcut}</span>
          )}
          {hasSubmenu && <ChevronRight size={14} className="ml-3 flex-shrink-0 text-muted-foreground" />}
        </button>
        {hasSubmenu && isHovered && item.submenu && (
          <div className="absolute z-10" style={getMenuStyle(true, index, item.submenu)}>
            <div
              className="min-w-[200px] rounded-lg border border-border bg-popover py-1.5 text-popover-foreground"
              style={{ ...surfaceStyles, boxShadow: '0 4px 20px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)' }}
            >
              {item.submenu.map((sub, idx) => renderMenuItem(sub, idx, true))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const menuTree = (
    <>
      {withOverlay && (
        <div
          className="fixed inset-0"
          style={{ zIndex: 3999 }}
          onClick={onClose}
          onContextMenu={(e) => {
            e.preventDefault();
            onClose();
          }}
        />
      )}
      <div className="context-menu" style={getMenuStyle()} onContextMenu={(e) => e.preventDefault()}>
        <div
          className="min-w-[220px] rounded-lg border border-border bg-popover py-1.5 text-popover-foreground"
          style={{ ...surfaceStyles, boxShadow: '0 8px 24px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08)' }}
        >
          {items.map((item, index) => renderMenuItem(item, index))}
        </div>
      </div>
    </>
  );

  // Global exclusivity: ensure only one unified menu visible at a time across the app
  type ActiveMenu = { id: symbol; close: () => void } | null;
  // Module-level singleton
  const g: any = globalThis as any;
  if (!g.__UNIFIED_CONTEXT_MENU__) g.__UNIFIED_CONTEXT_MENU__ = { active: null as ActiveMenu };
  const globalMenu = g.__UNIFIED_CONTEXT_MENU__ as { active: ActiveMenu };

  useEffect(() => {
    const id = idRef.current;
    if (visible) {
      if (globalMenu.active && globalMenu.active.id !== id) {
        try { globalMenu.active.close(); } catch {}
      }
      globalMenu.active = { id, close: onClose };
    }
    return () => {
      if (globalMenu.active && globalMenu.active.id === id) {
        globalMenu.active = null;
      }
    };
    // include only visibility and onClose to update ownership; id is stable
  }, [visible, onClose, globalMenu]);

  if (typeof document !== 'undefined' && document.body) {
    return visible ? createPortal(menuTree, document.body) : null;
  }
  return visible ? menuTree : null;
};

export default UnifiedContextMenu;
