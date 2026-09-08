import { create } from 'zustand';
import type { ConnectionAppearance } from '../types/canvas';

export type ConnectionMode = 'auto' | 'horizontal-only' | 'vertical-only';
export type EndpointStrategy = 'center-ray' | 'side-midpoints';
export type CurveModeDefault = 'auto' | 'tension';

export interface ConnectionSettings {
  mode: ConnectionMode;
  horizontalGapThreshold: number; // px
  verticalGapThreshold: number;   // px
  horizontalMinDelta: number;     // px
  verticalMinDelta: number;       // px
  endpointStrategy: EndpointStrategy; // connection endpoints selection
  curveModeDefault: CurveModeDefault; // default curvature strategy
  tension: number; // 0..1 default curvature strength
  // 默认外观 + 预设
  appearanceDefault?: ConnectionAppearance;
  presets?: Record<string, ConnectionAppearance>;
}

export interface SettingsState {
  connection: ConnectionSettings;
  // AI panel preferences (global)
  aiPanel?: {
    expandedRatio?: number; // 0..1
    backgroundOpacity?: number; // 0..1
  };
  // Smart guides preferences
  guides?: {
    enabled: boolean;
    showLines?: boolean; // render guide lines
    tolerancePx: number;
    showDistance: boolean;
    showSecondaryGuides?: boolean;
    equalSpacing: boolean;
    fallbackToGrid: boolean;
    allowBaseline?: boolean;
    allowContainer?: boolean;
    colorHex?: string; // guide line color
    dashed?: boolean;  // dashed vs solid
    modifierDisableKey?: 'Alt';
  };
  // Focus preferences for double-space focusing
  focus?: { fitRatio?: number; padding?: number }; // fitRatio: 0..1, padding in px
  // Screenshot preferences
  screenshot?: { aspect?: string }; // e.g., '16:9' | '4:3' | '1:1' | 'original'
  // Mindmap global preferences
  mindmap?: { tunnelLayout?: boolean; autoWidthMode?: 'auto' | 'fixed' }; // layout + node width behavior
  ui: { isOpen: boolean; activePane: 'account' | 'integrations' | 'connections' | 'guides' | 'keymap' | 'instructions' };
  load: () => void;
  save: () => void;
  setConnection: (partial: Partial<ConnectionSettings>) => void;
  setFocus?: (partial: { fitRatio?: number; padding?: number }) => void;
  setScreenshot?: (partial: { aspect?: string }) => void;
  setMindmap?: (partial: { tunnelLayout?: boolean; autoWidthMode?: 'auto' | 'fixed' }) => void;
  setAiPanel?: (partial: { expandedRatio?: number; backgroundOpacity?: number }) => void;
  setGuides?: (partial: Partial<NonNullable<SettingsState['guides']>>) => void;
  setConnectionAppearanceDefault?: (appearance: ConnectionAppearance) => void;
  saveConnectionPreset?: (name: string, appearance: ConnectionAppearance) => void;
  applyConnectionPreset?: (name: string) => void;
  resetConnection: () => void;
  open: (pane?: 'account' | 'integrations' | 'connections' | 'guides' | 'keymap' | 'instructions') => void;
  close: () => void;
}

const STORAGE_KEY = 'app_settings_v1';

