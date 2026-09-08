import type { ScreenshotAspect } from './types';

const resolveAspectRatio = (aspect?: ScreenshotAspect): number | null => {
  if (!aspect || aspect === 'original') return null;
  const [w, h] = `${aspect}`.split(':').map((v) => parseFloat(v));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
};

export async function cropBlobToAspect(blob: Blob, aspect?: ScreenshotAspect): Promise<Blob> {
  try {
    const targetRatio = resolveAspectRatio(aspect);
    if (!targetRatio) return blob;

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      (img as any).crossOrigin = 'anonymous';
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) return blob;

    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = width;
    let sourceHeight = height;
    const currentRatio = width / height;

    if (currentRatio > targetRatio) {
      sourceWidth = Math.round(height * targetRatio);
      sourceX = Math.max(0, Math.floor((width - sourceWidth) / 2));
    } else if (currentRatio < targetRatio) {
      sourceHeight = Math.round(width / targetRatio);
      sourceY = Math.max(0, Math.floor((height - sourceHeight) / 2));
    }

    const canvas = document.createElement('canvas');
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;

    ctx.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight,
    );

    const cropped = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((nextBlob) => resolve(nextBlob), 'image/png');
    });

    return cropped || blob;
  } catch {
    return blob;
  }
}
