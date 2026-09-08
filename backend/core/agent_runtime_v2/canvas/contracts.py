from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..contracts import RiskLevelV2


@dataclass(slots=True)
class CanvasIntentIRV2:
    user_goal: str
    target_canvas_id: str | None
    selection_scope: str
    operation_class: str
    risk_level: RiskLevelV2
    verification_contract: dict[str, Any] = field(default_factory=dict)
    planning_hints: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "user_goal": self.user_goal,
            "target_canvas_id": self.target_canvas_id,
            "selection_scope": self.selection_scope,
            "operation_class": self.operation_class,
            "risk_level": self.risk_level,
            "verification_contract": dict(self.verification_contract),
            "planning_hints": dict(self.planning_hints),
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "CanvasIntentIRV2":
        return cls(
            user_goal=str(payload.get("user_goal") or ""),
            target_canvas_id=payload.get("target_canvas_id"),
            selection_scope=str(payload.get("selection_scope") or "canvas"),
            operation_class=str(payload.get("operation_class") or "edit"),
            risk_level=str(payload.get("risk_level") or "low"),
            verification_contract=dict(payload.get("verification_contract") or {}),
            planning_hints=dict(payload.get("planning_hints") or {}),
        )


@dataclass(slots=True)
class CanvasPlanV2:
    intent: CanvasIntentIRV2
    task: dict[str, Any]
    canvas_context: dict[str, Any]
    runtime_policy: dict[str, Any]
    plan_id: str = ""
    planning_summary: dict[str, Any] = field(default_factory=dict)
    preview: dict[str, Any] = field(default_factory=dict)
    compiler_hints: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "intent": self.intent.to_dict(),
            "task": dict(self.task),
            "canvas_context": dict(self.canvas_context),
            "runtime_policy": dict(self.runtime_policy),
            "plan_id": self.plan_id,
            "planning_summary": dict(self.planning_summary),
            "preview": dict(self.preview),
            "compiler_hints": dict(self.compiler_hints),
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "CanvasPlanV2":
        return cls(
            intent=CanvasIntentIRV2.from_dict(dict(payload.get("intent") or {})),
            task=dict(payload.get("task") or {}),
            canvas_context=dict(payload.get("canvas_context") or {}),
            runtime_policy=dict(payload.get("runtime_policy") or {}),
            plan_id=str(payload.get("plan_id") or ""),
            planning_summary=dict(payload.get("planning_summary") or {}),
            preview=dict(payload.get("preview") or {}),
            compiler_hints=dict(payload.get("compiler_hints") or {}),
        )


@dataclass(slots=True)
class CanvasMutationBatchV2:
    canvas_id: str | None
    expected_version: int | None
    idempotency_key: str
    operations: list[dict[str, Any]]
    expected_positions: dict[str, dict[str, float]]
    layout_metadata: dict[str, Any]
    operation_summary: dict[str, Any]
    verification_contract: dict[str, Any]
    risk_level: RiskLevelV2

    def to_dict(self) -> dict[str, Any]:
        return {
            "canvas_id": self.canvas_id,
            "expected_version": self.expected_version,
            "idempotency_key": self.idempotency_key,
            "operations": list(self.operations),
            "expected_positions": dict(self.expected_positions),
            "layout_metadata": dict(self.layout_metadata),
            "operation_summary": dict(self.operation_summary),
            "verification_contract": dict(self.verification_contract),
            "risk_level": self.risk_level,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "CanvasMutationBatchV2":
        return cls(
            canvas_id=payload.get("canvas_id"),
            expected_version=payload.get("expected_version"),
            idempotency_key=str(payload.get("idempotency_key") or ""),
            operations=list(payload.get("operations") or []),
            expected_positions={
                str(key): dict(value or {})
                for key, value in dict(payload.get("expected_positions") or {}).items()
            },
            layout_metadata=dict(payload.get("layout_metadata") or {}),
            operation_summary=dict(payload.get("operation_summary") or {}),
            verification_contract=dict(payload.get("verification_contract") or {}),
            risk_level=str(payload.get("risk_level") or "low"),
        )


@dataclass(slots=True)
class CanvasPreviewIRV2:
    plan_id: str
    user_goal: str
    target_canvas_id: str | None
    selection_scope: str
    impacted_node_ids: list[str]
    impacted_connection_ids: list[str]
    impacted_regions: list[dict[str, Any]]
    operation_summary: dict[str, Any]
    risk_level: RiskLevelV2
    expected_canvas_version: int | None
    verification_summary: dict[str, Any]
    confirm_token: str
    pending_plan_ref: str
    planning_summary: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "plan_id": self.plan_id,
            "user_goal": self.user_goal,
            "target_canvas_id": self.target_canvas_id,
            "selection_scope": self.selection_scope,
            "impacted_node_ids": list(self.impacted_node_ids),
            "impacted_connection_ids": list(self.impacted_connection_ids),
            "impacted_regions": [dict(region or {}) for region in self.impacted_regions],
            "operation_summary": dict(self.operation_summary),
            "risk_level": self.risk_level,
            "expected_canvas_version": self.expected_canvas_version,
            "verification_summary": dict(self.verification_summary),
            "confirm_token": self.confirm_token,
            "pending_plan_ref": self.pending_plan_ref,
            "planning_summary": dict(self.planning_summary),
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "CanvasPreviewIRV2":
        return cls(
            plan_id=str(payload.get("plan_id") or ""),
            user_goal=str(payload.get("user_goal") or ""),
            target_canvas_id=payload.get("target_canvas_id"),
            selection_scope=str(payload.get("selection_scope") or "canvas"),
            impacted_node_ids=[str(item) for item in list(payload.get("impacted_node_ids") or [])],
            impacted_connection_ids=[str(item) for item in list(payload.get("impacted_connection_ids") or [])],
            impacted_regions=[dict(region or {}) for region in list(payload.get("impacted_regions") or [])],
            operation_summary=dict(payload.get("operation_summary") or {}),
            risk_level=str(payload.get("risk_level") or "low"),
            expected_canvas_version=payload.get("expected_canvas_version"),
            verification_summary=dict(payload.get("verification_summary") or {}),
            confirm_token=str(payload.get("confirm_token") or ""),
            pending_plan_ref=str(payload.get("pending_plan_ref") or ""),
            planning_summary=dict(payload.get("planning_summary") or {}),
        )
