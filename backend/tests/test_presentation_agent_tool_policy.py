from __future__ import annotations

from core.langgraph_engine.supervisor.agent_defs import PRESENTATION_AGENT, resolve_agent_prompt


def test_presentation_agent_disallows_image_generation_tool() -> None:
    allowed = PRESENTATION_AGENT.allowed_names or set()
    assert "canvas_generate_image" not in allowed
    assert "render_presentation" in allowed
    assert "canvas_write" in allowed
    assert "canvas_edit" in allowed


def test_presentation_agent_prompt_explicitly_bans_image_generation() -> None:
    prompt = resolve_agent_prompt(PRESENTATION_AGENT)
    assert "Do NOT call `canvas_generate_image`" in prompt
