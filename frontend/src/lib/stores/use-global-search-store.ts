import { create } from 'zustand';

type SearchScope = 'workspace' | 'canvas';

interface GlobalSearchState {
  open: boolean;
  query: string;
  scope: SearchScope;
  includeArchived: boolean;
  setOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  setScope: (scope: SearchScope) => void;
  setIncludeArchived: (value: boolean) => void;
  resetFilters: () => void;
}

export const useGlobalSearchStore = create<GlobalSearchState>((set) => ({
  open: false,
  query: '',
  scope: 'workspace',
  includeArchived: false,
  setOpen: (open) => set({ open }),
  setQuery: (query) => set({ query }),
  setScope: (scope) => set({ scope }),
  setIncludeArchived: (value) => set({ includeArchived: value }),
  resetFilters: () => set({ scope: 'workspace', includeArchived: false }),
}));
