import posthog from 'posthog-js';

export type TelemetryEvent =
  | 'canvas.save.success'
  | 'canvas.save.failed'
  | 'canvas.draft.detected'
  | 'canvas.draft.restored'
  | 'canvas.draft.discarded'
  | 'canvas.share.failed'
  | 'canvas.share.success';

export const trackEvent = (event: TelemetryEvent, properties?: Record<string, unknown>) => {
  try {
    if (typeof window === 'undefined') return;
    posthog.capture(event, properties);
  } catch {
    // ignore telemetry failures
  }
};

export default trackEvent;
