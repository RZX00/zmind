import pytest
from pydantic import BaseModel

from core.langgraph_engine.checkpoint_store import MemoryCheckpointStore
from core.langgraph_engine.contracts import DISABLED_IN_SHADOW_ERROR, SideEffectLevel, ToolSpec, fixtures
from core.langgraph_engine.engine import LangGraphEngine
from core.langgraph_engine.nodes.execute_tools import DefaultExecuteToolsNode
from core.langgraph_engine.nodes import load_context as load_context_module
from core.langgraph_engine.tools.registry import InMemoryToolRegistry
from core.langgraph_engine.contracts.engine_interface import RunConfig


class _NoArgs(BaseModel):
    pass


async def _ok_handler(args, context):
    return {"success": True}


@pytest.mark.asyncio
async def test_load_context_injects_system_prompt_and_messages(monkeypatch):
    async def _fake_load_thread_messages(*_args, **_kwargs):
        return [
            {
                "role": "user",
                "content": "hi",
                "metadata": {"session_index": 3},
            }
        ]

    monkeypatch.setattr(load_context_module, "load_thread_messages", _fake_load_thread_messages)
    monkeypatch.setattr(load_context_module, "augment_messages_with_image_urls", lambda msgs: msgs)

    async def call_model(state, ctx):
        assert state["messages_context"]
        sys_msg = state["messages_context"][0]
        assert sys_msg["role"] == "system"
        # Tool hints appended
        assert "dummy_tool" in sys_msg.get("content", "")
        assert state["session_index"] == 3
        state["termination"] = {"should_terminate": True, "reason": "done"}
        return state

    registry = InMemoryToolRegistry()
    registry.register(
        ToolSpec(
            name="dummy_tool",
            description="dummy description",
            args_model=_NoArgs,
            handler=_ok_handler,
        )
    )

    engine = LangGraphEngine(
        call_model_fn=call_model,
        checkpoint_store=MemoryCheckpointStore(),
        persist_events=False,
        tool_context={"db_connection": object()},
        tool_registry=registry,
    )
    cfg = RunConfig(
        agent_run_id="ar_ctx",
        thread_id="th_ctx",
        project_id=None,
        account_id="acct_ctx",
        model_name="openai/gpt-4o-mini",
    )

    events = []
    async for ev in engine.run(cfg):
        events.append(ev)
    assert any(e.get("type") == "status" for e in events)


@pytest.mark.asyncio
async def test_execute_tools_shadow_returns_disabled_error():
    registry = InMemoryToolRegistry()
    registry.register(
        ToolSpec(
            name="write_tool",
            description="dummy",
            args_model=_NoArgs,
            handler=_ok_handler,
            side_effect_level=SideEffectLevel.REVERSIBLE_WRITE,
        )
    )

    node = DefaultExecuteToolsNode(registry)
    state = dict(fixtures.SAMPLE_STATE)
    state["pending_tool_calls"] = [{"id": "tc1", "name": "write_tool", "arguments": {}}]
    state["tool_results"] = []
    state["is_shadow"] = True
    state["side_effect_policy"] = "dry_run"

    events = []

    class _Ctx:
        async def emit(self, event):
            events.append(event)

    new_state = await node(state, _Ctx())
    assert new_state["tool_results"]
    assert new_state["tool_results"][0]["success"] is False
    assert new_state["tool_results"][0].get("error") == DISABLED_IN_SHADOW_ERROR
    assert events and events[0].get("type") == "tool_message"


@pytest.mark.asyncio
async def test_execute_tools_blocks_canvas_tools_in_doc_surface():
    registry = InMemoryToolRegistry()
    registry.register(
        ToolSpec(
            name="canvas_write",
            description="dummy canvas write",
            args_model=_NoArgs,
            handler=_ok_handler,
            side_effect_level=SideEffectLevel.REVERSIBLE_WRITE,
        )
    )

    node = DefaultExecuteToolsNode(registry)
    state = dict(fixtures.SAMPLE_STATE)
    state["pending_tool_calls"] = [{"id": "tc_doc_1", "name": "canvas_write", "arguments": {}}]
    state["tool_results"] = []

    events = []

    class _Ctx:
        tool_context = {"interaction_surface": "doc"}

        async def emit(self, event):
            events.append(event)

    new_state = await node(state, _Ctx())
    assert new_state["tool_results"]
    assert new_state["tool_results"][0]["success"] is False
    assert new_state["tool_results"][0].get("error") == "tool_blocked_for_surface:doc"
    assert any(event.get("type") == "tool_message" for event in events)


@pytest.mark.asyncio
async def test_execute_tools_blocks_task_tool_in_doc_surface():
    registry = InMemoryToolRegistry()
    registry.register(
        ToolSpec(
            name="task",
            description="dummy task tool",
            args_model=_NoArgs,
            handler=_ok_handler,
            side_effect_level=SideEffectLevel.READ_ONLY,
        )
    )

    node = DefaultExecuteToolsNode(registry)
    state = dict(fixtures.SAMPLE_STATE)
    state["pending_tool_calls"] = [{"id": "tc_doc_task_1", "name": "task", "arguments": {}}]
    state["tool_results"] = []

    events = []

    class _Ctx:
        tool_context = {"interaction_surface": "doc"}

        async def emit(self, event):
            events.append(event)

    new_state = await node(state, _Ctx())
    assert new_state["tool_results"]
    assert new_state["tool_results"][0]["success"] is False
    assert new_state["tool_results"][0].get("error") == "tool_blocked_for_surface:doc"
    assert any(event.get("type") == "tool_message" for event in events)


@pytest.mark.asyncio
async def test_execute_tools_allows_doc_native_tool_in_doc_surface():
    registry = InMemoryToolRegistry()
    registry.register(
        ToolSpec(
            name="doc_read_context",
            description="dummy doc read tool",
            args_model=_NoArgs,
            handler=_ok_handler,
            side_effect_level=SideEffectLevel.READ_ONLY,
        )
    )

    node = DefaultExecuteToolsNode(registry)
    state = dict(fixtures.SAMPLE_STATE)
    state["pending_tool_calls"] = [{"id": "tc_doc_read_1", "name": "doc_read_context", "arguments": {}}]
    state["tool_results"] = []

    events = []

    class _Ctx:
        tool_context = {"interaction_surface": "doc"}

        async def emit(self, event):
            events.append(event)

    new_state = await node(state, _Ctx())
    assert new_state["tool_results"]
    assert new_state["tool_results"][0]["success"] is True
    assert new_state["tool_results"][0].get("error") is None
    assert any(event.get("type") == "tool_message" for event in events)


@pytest.mark.asyncio
async def test_execute_tools_blocks_non_doc_tool_in_doc_surface():
    registry = InMemoryToolRegistry()
    registry.register(
        ToolSpec(
            name="web_search",
            description="dummy web search tool",
            args_model=_NoArgs,
            handler=_ok_handler,
            side_effect_level=SideEffectLevel.READ_ONLY,
        )
    )

    node = DefaultExecuteToolsNode(registry)
    state = dict(fixtures.SAMPLE_STATE)
    state["pending_tool_calls"] = [{"id": "tc_doc_block_1", "name": "web_search", "arguments": {}}]
    state["tool_results"] = []

    events = []

    class _Ctx:
        tool_context = {"interaction_surface": "doc"}

        async def emit(self, event):
            events.append(event)

    new_state = await node(state, _Ctx())
    assert new_state["tool_results"]
    assert new_state["tool_results"][0]["success"] is False
    assert new_state["tool_results"][0].get("error") == "tool_blocked_for_surface:doc"
    assert any(event.get("type") == "tool_message" for event in events)
