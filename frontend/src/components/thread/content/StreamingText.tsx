import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ComposioUrlDetector } from './composio-url-detector';

interface StreamingTextProps {
  content: string;
  className?: string;
}

const STREAM_TICK_MS = 28;
const MIN_CHARS_PER_TICK = 2;
const MAX_CHARS_PER_TICK = 32;
const PENDING_DIVISOR = 12;

export const StreamingText: React.FC<StreamingTextProps> = ({
  content,
  className = "text-base prose dark:prose-invert chat-markdown max-w-none [&>:first-child]:mt-0 prose-headings:mt-3 break-words overflow-wrap-anywhere"
}) => {
  const [displayedContent, setDisplayedContent] = useState(content);
  const pendingRef = useRef('');
  const targetRef = useRef(content);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotionRef = useRef(false);

  const tick = useCallback(() => {
    if (reduceMotionRef.current) {
      pendingRef.current = '';
      setDisplayedContent(targetRef.current || '');
      timerRef.current = null;
      return;
    }

    const pending = pendingRef.current;
    if (!pending) {
      timerRef.current = null;
      return;
    }

    const step = Math.min(
      MAX_CHARS_PER_TICK,
      Math.max(MIN_CHARS_PER_TICK, Math.ceil(pending.length / PENDING_DIVISOR))
    );
    const nextChunk = pending.slice(0, step);
    pendingRef.current = pending.slice(step);
    setDisplayedContent((prev) => prev + nextChunk);
    timerRef.current = setTimeout(tick, STREAM_TICK_MS);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    reduceMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    if (!content) {
      targetRef.current = '';
      pendingRef.current = '';
      setDisplayedContent('');
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    if (reduceMotionRef.current) {
      targetRef.current = content;
      pendingRef.current = '';
      setDisplayedContent(content);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const previousTarget = targetRef.current || '';
    if (!content.startsWith(previousTarget)) {
      targetRef.current = content;
      pendingRef.current = '';
      setDisplayedContent(content);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const delta = content.slice(previousTarget.length);
    targetRef.current = content;
    if (!delta) return;

    pendingRef.current += delta;
    if (!timerRef.current) {
      timerRef.current = setTimeout(tick, STREAM_TICK_MS);
    }
  }, [content, tick]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!displayedContent) {
    return null;
  }

  return (
    <div className="text-base prose dark:prose-invert chat-markdown max-w-none [&>:first-child]:mt-0 prose-headings:mt-3 break-words overflow-hidden">
      <ComposioUrlDetector content={displayedContent} className={className} isAnimating={true} />
    </div>
  );
};
