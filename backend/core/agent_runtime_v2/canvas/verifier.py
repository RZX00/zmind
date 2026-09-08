from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from core.application.services.canvas_native_context_resolver_service import (
    CanvasNativeContextResolverService,
)
from core.application.services.canvas_native_verifier_service import CanvasNativeVerifierService
from core.domains.agent.verification import VerificationIssue, VerificationReport

from ..contracts import RuntimeContextV2
from .contracts import CanvasMutationBatchV2, CanvasPlanV2


@dataclass(slots=True)
class CanvasVerifierV2:
    verifier_service: CanvasNativeVerifierService
    context_resolver: CanvasNativeContextResolverService

    def __init__(
        self,
        verifier_service: CanvasNativeVerifierService | None = None,
        context_resolver: CanvasNativeContextResolverService | None = None,
    ) -> None:
        self.verifier_service = verifier_service or CanvasNativeVerifierService()
        self.context_resolver = context_resolver or CanvasNativeContextResolverService()

    def requires_full_verify(self, *, batch: CanvasMutationBatchV2) -> bool:
        if len(batch.operations) > 1:
            return True
        op_names = {str(operation.get("op") or "") for operation in batch.operations}
        return bool(
            op_names.intersection(
                {
                    "delete_node",
                    "delete_connection",
                    "add_connection",
                    "move_node",
                }
            )
        )

    @staticmethod
    def _with_evidence(
        verification: dict[str, Any],
        *,
        level: str,
        evidence: dict[str, Any],
    ) -> dict[str, Any]:
        merged = dict(verification)
        metadata = dict(merged.get("metadata") or {})
        metadata["verification_level"] = level
        merged["metadata"] = metadata
        merged["verification_level"] = level
        merged["evidence"] = evidence
        return merged

    async def lightweight_verify(
        self,
        *,
        context: RuntimeContextV2,
        batch: CanvasMutationBatchV2,
        execution: dict[str, Any],
    ) -> dict[str, Any]:
        if execution.get("status") == "failed":
            error = execution.get("error") or {}
            return self._with_evidence(
                VerificationReport.failed_report(
                "lightweight_execution_failed",
                issues=(
                    VerificationIssue(
                        code=str(error.get("code") or "execution_failed"),
                        message=str(error.get("message") or error.get("detail") or "Canvas execution failed."),
                        severity="error",
                        component="canvas_execution_core_v2",
                    ),
                ),
                metadata={
                    "retryable": bool(execution.get("retryable")),
                    "execution": execution,
                },
                ).to_dict(),
                level="lightweight",
                evidence={"execution": execution},
            )

        snapshot_doc, snapshot_source, snapshot_warnings = await self.context_resolver.fetch_snapshot(
            canvas_id=batch.canvas_id,
            workspace_id=context.workspace_target.workspace_id or context.identity.account_id,
        )
        if not isinstance(snapshot_doc, dict):
            return self._with_evidence(
                VerificationReport.failed_report(
                "lightweight_snapshot_unavailable",
                issues=(
                    VerificationIssue(
                        code="snapshot_unavailable",
                        message="Canvas snapshot was unavailable during lightweight verification.",
                        severity="error",
                        component="canvas_execution_core_v2",
                    ),
                ),
                metadata={
                    "snapshot_source": snapshot_source,
                    "snapshot_warnings": snapshot_warnings,
                    "retryable": True,
                },
                ).to_dict(),
                level="lightweight",
                evidence={
                    "snapshot_source": snapshot_source,
                    "snapshot_warnings": snapshot_warnings,
                },
            )

        issues: list[VerificationIssue] = []
        node_ids = {
            str(node.get("id"))
            for node in (snapshot_doc.get("nodes") or [])
            if isinstance(node, dict) and node.get("id")
        }
        server_version = snapshot_doc.get("serverVersion")
        if batch.expected_version is not None:
            try:
                if int(server_version) <= int(batch.expected_version):
                    issues.append(
                        VerificationIssue(
                            code="server_version_not_advanced",
                            message="Canvas server version did not advance after execution.",
                            severity="error",
                            component="canvas_execution_core_v2",
                            metadata={
                                "expected_version": batch.expected_version,
                                "actual_version": server_version,
                            },
                        )
                    )
            except Exception:
                issues.append(
                    VerificationIssue(
                        code="server_version_missing",
                        message="Canvas server version was unavailable after execution.",
                        severity="error",
                        component="canvas_execution_core_v2",
                    )
                )

        for operation in batch.operations:
            op_name = str(operation.get("op") or "")
            if op_name == "add_node":
                node = operation.get("node") if isinstance(operation.get("node"), dict) else {}
                node_id = str(node.get("id") or "")
                if node_id and node_id not in node_ids:
                    issues.append(
                        VerificationIssue(
                            code="created_node_missing",
                            message=f"Created node not found after execution: {node_id}",
                            severity="error",
                            component="canvas_execution_core_v2",
                        )
                    )

        if issues:
            return self._with_evidence(
                VerificationReport.failed_report(
                "lightweight_verification_failed",
                issues=tuple(issues),
                metadata={
                    "snapshot_source": snapshot_source,
                    "snapshot_warnings": snapshot_warnings,
                    "retryable": True,
                },
                ).to_dict(),
                level="lightweight",
                evidence={
                    "snapshot_source": snapshot_source,
                    "snapshot_warnings": snapshot_warnings,
                    "server_version": server_version,
                },
            )

        return self._with_evidence(
            VerificationReport.passed_report(
                "lightweight_verification_passed",
                metadata={
                    "snapshot_source": snapshot_source,
                    "server_version": server_version,
                },
            ).to_dict(),
            level="lightweight",
            evidence={
                "snapshot_source": snapshot_source,
                "snapshot_warnings": snapshot_warnings,
                "server_version": server_version,
            },
        )

    async def full_verify(
        self,
        *,
        context: RuntimeContextV2,
        plan: CanvasPlanV2,
        execution: dict[str, Any],
    ) -> dict[str, Any]:
        state = {
            "agent_run_id": context.identity.run_id,
            "thread_id": context.identity.thread_id,
            "canvas_execution": execution,
            "canvas_task": plan.task,
            "canvas_context": plan.canvas_context,
            "canvas_runtime": plan.runtime_policy,
        }
        verification = await self.verifier_service.verify(
            state=state,
            tool_context=context.to_tool_context(),
        )
        return self._with_evidence(
            verification,
            level="full",
            evidence={
                "plan_id": plan.plan_id,
                "verification_contract": dict(plan.intent.verification_contract or {}),
                "canvas_context": {
                    "canvas_id": plan.canvas_context.get("canvas_id"),
                    "workspace_id": plan.canvas_context.get("workspace_id"),
                },
            },
        )
