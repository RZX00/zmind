import pytest

from core.langgraph_engine.checkpoint_store import MemoryCheckpointStore
from core.langgraph_engine.contracts.engine_interface import RunConfig
from core.langgraph_engine.engine import LangGraphEngine
from core.utils.config import config


@pytest.mark.asyncio
async def test_canvas_native_route_bypasses_call_model(monkeypatch) -> None:
    monkeypatch.setattr(config, "CANVAS_NATIVE_RUNTIME_ENABLED", True, raising=False)
    monkeypatch.setattr(config, "CANVAS_NATIVE_RUNTIME_SHADOW", True, raising=False)
    monkeypatch.setattr(config, "CANVAS_NATIVE_VERIFY_ENABLED", True, raising=False)
    monkeypatch.setattr(config, "CANVAS_NATIVE_MAX_REPAIR_ATTEMPTS", 1, raising=False)

    async def call_model(state, ctx):
        raise AssertionError("classic call_model should not run for native-eligible canvas requests")

    engine = LangGraphEngine(
        call_model_fn=call_model,
        checkpoint_store=MemoryCheckpointStore(),
        persist_events=False,
        tool_context={
            "interaction_surface": "canvas",
            "canvas_id": "canvas_native_1",
            "account_id": "acct_native_1",
        },
    )
    cfg = RunConfig(
        agent_run_id="ar_native_graph_1",
        thread_id="th_native_graph_1",
        project_id=None,
        account_id="acct_native_1",
        model_name="openai/gpt-4o-mini",
        initial_messages_context=[
            {"role": "user", "content": "请整理当前画布布局。"}
        ],
    )

    events = []
    async for event in engine.run(cfg):
        events.append(event)

    assert any(event.get("type") == "assistant_final" for event in events)
    status_events = [event for event in events if event.get("type") == "status"]
    assert any(event.get("terminal_status") == "completed" for event in status_events)
