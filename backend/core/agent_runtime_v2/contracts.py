from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal


LaneNameV2 = Literal["canvas", "doc", "general", "subagent"]
ResponseModeV2 = Literal["auto", "preview", "confirm", "force_apply"]
RiskLevelV2 = Literal["low", "medium", "high"]
ContextStageNameV2 = Literal["normalize", "enrich", "budget", "replacement", "compact", "collapse", "assemble"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True, frozen=True)
class RuntimeIdentityV2:
    run_id: str
    thread_id: str
    account_id: str
    project_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "thread_id": self.thread_id,
            "account_id": self.account_id,
            "project_id": self.project_id,
        }


@dataclass(slots=True, frozen=True)
class WorkspaceTargetV2:
    workspace_id: str | None = None
    canvas_id: str | None = None
    doc_item_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "workspace_id": self.workspace_id,
            "canvas_id": self.canvas_id,
            "doc_item_id": self.doc_item_id,
            "metadata": dict(self.metadata),
        }


@dataclass(slots=True, frozen=True)
class SelectionContextV2:
    canvas_id: str | None = None
    scope: str = "canvas"
    node_ids: tuple[str, ...] = ()
    connection_ids: tuple[str, ...] = ()
    raw_payload: dict[str, Any] | None = None
    anchor_box: dict[str, Any] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "canvas_id": self.canvas_id,
            "scope": self.scope,
            "node_ids": list(self.node_ids),
            "connection_ids": list(self.connection_ids),
            "raw_payload": dict(self.raw_payload) if isinstance(self.raw_payload, dict) else self.raw_payload,
            "anchor_box": dict(self.anchor_box) if isinstance(self.anchor_box, dict) else self.anchor_box,
            "metadata": dict(self.metadata),
        }


@dataclass(slots=True, frozen=True)
class ArtifactReferenceV2:
    artifact_id: str
    kind: str
    pointer: str
    summary: str | None = None
    content_type: str = "application/json"
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "artifact_id": self.artifact_id,
            "kind": self.kind,
            "pointer": self.pointer,
            "summary": self.summary,
            "content_type": self.content_type,
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "ArtifactReferenceV2":
        return cls(
            artifact_id=str(payload.get("artifact_id") or ""),
            kind=str(payload.get("kind") or "unknown"),
            pointer=str(payload.get("pointer") or ""),
            summary=payload.get("summary"),
            content_type=str(payload.get("content_type") or "application/json"),
            metadata=dict(payload.get("metadata") or {}),
        )


@dataclass(slots=True, frozen=True)
class ReplacementLedgerEntryV2:
    key: str
    artifact: ArtifactReferenceV2
    original_size: int
    replacement_reason: str
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "artifact": self.artifact.to_dict(),
            "original_size": self.original_size,
            "replacement_reason": self.replacement_reason,
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "ReplacementLedgerEntryV2":
        return cls(
            key=str(payload.get("key") or ""),
            artifact=ArtifactReferenceV2.from_dict(dict(payload.get("artifact") or {})),
            original_size=int(payload.get("original_size") or 0),
            replacement_reason=str(payload.get("replacement_reason") or "unknown"),
            metadata=dict(payload.get("metadata") or {}),
        )


