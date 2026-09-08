import type { TextStyles } from '../types/textStyles';

export type TextOpacityPresetId = 'opaque' | 'dimmed' | 'transparent';

export interface TextOpacityPreset {
  id: TextOpacityPresetId;
  label: string;
  description: string;
  value: number;
}

export const TEXT_OPACITY_PRESETS: TextOpacityPreset[] = [
  {
    id: 'opaque',
    label: 'Opaque',
    description: 'Solid card background',
    value: 1
  },
  {
    id: 'dimmed',
    label: 'Soft 60%',
    description: 'Softer background presence',
    value: 0.6
  },
  {
    id: 'transparent',
    label: 'Transparent',
    description: 'No card background',
    value: 0
  }
];

export type TextLayoutPresetId = 'classic' | 'compact' | 'minimal';

export interface TextLayoutMetrics {
  padding: number;
  prefixGap: number;
  minHeight: number;
  minWidth: number;
}

export interface TextLayoutPreset {
  id: TextLayoutPresetId;
  label: string;
  description: string;
  metrics: TextLayoutMetrics;
}

export const TEXT_LAYOUT_PRESETS: TextLayoutPreset[] = [
  {
    id: 'classic',
    label: 'Classic Sticky',
    description: 'Comfortable padding with a card feel',
    metrics: {
      padding: 16,
      prefixGap: 12,
      minHeight: 60,
      minWidth: 300
    }
  },
  {
    id: 'compact',
    label: 'Compact Card',
    description: 'Tighter padding, smaller footprint',
    metrics: {
      padding: 12,
      prefixGap: 10,
      minHeight: 48,
      minWidth: 260
    }
  },
  {
    id: 'minimal',
    label: 'Minimal Note',
    description: 'Bare layout with subtle padding',
    metrics: {
      padding: 6,
      prefixGap: 8,
      minHeight: 36,
      minWidth: 220
    }
  }
];

export const DEFAULT_TEXT_OPACITY_PRESET: TextOpacityPresetId = 'opaque';
export const DEFAULT_TEXT_LAYOUT_PRESET: TextLayoutPresetId = 'classic';

export function getTextOpacityPreset(id?: TextOpacityPresetId | null): TextOpacityPreset {
  const fallback = TEXT_OPACITY_PRESETS[0];
  if (!id) return fallback;
  return TEXT_OPACITY_PRESETS.find((preset) => preset.id === id) ?? fallback;
}

export function getTextLayoutPreset(id?: TextLayoutPresetId | null): TextLayoutPreset {
  const fallback = TEXT_LAYOUT_PRESETS[0];
  if (!id) return fallback;
  return TEXT_LAYOUT_PRESETS.find((preset) => preset.id === id) ?? fallback;
}

export function applyOpacityToTextStyles(
  textStyles: TextStyles | undefined,
  opacity: number
): TextStyles {
  const next: TextStyles = {
    ...(textStyles || {})
  };
  next.opacity = opacity;
  return next;
}
