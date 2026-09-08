# Smart Guides DDD Architecture and Implementation Spec

Status: Draft (ready for review)
Owner: Frontend
Last updated: 2026-02-04

This document defines a full, production-grade Smart Guides system using
Domain-Driven Design (DDD). It is written so implementation can start
immediately once approved.

--------------------------------------------------------------------------------
## 1. Goals and Non-Goals

### Goals
1) Smart Guides must actually snap for single-node drag, multi-select drag,
   group drag, and resize. Behavior must be consistent across all cases.
2) Business logic is isolated in a pure domain module with zero React/DOM/store
   dependencies.
3) The system is anti-fragile: extreme inputs must degrade gracefully without
   crashing or jittering.
4) Performance: drag and resize must remain smooth at large node counts.
5) UX: the user can feel the feature immediately. No hidden on but invisible.

### Non-Goals
- This spec does not redesign canvas rendering or existing node types.
- This spec does not replace existing selection or drag mechanics outside guides.

--------------------------------------------------------------------------------
## 2. Scope

Smart Guides will control:
- Drag snapping (single node, multi-select, group).
- Resize snapping (bottom-right by default; extensible).
- Guide line rendering and distance labels.
- Equal spacing detection.
- Grid fallback (optional).
- Modifier key to temporarily disable snapping.

--------------------------------------------------------------------------------
## 3. Domain-Driven Design Overview

### Bounded Context
Smart Guides is its own bounded context. It consumes a read-only geometry
snapshot of the canvas and produces a Snap Plan (alignment lines, distances,
and the delta to apply).

### Layers (Ports and Adapters)

1) Domain (pure):
   - Value Objects: Point, Rect, Axis, GuideLine, DistanceHint.
   - Aggregates: CanvasSnapshot, SelectionSnapshot, GuideSession.
   - Domain Services: GuideEngine, NeighborIndex.
   - Policies: AlignmentPolicy, TolerancePolicy, ScoringPolicy.

2) Application:
   - Use cases: DragNode, DragSelection, ResizeNode.
   - Orchestrates policies, sessions, and emits SnapPlan.

3) Infrastructure:
   - SettingsRepository (local storage, remote sync).
   - TelemetryAdapter.
   - WorkerAdapter (optional, for heavy canvases).

4) UI:
   - React components call application use cases.
   - Overlay renderer consumes SnapPlan.

--------------------------------------------------------------------------------
## 4. UX Requirements (Product Truth)

1) Smart Guides ON must produce visible guidance or real snapping.
2) Single drag and multi-select drag must behave identically (same snapping rules).
3) Distance labels must match the final snapped position (no stale values).
4) Modifier key disables snapping instantly and reliably.
5) Equal spacing is predictable and does not override obvious alignment.
6) When no guide candidates exist, optional grid fallback may apply.

--------------------------------------------------------------------------------
## 5. Domain Model

### Value Objects
```ts
export type Axis = "x" | "y";
export type GuideOrientation = "vertical" | "horizontal";
export type GuideKind = "edge" | "center" | "baseline" | "spacing";

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
  priority: number; // used by scoring and debug
}

export interface DistanceHint {
  orientation: GuideOrientation;
  x1: number; y1: number; x2: number; y2: number;
  value: number;
}
```

### Aggregates
```ts
export interface CanvasSnapshot {
  nodes: NodeGeom[];
  scale: number;
  viewBounds?: Rect;
}

export interface NodeGeom {
  id: string;
  rect: Rect;
  type?: string;
  visible?: boolean;
  locked?: boolean;
}

export interface SelectionSnapshot {
  ids: string[];
  rect: Rect; // bounding rect of selection
}

export interface GuideSession {
  id: string;
  mode: "drag" | "resize";
  axisLock?: Axis;
  lastPlan?: SnapPlan;
  hysteresisPx: number;
}
```

### Snap Plan (Domain Output)
```ts
export interface SnapPlan {
  delta: Point;          // dx/dy to apply
  appliedRect: Rect;     // selection rect after snap
  guideLines: GuideLine[];
  distances: DistanceHint[];
  reasonTrace: string[]; // for debugging and telemetry
}
```

--------------------------------------------------------------------------------
## 6. Domain Services and Policies

