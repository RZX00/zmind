import type { JSONContent } from 'novel';

const TODO_LINE_REGEX = /^\s*[-*+]\s+\[( |x|X)\]\s*(.*)$/;
const BULLET_LINE_REGEX = /^\s*[-*+]\s+(.*)$/;
const ORDERED_LINE_REGEX = /^\s*\d+\.\s+(.*)$/;

interface TodoLine {
  checked: boolean;
  text: string;
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function parseTodoLines(markdown: string): TodoLine[] {
  const lines = normalizeText(markdown).split('\n');
  const parsed: TodoLine[] = [];

  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;

    const todoMatch = raw.match(TODO_LINE_REGEX);
    if (todoMatch) {
      parsed.push({
        checked: todoMatch[1].toLowerCase() === 'x',
        text: (todoMatch[2] || '').trim(),
      });
      continue;
    }

    const bulletMatch = raw.match(BULLET_LINE_REGEX);
    if (bulletMatch) {
      parsed.push({
        checked: false,
        text: (bulletMatch[1] || '').trim(),
      });
      continue;
    }

    const orderedMatch = raw.match(ORDERED_LINE_REGEX);
    if (orderedMatch) {
      parsed.push({
        checked: false,
        text: (orderedMatch[1] || '').trim(),
      });
      continue;
    }

    parsed.push({ checked: false, text: raw });
  }

  return parsed;
}

function todoLineToMarkdown(line: TodoLine): string {
  return line.text
    ? `- [${line.checked ? 'x' : ' '}] ${line.text}`
    : `- [${line.checked ? 'x' : ' '}] `;
}

function flattenText(node: JSONContent): string {
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content) || node.content.length === 0) return '';

  return node.content
    .map((child) => flattenText(child))
    .filter(Boolean)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectTaskItems(node: JSONContent, target: TodoLine[]): void {
  if (node.type === 'taskItem') {
    target.push({
      checked: Boolean(node.attrs && (node.attrs as Record<string, unknown>).checked),
      text: flattenText(node),
    });
  }

  if (!Array.isArray(node.content)) return;
  for (const child of node.content) {
    collectTaskItems(child, target);
  }
}

export function buildTodoJsonFromMarkdown(markdown: string): JSONContent | null {
  const lines = parseTodoLines(markdown);
  if (lines.length === 0) return null;

  return {
    type: 'doc',
    content: [
      {
        type: 'taskList',
        content: lines.map((line) => ({
          type: 'taskItem',
          attrs: { checked: line.checked },
          content: line.text
            ? [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: line.text }],
                },
              ]
            : [{ type: 'paragraph' }],
        })),
      },
    ],
  };
}

export function extractTodoMarkdownFromJson(json: JSONContent | null | undefined): string | null {
  if (!json) return null;
  const lines: TodoLine[] = [];
  collectTaskItems(json, lines);
  if (lines.length === 0) return null;

  return lines.map(todoLineToMarkdown).join('\n');
}

export function resolveTodoContentFromRichText(input: {
  markdown: string;
  json: JSONContent | null | undefined;
}): string {
  const fromJson = extractTodoMarkdownFromJson(input.json);
  if (fromJson && fromJson.trim()) {
    return fromJson;
  }

  const lines = parseTodoLines(input.markdown);
  return lines.map(todoLineToMarkdown).join('\n');
}
