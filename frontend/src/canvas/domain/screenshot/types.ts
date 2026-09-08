export type ScreenshotAspect = '16:9' | '4:3' | '1:1' | 'original' | string;

export interface ScreenshotReadinessReport {
  fontsReady: boolean;
  totalImages: number;
  readyImages: number;
  failedImages: number;
  timedOutImages: number;
  waitMs: number;
}

export interface ScreenshotDiagnostics {
  hiddenElements: number;
  imageErrors: number;
  readiness: ScreenshotReadinessReport;
  durationMs: number;
  degraded: boolean;
}

export interface ScreenshotCaptureRequest {
  rootEl: HTMLElement;
  scale?: number;
  backgroundColor?: string;
  aspect?: ScreenshotAspect;
  excludeSelector?: string;
  hideSelectors?: string[];
}

export interface ScreenshotArtifact {
  baseBlob: Blob;
  blob: Blob;
  aspect: ScreenshotAspect;
  diagnostics: ScreenshotDiagnostics;
}

export const SCREENSHOT_ASPECT_OPTIONS: ScreenshotAspect[] = ['16:9', '4:3', '1:1', 'original'];
