from __future__ import annotations

import pytest

from core.agent_runtime_v2.contracts import AgentRunStartV2, RuntimeIdentityV2
from core.agent_runtime_v2.continuity import MemoryContinuityStoreV2
from core.agent_runtime_v2.kernel import AgentRuntimeKernelV2
from core.agent_runtime_v2.lane_selector import ExecutionLaneDecisionV2


class _FakeLaneSelector:
    def resolve_intent(self, *, latest_user_text, interaction_surface, agent_config):
        return {"domain": "generic", "user_goal": latest_user_text}

    def select_lane(self, *, latest_user_text, interaction_surface, intent_payload, continuity_state):
        return ExecutionLaneDecisionV2(lane="general", reason="test_lane", intent_payload=intent_payload)


class _FakePersistenceProjection:
    def __init__(self) -> None:
        self.event_types: list[str] = []

    async def persist(self, *, context, event) -> None:
        self.event_types.append(event.event_type)


class _FakeGeneralLaneAdapter:
    async def run(self, *, context, bus, tool_pool):
        yield bus.message("done")
        yield bus.build(
            "run.completed",
            payload={"status": "completed"},
            metadata={"terminal_status": "completed"},
        )


class _FakeCanvasCore:
    async def execute(self, *, context, bus, intent_payload):
        context.continuity_state.pending_preview = {
            "plan_id": "plan_preview",
            "confirm_token": "confirm_preview",
        }
        context.continuity_state.pending_canvas_plan = {
            "plan": {"plan_id": "plan_preview"},
        }
        context.continuity_state.lane_state = "awaiting_confirmation"
        frontend_content = {
            "canvas_preview": {
                "plan_id": "plan_preview",
                "confirm_token": "confirm_preview",
                "pending_plan_ref": "pending:plan_preview:confirm_preview",
            },
            "cta": [
                {
                    "label": "Apply Plan",
                    "action": "canvas_preview.confirm",
                    "payload": {
                        "response_mode": "confirm",
                        "confirm_token": "confirm_preview",
                        "pending_plan_ref": "pending:plan_preview:confirm_preview",
                    },
                }
            ],
        }
        return [
            bus.build(
                "preview.ready",
                payload={
                    "preview": {
                        "plan_id": "plan_preview",
                        "confirm_token": "confirm_preview",
                        "pending_plan_ref": "pending:plan_preview:confirm_preview",
                    }
                },
            ),
            bus.build(
                "run.message",
                payload={
                    "message": {
                        "role": "assistant",
                        "content": "Plan ready",
                        "tool_calls": None,
                    }
                },
                user_visible=True,
                metadata={
                    "canvas_preview": True,
                    "frontend_content": frontend_content,
                },
            ),
            bus.build(
                "run.completed",
                payload={"status": "preview_ready"},
                metadata={"terminal_status": "completed", "canvas_preview": True},
            ),
        ]


@pytest.mark.asyncio
async def test_kernel_persists_general_lane_events_via_canonical_projection() -> None:
    projection = _FakePersistenceProjection()
    kernel = AgentRuntimeKernelV2(
        continuity_store=MemoryContinuityStoreV2(),
        lane_selector=_FakeLaneSelector(),
        general_lane_adapter=_FakeGeneralLaneAdapter(),
        persistence_projection=projection,
    )
    start = AgentRunStartV2(
        identity=RuntimeIdentityV2(
            run_id="run_1",
            thread_id="thread_1",
            account_id="acct_1",
            project_id=None,
        ),
        latest_user_text="hello",
        response_mode="auto",
    )

    events = [event async for event in kernel.run(start, tool_registry=None)]

    assert [event.event_type for event in events] == [
        "run.started",
        "intent.resolved",
        "lane.selected",
        "context.prepared",
        "run.message",
        "run.completed",
    ]
    assert projection.event_types == [event.event_type for event in events]


@pytest.mark.asyncio
async def test_kernel_attaches_resume_token_to_canvas_preview_events() -> None:
    store = MemoryContinuityStoreV2()
    kernel = AgentRuntimeKernelV2(
        continuity_store=store,
        canvas_core=_FakeCanvasCore(),
    )
    start = AgentRunStartV2(
        identity=RuntimeIdentityV2(
            run_id="run_canvas_1",
            thread_id="thread_canvas_1",
            account_id="acct_1",
            project_id=None,
        ),
        latest_user_text="Split the selected node",
        response_mode="auto",
        surface="canvas",
    )

    events = [event async for event in kernel.run(start, tool_registry=None)]

    preview_ready = next(event for event in events if event.event_type == "preview.ready")
    preview_message = next(event for event in events if event.event_type == "run.message")
    completed = next(event for event in events if event.event_type == "run.completed")

    resume_token = preview_ready.payload.get("resume_token")
    assert isinstance(resume_token, str)
    assert resume_token.startswith("rtv2_")
    assert preview_ready.payload["preview"]["resume_token"] == resume_token
    assert preview_message.metadata["resume_token"] == resume_token
    assert preview_message.metadata["frontend_content"]["continuity"]["resume_token"] == resume_token
    assert preview_message.metadata["frontend_content"]["cta"][0]["payload"]["resume_token"] == resume_token
    assert preview_message.metadata["frontend_content"]["canvas_preview"]["resume_token"] == resume_token
    assert completed.payload["resume_token"] == resume_token

    loaded = await store.load("thread:thread_canvas_1", resume_token=resume_token)
    assert loaded is not None
    assert loaded.pending_preview is not None
