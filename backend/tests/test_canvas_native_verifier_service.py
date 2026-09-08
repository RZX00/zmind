import pytest

from core.application.services.canvas_native_context_resolver_service import (
    CanvasNativeContextResolverService,
)
from core.application.services.canvas_native_verifier_service import (
    CanvasNativeVerifierService,
)


class _VerifierResolver(CanvasNativeContextResolverService):
    def __init__(self) -> None:
        pass

    async def fetch_snapshot(self, *, canvas_id: str | None, workspace_id: str | None):
        return (
            {
                "id": canvas_id,
                "serverVersion": 15,
                "nodes": [
                    {"id": "native_node_1", "content": "问题", "x": 440, "y": 0},
                    {"id": "existing_1", "content": "目标", "x": 0, "y": 0},
                    {"id": "existing_2", "content": "策略", "x": 180, "y": 0},
                    {"id": "native_summary_1", "content": "增长策略", "x": 90, "y": -160},
                    {"id": "split_1", "content": "目标", "x": 260, "y": 0},
                    {"id": "split_2", "content": "约束", "x": 620, "y": 0},
                    {"id": "split_3", "content": "动作", "x": 980, "y": 0},
                    {"id": "root_1", "content": "增长", "x": 0, "y": 0},
                    {"id": "merged_1", "content": "增长策略", "x": 90, "y": 0},
                    {"id": "external_in", "content": "输入", "x": -180, "y": 0},
                    {"id": "external_out", "content": "输出", "x": 360, "y": 0},
                ],
                "connections": [
                    {"id": "c1", "from": "native_node_1", "to": "existing_1"},
                    {"id": "c2", "from": "native_summary_1", "to": "existing_1"},
                    {"id": "c3", "from": "native_summary_1", "to": "existing_2"},
                    {"id": "c4", "from": "root_1", "to": "split_1"},
                    {"id": "c5", "from": "root_1", "to": "split_2"},
                    {"id": "c6", "from": "root_1", "to": "split_3"},
                    {"id": "c7", "from": "external_in", "to": "merged_1"},
                    {"id": "c8", "from": "merged_1", "to": "external_out"},
                ],
            },
            "realtime",
            [],
        )


@pytest.mark.asyncio
async def test_verifier_passes_when_nodes_connections_and_version_match() -> None:
    verifier = CanvasNativeVerifierService(context_resolver=_VerifierResolver())

    report = await verifier.verify(
        state={
            "canvas_runtime": {"mode": "apply"},
            "canvas_context": {"canvas_id": "canvas_1", "workspace_id": "acct_1"},
            "canvas_task": {
                "entities": [{"entity_id": "native_node_1"}],
                "connections": [{"source_entity_id": "native_node_1", "target_entity_id": "existing_1"}],
            },
            "canvas_execution": {
                "status": "applied",
                "expected_version": 9,
                "expected_positions": {"native_node_1": {"x": 440, "y": 0}},
            },
        },
        tool_context={},
    )

    assert report["passed"] is True
    assert report["summary"] == "verification_passed"


@pytest.mark.asyncio
async def test_verifier_checks_selection_transforms() -> None:
    verifier = CanvasNativeVerifierService(context_resolver=_VerifierResolver())

    report = await verifier.verify(
        state={
            "canvas_runtime": {"mode": "apply"},
            "canvas_context": {"canvas_id": "canvas_1", "workspace_id": "acct_1"},
            "canvas_task": {
                "entities": [],
                "connections": [],
                "transforms": [
                    {
                        "kind": "retitle_selection",
                        "target_entity_ids": ["existing_1", "existing_2"],
                        "payload": {"titles": ["目标", "策略"]},
                    },
                    {
                        "kind": "create_summary_hub",
                        "target_entity_ids": ["existing_1", "existing_2"],
                        "payload": {
                            "title": "增长策略",
                            "summary_node_id": "native_summary_1",
                        },
                    },
                ],
            },
            "canvas_execution": {
                "status": "applied",
                "expected_version": 9,
                "expected_positions": {"native_summary_1": {"x": 90, "y": -160}},
            },
        },
        tool_context={},
    )

    assert report["passed"] is True
    assert report["summary"] == "verification_passed"


@pytest.mark.asyncio
async def test_verifier_checks_split_transform() -> None:
    verifier = CanvasNativeVerifierService(context_resolver=_VerifierResolver())

    report = await verifier.verify(
        state={
            "canvas_runtime": {"mode": "apply"},
            "canvas_context": {"canvas_id": "canvas_1", "workspace_id": "acct_1"},
            "canvas_task": {
                "entities": [],
                "connections": [],
                "transforms": [
                    {
                        "kind": "split_node_into_children",
                        "target_entity_ids": ["root_1"],
                        "payload": {
                            "parent_node_id": "root_1",
                            "titles": ["目标", "约束", "动作"],
                            "child_node_ids": ["split_1", "split_2", "split_3"],
                        },
                    }
                ],
            },
            "canvas_execution": {
                "status": "applied",
                "expected_version": 9,
                "expected_positions": {
                    "split_1": {"x": 260, "y": 0},
                    "split_2": {"x": 620, "y": 0},
                    "split_3": {"x": 980, "y": 0},
                },
            },
        },
        tool_context={},
    )

    assert report["passed"] is True
    assert report["summary"] == "verification_passed"


@pytest.mark.asyncio
async def test_verifier_checks_merge_transform() -> None:
    verifier = CanvasNativeVerifierService(context_resolver=_VerifierResolver())

    report = await verifier.verify(
        state={
            "canvas_runtime": {"mode": "apply"},
            "canvas_context": {"canvas_id": "canvas_1", "workspace_id": "acct_1"},
            "canvas_task": {
                "entities": [],
                "connections": [],
                "transforms": [
                    {
                        "kind": "merge_selection_into_node",
                        "target_entity_ids": ["existing_1", "existing_2"],
                        "payload": {
                            "title": "增长策略",
                            "merged_node_id": "merged_1",
                        },
                    }
                ],
            },
            "canvas_execution": {
                "status": "applied",
                "expected_version": 9,
                "expected_positions": {"merged_1": {"x": 90, "y": 0}},
                "transform_metadata": {
                    "merged_nodes": [
                        {
                            "merged_node_id": "merged_1",
                            "replacement_pairs": [
                                {"from": "external_in", "to": "merged_1"},
                                {"from": "merged_1", "to": "external_out"},
                            ],
                        }
                    ]
                },
            },
        },
        tool_context={},
    )

    assert report["passed"] is False
    assert any(issue["code"] == "merged_source_not_deleted" for issue in report["issues"])
