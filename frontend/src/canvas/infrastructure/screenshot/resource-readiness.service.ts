import type { ScreenshotReadinessReport } from '../../domain/screenshot/types';

interface WaitForCaptureReadinessOptions {
  imageTimeoutMs?: number;
  fontsTimeoutMs?: number;
}

type ImageReadyStatus = 'ready' | 'error' | 'timeout';

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const waitForImageReady = async (img: HTMLImageElement, timeoutMs: number): Promise<ImageReadyStatus> => {
  if (img.complete) return img.naturalWidth > 0 ? 'ready' : 'error';

  return await new Promise<ImageReadyStatus>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (status: ImageReadyStatus) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      img.removeEventListener('load', handleLoad);
      img.removeEventListener('error', handleError);
      resolve(status);
    };

    const handleLoad = () => finish(img.naturalWidth > 0 ? 'ready' : 'error');
    const handleError = () => finish('error');

    img.addEventListener('load', handleLoad, { once: true });
    img.addEventListener('error', handleError, { once: true });

    timer = setTimeout(() => finish('timeout'), timeoutMs);

    if (typeof img.decode === 'function') {
      img
        .decode()
        .then(() => finish(img.naturalWidth > 0 ? 'ready' : 'error'))
        .catch(() => undefined);
    }
  });
};

export async function waitForCaptureReadiness(
  rootEl: HTMLElement,
  { imageTimeoutMs = 2800, fontsTimeoutMs = 1200 }: WaitForCaptureReadinessOptions = {},
): Promise<ScreenshotReadinessReport> {
  const startedAt = Date.now();
  const doc = rootEl.ownerDocument || document;

  const fontsReady = await withTimeout(
    Promise.resolve()
      .then(async () => {
        const anyDoc = doc as Document & { fonts?: { ready?: Promise<unknown> } };
        if (!anyDoc.fonts?.ready) return true;
        await anyDoc.fonts.ready;
        return true;
      })
      .catch(() => false),
    fontsTimeoutMs,
    false,
  );

  const images = Array.from(rootEl.querySelectorAll('img'));
  const statuses = await Promise.all(images.map((img) => waitForImageReady(img as HTMLImageElement, imageTimeoutMs)));

  const readyImages = statuses.filter((status) => status === 'ready').length;
  const failedImages = statuses.filter((status) => status === 'error').length;
  const timedOutImages = statuses.filter((status) => status === 'timeout').length;

  return {
    fontsReady,
    totalImages: images.length,
    readyImages,
    failedImages,
    timedOutImages,
    waitMs: Date.now() - startedAt,
  };
}
