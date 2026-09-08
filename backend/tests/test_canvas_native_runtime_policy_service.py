from types import SimpleNamespace

from core.application.services.canvas_native_runtime_policy_service import (
    CanvasNativeRuntimePolicyService,
)


def test_canvas_native_policy_enables_native_route_for_canvas_requests() -> None:
    service = CanvasNativeRuntimePolicyService(
        SimpleNamespace(
            CANVAS_NATIVE_RUNTIME_ENABLED=True,
            CANVAS_NATIVE_RUNTIME_SHADOW=False,
            CANVAS_NATIVE_VERIFY_ENABLED=True,
            CANVAS_NATIVE_MAX_REPAIR_ATTEMPTS=2,
            CANVAS_NATIVE_BEST_PATH_ENABLED=True,
            CANVAS_NATIVE_PLAN_BUDGET_MS=18,
            CANVAS_NATIVE_LAYOUT_BUDGET_MS=22,
            CANVAS_NATIVE_LAYOUT_COLLISION_PASS_LIMIT=3,
        )
    )

    result = service.evaluate(
        intent={"domain": "canvas", "target_surface": "canvas"},
        tool_context={"interaction_surface": "canvas", "canvas_id": "canvas_1", "account_id": "acct_1"},
    )

    assert result["eligible"] is True
    assert result["route"] == "native"
    assert result["verify_enabled"] is True
    assert result["repair_attempt_limit"] == 2
    assert result["best_path_enabled"] is True
    assert result["plan_budget_ms"] == 18
    assert result["layout_budget_ms"] == 22
    assert result["layout_collision_pass_limit"] == 3


def test_canvas_native_policy_falls_back_when_canvas_context_missing() -> None:
    service = CanvasNativeRuntimePolicyService(
        SimpleNamespace(
            CANVAS_NATIVE_RUNTIME_ENABLED=True,
            CANVAS_NATIVE_RUNTIME_SHADOW=False,
            CANVAS_NATIVE_VERIFY_ENABLED=False,
            CANVAS_NATIVE_MAX_REPAIR_ATTEMPTS=1,
            CANVAS_NATIVE_BEST_PATH_ENABLED=True,
            CANVAS_NATIVE_PLAN_BUDGET_MS=20,
            CANVAS_NATIVE_LAYOUT_BUDGET_MS=24,
            CANVAS_NATIVE_LAYOUT_COLLISION_PASS_LIMIT=2,
        )
    )

    result = service.evaluate(
        intent={"domain": "canvas", "target_surface": "canvas"},
        tool_context={"interaction_surface": "canvas", "account_id": "acct_1"},
    )

    assert result["eligible"] is False
    assert result["route"] == "classic"
    assert result["reason"] == "missing_canvas_id"
