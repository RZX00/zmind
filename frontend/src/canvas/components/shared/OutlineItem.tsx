import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {Link} from '@/i18n/routing';
import type { Canvas } from '../../types/canvas';
import { extractTagsFromText, sortTagsDefault } from '../../utils/tags';
import { getNodeDisplayTitle, type LinkExpansion, tableNodeToMarkdown } from '../../stores/outlineSelectors';
import { useOptionalWorkspace } from '@/contexts/workspace-context';
import { buildCanvasPath } from '@/lib/workspace-path';
import { parseTodoContent } from '../../utils/todoUtils';
import CanvasMarkdownRenderer from './CanvasMarkdownRenderer';
import { Globe2 } from 'lucide-react';
import { SvgRenderer } from '../svg/SvgRenderer';
import { useCanvasStore } from '../../stores/canvas.store';

interface OutlineItemProps {
  canvas: Canvas;
  id: string;
  type: 'heading' | 'note' | 'todo';
  depth: number; // depth from 1..n relative to headings; H1 reserved for doc title outside
  title: string;
  // actions
  onToggleTodo?: (id: string, completed: boolean) => void;
  onEditTitle?: (id: string, newTitle: string) => void;
  onJumpToNode?: (id: string) => void;
  expansion?: LinkExpansion;
  allowEdit?: boolean;
}

