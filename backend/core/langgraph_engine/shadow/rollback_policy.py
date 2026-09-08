from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Literal, Mapping, Protocol, Sequence

from .comparator import ComparisonReport

RollbackAction = Literal["allow", "freeze", "disable_primary"]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _p95(values: Sequence[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    idx = int(round(0.95 * (len(ordered) - 1)))
    return float(ordered[idx])


@dataclass(frozen=True, slots=True)
class RollbackThresholds:
    """
    Default gating thresholds (v1) from Master Design Doc / WS-E.

    Notes:
    - Rates are computed against total tool calls in the sample window.
    - Latency is compared using p95 run duration (ms) in the sample window.
    """

    schema_reject_rate_disable: float = 0.005
    tool_not_found_rate_disable: float = 0.005
    tool_error_rate_delta_freeze: float = 0.02
    latency_p95_delta_freeze_ms: float = 1_500
    disable_duration: timedelta = timedelta(hours=6)


@dataclass(frozen=True, slots=True)
class RollbackDecision:
    action: RollbackAction
    reason: str
    window_reports: int
    engine_version: str | None = None
    disabled_until: str | None = None
    metrics: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["metrics"] = dict(self.metrics)
        return payload


class RoutingStateStore(Protocol):
    def set_disabled_until(self, *, disabled_until_iso: str, reason: str, engine_version: str | None) -> None: ...


class InMemoryRoutingStateStore:
    def __init__(self) -> None:
        self.disabled_until_iso: str | None = None
        self.reason: str | None = None
        self.engine_version: str | None = None

    def set_disabled_until(self, *, disabled_until_iso: str, reason: str, engine_version: str | None) -> None:
        self.disabled_until_iso = disabled_until_iso
        self.reason = reason
        self.engine_version = engine_version


class RollbackPolicy:
    def __init__(self, thresholds: RollbackThresholds | None = None) -> None:
        self.thresholds = thresholds or RollbackThresholds()

    def evaluate(self, reports: Sequence[ComparisonReport]) -> RollbackDecision:
        if not reports:
            return RollbackDecision(action="allow", reason="no_reports", window_reports=0)

        engine_version = reports[-1].engine_version

        if any(r.first_diff and r.first_diff.diff_type == "protocol_violation" for r in reports if r.first_diff):
            disabled_until = (_utc_now() + self.thresholds.disable_duration).isoformat()
            return RollbackDecision(
                action="disable_primary",
                reason="protocol_violation",
                window_reports=len(reports),
                engine_version=engine_version,
                disabled_until=disabled_until,
            )

        tool_calls_shadow = 0
        tool_calls_primary = 0
        schema_reject_shadow = 0
        tool_not_found_shadow = 0
        tool_error_shadow = 0
        tool_error_primary = 0

        durations_shadow_ms: list[float] = []
        durations_primary_ms: list[float] = []

        for report in reports:
            tool_calls_shadow += int(report.metrics.get("tool_calls_shadow") or 0)
            tool_calls_primary += int(report.metrics.get("tool_calls_primary") or 0)
            schema_reject_shadow += int(report.shadow.error_counts.get("schema_reject", 0))
            tool_not_found_shadow += int(report.shadow.error_counts.get("tool_not_found", 0))
            tool_error_shadow += int(report.shadow.error_counts.get("tool_error", 0))
            tool_error_primary += int(report.primary.error_counts.get("tool_error", 0))

            dsm = report.metrics.get("duration_ms_shadow")
            dpm = report.metrics.get("duration_ms_primary")
            if isinstance(dsm, (int, float)):
                durations_shadow_ms.append(float(dsm))
            if isinstance(dpm, (int, float)):
                durations_primary_ms.append(float(dpm))

        denom_shadow = max(1, tool_calls_shadow)
        denom_primary = max(1, tool_calls_primary)

        schema_reject_rate_shadow = schema_reject_shadow / denom_shadow
        tool_not_found_rate_shadow = tool_not_found_shadow / denom_shadow

        tool_error_rate_shadow = tool_error_shadow / denom_shadow
        tool_error_rate_primary = tool_error_primary / denom_primary
        tool_error_rate_delta = tool_error_rate_shadow - tool_error_rate_primary

        latency_p95_shadow = _p95(durations_shadow_ms)
        latency_p95_primary = _p95(durations_primary_ms)
        latency_p95_delta = None
        if latency_p95_shadow is not None and latency_p95_primary is not None:
            latency_p95_delta = latency_p95_shadow - latency_p95_primary

        metrics = {
            "tool_calls_shadow": tool_calls_shadow,
            "tool_calls_primary": tool_calls_primary,
            "schema_reject_rate_shadow": schema_reject_rate_shadow,
            "tool_not_found_rate_shadow": tool_not_found_rate_shadow,
            "tool_error_rate_shadow": tool_error_rate_shadow,
            "tool_error_rate_primary": tool_error_rate_primary,
            "tool_error_rate_delta": tool_error_rate_delta,
            "latency_p95_shadow_ms": latency_p95_shadow,
            "latency_p95_primary_ms": latency_p95_primary,
            "latency_p95_delta_ms": latency_p95_delta,
        }

        if schema_reject_rate_shadow > self.thresholds.schema_reject_rate_disable:
            disabled_until = (_utc_now() + self.thresholds.disable_duration).isoformat()
            return RollbackDecision(
                action="disable_primary",
                reason="schema_reject_rate",
                window_reports=len(reports),
                engine_version=engine_version,
                disabled_until=disabled_until,
                metrics=metrics,
            )

        if tool_not_found_rate_shadow > self.thresholds.tool_not_found_rate_disable:
            disabled_until = (_utc_now() + self.thresholds.disable_duration).isoformat()
            return RollbackDecision(
                action="disable_primary",
                reason="tool_not_found_rate",
                window_reports=len(reports),
                engine_version=engine_version,
                disabled_until=disabled_until,
                metrics=metrics,
            )

        if tool_error_rate_delta > self.thresholds.tool_error_rate_delta_freeze:
            return RollbackDecision(
                action="freeze",
                reason="tool_error_rate_regression",
                window_reports=len(reports),
                engine_version=engine_version,
                metrics=metrics,
            )

        if latency_p95_delta is not None and latency_p95_delta > self.thresholds.latency_p95_delta_freeze_ms:
            return RollbackDecision(
                action="freeze",
                reason="latency_regression_p95",
                window_reports=len(reports),
                engine_version=engine_version,
                metrics=metrics,
            )

        return RollbackDecision(
            action="allow",
            reason="within_thresholds",
            window_reports=len(reports),
            engine_version=engine_version,
            metrics=metrics,
        )

    def apply(self, store: RoutingStateStore, decision: RollbackDecision) -> None:
        if decision.action != "disable_primary" or not decision.disabled_until:
            return
        store.set_disabled_until(
            disabled_until_iso=decision.disabled_until,
            reason=decision.reason,
            engine_version=decision.engine_version,
        )


def collect_reports_by_engine_version(
    reports: Iterable[ComparisonReport], *, engine_version: str
) -> list[ComparisonReport]:
    return [r for r in reports if r.engine_version == engine_version]

