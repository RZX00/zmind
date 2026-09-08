import { useCallback, useEffect, useState } from 'react';
import type { MenuItem, MenuState } from '@/types/menu';

export interface UseContextMenuControllerReturn {
  state: MenuState;
  openAtMouseEvent: (e: MouseEvent | React.MouseEvent, items: MenuItem[], meta?: Record<string, unknown>) => void;
  openAtPoint: (x: number, y: number, items: MenuItem[], meta?: Record<string, unknown>) => void;
  close: () => void;
}

// Global singleton to ensure only one menu is visible at a time
// Exclusivity is handled globally in UnifiedContextMenu; this controller remains local-state only.

export function useContextMenuController(): UseContextMenuControllerReturn {
  const [state, setState] = useState<MenuState>({ visible: false, x: 0, y: 0, items: [] });

  const close = useCallback(() => {
    setState((prev) => (prev.visible ? { ...prev, visible: false } : prev));
  }, []);

  const openAtPoint = useCallback((x: number, y: number, items: MenuItem[], meta?: Record<string, unknown>) => {
    setState({ visible: true, x, y, items, meta });
  }, []);

  const openAtMouseEvent = useCallback((e: MouseEvent | React.MouseEvent, items: MenuItem[], meta?: Record<string, unknown>) => {
    if (typeof (e as any).preventDefault === 'function') (e as any).preventDefault();
    if (typeof (e as any).stopPropagation === 'function') (e as any).stopPropagation();
    openAtPoint((e as any).clientX, (e as any).clientY, items, meta);
  }, [openAtPoint]);

  useEffect(() => {
    if (!state.visible) return;
    const handleClick = () => close();
    const handleEsc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') close(); };
    const handleScroll = () => close();
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleEsc);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleEsc);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [state.visible, close]);

  // no global pointer cleanup needed here

  return { state, openAtMouseEvent, openAtPoint, close };
}

export default useContextMenuController;
