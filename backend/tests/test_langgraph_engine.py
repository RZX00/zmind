import asyncio
from typing import List

import pytest

from core.langgraph_engine.checkpoint_store import MemoryCheckpointStore
from core.langgraph_engine.contracts.engine_interface import RunConfig
from core.langgraph_engine.contracts.event_schema import EngineEvent
from core.langgraph_engine.engine import LangGraphEngine


def _run_config(**overrides):
    cfg = RunConfig(
        agent_run_id="ar_test",
        thread_id="th_test",
        project_id="prj_test",
        account_id="acct_test",
        model_name="openai/gpt-4o-mini",
    )
    for k, v in overrides.items():
        setattr(cfg, k, v)
    return cfg


async def _drain(engine: LangGraphEngine, cfg: RunConfig, limit: int | None = None) -> List[EngineEvent]:
    events: List[EngineEvent] = []
    async for ev in engine.run(cfg):
        events.append(ev)
        if limit is not None and len(events) >= limit:
            break
    return events


class _NoopPersister:
    async def persist(self, state, event):
        return None


class _FailingPersister:
    def __init__(self):
        self.calls = 0

    async def persist(self, state, event):
        self.calls += 1
        raise RuntimeError("persist_failed")


@pytest.mark.asyncio
async def test_happy_path_no_tools():
    async def call_model(state, ctx):
        ts = "2025-01-01T00:00:00Z"
        await ctx.emit(
            {
                "type": "assistant_chunk",
                "timestamp": ts,
                "agent_run_id": state["agent_run_id"],
                "thread_id": state["thread_id"],
                "content": "Hello",
            }
        )
        await ctx.emit(
            {
                "type": "llm_response_end",
                "timestamp": ts,
                "agent_run_id": state["agent_run_id"],
                "thread_id": state["thread_id"],
                "message_id": "msg_llm_end",
                "llm_response_id": "llm_1",
                "model": state["model_name"],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                "finish_reason": "stop",
            }
        )
        state["termination"] = {"should_terminate": True, "reason": "done"}
        return state

    engine = LangGraphEngine(
        call_model_fn=call_model,
        checkpoint_store=MemoryCheckpointStore(),
        persist_events=False,
        event_persister=_NoopPersister(),
    )
    events = await _drain(engine, _run_config())
    types = [e["type"] for e in events]
    assert "assistant_chunk" in types
    assert any(e.get("terminal_status") == "completed" for e in events if e["type"] == "status")


@pytest.mark.asyncio
async def test_checkpoint_resume_does_not_repeat_tools():
    tool_runs: List[str] = []
    store = MemoryCheckpointStore()

    async def call_model(state, ctx):
        # iteration is incremented in node wrapper
        if state["iteration"] <= 1:
            state["pending_tool_calls"] = [{"id": "call1", "name": "tool_a", "arguments": {}}]
            state["termination"] = {"should_terminate": False, "reason": "needs_tool"}
        else:
            state["termination"] = {"should_terminate": True, "reason": "done"}
        return state

    async def execute_tools(state, ctx):
        tool_runs.append(f"run_{state['iteration']}")
        tc = state["pending_tool_calls"][0]
        await ctx.emit(
            {
                "type": "tool_message",
                "timestamp": "2025-01-01T00:00:00Z",
                "agent_run_id": state["agent_run_id"],
                "thread_id": state["thread_id"],
                "tool_call_id": tc["id"],
                "name": tc["name"],
                "message_id": f"tool_{tc['id']}",
                "content": "ok",
                "success": True,
            }
        )
        state["tool_results"] = [
            {
                "tool_call_id": tc["id"],
                "name": tc["name"],
                "success": True,
                "started_at": "2025-01-01T00:00:00Z",
                "ended_at": "2025-01-01T00:00:01Z",
            }
        ]
        state["pending_tool_calls"] = []
        return state

    engine = LangGraphEngine(
        call_model_fn=call_model,
        execute_tools_fn=execute_tools,
        checkpoint_store=store,
        persist_events=False,
        event_persister=_NoopPersister(),
    )

    # First partial run: stop after first emitted event to simulate interruption
    events_partial: List[EngineEvent] = []
    async for ev in engine.run(_run_config()):
        events_partial.append(ev)
        if ev["type"] == "tool_message":
            break

    # Grab last checkpoint id
    last_cp = max(store._store["ar_test"], key=lambda r: r["created_at"])["checkpoint_id"]  # type: ignore[attr-defined]

    # Resume from checkpoint
    events_resumed = await _drain(engine, _run_config(checkpoint_id=last_cp))

    # Tool execution should have happened exactly once
    assert tool_runs == ["run_1"]
    # Resume should complete
    assert any(e.get("terminal_status") == "completed" for e in events_resumed if e["type"] == "status")


@pytest.mark.asyncio
async def test_stop_signal_terminates():
    stop_event = asyncio.Event()
    stop_event.set()
    engine = LangGraphEngine(
        checkpoint_store=MemoryCheckpointStore(),
        persist_events=False,
        event_persister=_NoopPersister(),
    )
    events = await _drain(engine, _run_config(stop_event=stop_event))
    status = [e for e in events if e["type"] == "status"]
    assert any(s.get("terminal_status") == "stopped" for s in status)


@pytest.mark.asyncio
async def test_max_iterations_fails():
    engine = LangGraphEngine(
        checkpoint_store=MemoryCheckpointStore(),
        persist_events=False,
        event_persister=_NoopPersister(),
    )
    events = await _drain(engine, _run_config(max_iterations=0))
    status = [e for e in events if e["type"] == "status"]
    assert any(s.get("status_type") == "run_max_iterations" for s in status)
    assert any(s.get("terminal_status") == "error" for s in status)


@pytest.mark.asyncio
async def test_persistence_error_fails_run():
    async def call_model(state, ctx):
        ts = "2025-01-01T00:00:00Z"
        await ctx.emit(
            {
                "type": "assistant_final",
                "timestamp": ts,
                "agent_run_id": state["agent_run_id"],
                "thread_id": state["thread_id"],
                "thread_run_id": "tr-1",
                "iteration": state.get("iteration"),
                "message_id": "msg-asst-1",
                "content": {"role": "assistant", "content": "hi"},
                "metadata": {"engine": "langgraph"},
            }
        )
        state["termination"] = {"should_terminate": True, "reason": "done"}
        return state

    persister = _FailingPersister()
    engine = LangGraphEngine(
        call_model_fn=call_model,
        checkpoint_store=MemoryCheckpointStore(),
        event_persister=persister,
    )

    events = await _drain(engine, _run_config())
    assert persister.calls == 1
    types = [e["type"] for e in events]
    assert "assistant_final" in types
    assert "error" not in types
    assert any(e.get("status_type") == "run_completed" for e in events if e["type"] == "status")