### GuideEngine
Primary service. Pure function when used without sessions.

```ts
export interface GuideEngine {
  computeSnapPlan(
    canvas: CanvasSnapshot,
    selection: SelectionSnapshot,
    options: GuideOptions,
    session?: GuideSession
  ): SnapPlan;
}
```

### NeighborIndex
Spatial index to reduce candidate neighbors (grid or R-tree).

```ts
export interface NeighborIndex {
  rebuild(nodes: NodeGeom[], scale: number): void;
  query(rect: Rect, radius: number): NodeGeom[];
}
```

### GuideOptions
```ts
export interface GuideOptions {
  enabled: boolean;
  showLines: boolean;
  showDistance: boolean;
  equalSpacing: boolean;
  tolerancePx: number;
  fallbackToGrid: boolean;
  gridSizePx?: number;
  modifierDisabled: boolean;
  allowBaseline?: boolean;
}
```

### Policies
1) EligibilityPolicy
   - Filter out invalid nodes (NaN/Infinity).
   - Exclude nodes in selection.
   - Exclude hidden/locked/group nodes if configured.

2) TolerancePolicy
   - Convert tolerance in screen px to canvas units.
   - Apply hysteresis if axisLock exists.

3) ScoringPolicy
   - Score candidates based on distance, priority, and stability.
   - Provide deterministic tie-breaking.

--------------------------------------------------------------------------------
## 7. Core Algorithms

### 7.1 Candidate Generation (Alignment)
For each neighbor candidate:
- X-axis candidates: left-left, left-right, center-center, right-left, right-right
- Y-axis candidates: top-top, top-bottom, center-center, bottom-top, bottom-bottom
- Add optional baseline candidates for text nodes (future extension)

### 7.2 Scoring
Every candidate is scored; the lowest score wins.
```text
score = (abs(delta) * w_distance)
      + (axisLockMismatch ? w_axis_penalty : 0)
      - (isCenter ? w_center_bonus : 0)
      - (isEdge ? w_edge_bonus : 0)
      - (isEqualSpacing ? w_spacing_bonus : 0)
      + (stabilityPenalty)
```

### 7.3 Equal Spacing
Compute only after candidate neighbors are filtered.
- Identify nearest left and right neighbors that overlap the selection on Y.
- Compute target X so gaps are equal.
- Only apply if within tolerance.

Do the same for Y (top/bottom neighbors).

### 7.4 Hysteresis (Anti-Jitter)
If a guide locks to X or Y:
- Increase tolerance on that axis while locked.
- Only unlock if the pointer leaves a larger exit threshold.

### 7.5 Final Plan Assembly
Rules:
1) If options.enabled is false or modifierDisabled is true, return identity plan.
2) Select best X candidate and best Y candidate independently (unless policy forbids).
3) Apply equal spacing if it scores better than edge/center.
4) Compute appliedRect from selection.rect + delta.
5) Distances are computed after appliedRect is final.
6) If no candidates and fallbackToGrid is true, snap to grid.

--------------------------------------------------------------------------------
## 8. Application Layer (Use Cases)

### Use Case Interfaces
```ts
export interface DragGuidesUseCase {
  onDragStart(selection: SelectionSnapshot): GuideSession;
  onDragMove(
    session: GuideSession,
    canvas: CanvasSnapshot,
    selection: SelectionSnapshot,
    options: GuideOptions
  ): SnapPlan;
  onDragEnd(session: GuideSession): void;
}

export interface ResizeGuidesUseCase {
  onResizeStart(selection: SelectionSnapshot): GuideSession;
  onResizeMove(
    session: GuideSession,
    canvas: CanvasSnapshot,
    selection: SelectionSnapshot,
    options: GuideOptions
  ): SnapPlan;
  onResizeEnd(session: GuideSession): void;
}
```

### Responsibilities
- Manage GuideSession lifecycle.
- Call GuideEngine with proper options.
- Emit SnapPlan to UI.

--------------------------------------------------------------------------------
## 9. Infrastructure Adapters

### SettingsRepository
Provides GuideOptions from storage.

```ts
export interface SettingsRepository {
  getGuideOptions(): GuideOptions;
  setGuideOptions(partial: Partial<GuideOptions>): void;
}
```

