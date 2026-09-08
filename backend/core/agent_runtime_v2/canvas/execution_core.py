from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from core.application.services.canvas_native_narration_service import _contains_cjk
from core.canvas.ops_normalization import normalize_ops
from core.canvas.write_service import CanvasRealtimeError, CanvasWriteService

from ..contracts import RuntimeContextV2
from ..event_bus import CanonicalEventBusV2
from .contracts import CanvasMutationBatchV2, CanvasPlanV2, CanvasPreviewIRV2
from .intent_resolver import CanvasIntentResolverV2
from .mutation_compiler import CanvasMutationCompilerV2
from .planner import CanvasPlannerV2
from .repair import CanvasRepairEngineV2
from .risk import CanvasRiskPolicyV2
from .verifier import CanvasVerifierV2


def _stable_hash(*, plan: CanvasPlanV2, batch: CanvasMutationBatchV2) -> str:
    payload = {
        "plan": plan.to_dict(),
        "batch": batch.to_dict(),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _success_message(*, user_goal: str, batch: CanvasMutationBatchV2) -> str:
    add_nodes = int(batch.operation_summary.get("add_node") or 0)
    update_nodes = int(batch.operation_summary.get("update_node") or 0)
    move_nodes = int(batch.operation_summary.get("move_node") or 0)
    delete_nodes = int(batch.operation_summary.get("delete_node") or 0)
    add_connections = int(batch.operation_summary.get("add_connection") or 0)
    if _contains_cjk(user_goal):
        return (
            f"这次画布更新已经完成并通过验证。"
            f"新增 {add_nodes} 个节点，更新 {update_nodes} 个节点，移动 {move_nodes} 个节点，"
            f"删除 {delete_nodes} 个节点，并创建 {add_connections} 条连接。"
        )
    return (
        "The canvas update is complete and verified. "
        f"Added {add_nodes} nodes, updated {update_nodes}, moved {move_nodes}, "
        f"deleted {delete_nodes}, and created {add_connections} connections."
    )


def _failure_message(*, user_goal: str, verification: dict[str, Any]) -> str:
    summary = str(verification.get("summary") or "verification_failed")
    if _contains_cjk(user_goal):
        return f"这次画布操作我不能宣告完成，因为验证没有通过。当前结果：{summary}。"
    return f"I am not marking the canvas task complete because verification failed: {summary}."


def _extract_user_input_metadata(user_input: dict[str, Any]) -> dict[str, Any]:
    metadata = user_input.get("metadata")
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except Exception:
            metadata = {}
    return dict(metadata or {}) if isinstance(metadata, dict) else {}


def _extract_confirm_binding(user_input: dict[str, Any]) -> dict[str, str]:
    metadata = _extract_user_input_metadata(user_input)
    payload = metadata.get("cta_payload") or metadata.get("ctaPayload") or {}
    if not isinstance(payload, dict):
        payload = {}
    return {
        "confirm_token": str(payload.get("confirm_token") or payload.get("confirmToken") or "").strip(),
        "pending_plan_ref": str(payload.get("pending_plan_ref") or payload.get("pendingPlanRef") or "").strip(),
    }


@dataclass(slots=True)
class CanvasExecutionCoreV2:
    intent_resolver: CanvasIntentResolverV2
    planner: CanvasPlannerV2
    compiler: CanvasMutationCompilerV2
    verifier: CanvasVerifierV2
    repair_engine: CanvasRepairEngineV2
    create_write_service: type[CanvasWriteService]
    risk_policy: CanvasRiskPolicyV2

    def __init__(
        self,
        *,
        intent_resolver: CanvasIntentResolverV2 | None = None,
        planner: CanvasPlannerV2 | None = None,
        compiler: CanvasMutationCompilerV2 | None = None,
        verifier: CanvasVerifierV2 | None = None,
        repair_engine: CanvasRepairEngineV2 | None = None,
        create_write_service: type[CanvasWriteService] = CanvasWriteService,
    ) -> None:
        self.intent_resolver = intent_resolver or CanvasIntentResolverV2()
        self.planner = planner or CanvasPlannerV2()
        self.compiler = compiler or CanvasMutationCompilerV2()
        self.verifier = verifier or CanvasVerifierV2()
        self.repair_engine = repair_engine or CanvasRepairEngineV2()
        self.create_write_service = create_write_service
        self.risk_policy = CanvasRiskPolicyV2()

    async def execute(
        self,
        *,
        context: RuntimeContextV2,
        bus: CanonicalEventBusV2,
        intent_payload: dict[str, Any],
    ) -> list:
        events: list = []
        continuity = context.continuity_state
        if continuity is not None:
            continuity.active_lane = "canvas"
            continuity.lane_state = "planning"

        pending = continuity.pending_canvas_plan if continuity else None
        explicit_confirm = context.response_mode == "confirm" or self.risk_policy.is_confirmation_message(context.latest_user_text)
        confirm_binding = _extract_confirm_binding(context.user_input)

        if pending and explicit_confirm:
            plan, batch, preview = self._restore_pending_state(pending)
            if self._confirm_binding_mismatch(binding=confirm_binding, preview=preview):
                if continuity is not None:
                    continuity.decision_trace.append(
                        {
                            "component": "canvas_execution_core_v2",
                            "decision": "preview_invalidated",
                            "reason": "confirm_binding_mismatch",
                            "requested_confirm_token": confirm_binding.get("confirm_token"),
                            "requested_pending_plan_ref": confirm_binding.get("pending_plan_ref"),
                            "active_confirm_token": preview.confirm_token,
                            "active_pending_plan_ref": preview.pending_plan_ref,
                        }
                    )
                events.append(
                    bus.build(
                        "preview.invalidated",
                        payload={
                            "reason": "confirm_binding_mismatch",
                            "requested_confirm_token": confirm_binding.get("confirm_token"),
                            "requested_pending_plan_ref": confirm_binding.get("pending_plan_ref"),
                            "active_confirm_token": preview.confirm_token,
                            "active_pending_plan_ref": preview.pending_plan_ref,
                            "plan_id": plan.plan_id,
                        },
                    )
                )
                events.extend(self._preview_events(bus=bus, context=context, preview=preview))
                return events
            preflight = await self._check_pending_preview_valid(context=context, batch=batch)
            if not preflight.get("valid", True):
                if continuity is not None:
                    continuity.decision_trace.append(
                        {
                            "component": "canvas_execution_core_v2",
                            "decision": "preview_invalidated",
                            "reason": preflight.get("reason"),
                            "expected_version": batch.expected_version,
                            "current_version": preflight.get("current_version"),
                        }
                    )
                events.append(
                    bus.build(
                        "preview.invalidated",
                        payload={
                            "reason": preflight.get("reason"),
                            "expected_version": batch.expected_version,
                            "current_version": preflight.get("current_version"),
                            "plan_id": plan.plan_id,
                        },
                    )
                )
                self._clear_pending_preview(context)
                refreshed = await self._plan_batch_preview(
                    context=context,
                    intent_payload=intent_payload,
                )
                plan = refreshed["plan"]
                batch = refreshed["batch"]
                preview = refreshed["preview"]
                events.append(
                    bus.build(
                        "plan.created",
                        payload=self._plan_event_payload(plan=plan, preview=preview),
                    )
                )
                self._store_pending_preview(context=context, plan=plan, batch=batch, preview=preview)
                events.extend(self._preview_events(bus=bus, context=context, preview=preview))
                return events

            events.append(
                bus.build(
                    "preview.confirmed",
                    payload={
                        "risk_level": batch.risk_level,
                        "confirm_token": preview.confirm_token,
                        "plan_id": plan.plan_id,
                    },
                )
            )
            self._clear_pending_preview(context)
        else:
            planned = await self._plan_batch_preview(
                context=context,
                intent_payload=intent_payload,
            )
            plan = planned["plan"]
            batch = planned["batch"]
            preview = planned["preview"]
            events.append(
                bus.build(
                    "plan.created",
                    payload=self._plan_event_payload(plan=plan, preview=preview),
                )
            )

            force_preview = context.response_mode == "preview"
            force_apply = context.response_mode == "force_apply"
            if force_preview or (self.risk_policy.requires_preview(batch.risk_level) and not force_apply):
                self._store_pending_preview(context=context, plan=plan, batch=batch, preview=preview)
                events.extend(self._preview_events(bus=bus, context=context, preview=preview))
                return events

        repair_limit = max(0, int((plan.runtime_policy or {}).get("repair_attempt_limit") or 0))
        repair_count = 0
        while True:
            if continuity is not None:
                continuity.lane_state = "executing"
            events.append(
                bus.build(
                    "execution.started",
                    payload={
                        "plan_id": plan.plan_id,
                        "risk_level": batch.risk_level,
                        "operation_summary": batch.operation_summary,
                        "expected_version": batch.expected_version,
                    },
                )
            )
            execution = await self._apply_batch(context=context, batch=batch)
            if continuity is not None:
                continuity.lane_metadata["canvas"] = {
                    "plan_id": plan.plan_id,
                    "last_batch": batch.to_dict(),
                    "last_execution": dict(execution),
                }
            events.append(
                bus.build(
                    "canvas.executed",
                    payload={
                        "execution": execution,
                        "operation_summary": batch.operation_summary,
                    },
                )
            )

            if continuity is not None:
                continuity.lane_state = "verifying"
            verification = await self.verifier.lightweight_verify(
                context=context,
                batch=batch,
                execution=execution,
            )
            if verification.get("passed") and self.verifier.requires_full_verify(batch=batch):
                verification = await self.verifier.full_verify(
                    context=context,
                    plan=plan,
                    execution=execution,
                )

            if verification.get("passed"):
                if continuity is not None:
                    continuity.pending_canvas_plan = None
                    continuity.pending_preview = None
                    continuity.verifier_history.append(verification)
                    continuity.lane_state = "completed"
                events.append(bus.build("verification.passed", payload=verification))
                events.append(
                    bus.message(
                        _success_message(user_goal=plan.intent.user_goal, batch=batch),
                        metadata={"canvas_verified": True, "risk_level": batch.risk_level},
                    )
                )
                events.append(
                    bus.build(
                        "run.completed",
                        payload={"status": "completed", "verification": verification},
                        metadata={"terminal_status": "completed"},
                    )
                )
                return events

            if continuity is not None:
                continuity.verifier_history.append(verification)
            events.append(bus.build("verification.failed", payload=verification))

            retryable = bool((verification.get("metadata") or {}).get("retryable"))
            if not retryable or repair_count >= repair_limit:
                if continuity is not None:
                    continuity.pending_canvas_plan = None
                    continuity.pending_preview = None
                    continuity.lane_state = "failed"
                events.append(
                    bus.message(
                        _failure_message(user_goal=plan.intent.user_goal, verification=verification),
                        metadata={"canvas_verified": False, "risk_level": batch.risk_level},
                    )
                )
                events.append(
                    bus.build(
                        "run.failed",
                        payload={"status": "failed", "verification": verification},
                        metadata={"terminal_status": "failed"},
                    )
                )
                return events

            repair_count += 1
            if continuity is not None:
                continuity.lane_state = "repairing"
            events.append(bus.build("repair.started", payload={"repair_count": repair_count, "plan_id": plan.plan_id}))
            repaired = await self.repair_engine.repair(
                state={
                    "agent_run_id": context.identity.run_id,
                    "thread_id": context.identity.thread_id,
                    "canvas_task": plan.task,
                    "canvas_context": plan.canvas_context,
                    "canvas_runtime": plan.runtime_policy,
                    "canvas_execution": execution,
                    "canvas_verification": verification,
                    "repair_count": repair_count - 1,
                },
                tool_context=context.to_tool_context(),
            )
            if continuity is not None:
                continuity.repair_history.append(
                    {
                        "repair_count": repair_count,
                        "verification": verification,
                        "execution": execution,
                    }
                )
            plan = CanvasPlanV2(
                intent=plan.intent,
                task=dict(repaired.get("canvas_task") or plan.task),
                canvas_context=dict(repaired.get("canvas_context") or plan.canvas_context),
                runtime_policy=dict(repaired.get("canvas_runtime") or plan.runtime_policy),
                plan_id=plan.plan_id,
                planning_summary=dict(plan.planning_summary),
                preview=dict(plan.preview),
                compiler_hints=dict(plan.compiler_hints),
            )
            batch = await self.compiler.compile(plan=plan)
            batch.risk_level = plan.intent.risk_level
            events.append(
                bus.build(
                    "repair.completed",
                    payload={"repair_count": repair_count, "operation_summary": batch.operation_summary, "plan_id": plan.plan_id},
                )
            )

    async def _plan_batch_preview(
        self,
        *,
        context: RuntimeContextV2,
        intent_payload: dict[str, Any],
    ) -> dict[str, Any]:
        continuity = context.continuity_state
        intent_result = self.intent_resolver.resolve(context=context, intent_payload=intent_payload)
        if continuity is not None:
            continuity.decision_trace.append(
                {
                    "component": "canvas_execution_core_v2",
                    "decision": "intent_resolved",
                    "operation_class": intent_result.intent.operation_class,
                }
            )
        plan = await self.planner.plan(
            context=context,
            intent_ir=intent_result.intent,
            runtime_policy=intent_result.runtime_policy,
            intent_payload=intent_payload,
        )
        batch = await self.compiler.compile(plan=plan)
        risk_level = self.risk_policy.classify(plan=plan, batch=batch)
        plan.intent.risk_level = risk_level
        plan.intent.verification_contract = dict(batch.verification_contract)
        batch.risk_level = risk_level
        preview = self._build_preview_ir(context=context, plan=plan, batch=batch)
        return {"plan": plan, "batch": batch, "preview": preview}

    def _restore_pending_state(self, pending: dict[str, Any]) -> tuple[CanvasPlanV2, CanvasMutationBatchV2, CanvasPreviewIRV2]:
        plan = CanvasPlanV2.from_dict(dict(pending.get("plan") or {}))
        batch = CanvasMutationBatchV2.from_dict(dict(pending.get("batch") or {}))
        preview = CanvasPreviewIRV2.from_dict(dict(pending.get("preview") or {}))
        return plan, batch, preview

    def _store_pending_preview(
        self,
        *,
        context: RuntimeContextV2,
        plan: CanvasPlanV2,
        batch: CanvasMutationBatchV2,
        preview: CanvasPreviewIRV2,
    ) -> None:
        continuity = context.continuity_state
        if continuity is None:
            return
        continuity.pending_canvas_plan = {
            "plan": plan.to_dict(),
            "batch": batch.to_dict(),
            "preview": preview.to_dict(),
            "expected_version": batch.expected_version,
            "selection_snapshot": context.selection_context.to_dict(),
            "verify_status": "pending",
            "repair_status": "not_started",
        }
        continuity.pending_preview = preview.to_dict()
        continuity.active_lane = "canvas"
        continuity.lane_state = "awaiting_confirmation"

    def _clear_pending_preview(self, context: RuntimeContextV2) -> None:
        continuity = context.continuity_state
        if continuity is None:
            return
        continuity.pending_canvas_plan = None
        continuity.pending_preview = None

    def _preview_events(self, *, bus: CanonicalEventBusV2, context: RuntimeContextV2, preview: CanvasPreviewIRV2) -> list:
        frontend_content = self._build_preview_frontend_content(context=context, preview=preview)
        return [
            bus.build(
                "preview.ready",
                payload={
                    "preview": preview.to_dict(),
                    "risk_level": preview.risk_level,
                    "operation_summary": preview.operation_summary,
                },
                user_visible=False,
            ),
            bus.build(
                "run.message",
                payload={
                    "message": {
                        "role": "assistant",
                        "content": self.risk_policy.build_preview_message(preview=preview),
                        "tool_calls": None,
                    }
                },
                user_visible=True,
                metadata={
                    "canvas_preview": True,
                    "risk_level": preview.risk_level,
                    "confirm_token": preview.confirm_token,
                    "frontend_content": frontend_content,
                },
            ),
            bus.build(
                "run.completed",
                payload={"status": "preview_ready", "risk_level": preview.risk_level, "preview_ref": preview.pending_plan_ref},
                metadata={"terminal_status": "completed", "canvas_preview": True},
            ),
        ]

    def _build_preview_frontend_content(
        self,
        *,
        context: RuntimeContextV2,
        preview: CanvasPreviewIRV2,
    ) -> dict[str, Any]:
        workspace_target = context.workspace_target.to_dict()
        if isinstance(context.selection_context.raw_payload, dict):
            selection_context = dict(context.selection_context.raw_payload)
        else:
            selection_context = {
                "canvas_id": context.selection_context.canvas_id,
                "nodes": [{"id": node_id} for node_id in context.selection_context.node_ids],
                "connections": [{"id": connection_id} for connection_id in context.selection_context.connection_ids],
            }
            if context.selection_context.anchor_box:
                selection_context["anchor_box"] = dict(context.selection_context.anchor_box)
        return {
            "canvas_preview": preview.to_dict(),
            "cta": [
                {
                    "label": "应用方案" if _contains_cjk(context.latest_user_text) else "Apply Plan",
                    "action": "canvas_preview.confirm",
                    "style": "primary",
                    "icon": "play",
                    "payload": {
                        "response_mode": "confirm",
                        "confirm_token": preview.confirm_token,
                        "pending_plan_ref": preview.pending_plan_ref,
                        "expected_canvas_version": preview.expected_canvas_version,
                        "workspace_target": workspace_target,
                        "selection_context": selection_context,
                    },
                }
            ],
            "continuity": {
                "pending_preview": True,
            },
        }

    @staticmethod
    def _confirm_binding_mismatch(*, binding: dict[str, str], preview: CanvasPreviewIRV2) -> bool:
        requested_confirm_token = binding.get("confirm_token") or ""
        requested_pending_plan_ref = binding.get("pending_plan_ref") or ""
        if requested_confirm_token and requested_confirm_token != preview.confirm_token:
            return True
        if requested_pending_plan_ref and requested_pending_plan_ref != preview.pending_plan_ref:
            return True
        return False

    def _plan_event_payload(self, *, plan: CanvasPlanV2, preview: CanvasPreviewIRV2) -> dict[str, Any]:
        return {
            "plan_id": plan.plan_id,
            "risk_level": plan.intent.risk_level,
            "planning_summary": plan.planning_summary,
            "preview": preview.to_dict(),
        }

    def _build_preview_ir(
        self,
        *,
        context: RuntimeContextV2,
        plan: CanvasPlanV2,
        batch: CanvasMutationBatchV2,
    ) -> CanvasPreviewIRV2:
        confirm_token = f"confirm_{_stable_hash(plan=plan, batch=batch)[:16]}"
        impacted_node_ids: set[str] = set(context.selection_context.node_ids)
        impacted_connection_ids: set[str] = set(context.selection_context.connection_ids)

        for operation in batch.operations:
            op_name = str(operation.get("op") or "")
            if op_name.endswith("_node"):
                node = operation.get("node") if isinstance(operation.get("node"), dict) else {}
                node_id = str(node.get("id") or operation.get("node_id") or "")
                if node_id:
                    impacted_node_ids.add(node_id)
            if "connection" in op_name:
                connection = operation.get("connection") if isinstance(operation.get("connection"), dict) else {}
                connection_id = str(connection.get("id") or operation.get("connection_id") or "")
                if connection_id:
                    impacted_connection_ids.add(connection_id)

        impacted_regions = []
        if context.selection_context.anchor_box:
            impacted_regions.append(dict(context.selection_context.anchor_box))
        elif plan.planning_summary.get("focus_scope"):
            impacted_regions.append({"scope": plan.planning_summary.get("focus_scope")})

        verification_checks = list((batch.verification_contract or {}).get("checks") or [])
        verification_level = "full" if self.verifier.requires_full_verify(batch=batch) else "lightweight"

        return CanvasPreviewIRV2(
            plan_id=plan.plan_id,
            user_goal=plan.intent.user_goal,
            target_canvas_id=plan.canvas_context.get("canvas_id"),
            selection_scope=plan.intent.selection_scope,
            impacted_node_ids=sorted(impacted_node_ids),
            impacted_connection_ids=sorted(impacted_connection_ids),
            impacted_regions=impacted_regions,
            operation_summary=dict(batch.operation_summary),
            risk_level=batch.risk_level,
            expected_canvas_version=batch.expected_version,
            verification_summary={
                "level": verification_level,
                "check_count": len(verification_checks),
                "checks": verification_checks,
            },
            confirm_token=confirm_token,
            pending_plan_ref=f"pending:{plan.plan_id}:{confirm_token}",
            planning_summary=dict(plan.planning_summary),
        )

    async def _check_pending_preview_valid(
        self,
        *,
        context: RuntimeContextV2,
        batch: CanvasMutationBatchV2,
    ) -> dict[str, Any]:
        if batch.expected_version is None or batch.canvas_id is None:
            return {"valid": True, "reason": "no_expected_version"}
        snapshot_doc, snapshot_source, snapshot_warnings = await self.verifier.context_resolver.fetch_snapshot(
            canvas_id=batch.canvas_id,
            workspace_id=context.workspace_target.workspace_id or context.identity.account_id,
        )
        if not isinstance(snapshot_doc, dict):
            return {
                "valid": True,
                "reason": "snapshot_unavailable",
                "snapshot_source": snapshot_source,
                "snapshot_warnings": snapshot_warnings,
            }
        current_version = snapshot_doc.get("serverVersion")
        try:
            resolved_current_version = int(current_version)
        except Exception:
            return {"valid": True, "reason": "server_version_missing"}
        if resolved_current_version != int(batch.expected_version):
            return {
                "valid": False,
                "reason": "version_drift",
                "current_version": resolved_current_version,
                "snapshot_source": snapshot_source,
                "snapshot_warnings": snapshot_warnings,
            }
        return {"valid": True, "reason": "version_match", "current_version": resolved_current_version}

    async def _apply_batch(self, *, context: RuntimeContextV2, batch: CanvasMutationBatchV2) -> dict[str, Any]:
        normalized_ops, norm_warnings = normalize_ops(batch.operations)
        execution = {
            "status": "pending",
            "mode": "apply",
            "operation_count": len(normalized_ops),
            "operations": normalized_ops,
            "expected_positions": batch.expected_positions,
            "expected_version": batch.expected_version,
            "warnings": list(batch.operation_summary.get("warnings") or []) + list(norm_warnings),
            "idempotency_key": batch.idempotency_key,
            "retryable": False,
            "response": None,
            "layout_metadata": batch.layout_metadata,
            "transform_metadata": (batch.layout_metadata.get("transforms") or {}) if isinstance(batch.layout_metadata, dict) else {},
            "error": None,
        }

        write_service = self.create_write_service()
        try:
            result = await write_service.apply_canvas_ops(
                canvas_id=batch.canvas_id,
                workspace_id=context.workspace_target.workspace_id or context.identity.account_id,
                operations=normalized_ops,
                expected_version=str(batch.expected_version) if batch.expected_version is not None else None,
                user_id=None,
                idempotency_key=batch.idempotency_key,
                client_request_id=context.identity.run_id,
                client_session_id=f"canvas-runtime-v2:{context.identity.run_id}",
            )
            execution["response"] = self._trim_response(result)
            status_code = int(result.get("status_code") or 200) if isinstance(result, dict) else 200
            if status_code == 409 or result.get("error") == "version_conflict":
                execution["status"] = "failed"
                execution["retryable"] = True
                execution["error"] = {
                    "code": "version_conflict",
                    "detail": result,
                    "message": "Canvas version conflict.",
                }
            else:
                execution["status"] = "applied"
                server_version = result.get("serverVersion") or result.get("server_version")
                if server_version is not None:
                    execution["server_version"] = server_version
        except CanvasRealtimeError as exc:
            execution["status"] = "failed"
            execution["retryable"] = bool(exc.code in {"version_conflict", "timeout"} or exc.status_code == 409)
            execution["error"] = {
                "code": exc.code or "realtime_error",
                "status_code": exc.status_code,
                "message": exc.message,
                "detail": exc.detail,
            }
        return execution

    @staticmethod
    def _trim_response(response: Any) -> dict[str, Any] | None:
        if not isinstance(response, dict):
            return None
        trimmed: dict[str, Any] = {}
        for key in ("serverVersion", "server_version", "id_map", "idMap", "applied", "warnings", "status_code", "error"):
            if key in response:
                trimmed[key] = response.get(key)
        return trimmed
