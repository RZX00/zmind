from core.ai_models.registry import ModelRegistry


def test_legacy_gpt53_codex_aliases_resolve_to_gpt54() -> None:
    registry = ModelRegistry()

    assert registry.resolve_model_id("gpt-5.4") == "gpt-5.4"
    assert registry.resolve_model_id("gpt-5.4-high") == "gpt-5.4"
    assert registry.resolve_model_id("gpt-5.3-codex-high") == "gpt-5.4"
    assert registry.resolve_model_id("gpt-5.3-codex") == "gpt-5.4"
    assert registry.resolve_model_id("azure/gpt-5.3-codex-high") == "gpt-5.4"
    assert registry.resolve_model_id("azure/gpt-5.3-codex") == "gpt-5.4"

    assert registry.resolve_model_id("habitat/gpt-5.4") == "habitat/gpt-5.4"
    assert registry.resolve_model_id("habitat-gpt-5.4") == "habitat/gpt-5.4"
    assert registry.resolve_model_id("habitat:gpt-5.4") == "habitat/gpt-5.4"
    assert registry.resolve_model_id("leaflow/gpt-5.4") == "habitat/gpt-5.4"
