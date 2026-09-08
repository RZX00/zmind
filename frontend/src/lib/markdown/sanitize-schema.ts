import { defaultSchema, type Options as RehypeSanitizeOptions } from 'rehype-sanitize';

/**
 * Build a shared sanitize schema that allows the elements/attributes we rely on
 * across the product (code highlighting classes, custom spans, safe inline styles, etc).
 */
export const createMarkdownSanitizeSchema = (): RehypeSanitizeOptions => {
  const schema: RehypeSanitizeOptions = {
    ...defaultSchema,
    attributes: { ...(defaultSchema?.attributes || {}) },
    tagNames: defaultSchema?.tagNames ? [...defaultSchema.tagNames] : undefined,
    protocols: { ...(defaultSchema?.protocols || {}) },
  };

  const ensureAttr = (tag: string, attrs: string[]) => {
    const existing = schema.attributes?.[tag] || [];
    schema.attributes = schema.attributes || {};
    schema.attributes[tag] = Array.from(new Set([...existing, ...attrs]));
  };

  ensureAttr('a', ['target', 'rel', 'title']);
  ensureAttr('code', ['className', 'style']);
  ensureAttr('span', ['className', 'style', 'aria-hidden', 'ariaHidden']);
  ensureAttr('*', ['id', 'className', 'style', 'aria-hidden', 'ariaHidden', 'aria-label', 'ariaLabel', 'role']);
  ensureAttr('img', ['loading', 'width', 'height', 'decoding', 'data-src', 'srcset']);
  ensureAttr('input', ['type', 'checked', 'disabled']);
  ensureAttr('math', ['xmlns', 'display', 'className']);
  ensureAttr('annotation', ['encoding']);
  ['mi', 'mo', 'mtext', 'mstyle'].forEach((tag) => ensureAttr(tag, ['mathvariant']));

  if (schema.tagNames) {
    ['span', 'figure', 'figcaption', 'input'].forEach((tag) => {
      if (!schema.tagNames!.includes(tag)) {
        schema.tagNames!.push(tag);
      }
    });
    [
      'math',
      'semantics',
      'annotation',
      'mrow',
      'mi',
      'mo',
      'mn',
      'mtext',
      'mfrac',
      'msqrt',
      'mroot',
      'msup',
      'msub',
      'msubsup',
      'mover',
      'munder',
      'munderover',
      'mtable',
      'mtr',
      'mtd',
      'mstyle',
      'mspace',
      'mpadded',
      'mphantom',
      'menclose',
      'merror',
      'ms',
    ].forEach((tag) => {
      if (!schema.tagNames!.includes(tag)) {
        schema.tagNames!.push(tag);
      }
    });
  }

  return schema;
};

export const markdownSanitizeSchema = createMarkdownSanitizeSchema();
