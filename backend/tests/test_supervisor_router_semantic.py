from __future__ import annotations

import asyncio

import pytest

from core.langgraph_engine.supervisor import router


@pytest.mark.asyncio
async def test_route_from_semantic_uses_requested_model(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def fake_make_llm_api_call(**kwargs):
        captured.update(kwargs)
        return {"choices": [{"message": {"content": '{"should_delegate": false, "agents": []}'}}]}

    monkeypatch.delenv("SEMANTIC_ROUTER_TIMEOUT_MS", raising=False)
    monkeypatch.setattr(router, "make_llm_api_call", fake_make_llm_api_call)

    hint = await router.route_from_semantic(
        "hello",
        model_name="habitat/gpt-5.4",
        has_attachments=False,
        cta_action=None,
    )

    assert hint.should_delegate is False
    assert captured["model_name"] == "habitat/gpt-5.4"
    assert captured["response_format"] is None


@pytest.mark.asyncio
async def test_route_from_semantic_enables_json_format_for_compatible_model(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def fake_make_llm_api_call(**kwargs):
        captured.update(kwargs)
        return {"choices": [{"message": {"content": '{"should_delegate": false, "agents": []}'}}]}

    monkeypatch.setattr(router, "make_llm_api_call", fake_make_llm_api_call)

    hint = await router.route_from_semantic(
        "hello",
        model_name="habitat/gemini-3.1-pro",
        has_attachments=False,
        cta_action=None,
    )

    assert hint.should_delegate is False
    assert captured["model_name"] == "habitat/gemini-3.1-pro"
    assert captured["response_format"] == {"type": "json_object"}


@pytest.mark.asyncio
async def test_route_from_semantic_times_out_fast(monkeypatch) -> None:
    async def fake_make_llm_api_call(**_kwargs):
        await asyncio.sleep(0.05)
        return {"choices": [{"message": {"content": '{"should_delegate": false, "agents": []}'}}]}

    monkeypatch.setenv("SEMANTIC_ROUTER_TIMEOUT_MS", "5")
    monkeypatch.setattr(router, "make_llm_api_call", fake_make_llm_api_call)

    with pytest.raises(TimeoutError):
        await router.route_from_semantic(
            "hello",
            model_name="habitat/gpt-5.4",
            has_attachments=False,
            cta_action=None,
        )
