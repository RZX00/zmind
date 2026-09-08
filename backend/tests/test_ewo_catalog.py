import pytest

from core.ai_models.ai_models import ModelCapability
from core.ai_models.manager import ModelManager
from core.ai_models.provider_policy import provider_display_name, SPONSORED_PROVIDER_BADGE
from core.ai_models.registry import ModelRegistry, DEFAULT_FREE_MODEL
from core.utils.config import Configuration


def test_catalog_exposes_all_text_models_without_images():
    manager = ModelManager()
    manager.registry = ModelRegistry()
    visible = manager.list_available_models()
    assert len(visible) == 30
    assert len(manager.list_available_models(include_non_chat=True)) == 33
    ids = {m["id"] for m in visible}
    assert DEFAULT_FREE_MODEL in ids
    assert "habitat/gpt-6-astra" in ids
    assert "habitat/claude-fable-5" in ids
    assert "habitat/deepseek-v4-pro-0813" in ids
    assert "habitat/gpt-image-2" not in ids
    assert all("chat" in model["capabilities"] for model in visible)
    assert not manager.registry.get("habitat/gemini-3.1-pro").enabled
    assert manager.get_default_model("free").id == DEFAULT_FREE_MODEL
    assert manager.get_default_model("paid").id == DEFAULT_FREE_MODEL


def test_legacy_and_ewo_ids_resolve_without_changing_saved_ids():
    registry = ModelRegistry()
    for raw in ("gpt-5.6-sol", "gpt-6-astra", "gpt-image-2", "gemini-3.1-pro"):
        assert registry.resolve_model_id(f"ewo/{raw}") == f"habitat/{raw}"
        assert registry.resolve_model_id(f"habitat/{raw}") == f"habitat/{raw}"
    assert registry.resolve_model_id("leaflow/gpt-5.4") == "habitat/gpt-5.4"
    assert provider_display_name("habitat") == "Ewo"
    assert SPONSORED_PROVIDER_BADGE == "Ewo Sponsor"


def test_image_models_are_enabled_but_not_chat_capable():
    registry = ModelRegistry()
    for raw in ("gpt-image-2", "gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview"):
        model = registry.get(f"ewo/{raw}")
        assert model.enabled
        assert model.capabilities == [ModelCapability.IMAGE_GENERATION]
        assert model.metadata["protocol_support"]["imageGeneration"]


def test_catalog_preserves_prices_and_protocols_without_inventing_prices():
    registry = ModelRegistry()
    assert registry.get(DEFAULT_FREE_MODEL).pricing is not None
    assert registry.get("ewo/gpt-6-astra").pricing is None
    assert registry.get("ewo/gpt-5.6-luna").metadata["protocol_support"] == {"openAiResponses": True}
    assert registry.get("ewo/claude-opus-4.6").metadata["protocol_support"] == {"anthropicMessages": True}


def test_legacy_key_is_reused_and_old_gateway_is_migrated():
    config = Configuration.__new__(Configuration)
    config.HABITAT_API_KEY = "old-test-key"
    config.HABITAT_API_BASE = "https://api.aihabitat.live/v1"
    config._normalize_ewo_config()
    assert config.EWO_API_KEY == config.HABITAT_API_KEY == "old-test-key"
    assert config.EWO_API_BASE == config.HABITAT_API_BASE == "https://eapi.site/v1"


def test_explicit_ewo_settings_take_precedence_and_append_v1():
    config = Configuration.__new__(Configuration)
    config.EWO_API_KEY = "new-test-key"
    config.EWO_API_BASE = "https://eapi.site/"
    config.HABITAT_API_KEY = "old-test-key"
    config.HABITAT_API_BASE = "https://api.aihabitat.live/v1"
    config._normalize_ewo_config()
    assert config.HABITAT_API_KEY == "new-test-key"
    assert config.HABITAT_API_BASE == "https://eapi.site/v1"


@pytest.mark.asyncio
@pytest.mark.parametrize("model", ["ewo/gpt-5.6-luna", "ewo/gpt-6-astra", "ewo/codex-auto-review"])
async def test_responses_models_use_native_protocol(monkeypatch, model):
    from core.services import llm

    calls = []

    async def fake_call(**kwargs):
        calls.append(kwargs)
        return {"choices": []}

    monkeypatch.setattr(llm, "_habitat_responses_call", fake_call)
    await llm.make_llm_api_call(messages=[{"role": "user", "content": "Hi"}], model_name=model)
    assert calls[0]["raw_model"] == model.split("/", 1)[-1]


@pytest.mark.parametrize("model,provider,base", [
    ("ewo/claude-opus-4.6", "anthropic", "https://eapi.site"),
    ("ewo/gemini-3.8-flash", "openai", "https://eapi.site/v1"),
    ("ewo/deepseek-v4-pro", "openai", "https://eapi.site/v1"),
])
def test_other_models_use_compatible_gateway_protocol(monkeypatch, model, provider, base):
    from core.services import llm

    monkeypatch.setattr(llm.config, "HABITAT_API_BASE", "https://eapi.site/v1")
    monkeypatch.setattr(llm.config, "HABITAT_API_KEY", "test-key")
    params = llm.prepare_params(messages=[{"role": "user", "content": "Hi"}], model_name=model)
    assert params["model"] == model.split("/", 1)[-1]
    assert params["custom_llm_provider"] == provider
    assert params["api_base"] == base
    assert params["api_key"] == "test-key"
