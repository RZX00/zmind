import type { CanvasNode } from '../../types/canvas';
import {
  EXPANDED_EDITOR_DATA_KEY,
  EXPANDED_EDITOR_VERSION,
  type ExpandedEditorDataEnvelope,
  type ExpandedEditorSnapshot,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function readExpandedEditorSnapshot(node: CanvasNode): ExpandedEditorSnapshot | null {
  const data = (node as any)?.data;
  if (!isRecord(data)) return null;
  const entry = data[EXPANDED_EDITOR_DATA_KEY];
  if (!isRecord(entry)) return null;

  const markdown = toStringOrEmpty(entry.markdown);
  const html = toStringOrEmpty(entry.html);
  const version = toStringOrEmpty(entry.version) || EXPANDED_EDITOR_VERSION;
  const updatedAt = typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now();
  const json = isRecord(entry.json) ? (entry.json as any) : null;

  if (!markdown && !html && !json) return null;

  return {
    version,
    markdown,
    html,
    json,
    updatedAt,
  };
}

export function buildExpandedEditorSnapshot(input: {
  markdown: string;
  html: string;
  json: unknown;
}): ExpandedEditorSnapshot {
  return {
    version: EXPANDED_EDITOR_VERSION,
    markdown: (input.markdown || '').replace(/\r\n/g, '\n'),
    html: input.html || '',
    json: isRecord(input.json) ? (input.json as any) : null,
    updatedAt: Date.now(),
  };
}

export function mergeExpandedEditorData(
  existingData: unknown,
  snapshot: ExpandedEditorSnapshot,
): ExpandedEditorDataEnvelope {
  const base: ExpandedEditorDataEnvelope = isRecord(existingData)
    ? { ...(existingData as Record<string, unknown>) }
    : {};
  base[EXPANDED_EDITOR_DATA_KEY] = snapshot;
  return base;
}
