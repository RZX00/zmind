from __future__ import annotations

import pytest

from core.agent_runtime_v2.canvas.contracts import CanvasIntentIRV2, CanvasMutationBatchV2, CanvasPlanV2
from core.agent_runtime_v2.canvas.execution_core import CanvasExecutionCoreV2
from core.agent_runtime_v2.contracts import ContinuityStateV2, RuntimeContextV2, RuntimeIdentityV2, WorkspaceTargetV2
from core.agent_runtime_v2.event_bus import CanonicalEventBusV2


class _IntentResult:
    def __init__(self, intent: CanvasIntentIRV2, runtime_policy: dict) -> None:
        self.intent = intent
        self.runtime_policy = runtime_policy


class _FakeIntentResolver:
    def __init__(self, *, operation_class: str = "create") -> None:
        self.operation_class = operation_class

    def resolve(self, *, context, intent_payload):
        return _IntentResult(
            CanvasIntentIRV2(
                user_goal=context.latest_user_text,
                target_canvas_id=context.workspace_target.canvas_id,
                selection_scope=context.selection_context.scope,
                operation_class=self.operation_class,
                risk_level="low",
            ),
            {"route": "native", "reason": "eligible", "mode": "apply", "repair_attempt_limit": 1},
        )


class _PreviewPlanner:
    async def plan(self, *, context, intent_ir, runtime_policy, intent_payload):
        return CanvasPlanV2(
            intent=intent_ir,
            task={
                "intent_id": "preview_intent",
                "transforms": [
                    {
                        "kind": "split_node_into_children",
                        "target_entity_ids": ["node_1"],
                        "payload": {
                            "parent_node_id": "node_1",
                            "titles": ["A", "B"],
                            "child_node_ids": ["child_1", "child_2"],
                        },
                    }
                ],
                "layout": {"strategy": "preserve"},
                "execution": {"expected_canvas_version": 9},
                "verification": {"checks": [{"kind": "version_match"}]},
            },
            canvas_context={"canvas_id": "canvas_1", "workspace_id": "acct_1"},
            runtime_policy=runtime_policy,
            plan_id="plan_preview",
            planning_summary={"focus_scope": "selection"},
            preview={"title": "preview"},
        )


class _PreviewCompiler:
    async def compile(self, *, plan):
        return CanvasMutationBatchV2(
            canvas_id="canvas_1",
            expected_version=9,
            idempotency_key="preview_key",
            operations=[
                {"op": "add_node", "node": {"id": "child_1"}},
                {"op": "add_node", "node": {"id": "child_2"}},
            ],
            expected_positions={},
            layout_metadata={},
            operation_summary={"operation_count": 2, "add_node": 2},
            verification_contract={"checks": [{"kind": "version_match"}]},
            risk_level="medium",
        )


class _ApplyPlanner:
    async def plan(self, *, context, intent_ir, runtime_policy, intent_payload):
        return CanvasPlanV2(
            intent=intent_ir,
            task={
                "intent_id": "apply_intent",
                "entities": [{"entity_id": "new_1"}],
                "transforms": [],
                "layout": {"strategy": "preserve"},
                "execution": {"expected_canvas_version": 9},
                "verification": {"checks": [{"kind": "version_match"}]},
            },
            canvas_context={"canvas_id": "canvas_1", "workspace_id": "acct_1"},
            runtime_policy=runtime_policy,
            plan_id="plan_apply",
            planning_summary={"focus_scope": "canvas"},
            preview={"title": "apply"},
        )


class _ApplyCompiler:
    async def compile(self, *, plan):
        return CanvasMutationBatchV2(
            canvas_id="canvas_1",
            expected_version=9,
            idempotency_key="apply_key",
            operations=[{"op": "add_node", "node": {"id": "new_1", "content": "new"}}],
            expected_positions={"new_1": {"x": 100.0, "y": 100.0}},
            layout_metadata={},
            operation_summary={"operation_count": 1, "add_node": 1},
            verification_contract={"checks": [{"kind": "version_match"}]},
            risk_level="low",
        )


class _FakeContextResolver:
    def __init__(self, *, current_version: int = 9) -> None:
        self.current_version = current_version

    async def fetch_snapshot(self, *, canvas_id, workspace_id):
        return {
            "serverVersion": self.current_version,
            "nodes": [{"id": "child_1"}, {"id": "child_2"}, {"id": "new_1"}],
        }, "snapshot", []


