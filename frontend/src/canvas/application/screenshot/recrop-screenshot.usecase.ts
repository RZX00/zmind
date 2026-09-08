import { cropBlobToAspect } from '../../domain/screenshot/policies';
import type { ScreenshotAspect } from '../../domain/screenshot/types';

export async function recropScreenshotUseCase(baseBlob: Blob, aspect: ScreenshotAspect): Promise<Blob> {
  return cropBlobToAspect(baseBlob, aspect);
}
