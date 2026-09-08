from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from core.application.services.canvas_native_context_resolver_service import (
    CanvasNativeContextResolverService,
)
from core.application.services.canvas_native_executor_service import CanvasNativeExecutorService
from core.canvas.ops_normalization import normalize_ops, compute_idempotency_key

from .contracts import CanvasMutationBatchV2, CanvasPlanV2


@dataclass(slots=True)
class CanvasMutationCompilerV2:
    executor_service: CanvasNativeExecutorService
    context_resolver: CanvasNativeContextResolverService

    def __init__(
        self,
        executor_service: CanvasNativeExecutorService | None = None,
        context_resolver: CanvasNativeContextResolverService | None = None,
    ) -> None:
        self.executor_service = executor_service or CanvasNativeExecutorService()
        self.context_resolver = context_resolver or CanvasNativeContextResolverService()

    async def compile(self, *, plan: CanvasPlanV2) -> CanvasMutationBatchV2:
        snapshot_doc, _snapshot_source, snapshot_warnings = await self.context_resolver.fetch_snapshot(
            canvas_id=plan.canvas_context.get("canvas_id"),
            workspace_id=plan.canvas_context.get("workspace_id"),
        )
        operations, expected_positions, layout_metadata = self.executor_service.compile_mutation_batch(
            task=plan.task,
            context=plan.canvas_context,
            snapshot_doc=snapshot_doc,
            runtime=plan.runtime_policy,
        )
        normalized_ops, norm_warnings = normalize_ops(operations)
        operation_summary: dict[str, Any] = {"operation_count": len(normalized_ops)}
        for operation in normalized_ops:
            op_name = str(operation.get("op") or "unknown")
            operation_summary[op_name] = int(operation_summary.get(op_name) or 0) + 1
        operation_summary["warnings"] = list(snapshot_warnings) + list(norm_warnings)
        expected_version = (plan.task.get("execution") or {}).get("expected_canvas_version")
        try:
            expected_version = int(expected_version) if expected_version is not None else None
        except Exception:
            expected_version = None
        return CanvasMutationBatchV2(
            canvas_id=plan.canvas_context.get("canvas_id"),
            expected_version=expected_version,
            idempotency_key=(
                str((plan.task.get("execution") or {}).get("idempotency_key"))
                if (plan.task.get("execution") or {}).get("idempotency_key")
                else compute_idempotency_key(
                    plan.canvas_context.get("canvas_id"), normalized_ops, expected_version, prefix="canvas_v2"
                )
            ),
            operations=normalized_ops,
            expected_positions=expected_positions,
            layout_metadata=layout_metadata,
            operation_summary=operation_summary,
            verification_contract=dict((plan.task.get("verification") or {})),
            risk_level=plan.intent.risk_level,
        )
