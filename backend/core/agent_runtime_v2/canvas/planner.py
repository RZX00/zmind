from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from core.application.services.canvas_native_context_resolver_service import (
    CanvasNativeContextResolverService,
)
from core.application.services.canvas_native_planner_service import CanvasNativePlannerService

from ..contracts import RuntimeContextV2
from .contracts import CanvasIntentIRV2, CanvasPlanV2


@dataclass(slots=True)
class CanvasPlannerV2:
    context_resolver: CanvasNativeContextResolverService
    planner_service: CanvasNativePlannerService

    def __init__(
        self,
        context_resolver: CanvasNativeContextResolverService | None = None,
        planner_service: CanvasNativePlannerService | None = None,
    ) -> None:
        self.context_resolver = context_resolver or CanvasNativeContextResolverService()
        self.planner_service = planner_service or CanvasNativePlannerService()

    async def plan(
        self,
        *,
        context: RuntimeContextV2,
        intent_ir: CanvasIntentIRV2,
        runtime_policy: dict[str, Any],
        intent_payload: dict[str, Any],
    ) -> CanvasPlanV2:
        state = {
            "agent_run_id": context.identity.run_id,
            "thread_id": context.identity.thread_id,
            "messages_context": [{"role": "user", "content": context.latest_user_text}],
            "intent": dict(intent_payload),
            "canvas_runtime": dict(runtime_policy),
            "repair_count": 0,
        }
        canvas_context = await self.context_resolver.resolve(state, context.to_tool_context())
        task_ir = self.planner_service.plan(state=state, context=canvas_context)
        task_payload = task_ir.to_dict()
        planning_summary = {
            "focus_scope": canvas_context.get("focus_scope"),
            "focus_node_count": len(canvas_context.get("focus_node_ids") or []),
            "planned_entities": len(task_payload.get("entities") or []),
            "planned_connections": len(task_payload.get("connections") or []),
            "planned_transforms": len(task_payload.get("transforms") or []),
            "layout_strategy": (task_payload.get("layout") or {}).get("strategy"),
            "estimated_operation_count": (task_payload.get("metadata") or {}).get("estimated_operation_count"),
        }
        preview = {
            "title": "canvas_plan_preview",
            "planning_summary": planning_summary,
            "target_canvas_id": intent_ir.target_canvas_id,
        }
        return CanvasPlanV2(
            intent=intent_ir,
            task=task_payload,
            canvas_context=canvas_context,
            runtime_policy=dict(runtime_policy),
            plan_id=f"{context.identity.run_id}:canvas:{task_payload.get('intent_id') or 'plan'}",
            planning_summary=planning_summary,
            preview=preview,
            compiler_hints={
                "repair_attempt_limit": runtime_policy.get("repair_attempt_limit"),
                "layout_budget_ms": runtime_policy.get("layout_budget_ms"),
            },
        )
