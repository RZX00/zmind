import type { ScreenshotDiagnostics } from '../../domain/screenshot/types';
import { waitForCaptureReadiness } from './resource-readiness.service';

const TRANSPARENT_PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8e4xQAAAAASUVORK5CYII=';

export const DEFAULT_CAPTURE_HIDE_SELECTORS = [
  '[data-screenshot-exclude="true"]',
  '[data-export-exclude="true"]',
  '[data-selection-overlay="true"]',
  '[data-selection-chat-overlay="true"]',
  '[data-selection-feedback-overlay="true"]',
  '[data-overlay-root="true"]',
  '[data-radix-portal]',
  '.sonner-toast',
  '.react-contextmenu',
  '.selection-feedback-overlay',
  '.selection-chat-overlay',
  '.canvas-context-menu',
  '.canvas-playback-overlay',
  '.canvas-drag-box',
];

export const DEFAULT_CAPTURE_EXCLUDE_SELECTOR =
  '[data-screenshot-exclude="true"],[data-screenshot-hidden="true"],[data-export-exclude="true"]';

interface CaptureDomOptions {
  scale?: number;
  backgroundColor?: string;
  excludeSelector?: string;
  hideSelectors?: string[];
}

export interface DomCaptureResult {
  baseBlob: Blob;
  diagnostics: ScreenshotDiagnostics;
}

const freezeDynamicStyles = (doc: Document): (() => void) => {
  const styleEl = doc.createElement('style');
  styleEl.setAttribute('data-screenshot-freeze', 'true');
  styleEl.textContent = `
*,
*::before,
*::after {
  transition: none !important;
  animation: none !important;
  caret-color: transparent !important;
}
`;
  doc.head.appendChild(styleEl);
  return () => {
    styleEl.remove();
  };
};

const hideNoisyElements = (doc: Document, selectors: string[]) => {
  const hidden: Array<{ el: HTMLElement; display: string; priority: string }> = [];
  if (!selectors.length) {
    return {
      hiddenCount: 0,
      restore: () => undefined,
    };
  }

  const list = Array.from(doc.querySelectorAll<HTMLElement>(selectors.join(',')));
  list.forEach((el) => {
    hidden.push({
      el,
      display: el.style.getPropertyValue('display'),
      priority: el.style.getPropertyPriority('display'),
    });
    el.dataset.screenshotHidden = 'true';
    el.style.setProperty('display', 'none', 'important');
  });

  return {
    hiddenCount: hidden.length,
    restore: () => {
      hidden.forEach(({ el, display, priority }) => {
        if (display) el.style.setProperty('display', display, priority);
        else el.style.removeProperty('display');
        delete el.dataset.screenshotHidden;
      });
    },
  };
};

export async function captureDomToBlob(
  rootEl: HTMLElement,
  {
    scale = 2,
    backgroundColor,
    excludeSelector = DEFAULT_CAPTURE_EXCLUDE_SELECTOR,
    hideSelectors = [],
  }: CaptureDomOptions = {},
): Promise<DomCaptureResult | null> {
  if (!rootEl) return null;

  const startedAt = Date.now();
  const doc = rootEl.ownerDocument || document;
  const restoreFreeze = freezeDynamicStyles(doc);
  const selectors = [...new Set([...DEFAULT_CAPTURE_HIDE_SELECTORS, ...hideSelectors])];
  const { hiddenCount, restore: restoreHidden } = hideNoisyElements(doc, selectors);
  let imageErrors = 0;

  try {
    const readiness = await waitForCaptureReadiness(rootEl);
    const { toCanvas } = await import('html-to-image');

    const canvas = await toCanvas(rootEl, {
      pixelRatio: scale,
      cacheBust: false,
      includeQueryParams: true,
      backgroundColor: backgroundColor ?? undefined,
      imagePlaceholder: TRANSPARENT_PLACEHOLDER,
      fetchRequestInit: {
        credentials: 'include',
        mode: 'cors',
      },
      onImageErrorHandler: (...args: any[]) => {
        imageErrors += 1;
        const event = args?.[0];
        console.warn('[canvasScreenshot] image load error during capture', event);
      },
      filter: (node: any) => {
        try {
          if (!node || node.nodeType !== 1) return true;
          const asElement = node as Element;
          if (excludeSelector && (asElement.matches?.(excludeSelector) || asElement.closest?.(excludeSelector))) return false;
          if ((asElement as HTMLElement).dataset?.screenshotHidden === 'true') return false;
          return true;
        } catch {
          return true;
        }
      },
    });

    const baseBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
    if (!baseBlob) return null;

    const diagnostics: ScreenshotDiagnostics = {
      hiddenElements: hiddenCount,
      imageErrors,
      readiness,
      durationMs: Date.now() - startedAt,
      degraded:
        imageErrors > 0 ||
        !readiness.fontsReady ||
        readiness.failedImages > 0 ||
        readiness.timedOutImages > 0,
    };

    return {
      baseBlob,
      diagnostics,
    };
  } catch (error) {
    console.warn('[canvasScreenshot] Failed to capture canvas:', error);
    return null;
  } finally {
    restoreHidden();
    restoreFreeze();
  }
}
