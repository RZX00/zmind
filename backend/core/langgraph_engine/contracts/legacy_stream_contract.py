from __future__ import annotations

from typing import Any, Literal, NotRequired, TypedDict


# These templates must remain compatible with the existing Redis/SSE protocol
# implemented in `backend/run_agent_background.py` and `backend/core/agent_runs.py`.
LEGACY_REDIS_RESPONSE_LIST_KEY_TEMPLATE: str = "agent_run:{agent_run_id}:responses"
LEGACY_REDIS_RESPONSE_CHANNEL_TEMPLATE: str = "agent_run:{agent_run_id}:new_response"
LEGACY_REDIS_CONTROL_CHANNEL_TEMPLATE: str = "agent_run:{agent_run_id}:control"


LegacyMessageType = Literal["assistant", "tool", "status", "llm_response_end", "user", "system"]
LegacyStreamStatus = Literal["chunk", "complete"]
LegacyChannel = Literal["reasoning"]


class LegacyChunkMetadataObj(TypedDict, total=False):
    """
    Parsed metadata object (NOTE: in the legacy stream this is serialized as a JSON string).

    Common keys (non-exhaustive):
    - agent_run_id: str
    - thread_run_id: str
    - stream_status: "chunk" | "complete"
    - channel: "reasoning" (when provider exposes separate reasoning tokens)
    - llm_response_id: str (used for billing/persistence dedupe)
    """

    agent_run_id: str
    thread_run_id: str
    stream_status: LegacyStreamStatus
    channel: LegacyChannel
    llm_response_id: str


class LegacyChunkContentObj(TypedDict, total=False):
    """
    Parsed content object (NOTE: in the legacy stream this is serialized as a JSON string).

    Common keys (non-exhaustive):
    - role: "assistant" | "tool" | "system" | "user"
    - content: str | dict
    - tool_calls: list | None
    - status_type: str (for transient UI status updates)
    """

    role: str
    content: Any
    tool_calls: Any
    status_type: str


class LegacyMessageChunkRequired(TypedDict):
    """
    Legacy message-shaped chunk written into Redis (list) and read by SSE clients.

    IMPORTANT: `content` and `metadata` are JSON strings (backward compatibility),
    produced by `to_json_string()` / `format_for_yield()` in `core/utils/json_helpers.py`.
    """

    message_id: str | None
    thread_id: str
    type: LegacyMessageType
    content: str
    metadata: str
    created_at: str
    updated_at: str


class LegacyMessageChunk(LegacyMessageChunkRequired, total=False):
    """Legacy chunk with optional fields that appear in streaming or DB objects."""

    sequence: int
    is_llm_message: bool
    session_index: int


LegacyTerminalRunStatus = Literal["completed", "failed", "stopped", "error"]


class LegacyTerminalStatusChunk(TypedDict):
    """
    Run-level terminal status injected by the worker or stream endpoint.

    This is *not* a message object; it exists to allow the frontend to stop listening.
    """

    type: Literal["status"]
    status: LegacyTerminalRunStatus
    message: NotRequired[str]


class LegacyPingChunk(TypedDict):
    """SSE keep-alive event payload emitted by `/agent-run/{id}/stream` (not stored in Redis)."""

    type: Literal["ping"]


LegacyStreamChunk = LegacyMessageChunk | LegacyTerminalStatusChunk
LegacySSEPayload = LegacyStreamChunk | LegacyPingChunk

