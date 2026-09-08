from __future__ import annotations

from typing import Any, Mapping

from core.langgraph_engine.contracts.event_schema import EngineEvent
from core.langgraph_engine.contracts.legacy_stream_contract import (
    LegacyMessageChunk,
    LegacyStreamChunk,
)
from core.utils.json_helpers import format_for_yield, to_json_string


class LegacyStreamAdapter:
    """
    Translate canonical `EngineEvent` into the *legacy* Redis/SSE chunk protocol.

    Contract:
    - Pure mapping: same input event -> same output chunk.
    - Output shape must match existing legacy stream chunks
      (see `core/utils/json_helpers.py`).
    """

    @staticmethod
    def to_legacy_chunk(event: EngineEvent) -> LegacyStreamChunk:
        event_type = event["type"]
        timestamp = event["timestamp"]
        thread_id = event["thread_id"]

        if event_type == "assistant_chunk":
            metadata_obj: dict[str, Any] = {}
            event_metadata = event.get("metadata")
            if isinstance(event_metadata, dict):
                metadata_obj.update(event_metadata)
            metadata_obj["stream_status"] = "chunk"
            thread_run_id = event.get("thread_run_id")
            if thread_run_id:
                metadata_obj["thread_run_id"] = thread_run_id
            if event.get("channel") == "reasoning":
                metadata_obj["channel"] = "reasoning"

            chunk: LegacyMessageChunk = {
                "message_id": None,
                "thread_id": thread_id,
                "type": "assistant",
                "is_llm_message": True,
                "content": to_json_string({"role": "assistant", "content": event["content"]}),
                "metadata": to_json_string(metadata_obj),
                "created_at": timestamp,
                "updated_at": timestamp,
            }
            sequence = event.get("sequence")
            if isinstance(sequence, int):
                chunk["sequence"] = sequence
            return chunk

        if event_type == "assistant_final":
            # Preserve any upstream metadata but always enforce legacy-required fields.
            metadata_obj: dict[str, Any] = {}
            event_metadata = event.get("metadata")
            if isinstance(event_metadata, dict):
                metadata_obj.update(event_metadata)
            thread_run_id = event.get("thread_run_id")
            if thread_run_id:
                metadata_obj["thread_run_id"] = thread_run_id
            metadata_obj["stream_status"] = "complete"

            msg_obj: Mapping[str, Any] = {
                "message_id": event["message_id"],
                "thread_id": thread_id,
                "type": "assistant",
                "is_llm_message": True,
                "content": event["content"],
                "metadata": metadata_obj,
                "created_at": timestamp,
                "updated_at": timestamp,
            }
            return format_for_yield(dict(msg_obj))  # type: ignore[return-value]

        if event_type == "tool_message":
            tool_message = {
                "role": "tool",
                "tool_call_id": event["tool_call_id"],
                "name": event["name"],
                "content": event["content"],
            }
            metadata_obj: dict[str, Any] = {}
            event_metadata = event.get("metadata")
            if isinstance(event_metadata, dict):
                metadata_obj.update(event_metadata)
            msg_obj: Mapping[str, Any] = {
                "message_id": event["message_id"],
                "thread_id": thread_id,
                "type": "tool",
                "is_llm_message": True,
                "content": tool_message,
                "metadata": metadata_obj,
                "created_at": timestamp,
                "updated_at": timestamp,
            }
            return format_for_yield(dict(msg_obj))  # type: ignore[return-value]

        if event_type == "status":
            content_obj: dict[str, Any] = {}
            data = event.get("data")
            if isinstance(data, dict):
                content_obj.update(data)
            content_obj["status_type"] = event["status_type"]
            if event.get("message") and "message" not in content_obj:
                content_obj["message"] = event["message"]

            metadata_obj: dict[str, Any] = {}
            event_metadata = event.get("metadata")
            if isinstance(event_metadata, dict):
                metadata_obj.update(event_metadata)
            thread_run_id = event.get("thread_run_id")
            if thread_run_id:
                metadata_obj["thread_run_id"] = thread_run_id

            msg_obj: Mapping[str, Any] = {
                "message_id": event.get("message_id"),
                "thread_id": thread_id,
                "type": "status",
                "is_llm_message": False,
                "content": content_obj,
                "metadata": metadata_obj,
                "created_at": timestamp,
                "updated_at": timestamp,
            }
            return format_for_yield(dict(msg_obj))  # type: ignore[return-value]

        if event_type == "llm_response_end":
            assistant_message = event.get("assistant_message")
            if not isinstance(assistant_message, dict):
                assistant_message = {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": None,
                }

            llm_metadata: dict[str, Any] = {}
            event_metadata = event.get("metadata")
            if isinstance(event_metadata, dict):
                llm_metadata.update(event_metadata)

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

            thread_run_id = event.get("thread_run_id")
            metadata_obj: dict[str, Any] = {}
            # Match legacy insertion order: thread_run_id first, then llm_response_id.
            if thread_run_id:
                metadata_obj["thread_run_id"] = thread_run_id
            metadata_obj.update(llm_metadata)
            metadata_obj["llm_response_id"] = event["llm_response_id"]

            msg_obj: Mapping[str, Any] = {
                "message_id": event["message_id"],
                "thread_id": thread_id,
                "type": "llm_response_end",
                "is_llm_message": False,
                "content": llm_end_content,
                "metadata": metadata_obj,
                "created_at": timestamp,
                "updated_at": timestamp,
            }
            return format_for_yield(dict(msg_obj))  # type: ignore[return-value]

        if event_type == "error":
            content_obj: dict[str, Any] = {
                "role": "system",
                "status_type": "error",
                "message": event["message"],
            }
            metadata_obj: dict[str, Any] = {}
            thread_run_id = event.get("thread_run_id")
            if thread_run_id:
                metadata_obj["thread_run_id"] = thread_run_id

            msg_obj: Mapping[str, Any] = {
                "message_id": None,
                "thread_id": thread_id,
                "type": "status",
                "is_llm_message": False,
                "content": content_obj,
                "metadata": metadata_obj,
                "created_at": timestamp,
                "updated_at": timestamp,
            }
            return format_for_yield(dict(msg_obj))  # type: ignore[return-value]

        raise ValueError(f"Unsupported EngineEvent type: {event_type}")
