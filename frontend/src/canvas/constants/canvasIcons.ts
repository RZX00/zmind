export const CANVAS_ICON_NAMES = [
  'text',
  'todo',
  'code',
  'column',
  'table',
  'canvasLink',
  'group',
  'media',
  'image',
  'document',
  'spreadsheet',
  'presentation',
  'audio',
  'video',
  'shapeSquare',
  'shapeCircle',
  'shapeDiamond',
  'tableMinimal',
  'tableStriped',
  'tableGrid',
] as const;

export type CanvasIconName = typeof CANVAS_ICON_NAMES[number];

