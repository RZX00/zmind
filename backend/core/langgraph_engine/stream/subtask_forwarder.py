from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional

from core.langgraph_engine.contracts.event_schema import EngineEvent
from core.langgraph_engine.persistence.message_writer import message_writer
from core.langgraph_engine.stream import LegacyStreamAdapter, RedisStreamWriter
from core.utils.logger import logger

EventForwarder = Callable[[EngineEvent], Awaitable[None]]


@dataclass(frozen=True, slots=True)
class SubtaskForwarderConfig:
    parent_agent_run_id: str
    parent_thread_id: str
    parent_session_index: int | None = None
    parent_checkpoint_id: str | None = None
    engine: str | None = None
    engine_version: str | None = None
    is_shadow: bool = False
    subagent: str | None = None
    subagent_display_name: str | None = None
    parent_tool_call_id: str | None = None
    task_run_id: str | None = None
    persist_tool_messages: bool = False


def build_subtask_event_forwarder(cfg: SubtaskForwarderConfig) -> EventForwarder | None:
    if not cfg.parent_agent_run_id or not cfg.parent_thread_id:
        return None

    adapter = LegacyStreamAdapter()
    writer = RedisStreamWriter(cfg.parent_agent_run_id)

    persist_state: dict[str, Any] = {
        "agent_run_id": cfg.parent_agent_run_id,
        "thread_id": cfg.parent_thread_id,
        "engine": cfg.engine,
        "engine_version": cfg.engine_version,
        "session_index": cfg.parent_session_index or 0,
        "checkpoint_id": cfg.parent_checkpoint_id,
        "is_shadow": bool(cfg.is_shadow),
    }

    async def _forward_event(event: EngineEvent) -> None:
        event_type = event.get("type")
        if event_type == "status":
            status_type = event.get("status_type")
            if status_type not in {"tool_started", "tool_completed", "tool_failed", "tool_error"}:
                return
        elif event_type != "tool_message":
            return

        metadata = dict(event.get("metadata") or {})
        if cfg.subagent:
            metadata.setdefault("subagent", cfg.subagent)
        if cfg.subagent_display_name:
            metadata.setdefault("subagent_display_name", cfg.subagent_display_name)
        if cfg.parent_tool_call_id:
            metadata.setdefault("parent_tool_call_id", cfg.parent_tool_call_id)
        if cfg.task_run_id:
            metadata.setdefault("task_run_id", cfg.task_run_id)
        if cfg.parent_session_index is not None:
            metadata.setdefault("session_index", cfg.parent_session_index)

        forwarded = dict(event)
        forwarded["agent_run_id"] = cfg.parent_agent_run_id
        forwarded["thread_id"] = cfg.parent_thread_id
        forwarded["metadata"] = metadata

        chunk = adapter.to_legacy_chunk(forwarded)
        await writer.write_chunk(chunk)

        if cfg.persist_tool_messages and event_type == "tool_message":
            try:
                await message_writer.write_once(persist_state, forwarded)
            except Exception as persist_err:
                logger.debug(
                    "Subtask tool event persistence failed",
                    error=str(persist_err),
                    subagent=cfg.subagent,
                )

    return _forward_event

