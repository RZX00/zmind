'use client';

// SSR-safe wrapper for `sonner` toast functions.
// - On the server (SSR/prerender), calls are no-ops.
// - On the client, we lazy import `sonner` to avoid bundling issues during SSR.

type ToastOptions = {
  description?: string;
  duration?: number;
  [key: string]: any;
};

type ToastAPI = {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  warning: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
};

const loadToast = () => import('sonner').then((m) => m.toast).catch(() => null);

const isBrowser = () => typeof window !== 'undefined';

const toast: ToastAPI = {
  success(message, options) {
    if (!isBrowser()) return; // no-op on server
    loadToast().then((t) => t?.success?.(message, options));
  },
  error(message, options) {
    if (!isBrowser()) return;
    loadToast().then((t) => t?.error?.(message, options));
  },
  warning(message, options) {
    if (!isBrowser()) return;
    loadToast().then((t) => t?.warning?.(message, options));
  },
  info(message, options) {
    if (!isBrowser()) return;
    loadToast().then((t) => t?.info?.(message, options));
  },
};

export { toast };

