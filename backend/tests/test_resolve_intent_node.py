import pytest

from core.langgraph_engine.checkpoint_store import MemoryCheckpointStore
from core.langgraph_engine.contracts.engine_interface import RunConfig
from core.langgraph_engine.engine import LangGraphEngine
from core.langgraph_engine.nodes.resolve_intent import DefaultResolveIntentNode


@pytest.mark.asyncio
async def test_resolve_intent_node_sets_canvas_domain() -> None:
    node = DefaultResolveIntentNode()
    state = {
        "messages_context": [
            {
                "role": "user",
                "content": "请整理这个画布，把节点按主题分组后自动排版。",
            }
        ],
        "agent_config": None,
    }

    class _Ctx:
        tool_context = {"interaction_surface": "canvas"}

    new_state = await node(state, _Ctx())

    assert new_state["domain"] == "canvas"
    assert new_state["intent"]["target_surface"] == "canvas"
    assert new_state["intent"]["confidence"] >= 0.7


@pytest.mark.asyncio
async def test_engine_resolves_intent_before_call_model() -> None:
    captured: dict[str, object] = {}

    async def call_model(state, ctx):
        captured["domain"] = state.get("domain")
        captured["intent"] = state.get("intent")
        state["termination"] = {"should_terminate": True, "reason": "done"}
        return state

    engine = LangGraphEngine(
        call_model_fn=call_model,
        checkpoint_store=MemoryCheckpointStore(),
        persist_events=False,
        tool_context={"interaction_surface": "canvas"},
    )
    cfg = RunConfig(
        agent_run_id="ar_intent_001",
        thread_id="th_intent_001",
        project_id=None,
        account_id="acct_intent_001",
        model_name="openai/gpt-4o-mini",
        initial_messages_context=[
            {"role": "user", "content": "把当前画布重新排版，并补齐关键连接。"}
        ],
    )

    async for _event in engine.run(cfg):
        pass

    assert captured["domain"] == "canvas"
    intent = captured["intent"]
    assert isinstance(intent, dict)
    assert intent["domain"] == "canvas"
