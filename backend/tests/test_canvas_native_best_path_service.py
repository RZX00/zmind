from core.application.services.canvas_native_best_path_service import (
    CanvasNativeBestPathService,
)


def test_best_path_prefers_timeline_for_chain_selection() -> None:
    service = CanvasNativeBestPathService()

    result = service.choose(
        latest_user_text="把这些节点整理成时间线",
        context={
            "focus_node_ids": ["n1", "n2", "n3"],
            "focus_nodes": [
                {"id": "n1", "x": 0, "y": 0, "content": "发现"},
                {"id": "n2", "x": 220, "y": 0, "content": "分析"},
                {"id": "n3", "x": 440, "y": 0, "content": "修复"},
            ],
            "focus_connections": [
                {"from": "n1", "to": "n2"},
                {"from": "n2", "to": "n3"},
            ],
            "anchor_box": {"center_x": 220, "center_y": 0},
        },
        create_titles=[],
        lane_groups=[],
        lane_names=[],
        current_layout_strategy="cluster",
        should_connect=False,
        budget_ms=20,
    )

    assert result["strategy"] == "timeline"
    assert result["selection_topology"]["shape"] == "chain"
    assert result["ordered_focus_node_ids"] == ["n1", "n2", "n3"]
    assert result["connect_pattern"] == "sequence"


def test_best_path_picks_center_hub_as_mindmap_root() -> None:
    service = CanvasNativeBestPathService()

    result = service.choose(
        latest_user_text="把这些节点整理成脑图",
        context={
            "focus_node_ids": ["hub", "a", "b", "c"],
            "focus_nodes": [
                {"id": "hub", "x": 200, "y": 120, "content": "目标"},
                {"id": "a", "x": 0, "y": 0, "content": "风险"},
                {"id": "b", "x": 420, "y": 0, "content": "策略"},
                {"id": "c", "x": 200, "y": 280, "content": "动作"},
            ],
            "focus_connections": [
                {"from": "hub", "to": "a"},
                {"from": "hub", "to": "b"},
                {"from": "hub", "to": "c"},
            ],
            "anchor_box": {"center_x": 200, "center_y": 120},
        },
        create_titles=[],
        lane_groups=[],
        lane_names=[],
        current_layout_strategy="cluster",
        should_connect=False,
        budget_ms=20,
    )

    assert result["strategy"] == "mindmap"
    assert result["selection_topology"]["shape"] == "star"
    assert result["selected_root_node_id"] == "hub"
    assert result["connect_pattern"] == "star"
