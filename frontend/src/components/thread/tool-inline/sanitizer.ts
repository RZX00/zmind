// Simple sanitizer to remove internal fields from tool outputs.
// Rules:
// - Remove internal metadata keys.
// - Preserve user-facing string content and URLs.
// - Do NOT modify user-entered content; we cannot reliably detect origin, so we keep fields like 'query' and 'title'
// - Always keep URLs even if they contain brand words

function shouldKeepKey(key: string): boolean {
  // Drop explicit meta keys we never want to show
  const dropKeys = [
    'xml_tag_name',
    'tool_call_id',
    'engine',
    'provider',
    'providers',
    'platform',
    'vendor',
    'internal',
    'metadata',
  ];
  if (dropKeys.includes(key)) return false;

  return true;
}

export function sanitizeForDisplay<T = any>(input: T): T {
  if (input === null || input === undefined) return input;

  if (Array.isArray(input)) {
    return input
      .map((v) => sanitizeForDisplay(v))
      .filter((v) => v !== undefined) as unknown as T;
  }

  if (typeof input === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(input as Record<string, any>)) {
      if (!shouldKeepKey(k)) continue;
      const sv = sanitizeForDisplay(v);

      // Preserve strings; user-facing content must not be rewritten by the display layer.
      if (typeof sv === 'string') {
        out[k] = sv;
      } else if (sv !== undefined) {
        out[k] = sv;
      }
    }
    return out as unknown as T;
  }

  // Primitive
  return input;
}

export function debugLog(prefix: string, data: any) {
  if (typeof window !== 'undefined' && (window as any).NEXT_PUBLIC_DEBUG_TOOL_SUMMARY) {
    // nothing
  }
  if (process.env.NEXT_PUBLIC_DEBUG_TOOL_SUMMARY) {
    try {
      console.debug(`[tool-summary:${prefix}]`, data);
    } catch {}
  }
}

