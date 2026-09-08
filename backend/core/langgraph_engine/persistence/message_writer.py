from __future__ import annotations

import inspect
from typing import Any, Awaitable, Callable, Mapping

from core.langgraph_engine.contracts.event_schema import EngineEvent
from core.langgraph_engine.contracts.state_schema import GraphState
from core.services.supabase import DBConnection
from core.utils.logger import logger


class MessageWriterError(RuntimeError):
    pass


def _safe_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        v = value.strip()
        return v or None
    try:
        return str(value)
    except Exception:
        return None


def _is_unique_violation(exc: Exception) -> bool:
    code = getattr(exc, "code", None) or getattr(exc, "sqlstate", None)
    if code == "23505":
        return True
    details = getattr(exc, "details", None)
    if isinstance(details, str) and "23505" in details:
        return True
    msg = str(exc).lower()
    return "duplicate key value" in msg or "unique constraint" in msg or "23505" in msg


def _status_tool_call_id(event: Mapping[str, Any]) -> str | None:
    data = event.get("data")
    if not isinstance(data, dict):
        return None
    return _safe_str(data.get("tool_call_id") or data.get("toolCallId") or data.get("tool_call"))


def _message_dedup_key(state: GraphState, event: EngineEvent) -> str | None:
    agent_run_id = state["agent_run_id"]
    event_type = event["type"]

    if event_type == "assistant_final":
        return f"{agent_run_id}:assistant_final:{event['message_id']}"

    if event_type == "tool_message":
        return f"{agent_run_id}:tool:{event['tool_call_id']}"

    if event_type == "llm_response_end":
        return f"{agent_run_id}:llm_response_end:{event['llm_response_id']}"

    if event_type == "status":
        status_type = _safe_str(event.get("status_type")) or "unknown"
        thread_run_id = _safe_str(event.get("thread_run_id")) or "none"
        tool_call_id = _status_tool_call_id(event) or "none"
        return f"{agent_run_id}:status:{status_type}:{thread_run_id}:{tool_call_id}"

    if event_type == "error":
        thread_run_id = _safe_str(event.get("thread_run_id")) or "none"
        return f"{agent_run_id}:status:error:{thread_run_id}"

    # Never persist streaming chunks.
    if event_type == "assistant_chunk":
        return None

    return None


def _build_message_row(state: GraphState, event: EngineEvent) -> dict[str, Any] | None:
    event_type = event["type"]
    if event_type == "assistant_chunk":
        return None

    # v1 policy: shadow run writes 0 rows to `messages`.
    if state.get("is_shadow"):
        return None

    message_dedup_key = _message_dedup_key(state, event)
    if not message_dedup_key:
        return None

    thread_id = state["thread_id"]
    session_index = int(state.get("session_index") or 0)
    engine = state.get("engine")
    engine_version = state.get("engine_version")
    checkpoint_id = event.get("checkpoint_id", state.get("checkpoint_id"))

    metadata_obj: dict[str, Any] = {}
    event_metadata = event.get("metadata")
    if isinstance(event_metadata, dict):
        metadata_obj.update(event_metadata)

    thread_run_id = _safe_str(event.get("thread_run_id"))
    if thread_run_id:
        metadata_obj["thread_run_id"] = thread_run_id
    metadata_obj.setdefault("session_index", session_index)

    # Base row shared by all persisted event types.
    row: dict[str, Any] = {
        "thread_id": thread_id,
        "metadata": metadata_obj,
        "message_dedup_key": message_dedup_key,
        "engine": engine,
        "engine_version": engine_version,
        "checkpoint_id": checkpoint_id,
        "is_shadow": False,
    }

    if event_type == "assistant_final":
        row.update(
            {
                "message_id": event["message_id"],
                "type": "assistant",
                "is_llm_message": True,
                "content": event["content"],
            }
        )
        return row

    if event_type == "tool_message":
        tool_content = {
            "role": "tool",
            "tool_call_id": event["tool_call_id"],
            "name": event["name"],
            "content": event["content"],
        }
        row.update(
            {
                "message_id": event["message_id"],
                "type": "tool",
                "is_llm_message": True,
                "content": tool_content,
            }
        )
        return row

    if event_type == "status":
        content_obj: dict[str, Any] = {}
        data = event.get("data")
        if isinstance(data, dict):
            content_obj.update(data)
        content_obj["status_type"] = event["status_type"]
        if event.get("message") and "message" not in content_obj:
            content_obj["message"] = event["message"]

        row.update({"type": "status", "is_llm_message": False, "content": content_obj})
        status_message_id = _safe_str(event.get("message_id"))
        if status_message_id:
            row["message_id"] = status_message_id
        return row

    if event_type == "llm_response_end":
        assistant_message = event.get("assistant_message") or {
            "role": "assistant",
            "content": "",
            "tool_calls": None,
        }
        llm_end_content: dict[str, Any] = {
            "model": event["model"],
            "usage": event["usage"],
            "streaming": True,
            "choices": [
                {
                    "finish_reason": event["finish_reason"],
                    "index": 0,
                    "message": assistant_message,
                }
            ],
            "llm_response_id": event["llm_response_id"],
        }
        if event.get("response_ms") is not None:
            llm_end_content["response_ms"] = event["response_ms"]

        row.update(
            {
                "message_id": event["message_id"],
                "type": "llm_response_end",
                "is_llm_message": False,
                "content": llm_end_content,
                "llm_response_id": event["llm_response_id"],
                "billing_dedup_key": f"{state['agent_run_id']}:{event['llm_response_id']}",
            }
        )
        return row

    if event_type == "error":
        content_obj: dict[str, Any] = {
            "role": "system",
            "status_type": "error",
            "message": event["message"],
        }
        row.update(
            {
                "type": "status",
                "is_llm_message": False,
                "content": content_obj,
            }
        )
        return row

    return None


class MessageWriter:
    def __init__(self, client_getter: Callable[[], Awaitable[Any] | Any] | None = None):
        self._db = DBConnection()
        self._client_getter = client_getter or self._get_db_client

    async def _get_db_client(self) -> Any:
        return await self._db.client

    async def _resolve_client(self) -> Any:
        maybe_client = self._client_getter()
        if inspect.isawaitable(maybe_client):
            return await maybe_client
        return maybe_client

    async def write_once(self, state: GraphState, event: EngineEvent) -> dict[str, Any] | None:
        row = _build_message_row(state, event)
        if row is None:
            return None

        dedup_key = row.get("message_dedup_key")
        if not isinstance(dedup_key, str) or not dedup_key:
            return None

        client = await self._resolve_client()
        try:
            result = await client.table("messages").insert(row).execute()
            if getattr(result, "data", None):
                return result.data[0]
            return None
        except Exception as e:
            if _is_unique_violation(e):
                existing = await client.table("messages").select("*").eq("message_dedup_key", dedup_key).limit(1).execute()
                if getattr(existing, "data", None):
                    return existing.data[0]
                raise MessageWriterError(f"message_dedup_key_conflict_but_missing: {dedup_key}") from e

            logger.error(
                "[MESSAGE_WRITER] Failed to persist message",
                message_dedup_key=dedup_key,
                agent_run_id=state.get("agent_run_id"),
                thread_id=state.get("thread_id"),
                event_type=event.get("type"),
                error=str(e),
            )
            raise MessageWriterError(f"message_persist_failed: {dedup_key}: {e}") from e


message_writer = MessageWriter()
