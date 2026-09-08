from __future__ import annotations

from dataclasses import dataclass

from ..contracts import RiskLevelV2
from ..semantics import is_confirmation_message
from .contracts import CanvasMutationBatchV2, CanvasPlanV2, CanvasPreviewIRV2


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


@dataclass(slots=True)
class CanvasRiskPolicyV2:
    def classify(self, *, plan: CanvasPlanV2, batch: CanvasMutationBatchV2) -> RiskLevelV2:
        op_names = {str(op.get("op") or "") for op in batch.operations}
        transforms = [str(transform.get("kind") or "") for transform in plan.task.get("transforms") or []]
        layout_strategy = str((plan.task.get("layout") or {}).get("strategy") or "preserve")
        operation_count = len(batch.operations)

        if (
            "delete_node" in op_names
            or "delete_connection" in op_names
            or "merge_selection_into_node" in transforms
            or operation_count >= 25
        ):
            return "high"

        if (
            layout_strategy != "preserve"
            or "add_connection" in op_names
            or any(kind in {"split_node_into_children", "create_summary_hub", "retitle_selection"} for kind in transforms)
            or operation_count >= 5
        ):
            return "medium"

        return "low"

    @staticmethod
    def requires_preview(risk_level: RiskLevelV2) -> bool:
        return risk_level in {"medium", "high"}

    @staticmethod
    def is_confirmation_message(latest_user_text: str) -> bool:
        return is_confirmation_message(latest_user_text)

    def build_preview_message(self, *, preview: CanvasPreviewIRV2) -> str:
        add_nodes = int(preview.operation_summary.get("add_node", 0))
        update_nodes = int(preview.operation_summary.get("update_node", 0))
        move_nodes = int(preview.operation_summary.get("move_node", 0))
        delete_nodes = int(preview.operation_summary.get("delete_node", 0))
        add_connections = int(preview.operation_summary.get("add_connection", 0))

        if _contains_cjk(preview.user_goal):
            return (
                f"我已经整理好这次画布改动方案，风险等级为 {preview.risk_level}。"
                f"预计会新增 {add_nodes} 个节点、更新 {update_nodes} 个节点、移动 {move_nodes} 个节点、"
                f"删除 {delete_nodes} 个节点，并创建 {add_connections} 条连接。"
                f"确认后我会基于当前画布版本 {preview.expected_canvas_version} 执行并验证。"
                "回复“确认”即可继续。"
            )

        return (
            f"I prepared the canvas plan at {preview.risk_level} risk. "
            f"It will add {add_nodes} nodes, update {update_nodes}, move {move_nodes}, "
            f"delete {delete_nodes}, and create {add_connections} connections. "
            f"I will apply it against canvas version {preview.expected_canvas_version} and verify the result. "
            "Reply with 'confirm' to continue."
        )
