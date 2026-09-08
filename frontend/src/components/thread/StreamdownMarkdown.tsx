import type { Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { Streamdown } from 'streamdown';
import type { PluggableList } from 'unified';
import { MARKDOWN_COMPONENTS } from '@/components/ui/markdown';
import { markdownSanitizeSchema } from '@/lib/markdown/sanitize-schema';
import { rehypeInlineStyleSanitizer } from '@/lib/markdown/rehypeInlineStyleSanitizer';
import { cn } from '@/lib/utils';
import 'katex/dist/katex.min.css';

const remarkPlugins: PluggableList = [remarkGfm, remarkMath];
const rehypePlugins: PluggableList = [
  rehypeKatex,
  rehypeInlineStyleSanitizer,
  [rehypeSanitize, markdownSanitizeSchema] as const,
];

export type StreamdownMarkdownProps = {
  children: string;
  className?: string;
  components?: Partial<Components>;
  isAnimating?: boolean;
};

export function StreamdownMarkdown({
  children,
  className,
  components,
  isAnimating,
}: StreamdownMarkdownProps) {
  if (!children) return null;

  const mergedComponents = components
    ? { ...MARKDOWN_COMPONENTS, ...components }
    : MARKDOWN_COMPONENTS;

  return (
    <Streamdown
      className={cn('prose-code:before:hidden prose-code:after:hidden', className)}
      components={mergedComponents}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      isAnimating={isAnimating}
      parseIncompleteMarkdown={true}
    >
      {children}
    </Streamdown>
  );
}
