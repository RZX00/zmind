// Centralized HTML sanitizer for canvas renderers.
// Keeps persisted content intact while producing a safe rendering copy.

import createDOMPurify from 'dompurify';
import type {
  Config as DOMPurifyConfig,
  UponSanitizeAttributeHookEvent,
  UponSanitizeElementHookEvent,
} from 'dompurify';

type SanitizerContext = 'html-node' | 'markdown' | 'thumbnail';

export interface HtmlSanitizeOptions {
  context?: SanitizerContext;
  allowStyleTag?: boolean;
  allowInlineStyles?: boolean;
}

interface SanitizerRuntimeOptions {
  allowStyleTag: boolean;
  allowInlineStyles: boolean;
  context: SanitizerContext;
}

const DEFAULT_OPTIONS: SanitizerRuntimeOptions = {
  context: 'html-node',
  allowStyleTag: true,
  allowInlineStyles: true,
};

const BASE_ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'div', 'dl', 'dt', 'dd',
  'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img',
  'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'section', 'small', 'span',
  'strong', 'sub', 'sup', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th',
  'u', 'ul', 'video', 'source', 'audio', 'colgroup', 'col'
];

const BASE_ALLOWED_ATTR: Record<string, string[]> = {
  '*': [
    'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden', 'aria-describedby',
    'aria-expanded', 'aria-controls', 'data-*', 'dir', 'lang', 'tabindex', 'style'
  ],
  a: ['href', 'target', 'rel', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
  video: ['src', 'poster', 'controls', 'autoplay', 'loop', 'muted'],
  audio: ['src', 'controls', 'autoplay', 'loop'],
  source: ['src', 'type'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  table: ['border', 'cellpadding', 'cellspacing'],
};

const SAFE_URL_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

const DISALLOWED_CSS_SNIPPETS = /(expression\s*\(|javascript:|@import|behavior\s*:|<|>)/i;
const DISALLOWED_PROPERTIES = new Set(['behavior', '-ms-behavior']);

const COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;

const SELECTOR_PATTERN = /^[\w\s\.#>*:,\-\[\]"]+$/;

const getPurifyInstance = () => {
  if (typeof window === 'undefined') return null;
  return createDOMPurify(window);
};

const normalizeOptions = (options?: HtmlSanitizeOptions): SanitizerRuntimeOptions => {
  const merged: SanitizerRuntimeOptions = {
    ...DEFAULT_OPTIONS,
    ...(options || {}),
  } as SanitizerRuntimeOptions;

  if (merged.context === 'markdown') {
    merged.allowStyleTag = options?.allowStyleTag ?? false;
    merged.allowInlineStyles = options?.allowInlineStyles ?? true;
  }

  return merged;
};

const buildConfig = (options: SanitizerRuntimeOptions): DOMPurifyConfig => {
  const tags = new Set(BASE_ALLOWED_TAGS);
  if (options.allowStyleTag) {
    tags.add('style');
  } else {
    tags.delete('style');
  }

  const allowedAttributeSet = new Set<string>();
  for (const [tag, attrs] of Object.entries(BASE_ALLOWED_ATTR)) {
    const resolvedAttrs =
      tag === '*' && !options.allowInlineStyles
        ? attrs.filter((attr) => attr !== 'style')
        : attrs;
    resolvedAttrs.forEach((attr) => allowedAttributeSet.add(attr));
  }

  return {
    ALLOWED_TAGS: Array.from(tags),
    ALLOWED_ATTR: Array.from(allowedAttributeSet),
    ALLOW_DATA_ATTR: true,
    KEEP_CONTENT: true,
  } satisfies DOMPurifyConfig;
};

export const sanitizeInlineStyle = (value: string): string | null => {
  if (!value) return null;
  const declarations = value.split(';');
  const safeDeclarations: string[] = [];

  for (const declaration of declarations) {
    if (!declaration.trim()) continue;
    const [propRaw, ...rest] = declaration.split(':');
    if (!propRaw || rest.length === 0) continue;
    const valueRaw = rest.join(':');

    const property = propRaw.trim().toLowerCase();
    const propertyValue = valueRaw.trim();

    const safeValue = sanitizeCssValue(property, propertyValue);
    if (!safeValue) continue;

    safeDeclarations.push(`${property}: ${safeValue}`);
  }

  if (safeDeclarations.length === 0) return null;
  return safeDeclarations.join('; ');
};

const sanitizeCssValue = (property: string, rawValue: string): string | null => {
  if (DISALLOWED_PROPERTIES.has(property)) return null;

  const value = rawValue.replace(/!important/gi, '').trim();
  if (!value) return null;
  if (value.length > 1000) return null;
  if (DISALLOWED_CSS_SNIPPETS.test(value)) return null;

  if (/url\s*\(/i.test(value)) {
    const matches = value.match(/url\(([^)]+)\)/gi) || [];
    for (const match of matches) {
      const inner = match.replace(/^url\(/i, '').replace(/\)\s*$/i, '').trim();
      const inside = inner.replace(/^['"]|['"]$/g, '');
      if (!isSafeUrl(inside, 'src')) {
        return null;
      }
    }
  }

  return value;
};

export const sanitizeStyleBlock = (css: string): string | null => {
  if (!css) return null;
  const withoutComments = css.replace(COMMENT_PATTERN, '');
  const rules = withoutComments.split('}');
  const safeRules: string[] = [];

  for (const rawRule of rules) {
    const trimmedRule = rawRule.trim();
    if (!trimmedRule) continue;
    const segments = trimmedRule.split('{');
    if (segments.length < 2) continue;
    const selector = segments[0].trim();
    const declarations = segments.slice(1).join('{').trim();

    if (!selector || selector.startsWith('@')) continue;
    if (!SELECTOR_PATTERN.test(selector)) continue;

    const sanitized = sanitizeInlineStyle(declarations);
    if (!sanitized) continue;

    safeRules.push(`${selector} { ${sanitized} }`);
  }

  return safeRules.length > 0 ? safeRules.join('\n') : null;
};
const isSafeUrl = (value: string, attribute: 'href' | 'src'): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^javascript:/i.test(trimmed)) return false;

  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return true;

  if (attribute === 'src' && trimmed.startsWith('data:')) {
    // Allow limited data URIs for images/audio/video.
    return /^data:(image|audio|video)\//i.test(trimmed);
  }

  try {
    const url = new URL(trimmed, 'https://example.com');
    return SAFE_URL_PROTOCOLS.includes(url.protocol);
  } catch {
    return false;
  }
};

const runWithHooks = (
  purify: ReturnType<typeof createDOMPurify>,
  options: SanitizerRuntimeOptions,
  sanitizer: () => string,
): string => {
  const attrHook = (_node: Element, data: UponSanitizeAttributeHookEvent) => {
    if (data.attrName === 'style') {
      if (!options.allowInlineStyles) {
        data.keepAttr = false;
        return;
      }
      const sanitizedValue = sanitizeInlineStyle(data.attrValue || '');
      if (!sanitizedValue) {
        data.keepAttr = false;
      } else {
        data.attrValue = sanitizedValue;
      }
      return;
    }

    if (data.attrName === 'href' || data.attrName === 'src') {
      if (!isSafeUrl(data.attrValue || '', data.attrName as 'href' | 'src')) {
        data.keepAttr = false;
      } else {
        data.attrValue = (data.attrValue || '').trim();
      }
    }
  };

  const elementHook = (
    node: Element,
    data: UponSanitizeElementHookEvent & { keepElement?: boolean },
  ) => {
    if (data.tagName === 'style') {
      if (!options.allowStyleTag) {
        data.keepElement = false;
        return;
      }
      const sanitizedCss = sanitizeStyleBlock(node.textContent || '');
      if (!sanitizedCss) {
        data.keepElement = false;
      } else {
        node.textContent = sanitizedCss;
      }
    }
  };

  const hook = (name: string, handler: (...args: any[]) => void) => {
    purify.addHook(name as any, handler as any);
    return () => purify.removeHook(name as any);
  };

  const removeAttrHook = hook('uponSanitizeAttribute', attrHook);
  const removeElementHook = hook('uponSanitizeElement', elementHook);

  const result = sanitizer();

  removeAttrHook();
  removeElementHook();

  return result;
};

export const sanitizeHtmlForRender = (
  rawHtml: string,
  options?: HtmlSanitizeOptions,
): string => {
  if (!rawHtml) return '';
  if (options?.context === 'html-node') {
    return rawHtml;
  }
  const purify = getPurifyInstance();
  if (!purify) return rawHtml;

  const runtimeOptions = normalizeOptions(options);
  const config = buildConfig(runtimeOptions);

  return runWithHooks(purify, runtimeOptions, () => purify.sanitize(rawHtml, config));
};

export const sanitizeHtmlFragment = (
  fragment: string,
  options?: HtmlSanitizeOptions,
): string => sanitizeHtmlForRender(fragment, options);
