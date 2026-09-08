from __future__ import annotations

from core.agent_runtime_v2.artifacts import ArtifactStoreV2
from core.agent_runtime_v2.context.pipeline import ContextLifecyclePipelineV2
from core.agent_runtime_v2.contracts import ContinuityStateV2, RuntimeContextV2, RuntimeIdentityV2, SelectionContextV2, WorkspaceTargetV2


def test_context_pipeline_records_all_stages_and_replacements() -> None:
    continuity = ContinuityStateV2.empty("thread:thread_1")
    continuity.pending_preview = {
        "plan_id": "plan_preview",
        "details": "x" * 200,
    }
    context = RuntimeContextV2(
        identity=RuntimeIdentityV2(
            run_id="run_1",
            thread_id="thread_1",
            account_id="acct_1",
            project_id=None,
        ),
        surface="canvas",
        lane="canvas",
        latest_user_text="请整理当前画布结构",
        workspace_target=WorkspaceTargetV2(workspace_id="acct_1", canvas_id="canvas_1"),
        selection_context=SelectionContextV2(
            canvas_id="canvas_1",
            scope="selection",
            raw_payload={"nodes": [{"id": f"node_{index}", "content": "x" * 40} for index in range(8)]},
        ),
        continuity_state=continuity,
        diagnostics=[{"kind": "warning", "message": "large selection"}],
        budget_context={"artifact_threshold_chars": 64},
        tool_context={"agent_mailbox": {"pending": ["task_1"]}},
    )

    pipeline = ContextLifecyclePipelineV2(artifact_store=ArtifactStoreV2(replacement_threshold_chars=64))
    pipeline.run(context)

    lifecycle_stages = [record.stage for record in continuity.context_lifecycle]

    assert lifecycle_stages == ["normalize", "enrich", "budget", "replacement", "compact", "collapse", "assemble"]
    assert continuity.replacement_ledger
    assert continuity.collapsed_contexts["prompt.latest"]["collapse_summary"]["lane"] == "canvas"
    assert context.prompt_context["assembled"]["messages_context"][0]["role"] == "system"
