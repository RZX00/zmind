from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Any, Dict, Literal, Optional
import hashlib
import json


AutomationTriggerType = Literal["schedule", "event"]
AutomationRouteType = Literal["agent", "workflow"]
MatchStrategy = Literal["exact", "prefix", "jsonpath"]
ProviderEventStatus = Literal["received", "dispatched", "ignored", "failed"]
AutomationRunStatus = Literal[
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
    "dead_lettered",
]
AutomationRunSource = Literal["schedule", "event", "manual"]
AutomationAttemptStatus = Literal["running", "completed", "failed"]


ALLOWED_RUN_STATUS_TRANSITIONS: Dict[str, set[str]] = {
    "queued": {"running", "cancelled", "failed"},
    "running": {"completed", "failed", "cancelled"},
    "failed": {"running", "dead_lettered", "cancelled"},
    "completed": set(),
    "cancelled": set(),
    "dead_lettered": set(),
}


@dataclass(frozen=True)
class Automation:
    id: str
    account_id: str
    agent_id: Optional[str]
    name: str
    description: Optional[str]
    trigger_type: AutomationTriggerType
    provider: Optional[str]
    provider_binding_key: Optional[str]
    route_type: AutomationRouteType
    route_ref: Optional[str]
    is_active: bool
    config: Dict[str, Any]
    created_by: Optional[str]
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class AutomationBinding:
    id: str
    automation_id: str
    account_id: str
    provider: str
    match_strategy: MatchStrategy
    match_value: Dict[str, Any]
    is_active: bool
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ProviderEvent:
    id: str
    account_id: Optional[str]
    provider: str
    external_event_id: Optional[str]
    event_type: Optional[str]
    signature_valid: bool
    dedupe_key: str
    payload: Dict[str, Any]
    headers: Dict[str, Any]
    processing_status: ProviderEventStatus
    processing_error: Optional[str]
    dispatched_at: Optional[datetime]
    received_at: datetime
    created_at: datetime


@dataclass(frozen=True)
class AutomationRun:
    id: str
    automation_id: str
    account_id: str
    provider_event_id: Optional[str]
    trigger_source: AutomationRunSource
    triggered_at: datetime
    status: AutomationRunStatus
    retry_count: int
    max_retries: int
    external_run_key: Optional[str]
    agent_run_id: Optional[str]
    error_code: Optional[str]
    error_message: Optional[str]
    metadata: Dict[str, Any]
    created_at: datetime
    updated_at: datetime

    def transition(self, next_status: AutomationRunStatus) -> "AutomationRun":
        validate_run_status_transition(self.status, next_status)
        return replace(self, status=next_status, updated_at=datetime.now(timezone.utc))


@dataclass(frozen=True)
class AutomationRunAttempt:
    id: str
    run_id: str
    attempt_no: int
    status: AutomationAttemptStatus
    started_at: datetime
    ended_at: Optional[datetime]
    error_code: Optional[str]
    error_message: Optional[str]
    metadata: Dict[str, Any]
    created_at: datetime


def can_transition_run_status(current: str, nxt: str) -> bool:
    if current == nxt:
        return True
    return nxt in ALLOWED_RUN_STATUS_TRANSITIONS.get(current, set())


def validate_run_status_transition(current: str, nxt: str) -> None:
    if not can_transition_run_status(current, nxt):
        raise ValueError(f"invalid_automation_run_transition: {current} -> {nxt}")


def make_provider_event_dedupe_key(
    *,
    provider: str,
    external_event_id: Optional[str],
    event_type: Optional[str],
    payload: Optional[Dict[str, Any]] = None,
    signature_timestamp: Optional[str] = None,
) -> str:
    base_provider = (provider or "").strip().lower()
    if not base_provider:
        raise ValueError("provider is required for dedupe key")

    normalized_event_type = (event_type or "").strip().lower()

    if external_event_id:
        source = f"{base_provider}:{external_event_id.strip()}:{normalized_event_type}"
        return hashlib.sha256(source.encode("utf-8")).hexdigest()

    fingerprint = _payload_fingerprint(payload or {})
    ts = (signature_timestamp or "").strip()
    source = f"{base_provider}:{ts}:{normalized_event_type}:{fingerprint}"
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def _payload_fingerprint(payload: Dict[str, Any]) -> str:
    try:
        normalized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except Exception:
        normalized = str(payload)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
