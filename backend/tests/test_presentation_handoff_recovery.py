import copy
import json
from types import SimpleNamespace

import pytest

from core.langgraph_engine.supervisor.agent_defs import PRESENTATION_AGENT
from core.langgraph_engine.supervisor.handoff_tools import build_handoff_tool_specs


def _presentation_transfer_spec():
    specs = build_handoff_tool_specs({"presentation_agent": PRESENTATION_AGENT})
    return next(spec for spec in specs if spec.name == "transfer_to_presentation_agent")


@pytest.mark.asyncio
async def test_presentation_handoff_recovers_html_when_render_succeeds_but_run_fails(monkeypatch):
    render_html = "<!DOCTYPE html><html><body>demo</body></html>"
    subagent_result = {
        "success": False,
        "error": "graph_run_failed: ",
        "output": {
            "agent": "presentation_agent",
            "display_name": "Presentation Agent",
            "content": json.dumps(
                {
                    "title": "Demo Deck",
                    "style": "startup",
                    "slides": [{"order": 1, "layout": "title", "title": "Demo"}],
                },
                ensure_ascii=False,
            ),
            "tool_messages": [
                {
                    "name": "render_presentation",
                    "content": json.dumps(render_html, ensure_ascii=False),
                    "success": True,
                    "error": None,
                    "tool_call_id": "render_1",
                    "metadata": {
                        "slide_count": 1,
                        "style": "startup",
                        "slides_json": {
                            "title": "Demo Deck",
                            "style": "startup",
                            "slides": [{"order": 1, "layout": "title", "title": "Demo"}],
                        },
                    },
                }
            ],
        },
    }

    async def _fake_run_subagent(**_: object):
        return copy.deepcopy(subagent_result)

    class _FakeRegistry:
        def __init__(self) -> None:
            self.calls: list[dict] = []

        async def execute_tool_call(self, tool_call, _context):
            self.calls.append(tool_call)
            return {
                "tool_call_id": tool_call["id"],
                "name": "canvas_write",
                "success": True,
                "started_at": "2026-03-03T00:00:00+00:00",
                "ended_at": "2026-03-03T00:00:01+00:00",
                "output": {"canvas": {"id": "canvas_demo"}},
            }

    fake_registry = _FakeRegistry()

    monkeypatch.setattr("core.langgraph_engine.supervisor.handoff_tools.run_subagent", _fake_run_subagent)
    monkeypatch.setattr(
        "core.langgraph_engine.supervisor.handoff_tools.build_registry",
        lambda **_: fake_registry,
    )

    spec = _presentation_transfer_spec()
    result = await spec.handler(
        {"task": "生成PPT", "context": "创赛风格"},
        {
            "state": {"messages_context": [{"role": "user", "content": "生成PPT"}]},
            "run_config": SimpleNamespace(agent_run_id=None, thread_id=None),
            "tool_call_id": "parent_call_1",
        },
    )

    assert result["success"] is True
    assert result["error"] is None
    assert fake_registry.calls, "expected fallback canvas_write to be executed"

    write_call = fake_registry.calls[0]
    assert write_call["name"] == "canvas_write"
    node = write_call["arguments"]["nodes"][0]
    assert node["type"] == "code"
    assert node["codeType"] == "html"
    assert node["content"] == render_html

    publish = result.get("metadata", {}).get("presentation_publish", {})
    assert publish.get("attempted") is True
    assert publish.get("write_success") is True
    assert publish.get("original_error") == "graph_run_failed: "

    tool_messages = result["output"]["tool_messages"]
    assert any(msg.get("name") == "canvas_write" and msg.get("success") for msg in tool_messages)
    presentation_data = node.get("data", {}).get("presentation", {})
    assert presentation_data.get("title") == "Demo Deck"
    assert presentation_data.get("style") == "startup"
    assert presentation_data.get("slideCount") == 1
    assert presentation_data.get("capabilities", {}).get("fullscreen") is True


@pytest.mark.asyncio
async def test_presentation_handoff_skips_recovery_if_canvas_write_already_succeeded(monkeypatch):
    subagent_result = {
        "success": True,
        "error": None,
        "output": {
            "agent": "presentation_agent",
            "display_name": "Presentation Agent",
            "content": "done",
            "tool_messages": [
                {"name": "render_presentation", "content": json.dumps("<html></html>"), "success": True, "error": None},
                {"name": "canvas_write", "content": json.dumps({"ok": True}), "success": True, "error": None},
            ],
        },
    }

    async def _fake_run_subagent(**_: object):
        return copy.deepcopy(subagent_result)

    def _should_not_be_called(**_):
        raise AssertionError("build_registry should not be called when canvas_write already succeeded")

    monkeypatch.setattr("core.langgraph_engine.supervisor.handoff_tools.run_subagent", _fake_run_subagent)
    monkeypatch.setattr("core.langgraph_engine.supervisor.handoff_tools.build_registry", _should_not_be_called)

    spec = _presentation_transfer_spec()
    result = await spec.handler(
        {"task": "继续"},
        {
            "state": {"messages_context": [{"role": "user", "content": "继续"}]},
            "run_config": SimpleNamespace(agent_run_id=None, thread_id=None),
        },
    )

    assert result["success"] is True
    assert result.get("metadata", {}).get("presentation_publish") is None


@pytest.mark.asyncio
async def test_presentation_handoff_marks_success_when_canvas_write_already_succeeded_but_run_failed(monkeypatch):
    subagent_result = {
        "success": False,
        "error": "graph_run_failed: ",
        "output": {
            "agent": "presentation_agent",
            "display_name": "Presentation Agent",
            "content": "done",
            "tool_messages": [
                {"name": "render_presentation", "content": json.dumps("<html></html>"), "success": True, "error": None},
                {"name": "canvas_write", "content": json.dumps({"ok": True}), "success": True, "error": None},
            ],
        },
    }

    async def _fake_run_subagent(**_: object):
        return copy.deepcopy(subagent_result)

    def _should_not_be_called(**_):
        raise AssertionError("build_registry should not be called when canvas_write already succeeded")

    monkeypatch.setattr("core.langgraph_engine.supervisor.handoff_tools.run_subagent", _fake_run_subagent)
    monkeypatch.setattr("core.langgraph_engine.supervisor.handoff_tools.build_registry", _should_not_be_called)

    spec = _presentation_transfer_spec()
    result = await spec.handler(
        {"task": "继续"},
        {
            "state": {"messages_context": [{"role": "user", "content": "继续"}]},
            "run_config": SimpleNamespace(agent_run_id=None, thread_id=None),
        },
    )

    assert result["success"] is True
    assert result["error"] is None
    publish = result.get("metadata", {}).get("presentation_publish", {})
    assert publish.get("write_success") is True
    assert publish.get("used_existing_canvas_write") is True
