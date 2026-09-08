import pytest

from core.application.services.canvas_native_context_resolver_service import (
    CanvasNativeContextResolverService,
)
from core.application.services.canvas_native_executor_service import (
    CanvasNativeExecutorService,
)


class _FakeWriteService:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def apply_canvas_ops(
        self,
        *,
        canvas_id: str,
        workspace_id: str,
        operations: list[dict],
        expected_version=None,
        user_id=None,
        idempotency_key=None,
        client_request_id=None,
        client_session_id=None,
    ):
        self.calls.append(
            {
                "canvas_id": canvas_id,
                "workspace_id": workspace_id,
                "operations": operations,
                "expected_version": expected_version,
                "idempotency_key": idempotency_key,
            }
        )
        return {"serverVersion": 15, "applied": operations, "id_map": {}}


class _FakeResolver(CanvasNativeContextResolverService):
    def __init__(self) -> None:
        pass

    async def fetch_snapshot(self, *, canvas_id: str | None, workspace_id: str | None):
        return (
            {
                "id": canvas_id,
                "serverVersion": 9,
                "nodes": [
                    {"id": "root_1", "content": "增长", "x": 0, "y": 0, "width": 140, "height": 72},
                    {"id": "existing_1", "content": "旧标题1", "x": 0, "y": 0, "width": 100, "height": 60},
                    {"id": "existing_2", "content": "旧标题2", "x": 180, "y": 0, "width": 100, "height": 60},
                    {"id": "external_in", "content": "输入", "x": -180, "y": 0, "width": 100, "height": 60},
                    {"id": "external_out", "content": "输出", "x": 360, "y": 0, "width": 100, "height": 60},
                ],
                "connections": [
                    {"id": "c_in", "from": "external_in", "to": "existing_1"},
                    {"id": "c_mid", "from": "existing_1", "to": "existing_2"},
                    {"id": "c_out", "from": "existing_2", "to": "external_out"},
                ],
            },
            "realtime",
            [],
        )


@pytest.mark.asyncio
async def test_executor_applies_canonical_canvas_ops() -> None:
    fake_write_service = _FakeWriteService()

    class _FakeWriteServiceFactory:
        def __new__(cls):
            return fake_write_service

    executor = CanvasNativeExecutorService(
        context_resolver=_FakeResolver(),
        create_write_service=_FakeWriteServiceFactory,
    )

    state = {
        "agent_run_id": "ar_exec_1",
        "repair_count": 0,
        "canvas_runtime": {"mode": "apply"},
        "canvas_context": {
            "canvas_id": "canvas_1",
            "workspace_id": "acct_1",
            "anchor_box": {"x": 0, "y": 0, "width": 320, "height": 180, "center_x": 160, "center_y": 90},
            "focus_node_ids": ["existing_1"],
        },
        "canvas_task": {
            "intent_id": "ar_exec_1",
            "entities": [
                {
                    "entity_id": "native_node_1",
                    "label": "问题",
                    "text": "问题",
                    "properties": {"type": "text"},
                }
            ],
            "connections": [
                {"source_entity_id": "native_node_1", "target_entity_id": "existing_1", "relation": "related_to"}
            ],
            "working_set": {"node_ids": ["existing_1"]},
            "layout": {"strategy": "grid"},
            "execution": {
                "expected_canvas_version": 9,
                "idempotency_key": "native_exec_base",
            },
        },
    }

    result = await executor.execute(state=state, tool_context={"canvas_id": "canvas_1", "account_id": "acct_1"})

    assert result["status"] == "applied"
    assert result["operation_count"] == 2
    assert fake_write_service.calls[0]["expected_version"] == "9"
    assert fake_write_service.calls[0]["idempotency_key"] == "native_exec_base"
    assert any(op["op"] == "add_node" for op in fake_write_service.calls[0]["operations"])
    assert any(op["op"] == "add_connection" for op in fake_write_service.calls[0]["operations"])


