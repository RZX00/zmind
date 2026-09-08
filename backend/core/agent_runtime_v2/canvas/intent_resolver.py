from __future__ import annotations

from dataclasses import dataclass

from core.application.services.canvas_native_runtime_policy_service import (
    CanvasNativeRuntimePolicyService,
)
from core.utils.config import config

from ..contracts import RuntimeContextV2
from .contracts import CanvasIntentIRV2


def _infer_operation_class(text: str) -> str:
    lowered = str(text or "").lower()
    if any(token in lowered for token in ("merge", "合并", "delete", "删除", "remove")):
        return "rewrite"
    if any(token in lowered for token in ("split", "拆分", "summarize", "总结", "summary", "retitle", "rename", "重命名")):
        return "rewrite"
    if any(token in lowered for token in ("layout", "arrange", "organize", "整理", "排版", "布局")):
        return "layout"
    if any(token in lowered for token in ("connect", "link", "relationship", "连接", "连线")):
        return "connection"
    if any(token in lowered for token in ("create", "add", "新增", "创建", "插入")):
        return "create"
    return "edit"


@dataclass(slots=True)
class CanvasIntentResolutionResultV2:
    intent: CanvasIntentIRV2
    runtime_policy: dict


class CanvasIntentResolverV2:
    def __init__(self, runtime_policy_service: CanvasNativeRuntimePolicyService | None = None) -> None:
        self._runtime_policy_service = runtime_policy_service or CanvasNativeRuntimePolicyService(config)

    def resolve(self, *, context: RuntimeContextV2, intent_payload: dict) -> CanvasIntentResolutionResultV2:
        runtime_policy = self._runtime_policy_service.evaluate(
            intent=intent_payload,
            tool_context=context.to_tool_context(),
        )
        target_canvas_id = (
            context.workspace_target.canvas_id
            or context.selection_context.canvas_id
            or runtime_policy.get("canvas_id")
        )
        intent = CanvasIntentIRV2(
            user_goal=context.latest_user_text,
            target_canvas_id=target_canvas_id,
            selection_scope=context.selection_context.scope,
            operation_class=_infer_operation_class(context.latest_user_text),
            risk_level="low",
            verification_contract={
                "verify_enabled": bool(runtime_policy.get("verify_enabled", True)),
                "selection_scope": context.selection_context.scope,
            },
            planning_hints={
                "focus_node_ids": list(context.selection_context.node_ids),
                "focus_connection_ids": list(context.selection_context.connection_ids),
                "target_canvas_source": runtime_policy.get("reason"),
            },
        )
        return CanvasIntentResolutionResultV2(intent=intent, runtime_policy=runtime_policy)
