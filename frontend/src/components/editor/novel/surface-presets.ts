import type { NovelRichTextEditorProps } from './NovelRichTextEditor';

export type NovelEditorSurface = 'document' | 'canvas-inline';

type NovelSurfacePreset = Pick<NovelRichTextEditorProps, 'mode' | 'disableDragHandle'>;

const NOVEL_SURFACE_PRESETS: Record<NovelEditorSurface, NovelSurfacePreset> = {
  document: {
    mode: 'default',
    disableDragHandle: false,
  },
  'canvas-inline': {
    mode: 'canvas-inline',
    disableDragHandle: true,
  },
};

export function getNovelSurfacePreset(surface: NovelEditorSurface): NovelSurfacePreset {
  return NOVEL_SURFACE_PRESETS[surface];
}

