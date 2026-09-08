// Canvas motion constants (mindmap-only motion policy)

export const MOTION_ENABLED_MINDMAP = true;
export const MOTION_MS = 180; // duration in ms
export const MOTION_EASE = 'ease-out';

// Mindmap handles scaling freeze threshold
export const HANDLE_FREEZE_THRESHOLD = 0.7;

export function motionTransition(props: Array<'left' | 'top' | 'width' | 'height' | 'opacity' | 'transform'>): string {
  return props.map(p => `${p} ${MOTION_MS}ms ${MOTION_EASE}`).join(', ');
}

