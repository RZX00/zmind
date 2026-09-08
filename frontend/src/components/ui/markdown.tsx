import { cn } from '@/lib/utils';
import { marked } from 'marked';
import Image from 'next/image';
import { memo, useId, useMemo, useState } from 'react';
import type { Components } from 'react-markdown';
import { MarkdownRenderer as BaseMarkdownRenderer } from '@/lib/markdown/MarkdownRenderer';
import { CodeBlock, CodeBlockCode } from '@/components/ui/code-block';
import { Check, Copy } from 'lucide-react';

const passthroughLoader = ({ src }: { src: string }) => src;

export type MarkdownProps = {
  children: string;
  id?: string;
  className?: string;
  components?: Partial<Components>;
};

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown);
  return tokens.map((token: any) => token.raw);
}

function extractLanguage(className?: string): string {
  if (!className) return 'plaintext';
  const match = className.match(/language-(\w+)/);
  return match ? match[1].toLowerCase() : 'plaintext';
}

function isImageUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url, typeof window === 'undefined' ? 'http://localhost' : window.location.href);
    const pathname = u.pathname.toLowerCase();
    return (
      pathname.endsWith('.png') ||
      pathname.endsWith('.jpg') ||
      pathname.endsWith('.jpeg') ||
      pathname.endsWith('.gif') ||
      pathname.endsWith('.webp') ||
      pathname.endsWith('.bmp') ||
      pathname.endsWith('.svg') ||
      pathname.endsWith('.avif')
    );
  } catch {
    return false;
  }
}

