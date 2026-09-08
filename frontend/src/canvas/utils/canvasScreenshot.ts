import { captureCanvasUseCase } from '../application/screenshot/capture-canvas.usecase';
import { cropBlobToAspect as cropBlobToAspectPolicy } from '../domain/screenshot/policies';

export interface CanvasScreenshotOptions {
  scale?: number;
  backgroundColor?: string;
  excludeSelector?: string;
  hideSelectors?: string[];
  aspect?: string;
}

export type CanvasScreenshotResult = {
  baseBlob: Blob;
  blob: Blob;
  aspect: string;
};

export async function cropBlobToAspect(blob: Blob, aspectStr?: string): Promise<Blob> {
  return cropBlobToAspectPolicy(blob, aspectStr);
}

export async function captureCanvasElement(
  rootEl: HTMLElement,
  {
    scale = 2,
    backgroundColor,
    excludeSelector,
    hideSelectors = [],
    aspect = '16:9',
  }: CanvasScreenshotOptions = {},
): Promise<CanvasScreenshotResult | null> {
  const result = await captureCanvasUseCase({
    rootEl,
    scale,
    backgroundColor,
    excludeSelector,
    hideSelectors,
    aspect,
  });
  if (!result) return null;
  return {
    baseBlob: result.baseBlob,
    blob: result.blob,
    aspect: `${result.aspect || aspect || '16:9'}`,
  };
}

export default captureCanvasElement;
