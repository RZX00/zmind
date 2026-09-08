from core.application.services.intent_resolution_service import IntentResolutionService


def test_intent_resolution_prefers_canvas_for_canvas_workflows() -> None:
    service = IntentResolutionService()

    resolution = service.resolve(
        "请把这个画布里的节点自动排版，并补上缺失的连线。",
        interaction_surface="canvas",
    )

    assert resolution.domain == "canvas"
    assert resolution.target_surface == "canvas"
    assert resolution.confidence >= 0.7
    assert "surface:canvas" in resolution.signals


def test_intent_resolution_identifies_research_requests() -> None:
    service = IntentResolutionService()

    resolution = service.resolve("请搜索最新的行业资料，并给我可靠来源。")

    assert resolution.domain == "research"
    assert resolution.target_surface is None
    assert resolution.confidence >= 0.55
