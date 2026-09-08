export type Axis = "x" | "y";
export type GuideOrientation = "vertical" | "horizontal";
export type GuideKind = "edge" | "center" | "baseline" | "spacing" | "container";
export type GuideRole = "primary" | "secondary";
export type ResizeHandle =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GuideLine {
  orientation: GuideOrientation;
  pos: number;
  kind: GuideKind;
  targetId?: string;
  priority?: number;
  role?: GuideRole;
}

export interface DistanceHint {
  orientation: GuideOrientation;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  value: number;
}

export interface NodeGeom {
  id: string;
  rect: Rect;
  type?: string;
  visible?: boolean;
  locked?: boolean;
  baseline?: number;
  containerPadding?: { left: number; right: number; top: number; bottom: number };
}

export interface CanvasSnapshot {
  nodes: NodeGeom[];
  scale: number;
  viewBounds?: Rect;
}

export interface SelectionSnapshot {
  ids: string[];
  rect: Rect;
}

export interface AxisLock {
  x: boolean;
  y: boolean;
}

export interface GuideHit {
  token: string;
  guide: GuideLine;
  delta: number;
}

export interface GuideSession {
  id: string;
  mode: "drag" | "resize";
  axisLock?: AxisLock;
  lastPlan?: SnapPlan;
  hysteresisPx: number;
  lastHitX?: GuideHit;
  lastHitY?: GuideHit;
}

export interface SnapPlan {
  delta: Point;
  appliedRect: Rect;
  guideLines: GuideLine[];
  distances: DistanceHint[];
  reasonTrace: string[];
}

export interface ResizePlan {
  widthDelta: number;
  heightDelta: number;
  xDelta?: number;
  yDelta?: number;
  guideLines: GuideLine[];
  reasonTrace: string[];
}

export interface GuideOptions {
  enabled: boolean;
  showLines: boolean;
  showDistance: boolean;
  showSecondaryGuides?: boolean;
  equalSpacing: boolean;
  tolerancePx: number;
  fallbackToGrid: boolean;
  gridSizePx?: number;
  modifierDisabled: boolean;
  allowBaseline?: boolean;
  allowContainer?: boolean;
  resizeHandle?: ResizeHandle;
}
