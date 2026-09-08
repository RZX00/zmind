// TextNodeCore - text node display component
// Text editing is centralized in TextNodeEditor (Novel). This component only handles display and interaction affordances.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CanvasNode, FontStyle, NodeStyles, CornerStyle } from '../../../../types/canvas';
import CanvasMarkdownRenderer from '../../shared/CanvasMarkdownRenderer';
import { useTextLayoutPreset } from '../../../hooks/useTextNodePresets';
import { resolveTextTypographyTokens } from '../../../domain/text-layout/textTypographyTokens';

interface TextNodeCoreProps {
  node: CanvasNode;
  editing?: boolean;
  selected?: boolean;
  fontStyle?: FontStyle;
  nodeStyles?: NodeStyles;
  cornerStyle?: CornerStyle;
  onContentChange?: (nodeId: string, content: string) => void;
  onEditToggle?: (nodeId: string, editing: boolean) => void;
  onRequestExpandedEdit?: (nodeId: string) => void;
  onSizeChange?: (nodeId: string, size: { width: number; height: number }) => void;
  renderPrefix?: (isEditing: boolean) => React.ReactNode;
  contentClassName?: string;
  completedStyle?: boolean;
}

export const TextNodeCore: React.FC<TextNodeCoreProps> = ({
  node,
  editing = false,
  selected = false,
  fontStyle,
  nodeStyles,
  cornerStyle,
  onEditToggle,
  onRequestExpandedEdit,
  renderPrefix,
  contentClassName = '',
  completedStyle = false,
}) => {
  const t = useTranslations();
  const hasShapeDecoration = node.shapeDecoration && node.shapeDecoration.type !== 'none';
  const shapeType = node.shapeDecoration?.type;
  const textLayoutPreset = useTextLayoutPreset();
  const layoutMetrics = textLayoutPreset.metrics;
  const layoutPadding = layoutMetrics.padding;
  const layoutGap = layoutMetrics.prefixGap;

  const textStyles = nodeStyles?.textStyles || {};
  const accentColor = textStyles.accentColor || 'transparent';
  const typography = useMemo(
    () => resolveTextTypographyTokens({ fontStyle, nodeStyles }),
    [fontStyle, nodeStyles],
  );
  const completedClass = completedStyle ? 'opacity-75 line-through' : '';
  const topBorderRadius = cornerStyle?.radius || 0;

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const OVERFLOW_EPSILON = 4;
  const SINGLE_LINE_TOLERANCE = 1.2;
  const [scrollThumb, setScrollThumb] = useState<{ visible: boolean; top: number; height: number }>({
    visible: false,
    top: 0,
    height: 0,
  });

  const enableScroll = Boolean(selected && !editing);
  const scrollClass = enableScroll ? 'overflow-y-auto overflow-x-hidden scrollbar-none' : 'overflow-hidden';
  const scrollContainerProps = enableScroll ? { 'data-scroll-container': true } : {};
  const showScrollThumb = enableScroll && scrollThumb.visible;

  const updateScrollThumb = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollHeight, clientHeight, scrollTop } = el;
    let isSingleLine = false;
    try {
      const contentEl = el.querySelector('.text-node-content') as HTMLElement | null;
      if (contentEl) {
        const contentHeight = contentEl.getBoundingClientRect().height;
        const computed = window.getComputedStyle(contentEl);
        let lineHeight = Number.parseFloat(computed.lineHeight || '');
        if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
          lineHeight = typography.fontSize * typography.lineHeight;
        }
        isSingleLine = contentHeight <= lineHeight * SINGLE_LINE_TOLERANCE;
      }
    } catch {}

    const hasOverflow = !isSingleLine && scrollHeight > clientHeight + OVERFLOW_EPSILON;
    setScrollThumb((prev) => {
      if (!hasOverflow) {
        if (!prev.visible) return prev;
        return { visible: false, top: 0, height: 0 };
      }
      const ratio = clientHeight / scrollHeight;
      const thumbHeight = Math.max(12, Math.round(clientHeight * ratio));
      const maxTop = Math.max(0, clientHeight - thumbHeight);
      const top = maxTop > 0 ? Math.round((scrollTop / (scrollHeight - clientHeight)) * maxTop) : 0;
      if (prev.visible && prev.top === top && prev.height === thumbHeight) return prev;
      return { visible: true, top, height: thumbHeight };
    });
  }, [typography.fontSize, typography.lineHeight]);

  const scheduleThumbUpdate = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      updateScrollThumb();
    });
  }, [updateScrollThumb]);

  useEffect(() => {
    if (!enableScroll) {
      setScrollThumb((prev) => (prev.visible ? { visible: false, top: 0, height: 0 } : prev));
      return;
    }
    const tId = window.setTimeout(() => scheduleThumbUpdate(), 0);
    // Rendered markdown layout can settle after the first tick (fonts/inline styles).
    // Run a second measurement to avoid false-positive overflow thumbs on one-line text.
    const tId2 = window.setTimeout(() => scheduleThumbUpdate(), 80);
    return () => {
      window.clearTimeout(tId);
      window.clearTimeout(tId2);
    };
  }, [
    enableScroll,
    node.content,
    node.width,
    node.height,
    layoutPadding,
    typography.fontSize,
    typography.fontFamily,
    typography.fontWeight,
    typography.letterSpacing,
    scheduleThumbUpdate,
  ]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!enableScroll || !el) return;
    const handleScroll = () => scheduleThumbUpdate();
    el.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', scheduleThumbUpdate);
    return () => {
      el.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', scheduleThumbUpdate);
    };
  }, [enableScroll, scheduleThumbUpdate]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        try {
          cancelAnimationFrame(scrollRafRef.current);
        } catch {}
        scrollRafRef.current = null;
      }
    };
  }, []);

  const getShapeTextStyle = useCallback(() => {
    if (!hasShapeDecoration) return {};
    switch (shapeType) {
      case 'circle':
      case 'diamond':
        return { textAlign: 'center' as const };
      default:
        return {};
    }
  }, [hasShapeDecoration, shapeType]);

  const handleEnterEdit = useCallback(
    (e: React.MouseEvent) => {
      if (node.locked) return;
      e.preventDefault();
      e.stopPropagation();
      onEditToggle?.(node.id, true);
    },
    [node.id, node.locked, onEditToggle],
  );

  const placeholder = t('canvas.node.text.placeholder', { default: 'type here' });

  const docRef = useMemo(() => {
    const rawData = node.data as Record<string, unknown> | undefined;
    if (!rawData || typeof rawData !== 'object') return null;
    const rawRef = rawData.docRef as Record<string, unknown> | undefined;
    if (!rawRef || typeof rawRef !== 'object') return null;
    const sourceDocItemId =
      typeof rawRef.sourceDocItemId === 'string' ? rawRef.sourceDocItemId : '';
    if (!sourceDocItemId) return null;
    const sourceAnchor =
      typeof rawRef.sourceAnchor === 'string' && rawRef.sourceAnchor
        ? rawRef.sourceAnchor
        : undefined;
    const mode =
      rawRef.mode === 'snapshot' ? 'snapshot' : 'reference';
    const syncState =
      rawRef.syncState === 'missing' ||
      rawRef.syncState === 'stale' ||
      rawRef.syncState === 'forbidden'
        ? rawRef.syncState
        : 'synced';
    return {
      sourceDocItemId,
      sourceAnchor,
      mode,
      syncState,
    };
  }, [node.data]);

  const openDocReference = useCallback(
    (event: React.MouseEvent) => {
      if (!docRef || typeof window === 'undefined') return;
      event.preventDefault();
      event.stopPropagation();

      const segments = window.location.pathname.split('/').filter(Boolean);
      const localePrefix = segments[0] === 'zh' ? '/zh' : '';
      const teamIndex = segments.indexOf('team');
      const teamSlug =
        teamIndex >= 0 && typeof segments[teamIndex + 1] === 'string'
          ? segments[teamIndex + 1]
          : null;
      const base = teamSlug
        ? `/team/${teamSlug}/doc/${docRef.sourceDocItemId}`
        : `/doc/${docRef.sourceDocItemId}`;
      const search = docRef.sourceAnchor
        ? `?focusBlock=${encodeURIComponent(docRef.sourceAnchor)}`
        : '';
      window.location.assign(`${localePrefix}${base}${search}`);
    },
    [docRef],
  );

  const docRefStateLabel = useMemo(() => {
    if (!docRef) return '';
    switch (docRef.syncState) {
      case 'missing':
        return 'Missing';
      case 'stale':
        return 'Stale';
      case 'forbidden':
        return 'Forbidden';
      default:
        return 'Synced';
    }
  }, [docRef]);

  return (
    <div className="w-full h-full relative overflow-visible bg-transparent">
      {accentColor !== 'transparent' && (
        <div
          className="absolute top-0 left-0 right-0 z-10"
          style={{
            backgroundColor: accentColor,
            height: '6px',
            borderTopLeftRadius: `${topBorderRadius}px`,
            borderTopRightRadius: `${topBorderRadius}px`,
          }}
        />
      )}

      {docRef && !editing && (
        <button
          type="button"
          className="absolute right-2 top-2 z-20 inline-flex max-w-[85%] items-center gap-1 rounded-full border border-border/80 bg-background/90 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-sm hover:bg-accent"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={openDocReference}
          title={`Doc ${docRef.mode} · ${docRefStateLabel}`}
        >
          <span className="truncate">Doc {docRef.mode === 'snapshot' ? 'Snapshot' : 'Ref'}</span>
          <span className="text-muted-foreground">{docRefStateLabel}</span>
        </button>
      )}

      <div
        className="w-full h-full relative"
        style={{ minHeight: 'auto' }}
        onDoubleClick={handleEnterEdit}
      >
        <div className={`relative z-0 w-full h-full ${contentClassName}`} style={{ minHeight: 'auto' }}>
          {renderPrefix ? (
            <div
              className="flex items-start h-full"
              style={{
                ...getShapeTextStyle(),
                padding: layoutPadding,
                gap: layoutGap,
                boxSizing: 'border-box',
              }}
            >
              <div className="pt-1">{renderPrefix(false)}</div>
              <div className="flex-1 h-full">
                <div className="relative w-full h-full">
                  <div
                    ref={scrollRef}
                    className={`w-full h-full ${scrollClass} ${completedClass}`}
                    style={{
                      display: 'block',
                      verticalAlign: 'top',
                      minHeight: 'auto',
                      boxSizing: 'border-box',
                      fontWeight: typography.fontWeight,
                    }}
                    {...scrollContainerProps}
                  >
                    {node.content.trim() ? (
                      <CanvasMarkdownRenderer
                        content={node.content}
                        fontSize={typography.fontSize}
                        fontFamily={typography.fontFamily}
                        color={typography.color}
                        textAlign={typography.textAlign}
                        letterSpacing={typography.letterSpacing}
                        enableMath={false}
                        enableCodeCopy
                        className="text-node-content"
                      />
                    ) : (
                      <div
                        className="text-gray-400 dark:text-zinc-500 italic"
                        style={{
                          fontSize: `${typography.fontSize}px`,
                          fontFamily: typography.fontFamily,
                          opacity: 0.8,
                          pointerEvents: 'none',
                        }}
                      >
                        {placeholder}
                      </div>
                    )}
                  </div>
                  {showScrollThumb && (
                    <div className="absolute right-1 top-1 bottom-1 w-[2px] pointer-events-none">
                      <div
                        className="absolute left-0 w-full bg-muted-foreground/45 rounded-none"
                        style={{ top: scrollThumb.top, height: scrollThumb.height }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="relative w-full h-full">
              <div
                ref={scrollRef}
                className={`w-full h-full ${scrollClass} ${completedClass}`}
                style={{
                  display: 'block',
                  verticalAlign: 'top',
                  minHeight: 'auto',
                  boxSizing: 'border-box',
                  padding: layoutPadding,
                  ...getShapeTextStyle(),
                  fontWeight: typography.fontWeight,
                }}
                {...scrollContainerProps}
              >
                {node.content.trim() ? (
                  <CanvasMarkdownRenderer
                    content={node.content}
                    fontSize={typography.fontSize}
                    fontFamily={typography.fontFamily}
                    color={typography.color}
                    textAlign={typography.textAlign}
                    letterSpacing={typography.letterSpacing}
                    enableMath={false}
                    enableCodeCopy
                    className="text-node-content"
                  />
                ) : (
                  <div
                    className="text-gray-400 dark:text-zinc-500 italic"
                    style={{
                      fontSize: `${typography.fontSize}px`,
                      fontFamily: typography.fontFamily,
                      opacity: 0.8,
                      pointerEvents: 'none',
                    }}
                  >
                    {placeholder}
                  </div>
                )}
              </div>
              {showScrollThumb && (
                <div className="absolute right-1 top-1 bottom-1 w-[2px] pointer-events-none">
                  <div
                    className="absolute left-0 w-full bg-muted-foreground/45 rounded-none"
                    style={{ top: scrollThumb.top, height: scrollThumb.height }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TextNodeCore;