class _FakeVerifier:
    def __init__(self, *, current_version: int = 9) -> None:
        self.context_resolver = _FakeContextResolver(current_version=current_version)

    def requires_full_verify(self, *, batch):
        return False

    async def lightweight_verify(self, *, context, batch, execution):
        return {
            "passed": True,
            "summary": "lightweight_verification_passed",
            "metadata": {},
            "verification_level": "lightweight",
        }

    async def full_verify(self, *, context, plan, execution):
        raise AssertionError("full_verify should not run in these tests")


class _FakeRepairEngine:
    async def repair(self, *, state, tool_context):
        raise AssertionError("repair should not run in these tests")


class _FakeWriteService:
    called = False

    async def apply_canvas_ops(
        self,
        *,
        canvas_id,
        workspace_id,
        operations,
        expected_version,
        user_id,
        idempotency_key,
        client_request_id,
        client_session_id,
    ):
        type(self).called = True
        return {"serverVersion": 10, "applied": len(operations)}


def _build_context(*, response_mode: str = "auto", latest_user_text: str) -> RuntimeContextV2:
    return RuntimeContextV2(
        identity=RuntimeIdentityV2(
            run_id="run_1",
            thread_id="thread_1",
            account_id="acct_1",
            project_id=None,
        ),
        surface="canvas",
        interaction_mode="agent",
        response_mode=response_mode,
        lane="canvas",
        latest_user_text=latest_user_text,
        workspace_target=WorkspaceTargetV2(workspace_id="acct_1", canvas_id="canvas_1"),
        continuity_state=ContinuityStateV2.empty("thread:thread_1"),
    )


@pytest.mark.asyncio
async def test_canvas_core_emits_structured_preview_for_medium_risk_plan() -> None:
    context = _build_context(response_mode="auto", latest_user_text="请拆分当前节点")
    bus = CanonicalEventBusV2(runtime_context=context)
    core = CanvasExecutionCoreV2(
        intent_resolver=_FakeIntentResolver(operation_class="rewrite"),
        planner=_PreviewPlanner(),
        compiler=_PreviewCompiler(),
        verifier=_FakeVerifier(),
        repair_engine=_FakeRepairEngine(),
        create_write_service=_FakeWriteService,
    )

    events = await core.execute(context=context, bus=bus, intent_payload={"domain": "canvas"})
    event_types = [event.event_type for event in events]
    preview_ready = next(event for event in events if event.event_type == "preview.ready")
    preview_payload = preview_ready.payload["preview"]
    preview_message = next(event for event in events if event.event_type == "run.message")
    frontend_content = dict(preview_message.metadata.get("frontend_content") or {})

    assert "plan.created" in event_types
    assert "preview.ready" in event_types
    assert "run.message" in event_types
    assert event_types[-1] == "run.completed"
    assert preview_payload["risk_level"] == "medium"
    assert preview_payload["confirm_token"].startswith("confirm_")
    assert frontend_content["canvas_preview"]["confirm_token"] == preview_payload["confirm_token"]
    assert frontend_content["cta"][0]["action"] == "canvas_preview.confirm"
    assert context.continuity_state.pending_canvas_plan is not None
    assert context.continuity_state.pending_preview is not None
    assert context.continuity_state.lane_state == "awaiting_confirmation"
    assert _FakeWriteService.called is False


@pytest.mark.asyncio
async def test_canvas_core_auto_applies_low_risk_plan_and_verifies() -> None:
    _FakeWriteService.called = False
    context = _build_context(response_mode="force_apply", latest_user_text="新增一个节点")
    bus = CanonicalEventBusV2(runtime_context=context)
    core = CanvasExecutionCoreV2(
        intent_resolver=_FakeIntentResolver(operation_class="create"),
        planner=_ApplyPlanner(),
        compiler=_ApplyCompiler(),
        verifier=_FakeVerifier(),
        repair_engine=_FakeRepairEngine(),
        create_write_service=_FakeWriteService,
    )

    events = await core.execute(context=context, bus=bus, intent_payload={"domain": "canvas"})
    event_types = [event.event_type for event in events]

    assert _FakeWriteService.called is True
    assert "execution.started" in event_types
    assert "canvas.executed" in event_types
    assert "verification.passed" in event_types
    assert event_types[-1] == "run.completed"
    assert context.continuity_state.pending_canvas_plan is None
    assert context.continuity_state.lane_state == "completed"


