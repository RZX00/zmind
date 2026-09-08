import React, { useRef, useLayoutEffect, useCallback, forwardRef } from 'react';

interface AutoResizingTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  minHeight?: number;
  onHeightChange?: (height: number) => void;
}

export const AutoResizingTextarea = forwardRef<HTMLTextAreaElement, AutoResizingTextareaProps>(({
  value,
  minHeight = 24,
  style,
  onHeightChange,
  ...props
}, forwardedRef) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const setRefs = useCallback((instance: HTMLTextAreaElement | null) => {
    textareaRef.current = instance;
    if (typeof forwardedRef === 'function') {
      forwardedRef(instance);
    } else if (forwardedRef) {
      (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = instance;
    }
  }, [forwardedRef]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    // Reset height to auto to get the correct scrollHeight for shrinkage
    el.style.height = 'auto';
    const newHeight = Math.max(minHeight, el.scrollHeight);
    el.style.height = `${newHeight}px`;

    if (onHeightChange) {
      onHeightChange(newHeight);
    }
  }, [value, minHeight, onHeightChange]);

  return (
    <textarea
      ref={setRefs}
      value={value}
      rows={1}
      style={{
        padding: 0,
        margin: 0,
        lineHeight: '20px',
        ...style,
        resize: 'none',
        overflow: 'hidden',
        boxSizing: 'border-box',
        display: 'block',
        width: '100%',
        verticalAlign: 'top',
      }}
      {...props}
    />
  );
});

AutoResizingTextarea.displayName = 'AutoResizingTextarea';
