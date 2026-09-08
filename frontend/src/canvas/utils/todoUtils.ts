const LINE_SPLIT = /\r?\n/;
const TASK_REGEX = /^\s*[-*]\s+\[( |x|X)\]\s*(.*)$/;

export interface TodoLine {
  lineIndex: number;
  text: string;
  completed: boolean;
}

export function parseTodoContent(content: string): TodoLine[] {
  const lines = (content || '').split(LINE_SPLIT);
  if (lines.length === 0) return [];
  return lines.map((line, idx) => {
    const match = line.match(TASK_REGEX);
    if (match) {
      return {
        lineIndex: idx,
        text: match[2] || '',
        completed: match[1].toLowerCase() === 'x'
      };
    }
    return {
      lineIndex: idx,
      text: line,
      completed: false
    };
  });
}

export function toggleTodoLine(content: string, lineIndex: number): string {
  const lines = ensureLines(content);
  if (lineIndex < 0 || lineIndex >= lines.length) return normalizeTodoContent(lines.join('\n'));
  const match = lines[lineIndex].match(TASK_REGEX);
  const next = match
    ? buildLine(match[2] || '', match[1].toLowerCase() !== 'x')
    : buildLine(lines[lineIndex].trim(), true);
  lines[lineIndex] = next;
  return normalizeTodoContent(lines.join('\n'));
}

export function updateTodoLineText(content: string, lineIndex: number, nextText: string): string {
  const lines = ensureLines(content);
  if (lineIndex < 0 || lineIndex >= lines.length) return normalizeTodoContent(lines.join('\n'));
  const match = lines[lineIndex].match(TASK_REGEX);
  const completed = match ? match[1].toLowerCase() === 'x' : false;
  lines[lineIndex] = buildLine(nextText, completed);
  return normalizeTodoContent(lines.join('\n'));
}

export function insertTodoLine(content: string, lineIndex: number): { content: string; newIndex: number } {
  const lines = ensureLines(content);
  const idx = Math.max(0, Math.min(lineIndex, lines.length));
  lines.splice(idx, 0, '- [ ] ');
  return { content: normalizeTodoContent(lines.join('\n')), newIndex: idx };
}

export function removeTodoLine(content: string, lineIndex: number): { content: string; focusIndex: number } {
  const lines = ensureLines(content);
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return { content: normalizeTodoContent(lines.join('\n')), focusIndex: Math.max(0, Math.min(lineIndex, lines.length - 1)) };
  }
  lines.splice(lineIndex, 1);
  const nextIndex = Math.max(0, Math.min(lineIndex - 1, lines.length - 1));
  const nextContent = normalizeTodoContent(lines.join('\n'));
  return { content: nextContent, focusIndex: nextIndex };
}

export function normalizeTodoContent(content: string): string {
  const lines = (content || '').split(LINE_SPLIT);
  return lines
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      const match = line.match(TASK_REGEX);
      if (match) {
        return buildLine(match[2] || '', match[1].toLowerCase() === 'x');
      }
      return buildLine(trimmed, false);
    })
    .filter(Boolean)
    .join('\n');
}

export function setAllTodoLinesState(content: string, completed: boolean): string {
  const lines = ensureLines(content);
  const next = lines.map(line => {
    const match = line.match(TASK_REGEX);
    const text = match ? (match[2] || '') : line.trim();
    return buildLine(text, completed);
  });
  return normalizeTodoContent(next.join('\n'));
}

export function computeTodoCompletion(content: string): boolean {
  const tasks = parseTodoContent(content);
  if (tasks.length === 0) return false;
  return tasks.every(task => task.completed);
}

function ensureLines(content: string): string[] {
  const lines = (content || '').split(LINE_SPLIT);
  if (lines.length === 0) return ['- [ ] '];
  return lines;
}

function buildLine(text: string, completed: boolean): string {
  const normalized = text ?? '';
  return `- [${completed ? 'x' : ' '}] ${normalized}`;
}
