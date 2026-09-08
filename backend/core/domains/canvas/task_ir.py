from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


CanvasEntityKind = Literal["node", "connection", "group", "frame", "note", "summary", "unknown"]
LayoutStrategy = Literal["preserve", "auto", "cluster", "timeline", "mindmap", "grid", "swimlane"]
ExecutionMode = Literal["apply", "dry_run", "shadow"]
CanvasTransformKind = Literal[
    "retitle_selection",
    "create_summary_hub",
    "organize_selection",
    "split_node_into_children",
    "merge_selection_into_node",
]
VerificationKind = Literal[
    "entity_count",
    "layout_stability",
    "connection_integrity",
    "selection_coverage",
    "version_match",
    "custom",
]


@dataclass(frozen=True)
class TargetCanvasRef:
    canvas_id: str | None = None
    workspace_id: str | None = None
    snapshot_id: str | None = None
    selection_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "canvas_id": self.canvas_id,
            "workspace_id": self.workspace_id,
            "snapshot_id": self.snapshot_id,
            "selection_id": self.selection_id,
        }


@dataclass(frozen=True)
class CanvasWorkingSet:
    node_ids: tuple[str, ...] = ()
    connection_ids: tuple[str, ...] = ()
    selected_entity_ids: tuple[str, ...] = ()
    viewport: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "node_ids": list(self.node_ids),
            "connection_ids": list(self.connection_ids),
            "selected_entity_ids": list(self.selected_entity_ids),
            "viewport": dict(self.viewport) if isinstance(self.viewport, dict) else self.viewport,
        }


@dataclass(frozen=True)
class CanvasEntitySpec:
    entity_id: str | None = None
    entity_type: CanvasEntityKind = "unknown"
    label: str | None = None
    text: str | None = None
    properties: dict[str, Any] = field(default_factory=dict)
    anchors: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "entity_type": self.entity_type,
            "label": self.label,
            "text": self.text,
            "properties": dict(self.properties),
            "anchors": list(self.anchors),
        }


@dataclass(frozen=True)
class ConnectionIntent:
    source_entity_id: str | None = None
    target_entity_id: str | None = None
    relation: str | None = None
    directed: bool = True
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_entity_id": self.source_entity_id,
            "target_entity_id": self.target_entity_id,
            "relation": self.relation,
            "directed": self.directed,
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class CanvasSemanticLane:
    lane_id: str
    label: str
    entity_ids: tuple[str, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "lane_id": self.lane_id,
            "label": self.label,
            "entity_ids": list(self.entity_ids),
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class LayoutConstraints:
    strategy: LayoutStrategy = "preserve"
    preserve_positions: bool = True
    lock_selection: bool = False
    max_width: int | None = None
    max_height: int | None = None
    anchor_entity_id: str | None = None
    root_entity_id: str | None = None
    lanes: tuple[CanvasSemanticLane, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "strategy": self.strategy,
            "preserve_positions": self.preserve_positions,
            "lock_selection": self.lock_selection,
            "max_width": self.max_width,
            "max_height": self.max_height,
            "anchor_entity_id": self.anchor_entity_id,
            "root_entity_id": self.root_entity_id,
            "lanes": [lane.to_dict() for lane in self.lanes],
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class ExecutionPolicy:
    mode: ExecutionMode = "apply"
    idempotency_key: str | None = None
    expected_canvas_version: str | int | None = None
    allow_partial_success: bool = False
    repair_attempt_limit: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "idempotency_key": self.idempotency_key,
            "expected_canvas_version": self.expected_canvas_version,
            "allow_partial_success": self.allow_partial_success,
            "repair_attempt_limit": self.repair_attempt_limit,
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class CanvasTransform:
    kind: CanvasTransformKind
    target_entity_ids: tuple[str, ...] = ()
    payload: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "target_entity_ids": list(self.target_entity_ids),
            "payload": dict(self.payload),
        }


@dataclass(frozen=True)
class VerificationCheck:
    kind: VerificationKind
    target: str | None = None
    expected: Any = None
    required: bool = True
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "target": self.target,
            "expected": self.expected,
            "required": self.required,
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class VerificationPlan:
    checks: tuple[VerificationCheck, ...] = ()
    strict: bool = True
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "checks": [check.to_dict() for check in self.checks],
            "strict": self.strict,
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class CanvasTaskIR:
    intent_id: str | None = None
    user_goal: str = ""
    domain: str = "canvas"
    target: TargetCanvasRef = field(default_factory=TargetCanvasRef)
    working_set: CanvasWorkingSet = field(default_factory=CanvasWorkingSet)
    entities: tuple[CanvasEntitySpec, ...] = ()
    connections: tuple[ConnectionIntent, ...] = ()
    transforms: tuple[CanvasTransform, ...] = ()
    layout: LayoutConstraints = field(default_factory=LayoutConstraints)
    execution: ExecutionPolicy = field(default_factory=ExecutionPolicy)
    verification: VerificationPlan = field(default_factory=VerificationPlan)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "intent_id": self.intent_id,
            "user_goal": self.user_goal,
            "domain": self.domain,
            "target": self.target.to_dict(),
            "working_set": self.working_set.to_dict(),
            "entities": [entity.to_dict() for entity in self.entities],
            "connections": [connection.to_dict() for connection in self.connections],
            "transforms": [transform.to_dict() for transform in self.transforms],
            "layout": self.layout.to_dict(),
            "execution": self.execution.to_dict(),
            "verification": self.verification.to_dict(),
            "metadata": dict(self.metadata),
        }
