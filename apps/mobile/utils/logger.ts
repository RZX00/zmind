type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

type LoggerGlobal = typeof globalThis & {
  __ZMIND_SAFE_CONSOLE_INSTALLED__?: boolean;
};

const originalConsole = {
  log: console.log.bind(console),
  info: (console.info ?? console.log).bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: (console.debug ?? console.log).bind(console),
};

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /auth/i,
  /cookie/i,
  /secret/i,
  /password/i,
  /^pass$/i,
  /api[_-]?key/i,
  /session/i,
  /^code$/i,
  /url/i,
  /uri/i,
  /path/i,
  /content/i,
  /message/i,
  /payload/i,
  /attachment/i,
  /output/i,
  /result/i,
  /html/i,
  /image/i,
  /screenshot/i,
  /^data$/i,
  /headers/i,
  /body/i,
];

const MAX_STRING_LENGTH = 160;
const MAX_ARRAY_ITEMS = 10;
const MAX_OBJECT_KEYS = 20;
const MAX_DEPTH = 4;

function summarizeSensitiveValue(key: string, value: unknown): string {
  const label =
    /token|auth|cookie|secret|password|pass|api[_-]?key|session|code/i.test(key)
      ? 'credential'
      : /url|uri/i.test(key)
        ? 'url'
        : /path/i.test(key)
          ? 'path'
          : /image|screenshot/i.test(key)
            ? 'image'
            : /attachment/i.test(key)
              ? 'attachment'
              : 'content';

  if (typeof value === 'string') {
    return `[redacted-${label} length=${value.length}]`;
  }

  if (Array.isArray(value)) {
    return `[redacted-${label}-array length=${value.length}]`;
  }

  if (value && typeof value === 'object') {
    return `[redacted-${label}-object]`;
  }

  return `[redacted-${label}]`;
}

function redactHttpUrl(rawUrl: string): string {
  if (typeof URL !== 'undefined') {
    try {
      const parsedUrl = new URL(rawUrl);
      return `[redacted-url origin=${parsedUrl.origin}]`;
    } catch {
      return '[redacted-url]';
    }
  }

  return '[redacted-url]';
}

function sanitizeString(value: string): string {
  let sanitized = value;

  sanitized = sanitized.replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/gi, '[redacted-data-url]');
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [redacted]');
  sanitized = sanitized.replace(/\bhttps?:\/\/[^\s'"`]+/gi, (match) => redactHttpUrl(match));
  sanitized = sanitized.replace(/\b(?:file|content):\/\/[^\s'"`]+/gi, '[redacted-local-uri]');
  sanitized = sanitized.replace(/\b[A-Za-z]:\\[^\s'"`]+/g, '[redacted-path]');
  sanitized = sanitized.replace(
    /(^|[\s'"`])\/(?:workspace|data|var|private|storage|Users|user|tmp|cache)[^\s'"`]+/g,
    '$1[redacted-path]',
  );
  sanitized = sanitized.replace(
    /(["']?(?:token|access_token|authorization|auth|cookie|password|secret|api[_-]?key|session|code)["']?\s*[:=]\s*["'])[^"']+(["'])/gi,
    '$1[redacted]$2',
  );

  if (sanitized.includes('\n') || sanitized.length > MAX_STRING_LENGTH) {
    return `[redacted-text length=${value.length}]`;
  }

  return sanitized;
}

function sanitizeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (typeof value === 'function') {
    return `[function ${value.name || 'anonymous'}]`;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
    };
  }

  if (typeof URL !== 'undefined' && value instanceof URL) {
    return redactHttpUrl(value.toString());
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) {
      return `[array(${value.length})]`;
    }

    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[truncated ${value.length - MAX_ARRAY_ITEMS} items]`);
    }
    return items;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[circular]';
    }

    if (depth >= MAX_DEPTH) {
      return `[object ${(value as { constructor?: { name?: string } }).constructor?.name || 'Object'}]`;
    }

    seen.add(value);

    const entries = Object.entries(value as Record<string, unknown>);
    const sanitizedEntries = entries.slice(0, MAX_OBJECT_KEYS).map(([key, entryValue]) => {
      const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      return [
        key,
        isSensitive ? summarizeSensitiveValue(key, entryValue) : sanitizeValue(entryValue, depth + 1, seen),
      ] as const;
    });

    if (entries.length > MAX_OBJECT_KEYS) {
      sanitizedEntries.push(['__truncated__', `${entries.length - MAX_OBJECT_KEYS} keys`]);
    }

    return Object.fromEntries(sanitizedEntries);
  }

  return String(value);
}

function emitLog(level: LogLevel, args: unknown[]): void {
  const isDebugLevel = level === 'log' || level === 'info' || level === 'debug';
  if (isDebugLevel && !__DEV__) {
    return;
  }

  const sanitizedArgs = args.map((arg) => sanitizeValue(arg));
  originalConsole[level](...sanitizedArgs);
}

export function debugLog(...args: unknown[]): void {
  emitLog('log', args);
}

export function infoLog(...args: unknown[]): void {
  emitLog('info', args);
}

export function warnLog(...args: unknown[]): void {
  emitLog('warn', args);
}

export function errorLog(...args: unknown[]): void {
  emitLog('error', args);
}

export function installConsoleSafety(): void {
  const loggerGlobal = globalThis as LoggerGlobal;
  if (loggerGlobal.__ZMIND_SAFE_CONSOLE_INSTALLED__) {
    return;
  }

  loggerGlobal.__ZMIND_SAFE_CONSOLE_INSTALLED__ = true;

  console.log = (...args: Parameters<typeof console.log>) => emitLog('log', args);
  console.info = (...args: Parameters<typeof console.info>) => emitLog('info', args);
  console.warn = (...args: Parameters<typeof console.warn>) => emitLog('warn', args);
  console.error = (...args: Parameters<typeof console.error>) => emitLog('error', args);
  console.debug = (...args: Parameters<typeof console.debug>) => emitLog('debug', args);
}

installConsoleSafety();
