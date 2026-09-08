import React, { useMemo, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, Eye, Code } from 'lucide-react';
import { useTheme } from 'next-themes';
import MermaidRenderer from '../mermaid/MermaidRenderer';
import 'katex/dist/katex.min.css';
import { MarkdownRenderer } from '@/lib/markdown/MarkdownRenderer';
import { cn } from '@/lib/utils';
import { TEXT_MARKDOWN_RHYTHM } from '../../domain/text-layout/textMarkdownRhythm';

interface CanvasMarkdownRendererProps {
  content: string;
  className?: string;
  enableMath?: boolean;
  enableCodeCopy?: boolean;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  letterSpacing?: string;
  variant?: 'default' | 'outline';
}

interface CodeBlockPalette {
  border: string;
  surface: string;
  elevatedSurface: string;
  foreground: string;
  mutedForeground: string;
  selectedSurface: string;
  successSurface: string;
  successForeground: string;
  lineNumber: string;
}

interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  enableCopy?: boolean;
  variant?: 'default' | 'outline';
  isDark?: boolean;
}

function getCodePalette(isDark: boolean): CodeBlockPalette {
  if (isDark) {
    return {
      border: 'var(--border)',
      surface: 'var(--muted)',
      elevatedSurface: 'var(--card)',
      foreground: 'var(--foreground)',
      mutedForeground: 'var(--muted-foreground)',
      selectedSurface: 'color-mix(in srgb, var(--primary) 22%, var(--card))',
      successSurface: 'color-mix(in srgb, #22c55e 20%, var(--card))',
      successForeground: '#86efac',
      lineNumber: 'var(--muted-foreground)',
    };
  }

  return {
    border: 'var(--border)',
    surface: 'var(--muted)',
    elevatedSurface: 'var(--card)',
    foreground: 'var(--foreground)',
    mutedForeground: 'var(--muted-foreground)',
    selectedSurface: 'color-mix(in srgb, var(--primary) 15%, var(--card))',
    successSurface: 'color-mix(in srgb, #22c55e 14%, var(--card))',
    successForeground: '#15803d',
    lineNumber: 'var(--muted-foreground)',
  };
}

