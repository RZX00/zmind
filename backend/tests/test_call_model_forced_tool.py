from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from core.langgraph_engine.nodes.call_model import DefaultCallModelNode


class _StubToolRegistry:
    def get(self, name: str) -> object | None:
        if name == "run_skill":
            return object()
        return None


@pytest.mark.asyncio
async def test_forced_tool_call_injects_pending_call() -> None:
    events: list[dict[str, Any]] = []

    async def emit(event: dict[str, Any]) -> None:
        events.append(event)

    tool_context = {
        "forced_tool_call": {
            "tool": "run_skill",
            "skill_id": "ppt-plan",
            "input": "Generate a 10-slide SaaS pitch deck",
            "reason": "matcher_score",
            "score": 9,
            "threshold": 7,
        }
    }
    ctx = SimpleNamespace(
        stop_event=None,
        emit=emit,
        tool_context=tool_context,
    )
    node = DefaultCallModelNode(tool_registry=_StubToolRegistry())
    state = {
        "agent_run_id": "ar_1",
        "thread_id": "thread_1",
        "model_name": "openai/gpt-4o-mini",
        "messages_context": [],
        "engine": "langgraph",
        "engine_version": "2.0",
        "iteration": 0,
    }

    result = await node(state, ctx)

    assert result["termination"]["reason"] == "has_tool_calls"
    assert len(result["pending_tool_calls"]) == 1
    pending = result["pending_tool_calls"][0]
    assert pending["name"] == "run_skill"
    assert pending["arguments"]["skill_id"] == "ppt-plan"
    assert pending["arguments"]["input"] == "Generate a 10-slide SaaS pitch deck"

    assert tool_context.get("forced_tool_call") is None
    assert tool_context.get("forced_tool_call_consumed") is True

    assert [event["type"] for event in events] == ["status", "assistant_final", "llm_response_end"]
    assert events[0]["status_type"] == "forced_tool_call"
