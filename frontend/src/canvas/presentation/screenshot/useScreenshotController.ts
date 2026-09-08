'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { captureCanvasUseCase } from '../../application/screenshot/capture-canvas.usecase';
import { recropScreenshotUseCase } from '../../application/screenshot/recrop-screenshot.usecase';
import { SCREENSHOT_ASPECT_OPTIONS, type ScreenshotAspect } from '../../domain/screenshot/types';
import { useSettingsStore } from '../../stores/settings.store';

interface UseScreenshotControllerOptions {
  canvasTitle?: string;
  backgroundColor?: string;
  hideSelectors?: string[];
}

export interface ScreenshotController {
  open: boolean;
  loading: boolean;
  screenshotUrl: string | null;
  aspect: ScreenshotAspect;
  message: string | null;
  hasBlob: boolean;
  aspectOptions: ScreenshotAspect[];
  capture: (aspectOverride?: ScreenshotAspect) => Promise<void>;
  close: () => void;
  changeAspect: (aspect: ScreenshotAspect) => Promise<void>;
  download: () => void;
}

const sanitizeFileName = (title?: string) => {
  const base = (title || 'canvas')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'canvas';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${base}_${ts}`;
};

export function useScreenshotController({
  canvasTitle,
  backgroundColor,
  hideSelectors = [],
}: UseScreenshotControllerOptions): ScreenshotController {
  const t = useTranslations();
  const screenshotPrefs = useSettingsStore((s) => s.screenshot);
  const setScreenshotPrefs = useSettingsStore((s) => s.setScreenshot);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [baseBlob, setBaseBlob] = useState<Blob | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [aspect, setAspect] = useState<ScreenshotAspect>(screenshotPrefs?.aspect || '16:9');
  const [message, setMessage] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    setAspect(screenshotPrefs?.aspect || '16:9');
  }, [screenshotPrefs?.aspect]);

  useEffect(() => {
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  const aspectOptions = useMemo(() => SCREENSHOT_ASPECT_OPTIONS, []);

  const updateScreenshotUrl = useCallback((nextBlob: Blob | null) => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if (!nextBlob) {
      setScreenshotUrl(null);
      return;
    }
    const url = URL.createObjectURL(nextBlob);
    urlRef.current = url;
    setScreenshotUrl(url);
  }, []);

  const copyBlobToClipboard = useCallback(async (nextBlob: Blob) => {
    try {
      if (typeof window === 'undefined') return false;
      if (
        typeof navigator === 'undefined' ||
        !navigator.clipboard ||
        typeof (window as any).ClipboardItem === 'undefined'
      ) {
        setMessage(
          t('canvas.screenshot.clipboardUnavailable', {
            default: 'Clipboard unavailable. You can download the image instead.',
          }),
        );
        return false;
      }
      const item = new (window as any).ClipboardItem({ 'image/png': nextBlob });
      await navigator.clipboard.write([item]);
      const copiedMessage = t('canvas.screenshot.copied', { default: 'Screenshot copied to clipboard' });
      setMessage(copiedMessage);
      toast.success(copiedMessage);
      return true;
    } catch {
      setMessage(
        t('canvas.screenshot.clipboardUnavailable', {
          default: 'Clipboard unavailable. You can download the image instead.',
        }),
      );
      return false;
    }
  }, [t]);

  const capture = useCallback(async (aspectOverride?: ScreenshotAspect) => {
    const targetAspect = aspectOverride || aspect || '16:9';
    setOpen(true);
    setLoading(true);
    setMessage(null);

    try {
      const container = document.querySelector('[data-canvas-container]') as HTMLElement | null;
      if (!container) {
        const missingMessage = t('canvas.screenshot.missingContainer', {
          default: 'Canvas not found, cannot capture.',
        });
        setMessage(missingMessage);
        toast.error(missingMessage);
        return;
      }

      const artifact = await captureCanvasUseCase({
        rootEl: container,
        aspect: targetAspect,
        scale: 2,
        backgroundColor,
        hideSelectors,
      });

      if (!artifact?.blob) {
        const failedMessage = t('canvas.screenshot.failed', { default: 'Screenshot failed. Please retry.' });
        setMessage(failedMessage);
        toast.error(failedMessage);
        return;
      }

      setBaseBlob(artifact.baseBlob);
      setBlob(artifact.blob);
      updateScreenshotUrl(artifact.blob);
      setAspect(targetAspect);
      if (setScreenshotPrefs) setScreenshotPrefs({ aspect: targetAspect });

      await copyBlobToClipboard(artifact.blob);
      if (artifact.diagnostics.degraded) {
        setMessage(
          t('canvas.screenshot.partial', {
            default: 'Screenshot generated. Some media may still be loading.',
          }),
        );
      }
    } catch {
      const failedMessage = t('canvas.screenshot.failed', { default: 'Screenshot failed. Please retry.' });
      setMessage(failedMessage);
      toast.error(failedMessage);
    } finally {
      setLoading(false);
    }
  }, [aspect, backgroundColor, copyBlobToClipboard, hideSelectors, setScreenshotPrefs, t, updateScreenshotUrl]);

  const changeAspect = useCallback(async (nextAspect: ScreenshotAspect) => {
    setAspect(nextAspect);
    setMessage(null);
    if (setScreenshotPrefs) setScreenshotPrefs({ aspect: nextAspect });

    if (!baseBlob) {
      await capture(nextAspect);
      return;
    }

    setLoading(true);
    try {
      const nextBlob = await recropScreenshotUseCase(baseBlob, nextAspect);
      setBlob(nextBlob);
      updateScreenshotUrl(nextBlob);
      await copyBlobToClipboard(nextBlob);
    } finally {
      setLoading(false);
    }
  }, [baseBlob, capture, copyBlobToClipboard, setScreenshotPrefs, updateScreenshotUrl]);

  const download = useCallback(() => {
    if (!blob) return;
    const aspectToken = aspect && aspect !== 'original' ? `_${aspect.replace(':', 'x')}` : '';
    const name = `${sanitizeFileName(canvasTitle)}${aspectToken}.png`;
    saveAs(blob, name);
    toast.success(t('canvas.screenshot.downloaded', { default: 'Download ready.' }));
  }, [blob, aspect, canvasTitle, t]);

  const close = useCallback(() => {
    setOpen(false);
    setMessage(null);
  }, []);

  return {
    open,
    loading,
    screenshotUrl,
    aspect,
    message,
    hasBlob: !!blob,
    aspectOptions,
    capture,
    close,
    changeAspect,
    download,
  };
}
