from datetime import timedelta

from core.langgraph_engine.shadow.comparator import ComparisonReport, FirstDiff, RunStreamStats
from core.langgraph_engine.shadow.rollback_policy import RollbackPolicy, RollbackThresholds


def _stats(agent_run_id: str, *, tool_error: int = 0, schema_reject: int = 0, tool_not_found: int = 0) -> RunStreamStats:
    return RunStreamStats(
        agent_run_id=agent_run_id,
        terminal_status="completed",
        duration_ms=1000,
        tool_calls=(),
        error_counts={
            "schema_reject": schema_reject,
            "tool_not_found": tool_not_found,
            "tool_error": tool_error,
            "other_error": 0,
        },
        total_tokens=None,
        assistant_final_text="ok",
        assistant_final_message_id="msg",
        protocol_violations=(),
    )


def _report(
    *,
    engine_version: str = "v1",
    tool_calls_shadow: int = 100,
    tool_calls_primary: int = 100,
    duration_ms_shadow: int = 1000,
    duration_ms_primary: int = 1000,
    primary_errors: dict | None = None,
    shadow_errors: dict | None = None,
    first_diff: FirstDiff | None = None,
) -> ComparisonReport:
    p = _stats("primary", **(primary_errors or {}))
    s = _stats("shadow", **(shadow_errors or {}))
    return ComparisonReport(
        primary_agent_run_id="primary",
        shadow_agent_run_id="shadow",
        engine_version=engine_version,
        created_at="2025-01-01T00:00:00Z",
        is_match=False,
        first_diff=first_diff,
        primary=p,
        shadow=s,
        metrics={
            "tool_calls_shadow": tool_calls_shadow,
            "tool_calls_primary": tool_calls_primary,
            "duration_ms_shadow": duration_ms_shadow,
            "duration_ms_primary": duration_ms_primary,
        },
    )


def test_policy_disables_on_protocol_violation():
    policy = RollbackPolicy()
    report = _report(first_diff=FirstDiff(diff_type="protocol_violation", message="bad", primary=None, shadow=None))
    decision = policy.evaluate([report])
    assert decision.action == "disable_primary"
    assert decision.reason == "protocol_violation"
    assert decision.disabled_until is not None


def test_policy_disables_on_schema_reject_rate():
    thresholds = RollbackThresholds(schema_reject_rate_disable=0.005, disable_duration=timedelta(minutes=10))
    policy = RollbackPolicy(thresholds)
    report = _report(tool_calls_shadow=1, shadow_errors={"schema_reject": 1})
    decision = policy.evaluate([report])
    assert decision.action == "disable_primary"
    assert decision.reason == "schema_reject_rate"


def test_policy_disables_on_tool_not_found_rate():
    thresholds = RollbackThresholds(tool_not_found_rate_disable=0.005, disable_duration=timedelta(minutes=10))
    policy = RollbackPolicy(thresholds)
    report = _report(tool_calls_shadow=1, shadow_errors={"tool_not_found": 1})
    decision = policy.evaluate([report])
    assert decision.action == "disable_primary"
    assert decision.reason == "tool_not_found_rate"


def test_policy_freezes_on_tool_error_regression():
    thresholds = RollbackThresholds(tool_error_rate_delta_freeze=0.02)
    policy = RollbackPolicy(thresholds)
    report = _report(tool_calls_shadow=10, tool_calls_primary=10, shadow_errors={"tool_error": 3}, primary_errors={"tool_error": 0})
    decision = policy.evaluate([report])
    assert decision.action == "freeze"
    assert decision.reason == "tool_error_rate_regression"


def test_policy_freezes_on_latency_regression_p95():
    thresholds = RollbackThresholds(latency_p95_delta_freeze_ms=1500)
    policy = RollbackPolicy(thresholds)
    reports = [
        _report(duration_ms_shadow=5000, duration_ms_primary=1000),
        _report(duration_ms_shadow=5000, duration_ms_primary=1000),
    ]
    decision = policy.evaluate(reports)
    assert decision.action == "freeze"
    assert decision.reason == "latency_regression_p95"


def test_policy_allows_within_thresholds():
    policy = RollbackPolicy()
    report = _report(tool_calls_shadow=100, tool_calls_primary=100, shadow_errors={"tool_error": 1}, primary_errors={"tool_error": 1})
    decision = policy.evaluate([report])
    assert decision.action == "allow"
    assert decision.reason == "within_thresholds"

