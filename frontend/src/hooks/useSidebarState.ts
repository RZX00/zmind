// Unified sidebar state management hook (shared)

import { useState, useCallback, useEffect } from 'react';

export interface UnifiedSidebarState {
  isOpen: boolean;
  width: number;
  selectedFunction: string | null;
  userOnlineStatus: boolean;
  fileTreeCollapsed: boolean;
}

interface UseSidebarStateOptions {
  defaultOpen?: boolean;
  defaultWidth?: number;
  persistKey?: string;
}

const DEFAULT_CONFIG = {
  defaultOpen: true,
  defaultWidth: 280,
  persistKey: 'unified_sidebar_state',
};

export const useSidebarState = (options: UseSidebarStateOptions = {}) => {
  const config = { ...DEFAULT_CONFIG, ...options };

  const [state, setState] = useState<UnifiedSidebarState>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(config.persistKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          return {
            isOpen: parsed.isOpen ?? config.defaultOpen,
            width: parsed.width ?? config.defaultWidth,
            selectedFunction: null,
            userOnlineStatus: true,
            fileTreeCollapsed: parsed.fileTreeCollapsed ?? false,
          };
        }
      } catch (error) {
        console.warn('Failed to restore sidebar state:', error);
      }
    }
    return {
      isOpen: config.defaultOpen,
      width: config.defaultWidth,
      selectedFunction: null,
      userOnlineStatus: true,
      fileTreeCollapsed: false,
    };
  });

  const persistState = useCallback(
    (newState: UnifiedSidebarState) => {
      if (typeof window !== 'undefined') {
        try {
          const stateToPersist = {
            isOpen: newState.isOpen,
            width: newState.width,
            selectedFunction: newState.selectedFunction,
            fileTreeCollapsed: newState.fileTreeCollapsed,
          };
          localStorage.setItem(config.persistKey, JSON.stringify(stateToPersist));
        } catch (error) {
          console.warn('Failed to persist sidebar state:', error);
        }
      }
    },
    [config.persistKey],
  );

  const updateState = useCallback(
    (updates: Partial<UnifiedSidebarState>) => {
      setState((prev) => {
        const newState = { ...prev, ...updates };
        persistState(newState);
        return newState;
      });
    },
    [persistState],
  );

  const toggleSidebar = useCallback(() => {
    setState((prev) => {
      const newState = { ...prev, isOpen: !prev.isOpen };
      persistState(newState);
      return newState;
    });
  }, [persistState]);

  const openSidebar = useCallback(() => {
    updateState({ isOpen: true });
  }, [updateState]);

  const closeSidebar = useCallback(() => {
    updateState({ isOpen: false });
  }, [updateState]);

  const setSelectedFunction = useCallback(
    (functionName: string | null) => {
      updateState({ selectedFunction: functionName });
    },
    [updateState],
  );

  const setOnlineStatus = useCallback((online: boolean) => {
    setState((prev) => ({ ...prev, userOnlineStatus: online }));
  }, []);

  const toggleFileTree = useCallback(() => {
    updateState({ fileTreeCollapsed: !state.fileTreeCollapsed });
  }, [state.fileTreeCollapsed, updateState]);

  const setSidebarWidth = useCallback(
    (width: number) => {
      const clampedWidth = Math.max(240, Math.min(400, width));
      updateState({ width: clampedWidth });
    },
    [updateState],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === '\\') {
        event.preventDefault();
        toggleSidebar();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

  return {
    ...state,
    toggleSidebar,
    openSidebar,
    closeSidebar,
    setSelectedFunction,
    setOnlineStatus,
    toggleFileTree,
    setSidebarWidth,
    isCollapsed: !state.isOpen,
    canResize: state.isOpen,
  };
};

