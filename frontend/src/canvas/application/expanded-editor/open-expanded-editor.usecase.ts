import type { CanvasNode } from '../../types/canvas';
import { readExpandedEditorSnapshot } from '../../domain/expanded-editor/serialization';
import type { ExpandedEditorOpenState } from '../../domain/expanded-editor/types';
import { buildTodoJsonFromMarkdown } from '../../domain/expanded-editor/todo-richtext';

const TITLE_MAX_LENGTH = 60;

function normalizeMarkdownForCompare(input: string): string {
  return (input || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trimEnd();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeTitleSource(input: string): string {
  if (!input) return '';
  let text = decodeHtmlEntities(input).trim();
  if (!text) return '';

  // Strip obvious markdown prefixes.
  text = text
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^\[(?:x|X| )\]\s+/, '');

  // Remove inline markdown wrappers.
  text = text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1');

  // Remove html tags that leaked from rich text serialization.
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function resolveNodeTitle(node: CanvasNode): string {
  if (typeof node.title === 'string' && node.title.trim()) {
    const normalizedTitle = normalizeTitleSource(node.title);
    if (normalizedTitle) return normalizedTitle.slice(0, TITLE_MAX_LENGTH);
  }

  const normalizedLines = (node.content || '')
    .split(/\r?\n/g)
    .map((line) => normalizeTitleSource(line))
    .filter(Boolean);
  if (normalizedLines.length > 0) {
    return normalizedLines[0].slice(0, TITLE_MAX_LENGTH);
  }

  return 'Text Node';
}

export function openExpandedEditorUseCase(node: CanvasNode): ExpandedEditorOpenState {
  const snapshot = readExpandedEditorSnapshot(node);
  const contentMarkdown = normalizeMarkdownForCompare(node.content || '');
  const snapshotMarkdown = normalizeMarkdownForCompare(snapshot?.markdown || '');
  const snapshotInSyncWithContent =
    !!snapshot && snapshotMarkdown.length > 0 && snapshotMarkdown === contentMarkdown;

  // Single source of truth for inline edit should be current node.content (display source).
  // Only trust stored rich snapshot when markdown is in sync; otherwise stale json/html will
  // cause edit/display drift for headings/lists/task nodes.
  const markdown = snapshotInSyncWithContent
    ? snapshotMarkdown
    : contentMarkdown;
  const json =
    snapshotInSyncWithContent
      ? (snapshot?.json || (node.type === 'todo' ? buildTodoJsonFromMarkdown(markdown) : undefined))
      : (node.type === 'todo' ? buildTodoJsonFromMarkdown(markdown) : undefined);
  const html = snapshotInSyncWithContent ? (snapshot?.html || undefined) : undefined;

  return {
    nodeId: node.id,
    title: resolveNodeTitle(node),
    markdown,
    html,
    json,
  };
}
