import type { CanvasNode } from '../../types/canvas';
import {
  buildExpandedEditorSnapshot,
  mergeExpandedEditorData,
} from '../../domain/expanded-editor/serialization';
import type { ExpandedEditorDataEnvelope, ExpandedEditorSnapshot } from '../../domain/expanded-editor/types';
import { resolveTodoContentFromRichText } from '../../domain/expanded-editor/todo-richtext';

export interface SaveExpandedEditorInput {
  markdown: string;
  html: string;
  json: unknown;
}

export interface SaveExpandedEditorResult {
  content: string;
  data: ExpandedEditorDataEnvelope;
  snapshot: ExpandedEditorSnapshot;
}

export function saveExpandedEditorUseCase(
  node: CanvasNode,
  input: SaveExpandedEditorInput,
): SaveExpandedEditorResult {
  const snapshot = buildExpandedEditorSnapshot(input);
  const content =
    node.type === 'todo'
      ? resolveTodoContentFromRichText({ markdown: snapshot.markdown, json: snapshot.json })
      : snapshot.markdown;

  return {
    content,
    data: mergeExpandedEditorData((node as any).data, snapshot),
    snapshot,
  };
}