@pytest.mark.asyncio
async def test_executor_adds_swimlane_headers_for_lane_layout() -> None:
    fake_write_service = _FakeWriteService()

    class _FakeWriteServiceFactory:
        def __new__(cls):
            return fake_write_service

    executor = CanvasNativeExecutorService(
        context_resolver=_FakeResolver(),
        create_write_service=_FakeWriteServiceFactory,
    )

    state = {
        "agent_run_id": "ar_exec_swimlane",
        "repair_count": 0,
        "canvas_runtime": {"mode": "apply"},
        "canvas_context": {
            "canvas_id": "canvas_1",
            "workspace_id": "acct_1",
            "anchor_box": {"x": 20, "y": 20, "width": 500, "height": 220, "center_x": 270, "center_y": 130},
            "focus_node_ids": [],
        },
        "canvas_task": {
            "intent_id": "ar_exec_swimlane",
            "entities": [
                {"entity_id": "native_node_1", "label": "访谈", "text": "访谈", "properties": {"type": "text"}},
                {"entity_id": "native_node_2", "label": "需求", "text": "需求", "properties": {"type": "text"}},
                {"entity_id": "native_node_3", "label": "开发", "text": "开发", "properties": {"type": "text"}},
            ],
            "connections": [],
            "working_set": {"node_ids": []},
            "layout": {
                "strategy": "swimlane",
                "lanes": [
                    {"lane_id": "product", "label": "产品", "entity_ids": ["native_node_1", "native_node_2"]},
                    {"lane_id": "engineering", "label": "技术", "entity_ids": ["native_node_3"]},
                ],
            },
            "execution": {
                "expected_canvas_version": 9,
                "idempotency_key": "native_exec_swimlane",
            },
        },
    }

    result = await executor.execute(state=state, tool_context={"canvas_id": "canvas_1", "account_id": "acct_1"})

    assert result["status"] == "applied"
    assert result["operation_count"] == 5
    lane_headers = [
        op for op in fake_write_service.calls[0]["operations"]
        if op["op"] == "add_node" and str(op["node"]["id"]).startswith("ar_exec_swimlane_lane_")
    ]
    assert len(lane_headers) == 2


@pytest.mark.asyncio
async def test_executor_compiles_retitle_and_summary_transforms() -> None:
    fake_write_service = _FakeWriteService()

    class _FakeWriteServiceFactory:
        def __new__(cls):
            return fake_write_service

    executor = CanvasNativeExecutorService(
        context_resolver=_FakeResolver(),
        create_write_service=_FakeWriteServiceFactory,
    )

    state = {
        "agent_run_id": "ar_exec_transform",
        "repair_count": 0,
        "canvas_runtime": {"mode": "apply"},
        "canvas_context": {
            "canvas_id": "canvas_1",
            "workspace_id": "acct_1",
            "anchor_box": {"x": 0, "y": 0, "width": 320, "height": 180, "center_x": 160, "center_y": 90},
            "focus_node_ids": ["existing_1", "existing_2"],
        },
        "canvas_task": {
            "intent_id": "ar_exec_transform",
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
            "working_set": {"node_ids": ["existing_1", "existing_2"]},
            "layout": {"strategy": "preserve"},
            "execution": {
                "expected_canvas_version": 9,
                "idempotency_key": "native_exec_transform",
            },
        },
    }

    result = await executor.execute(state=state, tool_context={"canvas_id": "canvas_1", "account_id": "acct_1"})

    assert result["status"] == "applied"
    ops = fake_write_service.calls[0]["operations"]
    assert any(op["op"] == "update_node" and op["id"] == "existing_1" for op in ops)
    assert any(op["op"] == "update_node" and op["id"] == "existing_2" for op in ops)
    assert any(op["op"] == "add_node" and op["node"]["id"] == "native_summary_1" for op in ops)
    assert any(op["op"] == "add_connection" and op["from"] == "native_summary_1" and op["to"] == "existing_1" for op in ops)


