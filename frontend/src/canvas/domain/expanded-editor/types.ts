import type { JSONContent } from 'novel';

export const EXPANDED_EDITOR_VERSION = '1.0.0';
export const EXPANDED_EDITOR_DATA_KEY = 'expandedEditor';

export interface ExpandedEditorSnapshot {
  version: string;
  markdown: string;
  html: string;
  json: JSONContent | null;
  updatedAt: number;
}

export interface ExpandedEditorDataEnvelope {
  expandedEditor?: ExpandedEditorSnapshot;
  [key: string]: unknown;
}

export interface ExpandedEditorOpenState {
  nodeId: string;
  title: string;
  markdown: string;
  html?: string;
  json?: JSONContent | null;
}
