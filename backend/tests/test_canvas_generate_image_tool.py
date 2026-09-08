from core.media.generation_service import GeneratedMediaItem
from core.tools.canvas_generate_image_tool import (
    MAX_CANVAS_GENERATED_IMAGE_DIMENSION,
    CanvasGenerateImageTool,
)


def test_canvas_generate_image_tool_clamps_node_size_to_800():
    tool = CanvasGenerateImageTool(thread_id="th_test", canvas_id="cv_test")
    item = GeneratedMediaItem(
        storage_path="file-uploads/acct_test/generated.png",
        width=2000,
        height=1000,
        mime_type="image/png",
        byte_size=123,
        file_id="file_test",
    )

    ops = tool._build_add_node_operations("prompt", [item])
    node = ops[0]["node"]
    assert node["width"] <= MAX_CANVAS_GENERATED_IMAGE_DIMENSION
    assert node["height"] <= MAX_CANVAS_GENERATED_IMAGE_DIMENSION
    assert node["width"] == 800.0
    assert node["height"] == 400.0


def test_canvas_generate_image_tool_does_not_upscale_small_images():
    tool = CanvasGenerateImageTool(thread_id="th_test", canvas_id="cv_test")
    item = GeneratedMediaItem(
        storage_path="file-uploads/acct_test/small.png",
        width=640,
        height=480,
        mime_type="image/png",
        byte_size=123,
        file_id="file_small",
    )

    ops = tool._build_add_node_operations("prompt", [item])
    node = ops[0]["node"]
    assert node["width"] == 640.0
    assert node["height"] == 480.0


def test_canvas_generate_image_tool_clamps_by_height_when_tall():
    tool = CanvasGenerateImageTool(thread_id="th_test", canvas_id="cv_test")
    item = GeneratedMediaItem(
        storage_path="file-uploads/acct_test/tall.png",
        width=600,
        height=1200,
        mime_type="image/png",
        byte_size=123,
        file_id="file_tall",
    )

    ops = tool._build_add_node_operations("prompt", [item])
    node = ops[0]["node"]
    assert node["width"] == 400.0
    assert node["height"] == 800.0
