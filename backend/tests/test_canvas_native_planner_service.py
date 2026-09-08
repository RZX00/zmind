from core.application.services.canvas_native_planner_service import CanvasNativePlannerService


def test_planner_builds_create_connect_layout_ir() -> None:
    planner = CanvasNativePlannerService()

    state = {
        "agent_run_id": "ar_plan_1",
        "intent": {
            "domain": "canvas",
            "user_goal": "请在当前画布创建：问题，原因，方案，并自动连线和排版",
        },
        "messages_context": [
            {
                "role": "user",
                "content": "请在当前画布创建：问题，原因，方案，并自动连线和排版",
            }
        ],
        "canvas_runtime": {"repair_attempt_limit": 2},
    }
    context = {
        "canvas_id": "canvas_1",
        "workspace_id": "acct_1",
        "focus_scope": "canvas",
        "focus_node_ids": ["existing_1"],
        "focus_connection_ids": [],
        "current_server_version": 9,
        "anchor_box": {"x": 0, "y": 0, "width": 400, "height": 180, "center_x": 200, "center_y": 90},
    }

    task_ir = planner.plan(state=state, context=context)
    payload = task_ir.to_dict()

    assert payload["target"]["canvas_id"] == "canvas_1"
    assert len(payload["entities"]) == 3
    assert len(payload["connections"]) == 2
    assert payload["layout"]["strategy"] == "grid"
    assert payload["execution"]["expected_canvas_version"] == 9
    assert payload["verification"]["checks"]


def test_planner_builds_mindmap_recipe_with_root_connections() -> None:
    planner = CanvasNativePlannerService()

    state = {
        "agent_run_id": "ar_plan_mindmap",
        "intent": {
            "domain": "canvas",
            "user_goal": "创建一个脑图：目标、风险、策略、执行",
        },
        "messages_context": [
            {
                "role": "user",
                "content": "创建一个脑图：目标、风险、策略、执行",
            }
        ],
        "canvas_runtime": {"repair_attempt_limit": 2},
    }
    context = {
        "canvas_id": "canvas_1",
        "workspace_id": "acct_1",
        "focus_scope": "canvas",
        "focus_node_ids": [],
        "focus_connection_ids": [],
        "focus_nodes": [],
        "current_server_version": 9,
        "anchor_box": {"x": 0, "y": 0, "width": 400, "height": 180, "center_x": 200, "center_y": 90},
    }

    payload = planner.plan(state=state, context=context).to_dict()

    assert payload["layout"]["strategy"] == "mindmap"
    assert payload["layout"]["root_entity_id"] == payload["entities"][0]["entity_id"]
    assert len(payload["connections"]) == 3
    assert all(connection["source_entity_id"] == payload["entities"][0]["entity_id"] for connection in payload["connections"])


def test_planner_builds_swimlane_recipe_from_lane_groups() -> None:
    planner = CanvasNativePlannerService()

    state = {
        "agent_run_id": "ar_plan_swimlane",
        "intent": {
            "domain": "canvas",
            "user_goal": "创建泳道图\n产品：访谈、需求\n技术：架构、开发",
        },
        "messages_context": [
            {
                "role": "user",
                "content": "创建泳道图\n产品：访谈、需求\n技术：架构、开发",
            }
        ],
        "canvas_runtime": {"repair_attempt_limit": 1},
    }
    context = {
        "canvas_id": "canvas_1",
        "workspace_id": "acct_1",
        "focus_scope": "canvas",
        "focus_node_ids": [],
        "focus_connection_ids": [],
        "focus_nodes": [],
        "current_server_version": 11,
        "anchor_box": {"x": 0, "y": 0, "width": 600, "height": 240, "center_x": 300, "center_y": 120},
    }

    payload = planner.plan(state=state, context=context).to_dict()

    assert payload["layout"]["strategy"] == "swimlane"
    assert len(payload["layout"]["lanes"]) == 2
    assert payload["layout"]["lanes"][0]["label"] == "产品"
    assert len(payload["entities"]) == 4


def test_planner_builds_selection_transforms_for_retitle_and_summary() -> None:
    planner = CanvasNativePlannerService()

    state = {
        "agent_run_id": "ar_plan_transform",
        "intent": {
            "domain": "canvas",
            "user_goal": "把当前 3 个节点改成：目标、现状、策略，并总结：增长策略",
        },
        "messages_context": [
            {
                "role": "user",
                "content": "把当前 3 个节点改成：目标、现状、策略，并总结：增长策略",
            }
        ],
        "canvas_runtime": {"repair_attempt_limit": 1},
    }
    context = {
        "canvas_id": "canvas_1",
        "workspace_id": "acct_1",
        "focus_scope": "selection",
        "focus_node_ids": ["n1", "n2", "n3"],
        "focus_connection_ids": [],
        "focus_nodes": [
            {"id": "n1", "content": "旧1"},
            {"id": "n2", "content": "旧2"},
            {"id": "n3", "content": "旧3"},
        ],
        "current_server_version": 11,
        "anchor_box": {"x": 0, "y": 0, "width": 500, "height": 220, "center_x": 250, "center_y": 110},
    }

    payload = planner.plan(state=state, context=context).to_dict()

    assert len(payload["transforms"]) == 2
    assert payload["transforms"][0]["kind"] == "retitle_selection"
    assert payload["transforms"][0]["payload"]["titles"] == ["目标", "现状", "策略"]
    assert payload["transforms"][1]["kind"] == "create_summary_hub"
    assert payload["transforms"][1]["payload"]["title"] == "增长策略"