@pytest.mark.asyncio
async def test_executor_compiles_split_transform() -> None:
    fake_write_service = _FakeWriteService()

    class _FakeWriteServiceFactory:
        def __new__(cls):
            return fake_write_service

    executor = CanvasNativeExecutorService(
        context_resolver=_FakeResolver(),
        create_write_service=_FakeWriteServiceFactory,
    )

    state = {
        "agent_run_id": "ar_exec_split",
        "repair_count": 0,
        "canvas_runtime": {"mode": "apply"},
        "canvas_context": {
            "canvas_id": "canvas_1",
            "workspace_id": "acct_1",
            "anchor_box": {"x": 0, "y": 0, "width": 320, "height": 180, "center_x": 160, "center_y": 90},
            "focus_node_ids": ["root_1"],
        },
        "canvas_task": {
            "intent_id": "ar_exec_split",
            "entities": [],
            "connections": [],
            "transforms": [
                {
                    "kind": "split_node_into_children",
                    "target_entity_ids": ["root_1"],
                    "payload": {
                        "parent_node_id": "root_1",
                        "titles": ["目标", "约束", "动作"],
                        "child_layout": "timeline",
                        "child_node_ids": ["split_1", "split_2", "split_3"],
                    },
                }
            ],
            "working_set": {"node_ids": ["root_1"]},
            "layout": {"strategy": "preserve"},
            "execution": {
                "expected_canvas_version": 9,
                "idempotency_key": "native_exec_split",
            },
        },
    }

    result = await executor.execute(state=state, tool_context={"canvas_id": "canvas_1", "account_id": "acct_1"})

    assert result["status"] == "applied"
    ops = fake_write_service.calls[0]["operations"]
    assert len([op for op in ops if op["op"] == "add_node" and str(op["node"]["id"]).startswith("split_")]) == 3
    assert any(op["op"] == "add_connection" and op["from"] == "root_1" and op["to"] == "split_1" for op in ops)
    assert result["transform_metadata"]["split_nodes"][0]["parent_node_id"] == "root_1"


@pytest.mark.asyncio
async def test_executor_compiles_merge_transform_and_rewires_edges() -> None:
    fake_write_service = _FakeWriteService()

    class _FakeWriteServiceFactory:
        def __new__(cls):
            return fake_write_service

    executor = CanvasNativeExecutorService(
        context_resolver=_FakeResolver(),
        create_write_service=_FakeWriteServiceFactory,
    )

    state = {
        "agent_run_id": "ar_exec_merge",
        "repair_count": 0,
        "canvas_runtime": {"mode": "apply"},
        "canvas_context": {
            "canvas_id": "canvas_1",
            "workspace_id": "acct_1",
            "anchor_box": {"x": 0, "y": 0, "width": 500, "height": 220, "center_x": 250, "center_y": 110},
            "focus_node_ids": ["existing_1", "existing_2"],
        },
        "canvas_task": {
            "intent_id": "ar_exec_merge",
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
            "working_set": {"node_ids": ["existing_1", "existing_2"]},
            "layout": {"strategy": "preserve"},
            "execution": {
                "expected_canvas_version": 9,
                "idempotency_key": "native_exec_merge",
            },
        },
    }

    result = await executor.execute(state=state, tool_context={"canvas_id": "canvas_1", "account_id": "acct_1"})

    assert result["status"] == "applied"
    ops = fake_write_service.calls[0]["operations"]
    assert any(op["op"] == "add_node" and op["node"]["id"] == "merged_1" for op in ops)
    assert any(op["op"] == "delete_node" and op["id"] == "existing_1" for op in ops)
    assert any(op["op"] == "delete_node" and op["id"] == "existing_2" for op in ops)
    assert any(op["op"] == "delete_connection" and op["id"] == "c_mid" for op in ops)
    assert any(op["op"] == "add_connection" and op["from"] == "external_in" and op["to"] == "merged_1" for op in ops)
    assert any(op["op"] == "add_connection" and op["from"] == "merged_1" and op["to"] == "external_out" for op in ops)
