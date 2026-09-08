import type { CanvasNode } from '../../types/canvas';
import {
  DEFAULT_TEXT_LAYOUT_PRESET,
  getTextLayoutPreset,
  type TextLayoutPreset,
  type TextLayoutPresetId,
} from '../../constants/textNodePresets';
import {
  calculateOptimalNodeSize,
  calculateTextNodeHeight,
  estimateAutoTextWidth,
} from '../../utils/canvasUtils';
import { measureTextNodeRequiredHeight } from '../../utils/domMeasure';

export interface TextLayoutContext {
  layoutPreset?: TextLayoutPreset;
  layoutPresetId?: TextLayoutPresetId;
}

interface TextHeightInput extends TextLayoutContext {
  content: string;
  width: number;
  hasAccentColor?: boolean;
}

interface AutoWidthInput extends TextLayoutContext {
  content: string;
  nodeType: 'text' | 'todo';
  clamp?: { min?: number; max?: number };
}

interface OptimizeSizeInput extends TextLayoutContext {
  node: CanvasNode;
  content?: string;
  hasAccentColor?: boolean;
}

export function resolveTextLayoutPreset(input: TextLayoutContext = {}): TextLayoutPreset {
  if (input.layoutPreset) return input.layoutPreset;
  return getTextLayoutPreset(input.layoutPresetId ?? DEFAULT_TEXT_LAYOUT_PRESET);
}

export function calculateTextHeightWithLayout(input: TextHeightInput): number {
  const layoutPreset = resolveTextLayoutPreset(input);
  return calculateTextNodeHeight(input.content, input.width, {
    layoutPreset,
    hasAccentColor: input.hasAccentColor,
  });
}

export function estimateMindmapAutoTextWidth(input: AutoWidthInput): number {
  const layoutPreset = resolveTextLayoutPreset(input);
  return estimateAutoTextWidth(input.content, {
    layoutPreset,
    nodeType: input.nodeType,
    clamp: input.clamp,
  });
}

export function calculateOptimizedTextNodeSize(input: OptimizeSizeInput): { width: number; height: number } {
  const content = input.content ?? input.node.content ?? '';
  const layoutPreset = resolveTextLayoutPreset(input);
  const hasAccentColor =
    input.hasAccentColor ??
    Boolean((input.node as any).textStyles?.accentColor && (input.node as any).textStyles?.accentColor !== 'transparent');

  return calculateOptimalNodeSize(
    content,
    input.node.width,
    input.node.height,
    hasAccentColor,
    { layoutPreset },
  );
}

export function measureOrEstimateTextNodeHeight(input: OptimizeSizeInput): number {
  const measuredHeight = measureTextNodeRequiredHeight(input.node.id);
  if (typeof measuredHeight === 'number') {
    return measuredHeight;
  }
  return calculateOptimizedTextNodeSize(input).height;
}