def test_planner_builds_split_transform_for_single_selected_node() -> None:
    planner = CanvasNativePlannerService()

    state = {
        "agent_run_id": "ar_plan_split",
        "intent": {
            "domain": "canvas",
            "user_goal": "把这个节点拆成：目标、约束、动作",
        },
        "messages_context": [
            {
                "role": "user",
                "content": "把这个节点拆成：目标、约束、动作",
            }
        ],
        "canvas_runtime": {"repair_attempt_limit": 1},
    }
    context = {
        "canvas_id": "canvas_1",
        "workspace_id": "acct_1",
        "focus_scope": "selection",
        "focus_node_ids": ["root_1"],
        "focus_connection_ids": [],
        "focus_nodes": [{"id": "root_1", "content": "增长"}],
        "current_server_version": 7,
        "anchor_box": {"x": 0, "y": 0, "width": 320, "height": 180, "center_x": 160, "center_y": 90},
    }

    payload = planner.plan(state=state, context=context).to_dict()

    split = next(transform for transform in payload["transforms"] if transform["kind"] == "split_node_into_children")
    assert split["target_entity_ids"] == ["root_1"]
    assert split["payload"]["titles"] == ["目标", "约束", "动作"]
    assert len(split["payload"]["child_node_ids"]) == 3


def test_planner_builds_merge_transform_for_selected_nodes() -> None:
    planner = CanvasNativePlannerService()

    state = {
        "agent_run_id": "ar_plan_merge",
        "intent": {
            "domain": "canvas",
            "user_goal": "把这几个节点合并成：增长策略",
        },
        "messages_context": [
            {
                "role": "user",
                "content": "把这几个节点合并成：增长策略",
            }
        ],
        "canvas_runtime": {"repair_attempt_limit": 1},
    }
    context = {
        "canvas_id": "canvas_1",
        "workspace_id": "acct_1",
        "focus_scope": "selection",
        "focus_node_ids": ["n1", "n2", "n3"],
        "focus_connection_ids": [],
        "focus_nodes": [
            {"id": "n1", "content": "增长"},
            {"id": "n2", "content": "拉新"},
            {"id": "n3", "content": "激活"},
        ],
        "current_server_version": 8,
        "anchor_box": {"x": 0, "y": 0, "width": 480, "height": 220, "center_x": 240, "center_y": 110},
    }

    payload = planner.plan(state=state, context=context).to_dict()

    merge = next(transform for transform in payload["transforms"] if transform["kind"] == "merge_selection_into_node")
    assert merge["target_entity_ids"] == ["n1", "n2", "n3"]
    assert merge["payload"]["title"] == "增长策略"
    assert merge["payload"]["merged_node_id"]


def test_planner_auto_connects_selected_nodes_for_timeline_conversion() -> None:
    planner = CanvasNativePlannerService()

    state = {
        "agent_run_id": "ar_plan_timeline_selection",
        "intent": {"domain": "canvas", "user_goal": "把这些节点整理成时间线"},
        "messages_context": [{"role": "user", "content": "把这些节点整理成时间线"}],
        "canvas_runtime": {"repair_attempt_limit": 1},
    }
    context = {
        "canvas_id": "canvas_1",
        "workspace_id": "acct_1",
        "focus_scope": "selection",
        "focus_node_ids": ["n1", "n2", "n3"],
        "focus_connection_ids": [],
        "focus_nodes": [{"id": "n1"}, {"id": "n2"}, {"id": "n3"}],
        "current_server_version": 8,
        "anchor_box": {"x": 0, "y": 0, "width": 480, "height": 220, "center_x": 240, "center_y": 110},
    }

    payload = planner.plan(state=state, context=context).to_dict()

    assert payload["layout"]["strategy"] == "timeline"
    assert len(payload["connections"]) == 2
    assert payload["connections"][0]["relation"] == "next"


def test_planner_uses_best_path_root_for_selection_mindmap() -> None:
    planner = CanvasNativePlannerService()

    state = {
        "agent_run_id": "ar_plan_selection_mindmap",
        "intent": {"domain": "canvas", "user_goal": "把这些节点整理成脑图"},
        "messages_context": [{"role": "user", "content": "把这些节点整理成脑图"}],
        "canvas_runtime": {"repair_attempt_limit": 1, "plan_budget_ms": 25},
    }
    context = {
        "canvas_id": "canvas_1",
        "workspace_id": "acct_1",
        "focus_scope": "selection",
        "focus_node_ids": ["hub", "leaf_1", "leaf_2"],
        "focus_connection_ids": ["c1", "c2"],
        "focus_nodes": [
            {"id": "hub", "content": "目标", "x": 220, "y": 100},
            {"id": "leaf_1", "content": "风险", "x": 0, "y": 0},
            {"id": "leaf_2", "content": "策略", "x": 420, "y": 0},
        ],
        "focus_connections": [
            {"id": "c1", "from": "hub", "to": "leaf_1"},
            {"id": "c2", "from": "hub", "to": "leaf_2"},
        ],
        "current_server_version": 10,
        "anchor_box": {"x": 0, "y": 0, "width": 480, "height": 220, "center_x": 240, "center_y": 110},
    }

    payload = planner.plan(state=state, context=context).to_dict()

    assert payload["layout"]["strategy"] == "mindmap"
    assert payload["layout"]["root_entity_id"] == "hub"
    assert payload["connections"][0]["source_entity_id"] == "hub"
    assert payload["metadata"]["best_path"]["selection_topology"]["shape"] == "star"