const CodeBlock: React.FC<CodeBlockProps> = ({
  inline,
  className,
  children,
  enableCopy = true,
  variant = 'default',
  isDark = false,
  ...props
}) => {
  const [copied, setCopied] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [mermaidView, setMermaidView] = useState<'code' | 'preview'>('preview');

  const palette = useMemo(() => getCodePalette(isDark), [isDark]);
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const codeContent = String(children || '').replace(/\n$/, '');
  const isMermaid = language === 'mermaid';
  const isOutline = variant === 'outline';

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(codeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (inline) {
    return (
      <code className="canvas-markdown-inline-code" {...props}>
        {children}
      </code>
    );
  }

  const isMermaidPreview = isMermaid && mermaidView === 'preview';

  return (
    <div
      className="canvas-code-block-container relative group my-2"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        border: isMermaidPreview ? 'none' : `1px solid ${palette.border}`,
        borderRadius: isMermaidPreview ? '0' : 'var(--radius-sm)',
        overflow: 'hidden',
        background: isMermaidPreview ? 'transparent' : palette.elevatedSurface,
      }}
    >
      {!isMermaidPreview && !isOutline && (
        <div
          className="code-header flex items-center justify-between px-3 py-1.5 border-b text-xs"
          style={{ backgroundColor: palette.surface, borderColor: palette.border }}
        >
          <span className="font-medium" style={{ color: palette.foreground }}>
            {language || 'text'}
          </span>
          <div className="flex items-center gap-2">
            {isMermaid && !isOutline && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMermaidView(mermaidView === 'code' ? 'preview' : 'code');
                }}
                className={cn(
                  'mermaid-toggle-button flex items-center gap-1 px-2 py-1 text-xs rounded transition-all duration-200 font-medium',
                  isHovered ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
                style={{
                  backgroundColor: mermaidView === 'preview' ? palette.selectedSurface : palette.elevatedSurface,
                  color: palette.foreground,
                  border: `1px solid ${palette.border}`,
                }}
                title={mermaidView === 'code' ? 'Show preview' : 'Show code'}
              >
                {mermaidView === 'code' ? (
                  <>
                    <Eye size={10} />
                    <span>Preview</span>
                  </>
                ) : (
                  <>
                    <Code size={10} />
                    <span>Code</span>
                  </>
                )}
              </button>
            )}
            {enableCopy && !isOutline && (
              <button
                type="button"
                onClick={copyToClipboard}
                className={cn(
                  'copy-button flex items-center gap-1 px-2 py-1 text-xs rounded transition-all duration-200 font-medium',
                  isHovered ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
                style={{
                  backgroundColor: copied ? palette.successSurface : palette.elevatedSurface,
                  color: copied ? palette.successForeground : palette.foreground,
                  border: `1px solid ${copied ? palette.successForeground : palette.border}`,
                }}
                title={copied ? 'Copied' : 'Copy code'}
              >
                {copied ? (
                  <>
                    <Check size={10} />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={10} />
                    <span>Copy</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="code-content overflow-x-auto">
        {isMermaid && mermaidView === 'preview' ? (
          <div className="mermaid-preview-container relative" style={{ padding: '0.75rem 0', background: 'transparent' }}>
            {!isOutline && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMermaidView('code');
                }}
                className={cn(
                  'absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-1 text-xs rounded transition-all duration-200 font-medium',
                  isHovered ? 'opacity-100' : 'opacity-0',
                )}
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--card) 92%, transparent)',
                  color: palette.foreground,
                  border: `1px solid ${palette.border}`,
                  backdropFilter: 'blur(4px)',
                  boxShadow: 'var(--shadow-elev-2)',
                }}
                title="Show code"
              >
                <Code size={10} />
                <span>Code</span>
              </button>
            )}

            {codeContent.trim() ? (
              <MermaidRenderer code={codeContent} height="auto" className="w-full" isEditMode={false} />
            ) : (
              <div className="text-sm py-4 text-center" style={{ color: palette.mutedForeground }}>
                Mermaid diagram is empty
              </div>
            )}
          </div>
        ) : (
          <SyntaxHighlighter
            language={language}
            style={isDark ? oneDark : oneLight}
            customStyle={{
              margin: 0,
              borderRadius: 0,
              fontSize: '0.75rem',
              lineHeight: '1.4',
              padding: '0.75rem',
              background: palette.elevatedSurface,
              color: palette.foreground,
              fontFamily: 'Google Sans Code, Consolas, Monaco, Courier New, monospace',
            }}
            codeTagProps={{
              style: {
                fontFamily: 'Google Sans Code, Consolas, Monaco, Courier New, monospace',
                fontSize: '0.75rem',
              },
            }}
            showLineNumbers={isOutline ? false : codeContent.split('\n').length > 5}
            lineNumberStyle={{
              color: palette.lineNumber,
              fontSize: '0.7rem',
              paddingRight: '0.75rem',
              userSelect: 'none',
            }}
          >
            {codeContent}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
};

CodeBlock.displayName = 'CodeBlock';

const CanvasMarkdownRenderer: React.FC<CanvasMarkdownRendererProps> = React.memo(
  ({
    content,
    className = '',
    enableMath = false,
    enableCodeCopy = true,
    fontSize = 14,
    fontFamily = 'inherit',
    color = 'var(--foreground)',
    textAlign = 'left',
    letterSpacing = 'normal',
    variant = 'default',
  }) => {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const rhythm = TEXT_MARKDOWN_RHYTHM;

    if (!content) return null;

    const processContent = (raw: string): string => {
      let processedContent = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      const codeBlocks: string[] = [];
      processedContent = processedContent.replace(/```[\s\S]*?```/g, (match) => {
        const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
        codeBlocks.push(match);
        return placeholder;
      });

      processedContent = processedContent.replace(/`([^`\n]+?)`/g, '<span class="highlight-text">$1</span>');

      codeBlocks.forEach((block, index) => {
        processedContent = processedContent.replace(`__CODE_BLOCK_${index}__`, block);
      });

      return processedContent;
    };

    const processedContent = processContent(content);

    return (
      <div
        className={`canvas-markdown-renderer ${className}`}
        style={{
          margin: '0',
          padding: '0',
          lineHeight: '1.4',
          textAlign,
          fontFamily,
          letterSpacing,
          fontSize: `${fontSize}px`,
          color,
        }}
      >
        <div className="canvas-markdown-body">
          <MarkdownRenderer
            content={processedContent}
            allowHtml
            enableMath={enableMath}
            components={{
            blockquote: ({ children, ...props }) => (
              <blockquote className="canvas-markdown-quote" {...props}>
                {children}
              </blockquote>
            ),
            h1: ({ children, ...props }) => (
              <h1 className="canvas-markdown-h1" {...props}>
                {children}
              </h1>
            ),
            h2: ({ children, ...props }) => (
              <h2 className="canvas-markdown-h2" {...props}>
                {children}
              </h2>
            ),
            h3: ({ children, ...props }) => (
              <h3 className="canvas-markdown-h3" {...props}>
                {children}
              </h3>
            ),
            h4: ({ children, ...props }) => (
              <h4 className="canvas-markdown-h4" {...props}>
                {children}
              </h4>
            ),
            h5: ({ children, ...props }) => (
              <h5 className="canvas-markdown-h5" {...props}>
                {children}
              </h5>
            ),
            h6: ({ children, ...props }) => (
              <h6 className="canvas-markdown-h6" {...props}>
                {children}
              </h6>
            ),
            p: ({ children, ...props }) => (
              <p
                className="canvas-markdown-p"
                style={{
                  margin: '0 !important',
                  marginBottom: '0.125rem !important',
                  lineHeight: '1.4 !important',
                  padding: '0 !important',
                }}
                {...props}
              >
                {children}
              </p>
            ),
            ul: ({ children, className: listClassName, ...props }) => {
              const isTaskList = typeof listClassName === 'string' && listClassName.includes('contains-task-list');
              return (
                <ul
                  className={cn(
                    'canvas-markdown-ul',
                    isTaskList ? 'canvas-markdown-task-list' : 'list-disc',
                    listClassName,
                  )}
                  {...props}
                >
                  {children}
                </ul>
              );
            },
            ol: ({ children, className: listClassName, ...props }) => (
              <ol className={cn('canvas-markdown-ol list-decimal', listClassName)} {...props}>
                {children}
              </ol>
            ),
            li: ({ children, className: itemClassName, ...props }) => {
              const isTaskItem = typeof itemClassName === 'string' && itemClassName.includes('task-list-item');
              return (
                <li
                  className={cn(
                    'canvas-markdown-li',
                    isTaskItem && 'canvas-markdown-task-item',
                    itemClassName,
                  )}
                  {...props}
                >
                  {children}
                </li>
              );
            },
            input: ({ className: inputClassName, ...props }) => {
              const isCheckbox = props.type === 'checkbox';
              if (!isCheckbox) {
                return <input className={inputClassName} {...props} />;
              }
              return (
                <input
                  className={cn('canvas-markdown-task-checkbox', inputClassName)}
                  type="checkbox"
                  checked={Boolean(props.checked)}
                  readOnly
                  disabled
                />
              );
            },
            strong: ({ children, ...props }) => (
              <strong className="canvas-markdown-strong font-semibold" style={{ color }} {...props}>
                {children}
              </strong>
            ),
            em: ({ children, ...props }) => (
              <em className="canvas-markdown-em italic opacity-80" {...props}>
                {children}
              </em>
            ),
            table: ({ children, ...props }) => (
              <div className="overflow-x-auto">
                <table className="min-w-full border text-xs" style={{ borderColor: 'var(--border)' }} {...props}>
                  {children}
                </table>
              </div>
            ),
            thead: ({ children, ...props }) => (
              <thead style={{ backgroundColor: 'var(--muted)' }} {...props}>
                {children}
              </thead>
            ),
            tbody: ({ children, ...props }) => (
              <tbody className="divide-y" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }} {...props}>
                {children}
              </tbody>
            ),
            tr: ({ children, ...props }) => (
              <tr className="transition-colors duration-200" {...props}>
                {children}
              </tr>
            ),
            th: ({ children, ...props }) => (
              <th
                className="px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wider"
                style={{ color: 'var(--muted-foreground)' }}
                {...props}
              >
                {children}
              </th>
            ),
            td: ({ children, ...props }) => (
              <td className="px-2 py-1.5 text-xs" style={{ color }} {...props}>
                {children}
              </td>
            ),
            hr: ({ ...props }) => <hr className="canvas-markdown-hr" style={{ borderColor: 'var(--border)' }} {...props} />,
            a: ({ href, children, ...props }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="canvas-markdown-link underline"
                style={{ color: 'var(--primary)' }}
                {...props}
              >
                {children}
              </a>
            ),
            code: (props) => (
              <CodeBlock {...props} enableCopy={enableCodeCopy} variant={variant} isDark={isDark} />
            ),
            }}
          />
        </div>

        <style>{`
          .canvas-markdown-renderer {
            font-variant-ligatures: common-ligatures;
            font-feature-settings: 'palt' 1, 'liga' 1;
            font-kerning: normal;
          }
          .canvas-markdown-renderer p,
          .canvas-markdown-renderer ul,
          .canvas-markdown-renderer ol,
          .canvas-markdown-renderer table,
          .canvas-markdown-renderer pre,
          .canvas-markdown-renderer blockquote {
            margin-top: ${rhythm.paragraph.marginTopRem}rem !important;
            margin-bottom: ${rhythm.paragraph.marginBottomRem}rem !important;
          }
          .canvas-markdown-renderer .canvas-markdown-h1 {
            font-size: ${fontSize * rhythm.heading1.scale}px;
            font-weight: 600;
            line-height: ${rhythm.heading1.lineHeight};
            letter-spacing: ${rhythm.heading1.letterSpacingEm}em;
            margin-top: ${rhythm.heading1.marginTopRem}rem;
            margin-bottom: ${rhythm.heading1.marginBottomRem}rem;
            color: ${color};
            border-bottom: var(--stroke-1) solid var(--border);
            padding-bottom: ${rhythm.heading1.paddingBottomRem}rem;
          }
          .canvas-markdown-renderer .canvas-markdown-h2 {
            font-size: ${fontSize * rhythm.heading2.scale}px;
            font-weight: 600;
            line-height: ${rhythm.heading2.lineHeight};
            margin-top: ${rhythm.heading2.marginTopRem}rem;
            margin-bottom: ${rhythm.heading2.marginBottomRem}rem;
            color: ${color};
          }
          .canvas-markdown-renderer .canvas-markdown-h3 {
            font-size: ${fontSize * rhythm.heading3.scale}px;
            font-weight: 600;
            line-height: ${rhythm.heading3.lineHeight};
            margin-top: ${rhythm.heading3.marginTopRem}rem;
            margin-bottom: ${rhythm.heading3.marginBottomRem}rem;
            color: ${color};
          }
          .canvas-markdown-renderer .canvas-markdown-h4,
          .canvas-markdown-renderer .canvas-markdown-h5,
          .canvas-markdown-renderer .canvas-markdown-h6 {
            font-size: ${fontSize * rhythm.heading4to6.scale}px;
            font-weight: 600;
            line-height: ${rhythm.heading4to6.lineHeight};
            margin-top: ${rhythm.heading4to6.marginTopRem}rem;
            margin-bottom: ${rhythm.heading4to6.marginBottomRem}rem;
            color: ${color};
          }
          .canvas-markdown-renderer .canvas-markdown-p {
            margin-bottom: ${rhythm.paragraph.marginBottomRem}rem !important;
            color: ${color};
            white-space: pre-wrap;
            word-break: break-word;
            overflow-wrap: anywhere;
          }
          .canvas-markdown-renderer .canvas-markdown-ul,
          .canvas-markdown-renderer .canvas-markdown-ol {
            margin-top: ${rhythm.list.marginTopRem}rem !important;
            margin-bottom: ${rhythm.list.marginBottomRem}rem !important;
            margin-left: ${rhythm.list.marginLeftRem}rem;
            padding-left: ${rhythm.list.paddingLeftRem}rem;
            list-style-position: outside;
            color: ${color};
          }
          .canvas-markdown-renderer .canvas-markdown-task-list {
            list-style: none !important;
            margin-left: 0 !important;
            padding-left: 0 !important;
          }
          .canvas-markdown-renderer .canvas-markdown-li {
            margin-bottom: ${rhythm.list.itemSpacingRem}rem !important;
            color: ${color};
          }
          .canvas-markdown-renderer .canvas-markdown-li > p {
            margin-top: 0 !important;
            margin-bottom: 0 !important;
          }
          .canvas-markdown-renderer .canvas-markdown-task-item {
            list-style: none !important;
            display: flex;
            align-items: flex-start;
            gap: ${rhythm.task.itemGapRem}rem;
            margin-left: 0;
          }
          .canvas-markdown-renderer .canvas-markdown-task-item::marker {
            content: '';
          }
          .canvas-markdown-renderer .canvas-markdown-task-checkbox {
            width: 0.95rem;
            height: 0.95rem;
            margin-top: ${rhythm.task.checkboxOffsetTopRem}rem;
            accent-color: var(--primary);
            pointer-events: none;
            flex: 0 0 auto;
          }
          .canvas-markdown-renderer .canvas-markdown-task-item input[checked] ~ * {
            color: var(--muted-foreground);
            text-decoration: line-through;
            text-decoration-thickness: 1.5px;
          }
          .canvas-markdown-renderer .canvas-markdown-task-item > p {
            margin: 0 !important;
            flex: 1 1 auto;
          }
          .canvas-markdown-renderer .canvas-markdown-li::marker {
            color: var(--muted-foreground);
          }
          .canvas-markdown-renderer .canvas-markdown-hr {
            margin-top: ${rhythm.horizontalRule.marginTopRem}rem;
            margin-bottom: ${rhythm.horizontalRule.marginBottomRem}rem;
          }
          .canvas-markdown-renderer table {
            margin: 1rem 0 !important;
            width: 100%;
            border-collapse: collapse;
            background-color: var(--card);
          }
          .canvas-markdown-renderer th,
          .canvas-markdown-renderer td {
            border: var(--stroke-1) solid var(--border);
            padding: 0.45rem 0.75rem;
            text-align: left;
          }
          .canvas-markdown-renderer thead {
            background: var(--muted);
            font-weight: 600;
          }
          .canvas-markdown-renderer .canvas-markdown-quote {
            font-style: normal;
            color: ${color};
            background: color-mix(in srgb, var(--muted) 70%, transparent);
            border-left: var(--stroke-4) solid var(--border);
            padding: 0.85rem 1.1rem;
            margin: 1rem 0;
          }
          .canvas-markdown-renderer .canvas-markdown-inline-code {
            font-family: 'JetBrains Mono', 'Google Sans Code', 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: ${fontSize * 0.85}px;
            background-color: color-mix(in srgb, var(--muted) 84%, transparent);
            color: ${color};
            padding: 0.1rem 0.25rem;
            border-radius: var(--radius-xs);
            border: var(--stroke-1) solid var(--border);
          }
          .canvas-markdown-renderer .highlight-text {
            background-color: color-mix(in srgb, var(--primary) 18%, transparent);
            color: ${color};
            padding: 0.1em 0.25em;
            border-radius: var(--radius-xs);
            border: var(--stroke-1) solid color-mix(in srgb, var(--primary) 36%, var(--border));
          }
          .canvas-markdown-renderer .canvas-code-block-container {
            margin: 1rem 0;
            background: var(--card);
            border: var(--stroke-1) solid var(--border);
          }
          .canvas-markdown-renderer .copy-button {
            transition: all 0.2s ease;
          }
          .canvas-markdown-renderer pre {
            margin: 0 !important;
          }
          .canvas-markdown-renderer .katex {
            font-size: ${fontSize * 0.95}px;
          }
          .canvas-markdown-renderer .katex-display {
            margin: 1rem 0;
          }
          .canvas-markdown-renderer .canvas-markdown-link {
            color: var(--primary);
            border-bottom: var(--stroke-1) solid color-mix(in srgb, var(--primary) 35%, transparent);
            text-decoration: none;
            padding-bottom: 1px;
          }
          .canvas-markdown-renderer .canvas-markdown-link:hover {
            border-bottom-color: var(--primary);
          }
          .canvas-markdown-renderer .canvas-markdown-body > *:first-child { margin-top: 0 !important; }
          .canvas-markdown-renderer .canvas-markdown-body > *:last-child { margin-bottom: 0 !important; }
          .canvas-markdown-renderer.todo-line-markdown {
            margin: 0 !important;
            padding: 0 !important;
            display: flex;
            align-items: center;
            min-height: 0;
          }
          .canvas-markdown-renderer.todo-line-markdown p,
          .canvas-markdown-renderer.todo-line-markdown ul,
          .canvas-markdown-renderer.todo-line-markdown ol,
          .canvas-markdown-renderer.todo-line-markdown blockquote {
            margin: 0 !important;
          }
        `}</style>
      </div>
    );
  },
);

CanvasMarkdownRenderer.displayName = 'CanvasMarkdownRenderer';

export default CanvasMarkdownRenderer;
export type { CanvasMarkdownRendererProps };