const OutlineItem: React.FC<OutlineItemProps> = ({ canvas, id, type, depth, title, onToggleTodo, onEditTitle, onJumpToNode, expansion, allowEdit = true }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const selectedIds = useCanvasStore(s => s.selections.nodeIds);
  // Workspace is optional in shared view; fall back gracefully when provider is absent
  const workspace = useOptionalWorkspace();
  const teamSlug = workspace?.teamSlug ?? null;

  const node = useMemo(() => (canvas.nodes || []).find(n => n.id === id), [canvas.nodes, id]);
  const isCanvasLink = node?.type === 'canvas-link';
  const isStml = node?.type === 'code' && ((node as any).codeType === 'stml' || (node as any).codeType === 'html');
  const isSvg = node?.type === 'code' && (node as any).codeType === 'svg';
  const isSelected = useMemo(() => !!selectedIds && selectedIds.has(id), [selectedIds, id]);
  const stmlPreview = useMemo(() => {
    if (!isStml) return '';
    const raw = (node as any)?.content || '';
    const cleaned = raw
      .replace(/<!doctype[^>]*>/ig, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const truncated = cleaned.slice(0, 5);
    return truncated ? `${truncated}…` : '';
  }, [isStml, node]);
  const stmlTitle = useMemo(() => {
    if (!isStml) return title;
    const cleaned = (title || '')
      .replace(/<!doctype[^>]*>/ig, ' ')
      .replace(/<[^>]+>/g, ' ')
      .trim();
    if (!cleaned) return 'HTML 页面';
    const truncated = cleaned.slice(0, 5);
    return truncated ? `${truncated}…` : 'HTML 页面';
  }, [isStml, title]);
  const titleTrim = (title || '').trim();
  const hideTitleText = useMemo(() => {
    if (!node) return false;
    if (node.type === 'canvas-link' || node.type === 'table') return false;
    if (node.type === 'code') return false;
    const raw = (node as any)?.content || '';
    const lines = raw.split(/\n/);
    if (lines.length !== 1) return false;
    const first = lines[0].trim();
    return !!first && first === titleTrim;
  }, [node, titleTrim]);
  const tags = useMemo(() => {
    const raw = (node?.title || '') + ' ' + (node?.content || '');
    return sortTagsDefault(extractTagsFromText(raw));
  }, [node?.title, node?.content]);
  const canvasLinkHref = (() => {
    if (!isCanvasLink || !node?.targetCanvasId) return null;
    // If WorkspaceProvider exists, build workspace path; otherwise link to shared canvas path
    if (teamSlug) {
      return buildCanvasPath(node.targetCanvasId, teamSlug, '?view=outline');
    }
    return `/share/canvas/${encodeURIComponent(node.targetCanvasId)}?view=outline`;
  })();

  // no expansion VM now; we compute direct outgoing refs only

  const handleDoubleClick = useCallback(() => {
    if (!allowEdit) return;
    if (type === 'heading' || type === 'note' || type === 'todo') {
      setEditing(true);
      setValue(title);
    }
  }, [allowEdit, type, title]);

  const handleBlur = useCallback(() => {
    setEditing(false);
    if (!allowEdit) return;
    if (value !== title) onEditTitle?.(id, value.trim());
  }, [id, value, title, onEditTitle, allowEdit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setValue(title);
      setEditing(false);
    }
  }, [title]);

  const handleCardKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onJumpToNode?.(id);
    }
  }, [onJumpToNode, id]);

  // 注意：结构缩进仅由 container-guide/link-guide 承担，这里不再额外加 paddingLeft
  const inlineEligible = useMemo(() => {
    if (isCanvasLink) return false;
    if (!expansion || (expansion.targets || []).length !== 1) return false;
    const targetTitle = getNodeDisplayTitle(canvas, expansion.targets[0].id);
    const srcLen = (title || '').trim().length;
    const tgtLen = (targetTitle || '').trim().length;
    return srcLen <= 10 && tgtLen <= 10;
  }, [isCanvasLink, expansion, canvas, title]);

  const isTodoNode = node?.type === 'todo';
  const todoLines = useMemo(() => isTodoNode ? parseTodoContent(node?.content || '') : [], [isTodoNode, node?.content]);
  const allCompleted = isTodoNode ? (todoLines.length > 0 && todoLines.every(line => line.completed)) : false;
  const partiallyCompleted = isTodoNode ? (todoLines.some(line => line.completed) && !allCompleted) : false;
  const todoCheckboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!todoCheckboxRef.current) return;
    todoCheckboxRef.current.indeterminate = partiallyCompleted;
  }, [partiallyCompleted]);

  const lineContent = (
    <div className="flex items-center gap-2">
      {type === 'todo' ? (
        <input
          aria-label="toggle-todo"
          type="checkbox"
          className="outline-checkbox"
          checked={allCompleted}
          ref={todoCheckboxRef}
          disabled={!allowEdit}
          onChange={(e) => onToggleTodo?.(id, e.target.checked)}
        />
      ) : null}
      {editing ? (
        <input
          autoFocus
          className="flex-1 bg-transparent border-b border-border focus:border-blue-400 outline-none text-foreground"
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <div className={type === 'todo' && allCompleted ? 'line-through text-muted-foreground' : 'text-foreground'} title={id} onDoubleClick={handleDoubleClick}>
          {type === 'heading' ? (
            <span className={`outline-header inline-block ${depth <= 2 ? 'outline-h2' : depth === 3 ? 'outline-h3' : 'outline-h4'}`}>
              {title}
            </span>
          ) : (
            canvasLinkHref ? (
              <Link
                href={canvasLinkHref}
                onClick={(e: any) => e.stopPropagation()}
                className="text-blue-700 hover:underline"
              >
                {title}
              </Link>
            ) : (
              hideTitleText ? null : <span className="outline-text inline-block">{title}</span>
            )
          )}
          {/* Inline single-edge short form: A (label) → B */}
          {inlineEligible && expansion && (
            (() => {
              const t = expansion.targets[0];
              const label = (expansion.commonLabel ? expansion.commonLabel : (t.label || '')).trim();
              const tgtTitle = getNodeDisplayTitle(canvas, t.id);
              return (
                <>
                  {' '}
                  {label ? <span className="text-foreground">（{label}）</span> : null}
                  {' '}
                  <span className="text-foreground">→</span>{' '}
                  <a
                    href="#"
                    onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); onJumpToNode?.(t.id); }}
                    className="text-foreground hover:underline"
                    title={tgtTitle}
                  >
                    {tgtTitle}
                  </a>
                </>
              );
            })()
          )}
        </div>
      )}
      {/* tags（仍保留，简洁展示） */}
      {!isCanvasLink && tags.length > 0 && (
        <span className="text-muted-foreground">
          {tags.map(t => ` #${t}`).join('')}
        </span>
      )}
    </div>
  );

  if (isStml) {
    const baseCard = `w-full text-left cursor-pointer select-text rounded-xl transition-colors px-2.5 py-1.5 shadow-sm border ${isSelected ? 'bg-card/90 border-border' : 'bg-transparent border-transparent hover:border-border/60'}`;
    return (
      <div className="py-0.5">
        <div
          className={baseCard}
          role="button"
          tabIndex={0}
          onKeyDown={handleCardKeyDown}
          onClick={(e) => {
            e.stopPropagation();
            if ((e.target as HTMLElement).tagName === 'INPUT') return;
            onJumpToNode?.(id);
          }}
        >
          <div className="html-card">
            <div className="html-card__content">
              <div className="html-card__pill">HTML</div>
              <div className="html-card__title line-clamp-1">{stmlTitle}</div>
              {stmlPreview ? (
                <div className="html-card__preview line-clamp-2">{stmlPreview}</div>
              ) : null}
            </div>
            <div className="html-card__icon-wrap">
              <div className="html-card__icon-tilt">
                <Globe2 size={18} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const baseCard = `w-full text-left cursor-pointer select-text rounded-xl transition-colors px-2.5 py-1.5 shadow-sm border ${isSelected ? 'bg-card/90 border-border' : 'bg-transparent border-transparent hover:border-border/60'}`;

  return (
    <div className="py-0.5">
      <div
        className={baseCard}
        role="button"
        tabIndex={0}
        onKeyDown={handleCardKeyDown}
        onClick={(e) => {
          e.stopPropagation();
          if ((e.target as HTMLElement).tagName === 'INPUT') return;
          onJumpToNode?.(id);
        }}
      >
        <div className="flex items-start gap-2.5">
          <div className="flex-1 min-w-0">
            {lineContent}
            {(type === 'note' || type === 'todo') && !isCanvasLink && (() => {
              if (!node) return null;
              if (isSvg) {
                return (
                  <div className="mt-1 outline-svg-preview">
                    <SvgRenderer
                      content={(node as any).content || ''}
                      className="outline-svg-renderer"
                      interactive={false}
                      showError={false}
                    />
                  </div>
                );
              }
              if (node.type === 'table') {
                return (
                  <div className="mt-1 relative">
                    <CanvasMarkdownRenderer
                      content={tableNodeToMarkdown(node as any)}
                      enableMath={false}
                      enableCodeCopy={false}
                    />
                  </div>
                );
              }
              const isMermaid = (node as any).type === 'code' && (node as any).codeType === 'mermaid';
              const raw = (node as any).content || '';
              if (!raw) return null;

              let contentToRender = raw;
              if (!isMermaid && node.type !== 'code') {
                const lines = raw.split(/\n/);
                if (lines.length > 1) {
                  const first = lines[0].trim();
                  const titleTrim = (title || '').trim();
                  if (titleTrim && first === titleTrim) {
                    contentToRender = lines.slice(1).join('\n');
                  }
                }
              }
              if (!contentToRender) return null;
              const rendered = isMermaid
                ? (/^```/.test(raw.trim()) ? raw : `\u0060\u0060\u0060mermaid\n${raw}\n\u0060\u0060\u0060`)
                : contentToRender;
              return (
                <div className="mt-1 relative">
                  <CanvasMarkdownRenderer
                    content={rendered}
                    enableMath={false}
                    enableCodeCopy={false}
                  />
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OutlineItem;