export const MARKDOWN_COMPONENTS: Partial<Components> = {
  code: function CodeComponent({ className, children, ...props }: any) {
    const isInline =
      !props.node?.position?.start.line ||
      props.node?.position?.start.line === props.node?.position?.end.line;
    const [copied, setCopied] = useState(false);

    if (isInline) {
      return (
        <span
          className={cn(
            'bg-primary-foreground dark:bg-zinc-800 dark:border dark:border-zinc-700 rounded-sm px-1 font-mono text-sm',
            className,
          )}
          {...props}
        >
          {children}
        </span>
      );
    }

    const language = extractLanguage(className);
    const codeText = Array.isArray(children)
      ? children.join('')
      : typeof children === 'string'
        ? children
        : String(children ?? '');

    const handleCopy = async () => {
      if (!codeText) return;
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
      try {
        await navigator.clipboard.writeText(codeText);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } catch {
        setCopied(false);
      }
    };

    const languageLabel = language && language !== 'plaintext' ? language : 'code';

    return (
      <div className="my-4 overflow-hidden rounded-lg border border-border/60 bg-card/40 shadow-sm">
        <div className="flex items-center justify-between px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground bg-muted/40">
          <span>{languageLabel}</span>
          <button
            type="button"
            onClick={handleCopy}
            title={copied ? '已复制' : '复制代码'}
            aria-label={copied ? '已复制' : '复制代码'}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/80 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur transition hover:bg-muted/80 hover:text-foreground"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        </div>
        <CodeBlock className="w-full">
          <CodeBlockCode
            code={codeText}
            language={language}
            className="text-sm leading-relaxed"
          />
        </CodeBlock>
      </div>
    );
  },
  pre: function PreComponent({ children }: any) {
    return <>{children}</>;
  },
  ul: function UnorderedList({ children, ...props }: any) {
    return (
      <ul className="list-disc pl-5 my-2" {...props}>
        {children}
      </ul>
    );
  },
  ol: function OrderedList({ children, ...props }: any) {
    return (
      <ol className="list-decimal pl-5 my-2" {...props}>
        {children}
      </ol>
    );
  },
  li: function ListItem({ children, ...props }: any) {
    return (
      <li className="my-1" {...props}>
        {children}
      </li>
    );
  },
  h1: function H1({ children, ...props }: any) {
    return (
      <h1 className="text-2xl font-bold my-3" {...props}>
        {children}
      </h1>
    );
  },
  h2: function H2({ children, ...props }: any) {
    return (
      <h2 className="text-xl font-bold my-2" {...props}>
        {children}
      </h2>
    );
  },
  h3: function H3({ children, ...props }: any) {
    return (
      <h3 className="text-lg font-bold my-2" {...props}>
        {children}
      </h3>
    );
  },
  blockquote: function Blockquote({ children, ...props }: any) {
    return (
      <blockquote
        className="border-l-4 border-muted pl-4 italic my-2 dark:text-zinc-400 dark:border-zinc-600"
        {...props}
      >
        {children}
      </blockquote>
    );
  },
  a: function Anchor({ children, href, ...props }: any) {
    // 如果这是一个纯图片链接（文本等于链接并且后缀为图片），则直接渲染为图片
    const onlyChild = Array.isArray(children) && children.length === 1 ? children[0] : null;
    const childText = typeof onlyChild === 'string' ? onlyChild : (onlyChild?.props?.children ?? undefined);
    const text = typeof childText === 'string' ? childText : undefined;
    if (href && text && text === href && isImageUrl(href)) {
      return (
        // 外层容器方便横向滚动时保持布局
        <span className="inline-block max-w-full" {...props}>
          <Image
            src={href}
            alt="image"
            width={1200}
            height={800}
            unoptimized
            loader={passthroughLoader}
            className="max-w-full h-auto rounded-md"
            sizes="100vw"
          />
        </span>
      );
    }

    return (
      <a
        href={href}
        className="text-primary hover:underline dark:text-brand-400"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    );
  },
  img: function ImageRenderer({ src, alt, ...props }: any) {
    if (!src) return null;
    return (
      <Image
        src={src}
        alt={alt || 'image'}
        width={1200}
        height={800}
        unoptimized
        loader={passthroughLoader}
        className="max-w-full h-auto rounded-md"
        sizes="100vw"
        {...props}
      />
    );
  },
  table: function Table({ children, ...props }: any) {
    return (
      <div className="overflow-x-auto w-full">
        <table
          className="table-auto border-collapse my-3 text-sm min-w-full w-max"
          style={{ width: 'max-content' }}
          {...props}
        >
          {children}
        </table>
      </div>
    );
  },
  th: function TableHeader({ children, ...props }: any) {
    return (
      <th
        className="border border-slate-300 dark:border-zinc-700 px-3 py-2 text-left font-semibold bg-slate-100 dark:bg-zinc-800"
        {...props}
      >
        {children}
      </th>
    );
  },
  td: function TableCell({ children, ...props }: any) {
    return (
      <td
        className="border border-slate-300 dark:border-zinc-700 px-3 py-2"
        {...props}
      >
        {children}
      </td>
    );
  },
};

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({
    content,
    components = MARKDOWN_COMPONENTS,
  }: {
    content: string;
    components?: Partial<Components>;
  }) {
    return (
      <BaseMarkdownRenderer content={content} components={components} />
    );
  },
  function propsAreEqual(prevProps: any, nextProps: any) {
    return prevProps.content === nextProps.content;
  },
);

MemoizedMarkdownBlock.displayName = 'MemoizedMarkdownBlock';

function MarkdownComponent({
  children,
  id,
  className,
  components = MARKDOWN_COMPONENTS,
}: MarkdownProps) {
  const generatedId = useId();
  const blockId = id ?? generatedId;
  const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children]);

  return (
    <div
      className={cn(
        'prose-code:before:hidden prose-code:after:hidden',
        className,
      )}
    >
      {blocks.map((block, index) => (
        <MemoizedMarkdownBlock
          key={`${blockId}-block-${index}`}
          content={block}
          components={components}
        />
      ))}
    </div>
  );
}

const Markdown = memo(MarkdownComponent);
Markdown.displayName = 'Markdown';

export { Markdown };
