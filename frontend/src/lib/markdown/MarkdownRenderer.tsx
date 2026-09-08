import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
import type { Pluggable } from 'unified';

import { markdownSanitizeSchema } from './sanitize-schema';
import { rehypeInlineStyleSanitizer } from './rehypeInlineStyleSanitizer';

export interface MarkdownRendererProps {
  content: string;
  className?: string;
  components?: Components;
  enableMath?: boolean;
  allowHtml?: boolean;
  remarkPlugins?: Pluggable[];
  rehypePlugins?: Pluggable[];
}

const noopArray: Pluggable[] = [];

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = memo(
  ({
    content,
    className,
    components,
    enableMath = false,
    allowHtml = false,
    remarkPlugins = noopArray,
    rehypePlugins = noopArray,
  }) => {
    if (!content) return null;

    const appliedRemark: Pluggable[] = [remarkGfm, ...(enableMath ? [remarkMath] : []), ...remarkPlugins];
    const appliedRehype: Pluggable[] = [
      allowHtml ? rehypeRaw : null,
      ...(enableMath ? [rehypeKatex] : []),
      rehypeInlineStyleSanitizer,
      [rehypeSanitize, markdownSanitizeSchema],
      ...rehypePlugins,
    ].filter(Boolean) as Pluggable[];

    const markdown = (
      <ReactMarkdown remarkPlugins={appliedRemark} rehypePlugins={appliedRehype} components={components}>
        {content}
      </ReactMarkdown>
    );

    if (!className) return markdown;
    return <div className={className}>{markdown}</div>;
  },
);

MarkdownRenderer.displayName = 'MarkdownRenderer';
