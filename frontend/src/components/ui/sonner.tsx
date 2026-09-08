'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import {
  Toaster as Sonner,
  ToasterProps,
  toast,
  useSonner,
} from 'sonner';
import type { ToastT } from 'sonner';

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system', resolvedTheme } = useTheme();
  const { toasts } = useSonner();
  const toastsRef = useRef<ToastT[]>([]);
  const defaultPosition = props.position ?? 'bottom-right';

  useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);

  useEffect(() => {
    const handleToastClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const toastElement = target.closest<HTMLElement>('[data-sonner-toast]');
      if (!toastElement) return;
      if (toastElement.getAttribute('data-dismissible') === 'false') return;
      if (target.closest('[data-button]') || target.closest('[data-close-button]')) return;

      const indexAttr = toastElement.getAttribute('data-index');
      if (!indexAttr) return;
      const toastIndex = Number(indexAttr);
      if (Number.isNaN(toastIndex)) return;

      const listElement = toastElement.closest<HTMLElement>('[data-sonner-toaster]');
      const y = listElement?.getAttribute('data-y-position');
      const x = listElement?.getAttribute('data-x-position');
      const resolvedPosition = y && x ? `${y}-${x}` : defaultPosition;

      const toastList = toastsRef.current.filter((toastItem) => {
        if (toastItem.position) {
          return toastItem.position === resolvedPosition;
        }
        return resolvedPosition === defaultPosition;
      });

      const toastToDismiss = toastList[toastIndex];
      if (!toastToDismiss) return;

      toast.dismiss(toastToDismiss.id);
    };

    document.addEventListener('click', handleToastClick);
    return () => document.removeEventListener('click', handleToastClick);
  }, [defaultPosition]);

  return (
    <Sonner
      theme={(theme === 'system' ? resolvedTheme ?? 'system' : theme) as ToasterProps['theme']}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': '1rem',
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
