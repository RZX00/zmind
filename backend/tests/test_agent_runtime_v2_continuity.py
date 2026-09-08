from __future__ import annotations

import pytest

from core.agent_runtime_v2.continuity import MemoryContinuityStoreV2, resume_consistency_check
from core.agent_runtime_v2.contracts import ContextLifecycleRecordV2, ContinuityStateV2


@pytest.mark.asyncio
async def test_memory_continuity_store_round_trip_pending_preview_and_lifecycle() -> None:
    store = MemoryContinuityStoreV2()
    state = ContinuityStateV2.empty("thread:thread_1")
    state.pending_canvas_plan = {
        "plan": {"intent": {"user_goal": "preview"}},
        "batch": {"operations": [{"op": "add_node"}]},
    }
    state.pending_preview = {
        "plan_id": "plan_preview",
        "confirm_token": "confirm_123",
        "risk_level": "medium",
    }
    state.context_lifecycle = [
        ContextLifecycleRecordV2(
            stage="normalize",
            payload={"surface": "canvas"},
        )
    ]

    checkpoint_id = await store.save("thread:thread_1", state)
    loaded = await store.load("thread:thread_1", resume_token=checkpoint_id)

    assert loaded is not None
    assert loaded.pending_canvas_plan == state.pending_canvas_plan
    assert loaded.pending_preview == state.pending_preview
    assert loaded.context_lifecycle[0].stage == "normalize"


def test_resume_consistency_detects_surface_and_canvas_drift() -> None:
    state = ContinuityStateV2.empty("thread:thread_1")
    state.resume_metadata["runtime_context_snapshot"] = {
        "surface": "canvas",
        "workspace_target": {"canvas_id": "canvas_a"},
        "selection_context": {"node_ids": ["node_1"]},
    }

    result = resume_consistency_check(
        stored=state,
        surface="doc",
        workspace_target={"canvas_id": "canvas_b"},
        selection_context={"node_ids": ["node_2"]},
    )

    assert result["ok"] is False
    assert "surface_changed" in result["mismatches"]
    assert "canvas_target_changed" in result["mismatches"]
    assert "selection_changed" in result["mismatches"]
