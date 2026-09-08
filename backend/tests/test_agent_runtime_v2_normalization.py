from __future__ import annotations

from core.agent_runtime_v2.contracts import AgentRunStartV2, RuntimeIdentityV2, SelectionContextV2, WorkspaceTargetV2
from core.agent_runtime_v2.normalization import InputNormalizerV2


def test_input_normalizer_rehydrates_selection_ids_from_raw_payload() -> None:
    normalizer = InputNormalizerV2()
    start = AgentRunStartV2(
        identity=RuntimeIdentityV2(
            run_id="run_1",
            thread_id="thread_1",
            account_id="acct_1",
            project_id=None,
        ),
        surface="canvas",
        user_input={"content": {"text": "Split the selected node"}},
        workspace_target=WorkspaceTargetV2(workspace_id="acct_1", canvas_id="canvas_1"),
        selection_context=SelectionContextV2(
            canvas_id="canvas_1",
            raw_payload={
                "nodes": [{"id": "node_1"}, {"id": "node_2"}],
                "connections": [{"id": "conn_1"}],
                "anchor_box": {"x": 10, "y": 20},
            },
        ),
    )

    normalized = normalizer.normalize(start)

    assert normalized.latest_user_text == "Split the selected node"
    assert normalized.selection_context.scope == "selection"
    assert normalized.selection_context.node_ids == ("node_1", "node_2")
    assert normalized.selection_context.connection_ids == ("conn_1",)
    assert normalized.selection_context.anchor_box == {"x": 10, "y": 20}
