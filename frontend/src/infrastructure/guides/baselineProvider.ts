import type { CanvasNode, FontStyle } from '../../canvas/types/canvas';
import { DEFAULT_TEXT_LAYOUT_PRESET, getTextLayoutPreset } from '../../canvas/constants/textNodePresets';
import { useCanvasStore } from '../../canvas/stores/canvas.store';

function getLayoutPaddingPx(): number {
  try {
    const canvas = useCanvasStore.getState().canvas;
    const presetId = canvas?.textLayoutPreset ?? DEFAULT_TEXT_LAYOUT_PRESET;
    const preset = getTextLayoutPreset(presetId);
    return preset.metrics.padding;
  } catch {
    return 16;
  }
}

function inferFirstLineFontSize(content: string, fallback: number): number {
  const firstLine = content.split('\n').find((line) => line.trim().length > 0);
  if (!firstLine) return fallback;
  if (firstLine.startsWith('# ')) return 20;
  if (firstLine.startsWith('## ')) return 18;
  if (/^#{3,6}\s/.test(firstLine)) return 16;
  return fallback;
}

export function buildBaselineMap(nodes: CanvasNode[], fontStyle?: FontStyle): Record<string, number> {
  const padding = getLayoutPaddingPx();
  const baseFontSize = fontStyle?.size ?? 16;
  const result: Record<string, number> = {};

  for (const node of nodes || []) {
    if (node.type !== 'text' && node.type !== 'todo') continue;
    const fontSize = inferFirstLineFontSize(node.content || '', baseFontSize);
    const baselineOffset = Math.round(fontSize * 0.8);
    const raw = node.y + padding + baselineOffset;
    const minY = node.y + 2;
    const maxY = node.y + Math.max(2, node.height - 2);
    const baseline = Math.min(maxY, Math.max(minY, raw));
    result[node.id] = baseline;
  }

  return result;
}
