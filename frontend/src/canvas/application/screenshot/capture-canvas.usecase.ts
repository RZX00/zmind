import { cropBlobToAspect } from '../../domain/screenshot/policies';
import type { ScreenshotArtifact, ScreenshotCaptureRequest } from '../../domain/screenshot/types';
import { captureDomToBlob } from '../../infrastructure/screenshot/dom-capture.adapter';

export async function captureCanvasUseCase(request: ScreenshotCaptureRequest): Promise<ScreenshotArtifact | null> {
  const aspect = request.aspect || '16:9';
  const captureResult = await captureDomToBlob(request.rootEl, {
    scale: request.scale ?? 2,
    backgroundColor: request.backgroundColor,
    hideSelectors: request.hideSelectors || [],
    excludeSelector: request.excludeSelector,
  });
  if (!captureResult?.baseBlob) return null;

  const blob = await cropBlobToAspect(captureResult.baseBlob, aspect);
  return {
    baseBlob: captureResult.baseBlob,
    blob,
    aspect,
    diagnostics: captureResult.diagnostics,
  };
}
