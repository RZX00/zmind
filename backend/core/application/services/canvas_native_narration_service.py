from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from core.services import metrics


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _contains_cjk(text: str) -> bool:
    for ch in str(text or ""):
        code = ord(ch)
        if (
            0x3400 <= code <= 0x4DBF
            or 0x4E00 <= code <= 0x9FFF
            or 0x20000 <= code <= 0x2A6DF
            or 0x2A700 <= code <= 0x2B73F
            or 0x2B740 <= code <= 0x2B81F
            or 0x2B820 <= code <= 0x2CEAF
            or 0xF900 <= code <= 0xFAFF
        ):
            return True
    return False


class CanvasNativeNarrationService:
    def build(self, *, state: dict[str, Any]) -> dict[str, Any]:
        intent = state.get("intent") or {}
        runtime = state.get("canvas_runtime") or {}
        execution = state.get("canvas_execution") or {}
        verification = state.get("canvas_verification") or {}
        degraded_state = list(state.get("degraded_state") or [])

        user_goal = str(intent.get("user_goal") or "")
        is_cjk = _contains_cjk(user_goal)

        operations = list(execution.get("operations") or [])
        add_nodes = sum(1 for op in operations if op.get("op") == "add_node")
        move_nodes = sum(1 for op in operations if op.get("op") == "move_node")
        update_nodes = sum(1 for op in operations if op.get("op") == "update_node")
        delete_nodes = sum(1 for op in operations if op.get("op") == "delete_node")
        add_connections = sum(1 for op in operations if op.get("op") == "add_connection")
        transform_metadata = execution.get("transform_metadata") or {}
        split_count = len(transform_metadata.get("split_nodes") or [])
        merged_count = len(transform_metadata.get("merged_nodes") or [])

        passed = bool(verification.get("passed"))
        shadow = bool(runtime.get("shadow"))
        execution_status = str(execution.get("status") or "unknown")
        summary = str(verification.get("summary") or execution_status)

        if passed:
            if is_cjk:
                content = (
                    "Canvas Native Runtime 已完成。"
                    f"新增节点 {add_nodes} 个，更新节点 {update_nodes} 个，移动节点 {move_nodes} 个，删除节点 {delete_nodes} 个，新增连线 {add_connections} 条。"
                )
                if split_count:
                    content += f" 已执行 {split_count} 个拆分变换。"
                if merged_count:
                    content += f" 已执行 {merged_count} 个合并变换。"
                if shadow:
                    content += " 当前为 shadow 模式，结果仅用于比对，没有实际写入。"
            else:
                content = (
                    "Canvas native runtime completed. "
                    f"Added {add_nodes} nodes, updated {update_nodes} nodes, moved {move_nodes} nodes, deleted {delete_nodes} nodes, and created {add_connections} connections."
                )
                if split_count:
                    content += f" Executed {split_count} split transforms."
                if merged_count:
                    content += f" Executed {merged_count} merge transforms."
                if shadow:
                    content += " Shadow mode is enabled, so no real canvas write was applied."
            termination = {"should_terminate": True, "reason": "native_path_completed"}
            metrics.incr("canvas_native.narrate.success", 1, mode="shadow" if shadow else "apply")
        else:
            if is_cjk:
                content = (
                    "Canvas Native Runtime 未完全通过验收。"
                    f"当前执行状态={execution_status}，验证结果={summary}。"
                    " 系统已经停止自动重试，请检查当前画布结果。"
                )
                if degraded_state:
                    content += f" 当前记录了 {len(degraded_state)} 个降级/异常信号。"
            else:
                content = (
                    "Canvas native runtime did not pass verification. "
                    f"Execution={execution_status}, verification={summary}. "
                    "Automatic repair is exhausted; please review the current canvas state."
                )
                if degraded_state:
                    content += f" {len(degraded_state)} degraded signals were recorded."
            termination = {
                "should_terminate": True,
                "reason": "error",
                "message": "native_verification_failed",
            }
            metrics.incr("canvas_native.narrate.failure", 1, mode="shadow" if shadow else "apply")

        return {
            "event": {
                "type": "assistant_final",
                "timestamp": _now_iso(),
                "agent_run_id": state["agent_run_id"],
                "thread_id": state["thread_id"],
                "message_id": f"native-summary-{state['agent_run_id']}",
                "content": {"role": "assistant", "content": content, "tool_calls": None},
                "metadata": {
                    "engine": "langgraph",
                    "native_canvas": True,
                    "shadow": shadow,
                    "execution_status": execution_status,
                    "verification_passed": passed,
                    "verification_summary": summary,
                },
            },
            "termination": termination,
        }