### TelemetryAdapter
Records important events.

```ts
export interface TelemetryAdapter {
  recordSnapEvent(data: {
    mode: "drag" | "resize";
    snapped: boolean;
    axis?: Axis;
    reasonTrace?: string[];
  }): void;
}
```

### WorkerAdapter (optional)
Move GuideEngine to a Worker when node count exceeds threshold.

--------------------------------------------------------------------------------
## 10. UI Integration

### New Integration Point
Introduce a single controller to replace scattered logic.

```ts
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
  ): SnapPlan;
  endResize(session: GuideSession): void;
}
```

### Integration Targets (current code)
- Replace snapping logic in:
  - frontend/src/canvas/components/core/interactions/useNodesDnd.ts
  - frontend/src/canvas/components/core/InfiniteCanvas.tsx
  - frontend/src/canvas/utils/smartGuides.ts (deprecated)

### UI Flow
1) Drag start -> GuidesController.startDrag -> session
2) Drag move -> GuidesController.moveDrag -> SnapPlan
3) Apply SnapPlan.delta to transform or to actual node positions
4) Render SnapPlan.guideLines + SnapPlan.distances
5) Drag end -> GuidesController.endDrag -> clear overlays

--------------------------------------------------------------------------------
## 11. Anti-Fragile Guarantees

1) Any invalid geometry results in identity SnapPlan.
2) Large scale values are clamped to avoid divide-by-zero.
3) If NeighborIndex fails, fallback to linear scan on nearby nodes only.
4) If performance budget is exceeded, skip guides for that frame.

--------------------------------------------------------------------------------
## 12. Testing Strategy

### Unit Tests
- Geometry utilities: rect center, edges, bounds.
- GuideEngine scoring and candidate selection.
- Equal spacing: symmetric and asymmetric layouts.
- Hysteresis lock and unlock.

### Property-Based Tests
Random nodes (1 to 10k) with random sizes:
- Output must be finite.
- Delta must not exceed tolerance if snapping is applied.

### Integration Tests
- Drag single node near another node -> expected snap.
- Drag multi-select bounding box -> expected snap.
- Resize node near neighbor edge -> expected snap.

### Performance Tests
- Measure average compute time at 1k, 5k, 10k nodes.
- Budget target: <= 2 ms per frame.

--------------------------------------------------------------------------------
## 13. Migration and Rollout Plan

### Phase 0: Add New Module (Default On)
Smart Guides v2 is enabled by default (no environment flag).

### Phase 1: Shadow Mode
Run v2 engine in parallel (no UI effect) and log discrepancies.

### Phase 2: Single Drag Snap
Enable v2 for single drag only. Compare metrics with legacy.

### Phase 3: Multi-select and Group Drag
Switch to v2 for all drag cases.

### Phase 4: Resize Snap
Switch to v2 for resize.

### Phase 5: Remove Legacy
Delete old smartGuides.ts usage and duplicate logic.

--------------------------------------------------------------------------------
## 14. Settings and Defaults

Default settings (must be centralized in SettingsRepository):
```
enabled: true
showLines: true
showDistance: false
equalSpacing: true
tolerancePx: 8
fallbackToGrid: false
gridSizePx: 20
```

Rationale: When guides are on, users must see immediate effect.

--------------------------------------------------------------------------------
## 15. Open Questions

1) Should baseline alignment be enabled for text nodes in v1?
2) Should equal spacing outrank center alignment by default?
3) What is the target threshold for enabling WorkerAdapter?

--------------------------------------------------------------------------------
## 16. Implementation Checklist (Ready to Execute)

1) Create domain module:
   - frontend/src/domain/guides/*
2) Create application use cases:
   - frontend/src/application/guides/*
3) Create infrastructure adapters:
   - frontend/src/infrastructure/guides/*
4) Create GuidesController and wire into drag/resize flows.
5) Update overlay rendering to consume SnapPlan.
6) Implement feature flag + telemetry.
7) Add tests and performance checks.

--------------------------------------------------------------------------------
## 17. Approval Gate

Once this document is approved:
- Implementation starts immediately with v2 as default.
- Legacy Smart Guides will be deprecated and removed after rollout.
