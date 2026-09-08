from core.application.services.canvas_native_layout_service import CanvasNativeLayoutService


def test_layout_service_builds_mindmap_with_center_root() -> None:
    service = CanvasNativeLayoutService()

    positions, metadata = service.compute_positions(
        entity_ids=["root", "a", "b", "c"],
        strategy="mindmap",
        anchor_box={"x": 0, "y": 0, "width": 400, "height": 200, "center_x": 200, "center_y": 100},
        root_entity_id="root",
    )

    assert metadata["root_entity_id"] == "root"
    assert positions["root"] == {"x": 200, "y": 100}
    assert set(positions.keys()) == {"root", "a", "b", "c"}


def test_layout_service_builds_swimlane_columns() -> None:
    service = CanvasNativeLayoutService()

    positions, metadata = service.compute_positions(
        entity_ids=["n1", "n2", "n3"],
        strategy="swimlane",
        anchor_box={"x": 20, "y": 40, "width": 500, "height": 240, "center_x": 270, "center_y": 160},
        lanes=[
            {"lane_id": "product", "label": "产品", "entity_ids": ["n1", "n2"]},
            {"lane_id": "engineering", "label": "技术", "entity_ids": ["n3"]},
        ],
    )

    assert len(metadata["lanes"]) == 2
    assert positions["n1"]["x"] == positions["n2"]["x"]
    assert positions["n3"]["x"] > positions["n1"]["x"]
    assert positions["n2"]["y"] > positions["n1"]["y"]


def test_layout_service_preserves_preferred_order_for_timeline() -> None:
    service = CanvasNativeLayoutService()

    positions, metadata = service.compute_positions(
        entity_ids=["n1", "n2", "n3"],
        strategy="timeline",
        anchor_box={"x": 0, "y": 0, "width": 400, "height": 200, "center_x": 200, "center_y": 100},
        preferred_order_ids=["n2", "n3", "n1"],
    )

    assert metadata["ordered_entity_ids"] == ["n2", "n3", "n1"]
    assert positions["n2"]["x"] < positions["n3"]["x"] < positions["n1"]["x"]


def test_layout_service_avoids_obstacle_within_budget() -> None:
    service = CanvasNativeLayoutService()

    positions, metadata = service.compute_positions(
        entity_ids=["new_1"],
        strategy="cluster",
        anchor_box={"x": 0, "y": 0, "width": 320, "height": 180, "center_x": 160, "center_y": 90},
        node_lookup={
            "obstacle_1": {"id": "obstacle_1", "x": 0, "y": 0, "width": 320, "height": 120},
        },
        budget_ms=20,
        collision_pass_limit=3,
    )

    assert metadata["collision_resolved_count"] >= 1
    assert metadata["budget_exceeded"] is False
    assert positions["new_1"]["x"] > 0 or positions["new_1"]["y"] > 0
