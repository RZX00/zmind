import { visit, SKIP } from 'unist-util-visit';
import type { Element, Properties, Root } from 'hast';

import { sanitizeInlineStyle } from './htmlSanitizer';

/**
 * Rehype plugin that sanitizes inline styles and strips unsafe style/script nodes.
 * This mirrors the Canvas-specific logic but is shared across every markdown renderer.
 */
export const rehypeInlineStyleSanitizer = () => {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (!node || !node.properties) return;

      const properties: Properties = { ...node.properties };

      if (properties.style) {
        const sanitized = sanitizeInlineStyle(String(properties.style));
        if (sanitized) {
          properties.style = sanitized;
        } else {
          delete properties.style;
        }
      }

      for (const key of Object.keys(properties)) {
        if (key.toLowerCase().startsWith('on')) {
          delete properties[key];
        }
      }

      node.properties = properties;

      if (node.tagName === 'style' && parent && typeof index === 'number') {
        parent.children.splice(index, 1);
        return [SKIP, index];
      }

      return undefined;
    });
  };
};
