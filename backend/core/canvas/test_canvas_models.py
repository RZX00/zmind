from core.canvas.api_models import CanvasDoc, CanvasNode


def test_canvas_node_allows_custom_group_mode_strings():
    node = CanvasNode(
        id="group-1",
        type="group",
        x=0,
        y=0,
        width=100,
        height=80,
        content="",
        groupMode="container",
    )

    doc = CanvasDoc(
        id="canvas-1",
        title="Test Canvas",
        nodes=[node],
        connections=[],
        createdAt=0,
        updatedAt=0,
        version="1",
    )

    assert doc.nodes[0].groupMode == "container"