const defaultConnection: ConnectionSettings = {
  mode: 'auto',
  horizontalGapThreshold: 30,
  verticalGapThreshold: 30,
  horizontalMinDelta: 10,
  verticalMinDelta: 10,
  endpointStrategy: 'center-ray',
  curveModeDefault: 'auto',
  tension: 0.35,
  appearanceDefault: {
    width: 2,
    opacity: 1,
    dashed: false,
    // 默认更大箭头尺寸（最小即默认）
    arrow: { start: false, end: true, size: 16, shape: 'triangle', filled: true },
    theme: 'solid',
  },
  presets: {},
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  connection: { ...defaultConnection },
  focus: { fitRatio: 0.8, padding: 24 },
  screenshot: { aspect: '16:9' },
  mindmap: { tunnelLayout: true, autoWidthMode: 'fixed' },
  aiPanel: { expandedRatio: 0.8, backgroundOpacity: 0.8 },
  guides: { enabled: false, showLines: false, tolerancePx: 8, showDistance: false, showSecondaryGuides: true, equalSpacing: true, fallbackToGrid: false, allowBaseline: true, allowContainer: true, colorHex: '#9FA8A3', dashed: false, modifierDisableKey: 'Alt' },
  ui: { isOpen: false, activePane: 'account' },
  load: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.connection) set({ connection: { ...defaultConnection, ...parsed.connection } });
      if (parsed?.focus) set({ focus: { fitRatio: typeof parsed.focus.fitRatio === 'number' ? parsed.focus.fitRatio : 0.8, padding: typeof parsed.focus.padding === 'number' ? parsed.focus.padding : 24 } });
      if (parsed?.screenshot) set({ screenshot: { aspect: parsed.screenshot.aspect || '16:9' } });
      if (parsed?.mindmap) set({ mindmap: { tunnelLayout: parsed.mindmap.tunnelLayout !== false, autoWidthMode: parsed.mindmap.autoWidthMode === 'auto' ? 'auto' : 'fixed' } });
      if (parsed?.aiPanel) {
        const ratio = typeof parsed.aiPanel.expandedRatio === 'number' ? parsed.aiPanel.expandedRatio : 0.8;
        const opacity = typeof parsed.aiPanel.backgroundOpacity === 'number' ? parsed.aiPanel.backgroundOpacity : 0.8;
        set({ aiPanel: { expandedRatio: ratio, backgroundOpacity: opacity } });
      }
      if (parsed?.guides) set({ guides: {
        enabled: parsed.guides.enabled !== false,
        showLines: parsed.guides.showLines === true,
        tolerancePx: typeof parsed.guides.tolerancePx === 'number' ? parsed.guides.tolerancePx : 8,
        showDistance: parsed.guides.showDistance === true,
        showSecondaryGuides: parsed.guides.showSecondaryGuides !== false,
        equalSpacing: parsed.guides.equalSpacing !== false,
        fallbackToGrid: !!parsed.guides.fallbackToGrid,
        allowBaseline: parsed.guides.allowBaseline !== false,
        allowContainer: parsed.guides.allowContainer !== false,
        colorHex: typeof parsed.guides.colorHex === 'string' ? parsed.guides.colorHex : '#9FA8A3',
        dashed: parsed.guides.dashed === true,
        modifierDisableKey: 'Alt'
      } });
    } catch (e) {
      console.warn('Failed to load settings:', e);
    }
  },
  save: () => {
    try {
      const state = get();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ connection: state.connection, focus: state.focus, screenshot: state.screenshot, mindmap: state.mindmap, aiPanel: state.aiPanel, guides: state.guides }));
    } catch (e) {
      console.warn('Failed to save settings:', e);
    }
  },
  setConnection: (partial) => {
    set((s) => ({ connection: { ...s.connection, ...partial } }));
    // 轻量防抖可后续加入，这里直接保存
    get().save();
  },
  setFocus: (partial) => {
    set((s) => ({ focus: { ...(s.focus || {}), ...partial } }));
    get().save();
  },
  setScreenshot: (partial) => {
    set((s) => ({ screenshot: { ...(s.screenshot || {}), ...partial } }));
    get().save();
  },
  setMindmap: (partial) => {
    set((s) => ({ mindmap: { ...(s.mindmap || {}), ...partial } }));
    get().save();
  },
  setAiPanel: (partial) => {
    set((s) => ({ aiPanel: { ...(s.aiPanel || { expandedRatio: 0.8, backgroundOpacity: 0.8 }), ...partial } }));
    get().save();
  },
  setGuides: (partial) => {
    set((s) => ({ guides: { ...(s.guides || { enabled: false, showLines: false, tolerancePx: 8, showDistance: false, showSecondaryGuides: true, equalSpacing: false, fallbackToGrid: false, allowBaseline: true, allowContainer: true, colorHex: '#9FA8A3', dashed: false, modifierDisableKey: 'Alt' }), ...partial } }));
    get().save();
  },
  setConnectionAppearanceDefault: (appearance) => {
    set((s) => ({ connection: { ...s.connection, appearanceDefault: { ...(s.connection.appearanceDefault || {}), ...appearance } } }));
    get().save();
  },
  saveConnectionPreset: (name, appearance) => {
    set((s) => ({ connection: { ...s.connection, presets: { ...(s.connection.presets || {}), [name]: appearance } } }));
    get().save();
  },
  applyConnectionPreset: (name) => {
    const preset = get().connection.presets?.[name];
    if (!preset) return;
    set((s) => ({ connection: { ...s.connection, appearanceDefault: preset } }));
    get().save();
  },
  resetConnection: () => {
    set({ connection: { ...defaultConnection } });
    get().save();
  },
  open: (pane) => set((s) => ({ ui: { ...s.ui, isOpen: true, activePane: pane ?? 'account' } })),
  close: () => set((s) => ({ ui: { ...s.ui, isOpen: false } })),
}));

// 供非 React 模块读取（如渲染算法）
export function getConnectionSettings(): ConnectionSettings {
  const s = useSettingsStore.getState().connection;
  return s;
}