@dataclass(slots=True, frozen=True)
class ContextLifecycleRecordV2:
    stage: ContextStageNameV2
    payload: dict[str, Any]
    artifact_refs: tuple[ArtifactReferenceV2, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "stage": self.stage,
            "payload": dict(self.payload),
            "artifact_refs": [artifact.to_dict() for artifact in self.artifact_refs],
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "ContextLifecycleRecordV2":
        return cls(
            stage=str(payload.get("stage") or "normalize"),
            payload=dict(payload.get("payload") or {}),
            artifact_refs=tuple(
                ArtifactReferenceV2.from_dict(dict(item or {}))
                for item in list(payload.get("artifact_refs") or [])
                if isinstance(item, dict)
            ),
            metadata=dict(payload.get("metadata") or {}),
        )


@dataclass(slots=True)
class ContinuityStateV2:
    continuity_id: str
    transcript: list[dict[str, Any]] = field(default_factory=list)
    sidechains: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    event_history: list[dict[str, Any]] = field(default_factory=list)
    replacement_ledger: list[ReplacementLedgerEntryV2] = field(default_factory=list)
    collapsed_contexts: dict[str, dict[str, Any]] = field(default_factory=dict)
    verifier_history: list[dict[str, Any]] = field(default_factory=list)
    artifacts: dict[str, dict[str, Any]] = field(default_factory=dict)
    lane_metadata: dict[str, Any] = field(default_factory=dict)
    active_lane: LaneNameV2 | None = None
    lane_state: str = "idle"
    repair_history: list[dict[str, Any]] = field(default_factory=list)
    decision_trace: list[dict[str, Any]] = field(default_factory=list)
    context_lifecycle: list[ContextLifecycleRecordV2] = field(default_factory=list)
    pending_canvas_plan: dict[str, Any] | None = None
    pending_preview: dict[str, Any] | None = None
    resume_metadata: dict[str, Any] = field(default_factory=dict)
    updated_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> dict[str, Any]:
        return {
            "continuity_id": self.continuity_id,
            "transcript": list(self.transcript),
            "sidechains": {key: list(value) for key, value in self.sidechains.items()},
            "event_history": list(self.event_history),
            "replacement_ledger": [entry.to_dict() for entry in self.replacement_ledger],
            "collapsed_contexts": {key: dict(value) for key, value in self.collapsed_contexts.items()},
            "verifier_history": list(self.verifier_history),
            "artifacts": {key: dict(value) for key, value in self.artifacts.items()},
            "lane_metadata": dict(self.lane_metadata),
            "active_lane": self.active_lane,
            "lane_state": self.lane_state,
            "repair_history": list(self.repair_history),
            "decision_trace": list(self.decision_trace),
            "context_lifecycle": [record.to_dict() for record in self.context_lifecycle],
            "pending_canvas_plan": dict(self.pending_canvas_plan) if isinstance(self.pending_canvas_plan, dict) else None,
            "pending_preview": dict(self.pending_preview) if isinstance(self.pending_preview, dict) else None,
            "resume_metadata": dict(self.resume_metadata),
            "updated_at": self.updated_at,
        }

    @classmethod
    def empty(cls, continuity_id: str) -> "ContinuityStateV2":
        return cls(continuity_id=continuity_id)

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None, *, continuity_id: str | None = None) -> "ContinuityStateV2":
        data = dict(payload or {})
        resolved_id = str(data.get("continuity_id") or continuity_id or "")
        return cls(
            continuity_id=resolved_id,
            transcript=list(data.get("transcript") or []),
            sidechains={str(key): list(value or []) for key, value in dict(data.get("sidechains") or {}).items()},
            event_history=list(data.get("event_history") or []),
            replacement_ledger=[
                ReplacementLedgerEntryV2.from_dict(dict(item or {}))
                for item in list(data.get("replacement_ledger") or [])
                if isinstance(item, dict)
            ],
            collapsed_contexts={str(key): dict(value or {}) for key, value in dict(data.get("collapsed_contexts") or {}).items()},
            verifier_history=list(data.get("verifier_history") or []),
            artifacts={str(key): dict(value or {}) for key, value in dict(data.get("artifacts") or {}).items()},
            lane_metadata=dict(data.get("lane_metadata") or {}),
            active_lane=(str(data.get("active_lane")) if data.get("active_lane") else None),
            lane_state=str(data.get("lane_state") or "idle"),
            repair_history=list(data.get("repair_history") or []),
            decision_trace=list(data.get("decision_trace") or []),
            context_lifecycle=[
                ContextLifecycleRecordV2.from_dict(dict(item or {}))
                for item in list(data.get("context_lifecycle") or [])
                if isinstance(item, dict)
            ],
            pending_canvas_plan=dict(data.get("pending_canvas_plan") or {}) if isinstance(data.get("pending_canvas_plan"), dict) else None,
            pending_preview=dict(data.get("pending_preview") or {}) if isinstance(data.get("pending_preview"), dict) else None,
            resume_metadata=dict(data.get("resume_metadata") or {}),
            updated_at=str(data.get("updated_at") or _now_iso()),
        )


@dataclass(slots=True)
class AgentRunStartV2:
    identity: RuntimeIdentityV2
    surface: str | None = None
    interaction_mode: str = "agent"
    response_mode: ResponseModeV2 = "auto"
    user_input: dict[str, Any] | None = None
    latest_user_text: str = ""
    workspace_target: WorkspaceTargetV2 = field(default_factory=WorkspaceTargetV2)
    selection_context: SelectionContextV2 = field(default_factory=SelectionContextV2)
    model_name: str = ""
    enable_thinking: bool | None = False
    reasoning_effort: str = "low"
    enable_context_manager: bool = True
    enable_prompt_caching: bool = True
    agent_config: dict[str, Any] | None = None
    tool_context: dict[str, Any] = field(default_factory=dict)
    checkpoint_id: str | None = None
    resume_token: str | None = None
    stop_event: asyncio.Event | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "identity": self.identity.to_dict(),
            "surface": self.surface,
            "interaction_mode": self.interaction_mode,
            "response_mode": self.response_mode,
            "user_input": dict(self.user_input or {}),
            "latest_user_text": self.latest_user_text,
            "workspace_target": self.workspace_target.to_dict(),
            "selection_context": self.selection_context.to_dict(),
            "model_name": self.model_name,
            "enable_thinking": self.enable_thinking,
            "reasoning_effort": self.reasoning_effort,
            "enable_context_manager": self.enable_context_manager,
            "enable_prompt_caching": self.enable_prompt_caching,
            "agent_config": dict(self.agent_config or {}),
            "tool_context": dict(self.tool_context),
            "checkpoint_id": self.checkpoint_id,
            "resume_token": self.resume_token,
        }


