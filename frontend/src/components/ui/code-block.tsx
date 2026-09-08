'use client';

import { cn } from '@/lib/utils';
import React, { useEffect, useState } from 'react';
import { codeToHtml } from 'shiki';
import { useTheme } from 'next-themes';
import { MermaidRenderer } from './mermaid-renderer';
import { SvgPreview } from './svg-preview';

export type CodeBlockProps = {
  children?: React.ReactNode;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div className={cn('w-full min-w-0 overflow-hidden', className)} {...props}>
      {children}
    </div>
  );
}

export type CodeBlockCodeProps = {
  code: string;
  language?: string;
  theme?: string;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

function CodeBlockCode({
  code,
  language = 'tsx',
  theme: propTheme,
  className,
  ...props
}: CodeBlockCodeProps) {
  const { resolvedTheme } = useTheme();
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [mermaidFailed, setMermaidFailed] = useState(false);
  const normalizedLanguage = (language || 'tsx').toLowerCase();
  const isSvgLanguage = normalizedLanguage === 'svg';
  const trimmedCode = typeof code === 'string' ? code.trimStart() : '';
  const looksLikeSvg =
    trimmedCode.startsWith('<svg') ||
    (trimmedCode.startsWith('<?xml') && trimmedCode.includes('<svg'));
  const shouldRenderSvg =
    isSvgLanguage ||
    ((normalizedLanguage === 'xml' || normalizedLanguage === 'html') && looksLikeSvg);

  // Use github-dark when in dark mode, github-light when in light mode
  const theme =
    propTheme || (resolvedTheme === 'dark' ? 'github-dark' : 'github-light');

  // Regular syntax highlighting effect
  useEffect(() => {
    // Skip syntax highlighting for successful mermaid renders
    if (normalizedLanguage === 'mermaid' && !mermaidFailed) {
      return;
    }
    if (shouldRenderSvg) {
      return;
    }

    async function highlight() {
      if (!code || typeof code !== 'string') {
        setHighlightedHtml(null);
        return;
      }
      const html = await codeToHtml(code, {
        lang: normalizedLanguage,
        theme
      });
      setHighlightedHtml(html);
    }
    highlight();
  }, [code, normalizedLanguage, theme, mermaidFailed, shouldRenderSvg]);

  const classNames = cn(
    'w-full min-w-0 overflow-hidden',
    '[&_pre]:!m-0 [&_pre]:!w-full [&_pre]:!min-w-0 [&_pre]:!overflow-x-hidden [&_pre]:!whitespace-pre-wrap [&_pre]:!bg-transparent [&_pre]:!p-4 [&_pre]:!box-border',
    '[&_.shiki]:!w-full [&_.shiki]:!min-w-0 [&_.shiki]:!overflow-x-hidden [&_.shiki]:!bg-transparent',
    '[&_code]:!min-w-0 [&_code]:!whitespace-pre-wrap [&_code]:!break-words [&_code]:!overflow-wrap-anywhere',
    className,
  );

  // Handle Mermaid rendering
  if (normalizedLanguage === 'mermaid' && !mermaidFailed) {
    return (
      <MermaidRenderer 
        chart={code}
        className={className}
      />
    );
  }

  if (shouldRenderSvg) {
    return <SvgPreview content={code} className={className} />;
  }

  // Regular code rendering (including failed Mermaid)
  return highlightedHtml ? (
    <div
      className={classNames}
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      {...props}
    />
  ) : (
    <div className={classNames} {...props}>
      <pre className="!w-full !min-w-0 !overflow-x-hidden !whitespace-pre-wrap !box-border">
        <code className="!whitespace-pre-wrap !break-words !overflow-wrap-anywhere">
          {code}
        </code>
      </pre>
    </div>
  );
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>;

function CodeBlockGroup({
  children,
  className,
  ...props
}: CodeBlockGroupProps) {
  return (
    <div className={cn('', className)} {...props}>
      {children}
    </div>
  );
}

export { CodeBlockGroup, CodeBlockCode, CodeBlock };
