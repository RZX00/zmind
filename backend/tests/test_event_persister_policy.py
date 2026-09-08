from __future__ import annotations

from typing import Any

import pytest

from core.langgraph_engine.persistence.event_persister import EventPersister


class _FakeWriter:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    async def write_once(self, _state: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
        self.events.append(event)
        return {"ok": True}


class _FakeBilling:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    async def deduct_once(self, _state: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
        self.events.append(event)
        return {"ok": True}


def _state() -> dict[str, Any]:
    return {
        "agent_run_id": "run-1",
        "thread_id": "thread-1",
        "session_index": 0,
    }


@pytest.mark.unit
@pytest.mark.asyncio
async def test_event_persister_defaults_to_terminal_status_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LANGGRAPH_PERSIST_STATUS_EVENTS", raising=False)
    monkeypatch.delenv("LANGGRAPH_PERSIST_STATUS_TERMINAL_ONLY", raising=False)
    monkeypatch.delenv("LANGGRAPH_PERSIST_STATUS_TYPES", raising=False)

    writer = _FakeWriter()
    billing = _FakeBilling()
    persister = EventPersister(message_writer_obj=writer, billing_guard_obj=billing)  # type: ignore[arg-type]

    await persister.persist(
        _state(), {"type": "status", "status_type": "thread_run_start"}  # type: ignore[arg-type]
    )
    await persister.persist(
        _state(), {"type": "status", "status_type": "run_completed"}  # type: ignore[arg-type]
    )

    assert len(writer.events) == 1
    assert writer.events[0].get("status_type") == "run_completed"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_event_persister_can_persist_all_status_events(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LANGGRAPH_PERSIST_STATUS_EVENTS", "true")
    monkeypatch.setenv("LANGGRAPH_PERSIST_STATUS_TERMINAL_ONLY", "false")
    monkeypatch.delenv("LANGGRAPH_PERSIST_STATUS_TYPES", raising=False)

    writer = _FakeWriter()
    billing = _FakeBilling()
    persister = EventPersister(message_writer_obj=writer, billing_guard_obj=billing)  # type: ignore[arg-type]

    await persister.persist(
        _state(), {"type": "status", "status_type": "thread_run_start"}  # type: ignore[arg-type]
    )
    await persister.persist(
        _state(), {"type": "status", "status_type": "tool_started"}  # type: ignore[arg-type]
    )

    assert [event.get("status_type") for event in writer.events] == [
        "thread_run_start",
        "tool_started",
    ]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_event_persister_respects_custom_terminal_status_types(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LANGGRAPH_PERSIST_STATUS_EVENTS", "false")
    monkeypatch.setenv("LANGGRAPH_PERSIST_STATUS_TERMINAL_ONLY", "true")
    monkeypatch.setenv("LANGGRAPH_PERSIST_STATUS_TYPES", "run_completed")

    writer = _FakeWriter()
    billing = _FakeBilling()
    persister = EventPersister(message_writer_obj=writer, billing_guard_obj=billing)  # type: ignore[arg-type]

    await persister.persist(
        _state(), {"type": "status", "status_type": "run_stopped"}  # type: ignore[arg-type]
    )
    await persister.persist(
        _state(), {"type": "status", "status_type": "run_completed"}  # type: ignore[arg-type]
    )
    await persister.persist(
        _state(),
        {"type": "status", "status_type": "thread_run_end", "terminal_status": "completed"},  # type: ignore[arg-type]
    )
    await persister.persist(
        _state(),
        {"type": "llm_response_end", "llm_response_id": "llm-1"},  # type: ignore[arg-type]
    )

    assert [event.get("status_type") for event in writer.events[:-1]] == [
        "run_completed",
        "thread_run_end",
    ]
    assert writer.events[-1].get("type") == "llm_response_end"
    assert len(billing.events) == 1