@dataclass(slots=True)
class RuntimeContextV2:
    identity: RuntimeIdentityV2
    surface: str | None = None
    interaction_mode: str = "agent"
    response_mode: ResponseModeV2 = "auto"
    lane: LaneNameV2 = "general"
    latest_user_text: str = ""
    user_input: dict[str, Any] = field(default_factory=dict)
    workspace_target: WorkspaceTargetV2 = field(default_factory=WorkspaceTargetV2)
    selection_context: SelectionContextV2 = field(default_factory=SelectionContextV2)
    model_name: str = ""
    enable_thinking: bool | None = False
    reasoning_effort: str = "low"
    enable_context_manager: bool = True
    enable_prompt_caching: bool = True
    agent_config: dict[str, Any] | None = None
    tool_context: dict[str, Any] = field(default_factory=dict)
    policy_context: dict[str, Any] = field(default_factory=dict)
    budget_context: dict[str, Any] = field(default_factory=dict)
    prompt_context: dict[str, Any] = field(default_factory=dict)
    diagnostics: list[dict[str, Any]] = field(default_factory=list)
    continuity_state: ContinuityStateV2 | None = None
    checkpoint_id: str | None = None
    resume_token: str | None = None
    stop_event: asyncio.Event | None = None

    def to_tool_context(self) -> dict[str, Any]:
        merged = dict(self.tool_context)
        merged.setdefault("interaction_surface", self.surface)
        merged.setdefault("interaction_mode", self.interaction_mode)
        merged.setdefault("canvas_id", self.workspace_target.canvas_id or self.selection_context.canvas_id)
        merged.setdefault("selection_context", self.selection_context.raw_payload)
        merged["runtime_context_v2"] = self.to_dict()
        return merged

    def to_dict(self) -> dict[str, Any]:
        return {
            "identity": self.identity.to_dict(),
            "surface": self.surface,
            "interaction_mode": self.interaction_mode,
            "response_mode": self.response_mode,
            "lane": self.lane,
            "latest_user_text": self.latest_user_text,
            "user_input": dict(self.user_input),
            "workspace_target": self.workspace_target.to_dict(),
            "selection_context": self.selection_context.to_dict(),
            "model_name": self.model_name,
            "enable_thinking": self.enable_thinking,
            "reasoning_effort": self.reasoning_effort,
            "enable_context_manager": self.enable_context_manager,
            "enable_prompt_caching": self.enable_prompt_caching,
            "agent_config": dict(self.agent_config or {}),
            "tool_context": dict(self.tool_context),
            "policy_context": dict(self.policy_context),
            "budget_context": dict(self.budget_context),
            "prompt_context": dict(self.prompt_context),
            "diagnostics": list(self.diagnostics),
            "continuity_state": self.continuity_state.to_dict() if self.continuity_state else None,
            "checkpoint_id": self.checkpoint_id,
            "resume_token": self.resume_token,
        }


@dataclass(slots=True, frozen=True)
class AgentEventV2:
    event_id: str
    event_type: str
    run_id: str
    thread_id: str
    lane: LaneNameV2
    sequence: int
    timestamp: str
    payload: dict[str, Any] = field(default_factory=dict)
    user_visible: bool = False
    persistence_hint: dict[str, Any] = field(default_factory=dict)
    analytics_hint: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "event_type": self.event_type,
            "run_id": self.run_id,
            "thread_id": self.thread_id,
            "lane": self.lane,
            "sequence": self.sequence,
            "timestamp": self.timestamp,
            "payload": dict(self.payload),
            "user_visible": self.user_visible,
            "persistence_hint": dict(self.persistence_hint),
            "analytics_hint": dict(self.analytics_hint),
            "metadata": dict(self.metadata),
        }

    def get(self, key: str, default: Any = None) -> Any:
        aliases = {
            "type": "event_type",
            "agent_run_id": "run_id",
        }
        return self.to_dict().get(aliases.get(key, key), default)

    def __getitem__(self, key: str) -> Any:
        value = self.get(key)
        if value is None and key not in self.to_dict():
            raise KeyError(key)
        return value
