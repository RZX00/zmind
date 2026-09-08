import { create } from 'zustand';

interface EditorState {
  editor: unknown | null;
  setEditor: (editor: unknown | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  editor: null,
  setEditor: (editor) => set({ editor }),
}));
