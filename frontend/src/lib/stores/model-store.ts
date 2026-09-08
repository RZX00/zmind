import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { migrateLegacyLocalStorage } from '../utils/migrate-local-storage';

interface ModelStore {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
}

export const useModelStore = create<ModelStore>()(
  persist(
    (set) => ({
      selectedModel: '', // Will be set by the hook based on API data
      setSelectedModel: (model: string) => {
        console.log('🔧 ModelStore: Setting selected model to:', model);
        set({ selectedModel: model });
      },
    }),
    {
      // Bump storage key to invalidate stale cached model ids across browsers
      name: 'zmind-model-selection-v5',
      partialize: (state) => ({
        selectedModel: state.selectedModel,
      }),
      onRehydrateStorage: () => {
        if (typeof window !== 'undefined') {
          try { migrateLegacyLocalStorage(); } catch {}
        }
      },
    }
  )
);

// Utility functions for compatibility
export const formatModelName = (name: string): string => {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};