@pytest.mark.asyncio
async def test_canvas_core_confirm_restores_same_pending_plan_and_executes() -> None:
    _FakeWriteService.called = False
    verifier = _FakeVerifier(current_version=9)
    context = _build_context(response_mode="auto", latest_user_text="请拆分当前节点")
    core = CanvasExecutionCoreV2(
        intent_resolver=_FakeIntentResolver(operation_class="rewrite"),
        planner=_PreviewPlanner(),
        compiler=_PreviewCompiler(),
        verifier=verifier,
        repair_engine=_FakeRepairEngine(),
        create_write_service=_FakeWriteService,
    )

    first_events = await core.execute(context=context, bus=CanonicalEventBusV2(runtime_context=context), intent_payload={"domain": "canvas"})
    assert any(event.event_type == "preview.ready" for event in first_events)

    context.latest_user_text = "确认"
    context.response_mode = "confirm"
    second_events = await core.execute(
        context=context,
        bus=CanonicalEventBusV2(runtime_context=context),
        intent_payload={"domain": "canvas"},
    )
    event_types = [event.event_type for event in second_events]

    assert _FakeWriteService.called is True
    assert "preview.confirmed" in event_types
    assert "execution.started" in event_types
    assert "verification.passed" in event_types
    assert event_types[-1] == "run.completed"
    assert context.continuity_state.pending_canvas_plan is None
    assert context.continuity_state.pending_preview is None


@pytest.mark.asyncio
async def test_canvas_core_invalidates_stale_preview_before_execution() -> None:
    _FakeWriteService.called = False
    verifier = _FakeVerifier(current_version=9)
    context = _build_context(response_mode="auto", latest_user_text="请拆分当前节点")
    core = CanvasExecutionCoreV2(
        intent_resolver=_FakeIntentResolver(operation_class="rewrite"),
        planner=_PreviewPlanner(),
        compiler=_PreviewCompiler(),
        verifier=verifier,
        repair_engine=_FakeRepairEngine(),
        create_write_service=_FakeWriteService,
    )

    first_events = await core.execute(context=context, bus=CanonicalEventBusV2(runtime_context=context), intent_payload={"domain": "canvas"})
    assert any(event.event_type == "preview.ready" for event in first_events)

    verifier.context_resolver.current_version = 10
    context.latest_user_text = "确认"
    context.response_mode = "confirm"
    second_events = await core.execute(
        context=context,
        bus=CanonicalEventBusV2(runtime_context=context),
        intent_payload={"domain": "canvas"},
    )
    event_types = [event.event_type for event in second_events]

    assert _FakeWriteService.called is False
    assert "preview.invalidated" in event_types
    assert "preview.ready" in event_types
    assert "execution.started" not in event_types
    assert event_types[-1] == "run.completed"
    assert context.continuity_state.pending_canvas_plan is not None
    assert context.continuity_state.pending_preview is not None


@pytest.mark.asyncio
async def test_canvas_core_rejects_mismatched_confirm_binding_before_execution() -> None:
    _FakeWriteService.called = False
    context = _build_context(response_mode="auto", latest_user_text="Split the current node")
    core = CanvasExecutionCoreV2(
        intent_resolver=_FakeIntentResolver(operation_class="rewrite"),
        planner=_PreviewPlanner(),
        compiler=_PreviewCompiler(),
        verifier=_FakeVerifier(),
        repair_engine=_FakeRepairEngine(),
        create_write_service=_FakeWriteService,
    )

    first_events = await core.execute(
        context=context,
        bus=CanonicalEventBusV2(runtime_context=context),
        intent_payload={"domain": "canvas"},
    )
    assert any(event.event_type == "preview.ready" for event in first_events)

    context.latest_user_text = "Apply Plan"
    context.response_mode = "confirm"
    context.user_input = {
        "metadata": {
            "cta_action": "canvas_preview.confirm",
            "cta_payload": {
                "confirm_token": "confirm_stale",
                "pending_plan_ref": "pending:stale:confirm_stale",
            },
        }
    }

    second_events = await core.execute(
        context=context,
        bus=CanonicalEventBusV2(runtime_context=context),
        intent_payload={"domain": "canvas"},
    )
    event_types = [event.event_type for event in second_events]
    invalidated = next(event for event in second_events if event.event_type == "preview.invalidated")

    assert _FakeWriteService.called is False
    assert "preview.invalidated" in event_types
    assert "preview.ready" in event_types
    assert "execution.started" not in event_types
    assert invalidated.payload["reason"] == "confirm_binding_mismatch"
    assert context.continuity_state.pending_canvas_plan is not None
    assert context.continuity_state.pending_preview is not None
