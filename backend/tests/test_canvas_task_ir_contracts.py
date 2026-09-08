import json

from core.domains.canvas.task_ir import (
    CanvasEntitySpec,
    CanvasSemanticLane,
    CanvasTaskIR,
    CanvasTransform,
    CanvasWorkingSet,
    ConnectionIntent,
    ExecutionPolicy,
    LayoutConstraints,
    TargetCanvasRef,
    VerificationCheck,
    VerificationPlan,
)


def test_canvas_task_ir_preserves_execution_guards() -> None:
    task_ir = CanvasTaskIR(
        intent_id="intent_001",
        user_goal="重排当前画布并补充关键连接",
        target=TargetCanvasRef(canvas_id="canvas_123", workspace_id="workspace_456"),
        working_set=CanvasWorkingSet(
            node_ids=("node_a", "node_b"),
            selected_entity_ids=("node_a", "node_b"),
        ),
        entities=(
            CanvasEntitySpec(entity_id="node_a", entity_type="node", label="问题"),
            CanvasEntitySpec(entity_id="node_b", entity_type="node", label="方案"),
        ),
        connections=(
            ConnectionIntent(
                source_entity_id="node_a",
                target_entity_id="node_b",
                relation="leads_to",
            ),
        ),
        transforms=(
            CanvasTransform(
                kind="create_summary_hub",
                target_entity_ids=("node_a", "node_b"),
                payload={"title": "总纲"},
            ),
        ),
        layout=LayoutConstraints(
            strategy="mindmap",
            preserve_positions=False,
            root_entity_id="node_a",
            lanes=(
                CanvasSemanticLane(
                    lane_id="lane_strategy",
                    label="策略",
                    entity_ids=("node_a", "node_b"),
                ),
            ),
        ),
        execution=ExecutionPolicy(
            mode="apply",
            idempotency_key="idem_canvas_001",
            expected_canvas_version=7,
            repair_attempt_limit=2,
        ),
        verification=VerificationPlan(
            checks=(
                VerificationCheck(kind="version_match", target="canvas_version", expected=7),
            ),
        ),
    )

    payload = task_ir.to_dict()

    assert payload["execution"]["idempotency_key"] == "idem_canvas_001"
    assert payload["execution"]["expected_canvas_version"] == 7
    assert payload["layout"]["root_entity_id"] == "node_a"
    assert payload["layout"]["lanes"][0]["lane_id"] == "lane_strategy"
    assert payload["transforms"][0]["kind"] == "create_summary_hub"
    assert payload["verification"]["checks"][0]["kind"] == "version_match"
    json.dumps(payload, ensure_ascii=False)
