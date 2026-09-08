export interface SnapTelemetryEvent {
  mode: 'drag' | 'resize';
  snapped: boolean;
  axis?: 'x' | 'y';
  reasonTrace?: string[];
}

export function recordSnapEvent(_event: SnapTelemetryEvent): void {
  // no-op for now
}
