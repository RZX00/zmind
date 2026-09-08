import type { CanvasNode } from '../../types/canvas';
import type {
  CanvasSnapshot,
  GuideOptions,
  GuideSession,
  ResizePlan,
  SelectionSnapshot,
  SnapPlan,
} from '../../domain/guides';
import { GuideEngineImpl, SimpleGridIndex } from '../../domain/guides';

let sessionCounter = 0;

export interface GuidesController {
  startDrag(selection: SelectionSnapshot): GuideSession;
  moveDrag(
    session: GuideSession,
    canvas: CanvasSnapshot,
    selection: SelectionSnapshot,
    options: GuideOptions
  ): SnapPlan;
  endDrag(session: GuideSession): void;

  startResize(selection: SelectionSnapshot): GuideSession;
  moveResize(
    session: GuideSession,
    canvas: CanvasSnapshot,
    selection: SelectionSnapshot,
    options: GuideOptions
  ): ResizePlan;
  endResize(session: GuideSession): void;
}

export function buildCanvasSnapshot(
  nodes: CanvasNode[],
  scale: number,
  options?: {
    baselineById?: Record<string, number>;
    containerPaddingById?: Record<string, { left: number; right: number; top: number; bottom: number }>;
  }
): CanvasSnapshot {
  return {
    scale,
    nodes: (nodes || []).map((n) => ({
      id: n.id,
      type: (n as any).type,
      visible: (n as any).visible !== false,
      locked: (n as any).locked === true,
      baseline: typeof options?.baselineById?.[n.id] === 'number' ? options!.baselineById![n.id] : undefined,
      containerPadding: options?.containerPaddingById?.[n.id],
      rect: {
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.height,
      },
    })),
  };
}

export function createGuidesController(): GuidesController {
  const index = new SimpleGridIndex();
  const engine = new GuideEngineImpl(index);

  const startSession = (mode: 'drag' | 'resize'): GuideSession => ({
    id: `guide-session-${sessionCounter++}`,
    mode,
    axisLock: { x: false, y: false },
    hysteresisPx: 4,
  });

  return {
    startDrag: (_selection) => startSession('drag'),
    moveDrag: (session, canvas, selection, options) =>
      engine.computeSnapPlan(canvas, selection.rect, selection.ids, options, session),
    endDrag: (_session) => {},

    startResize: (_selection) => startSession('resize'),
    moveResize: (session, canvas, selection, options) =>
      engine.computeResizePlan(canvas, selection.rect, selection.ids, options, session),
    endResize: (_session) => {},
  };
}
