import type { JSONContent } from 'novel';

export interface NovelEditorContentSeed {
  markdown?: string;
  html?: string;
  json?: JSONContent | null;
}

export interface NovelEditorSnapshot {
  markdown: string;
  html: string;
  json: JSONContent | null;
  wordCount: number;
  characterCount: number;
}

export type NovelAiOption = 'zap' | 'improve' | 'fix' | 'shorter' | 'longer' | 'continue';

export interface NovelAiRequest {
  selectionMarkdown: string;
  option: NovelAiOption;
  command?: string;
  previousCompletion?: string;
}
