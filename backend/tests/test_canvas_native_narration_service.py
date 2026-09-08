from core.application.services.canvas_native_narration_service import (
    CanvasNativeNarrationService,
)


def test_narration_service_reports_success_for_cjk_users() -> None:
    service = CanvasNativeNarrationService()

    payload = service.build(
        state={
            "agent_run_id": "ar_narr_1",
            "thread_id": "th_narr_1",
            "intent": {"user_goal": "请整理画布"},
            "canvas_runtime": {"shadow": False},
            "canvas_execution": {
                "status": "applied",
                "operations": [
                    {"op": "add_node"},
                    {"op": "update_node"},
                    {"op": "move_node"},
                    {"op": "delete_node"},
                    {"op": "add_connection"},
                ],
                "transform_metadata": {
                    "split_nodes": [{"parent_node_id": "root_1"}],
                    "merged_nodes": [{"merged_node_id": "merged_1"}],
                },
            },
            "canvas_verification": {"passed": True, "summary": "verification_passed"},
            "degraded_state": [],
        }
    )

    assert payload["termination"]["reason"] == "native_path_completed"
    assert "Canvas Native Runtime 已完成" in payload["event"]["content"]["content"]
    assert "拆分变换" in payload["event"]["content"]["content"]
    assert "合并变换" in payload["event"]["content"]["content"]


def test_narration_service_reports_failure_as_error() -> None:
    service = CanvasNativeNarrationService()

    payload = service.build(
        state={
            "agent_run_id": "ar_narr_2",
            "thread_id": "th_narr_2",
            "intent": {"user_goal": "please organize the canvas"},
            "canvas_runtime": {"shadow": False},
            "canvas_execution": {"status": "failed", "operations": []},
            "canvas_verification": {"passed": False, "summary": "verification_failed"},
            "degraded_state": [{"code": "x"}],
        }
    )

    assert payload["termination"]["reason"] == "error"
    assert payload["termination"]["message"] == "native_verification_failed"
