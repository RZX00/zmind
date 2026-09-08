// Parse inline JSON blocks containing a top-level object with a `tool_execution` key
// Returns a list of segments: text or tool execution objects

export type Segment =
  | { type: 'text'; text: string }
  | { type: 'tool'; exec: any; raw: string };

function findJsonObjectBounds(source: string, startIndex: number): { end: number } | null {
  // Start scanning from the first '{' before or at startIndex
  let i = startIndex;
  while (i > 0 && source[i] !== '{') i--;
  if (source[i] !== '{') return null;

  let level = 0;
  let inStr: 'single' | 'double' | null = null;
  let escaped = false;
  for (let j = i; j < source.length; j++) {
    const ch = source[j];
    if (inStr) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if ((inStr === 'double' && ch === '"') || (inStr === 'single' && ch === "'")) {
        inStr = null;
      }
    } else {
      if (ch === '"') inStr = 'double';
      else if (ch === "'") inStr = 'single';
      else if (ch === '{') level++;
      else if (ch === '}') {
        level--;
        if (level === 0) return { end: j };
      }
    }
  }
  return null;
}

export function parseInlineToolExecutions(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  const re = /\{\s*\"tool_execution\"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const idx = m.index;
    // Find bounds for the JSON object starting around idx
    const bounds = findJsonObjectBounds(text, idx);
    if (!bounds) continue;
    const start = text.lastIndexOf('{', idx);
    const end = bounds.end;
    if (start < 0 || end <= start) continue;
    const jsonStr = text.slice(start, end + 1);
    try {
      const execObj = JSON.parse(jsonStr);
      if (execObj && typeof execObj === 'object' && execObj.tool_execution) {
        if (start > cursor) segments.push({ type: 'text', text: text.slice(cursor, start) });
        segments.push({ type: 'tool', exec: execObj.tool_execution, raw: jsonStr });
        cursor = end + 1;
      }
    } catch {
      // Not valid JSON, skip
    }
  }
  if (cursor < text.length) {
    segments.push({ type: 'text', text: text.slice(cursor) });
  }
  return segments;
}

