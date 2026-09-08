from __future__ import annotations

from typing import Any, Literal, NotRequired, TypedDict


EngineEventType = Literal[
    "assistant_chunk",
    "assistant_final",
    "tool_message",
    "status",
    "llm_response_end",
    "error",
]


class EngineEventBase(TypedDict):
    """
    Canonical engine event envelope (v1).

    Notes:
    - `timestamp` is ISO-8601 UTC string for deterministic downstream rendering.
    - `thread_run_id` groups events belonging to a single model call (old system used this).
    """

    type: EngineEventType
    timestamp: str
    agent_run_id: str
    thread_id: str
    thread_run_id: NotRequired[str]
    iteration: NotRequired[int]
    checkpoint_id: NotRequired[str | None]
    sequence: NotRequired[int]
    metadata: NotRequired[dict[str, Any]]


class AssistantChunkEvent(EngineEventBase):
    type: Literal["assistant_chunk"]
    content: str
    channel: NotRequired[Literal["reasoning"]]


class AssistantFinalEvent(EngineEventBase):
    type: Literal["assistant_final"]
    message_id: str
    content: dict[str, Any]
    metadata: NotRequired[dict[str, Any]]


class ToolMessageEvent(EngineEventBase):
    type: Literal["tool_message"]
    message_id: str
    tool_call_id: str
    name: str
    content: str
    success: bool
    error: NotRequired[str]
    metadata: NotRequired[dict[str, Any]]


class StatusEvent(EngineEventBase):
    type: Literal["status"]
    message_id: NotRequired[str]
    status_type: str
    message: NotRequired[str]
    data: NotRequired[dict[str, Any]]
    metadata: NotRequired[dict[str, Any]]
    # When present, indicates a terminal run-level status for adapters ("completed"/"failed"/"stopped"/"error").
    terminal_status: NotRequired[str]


class LLMResponseEndEvent(EngineEventBase):
    type: Literal["llm_response_end"]
    message_id: str
    llm_response_id: str
    model: str
    usage: dict[str, Any]
    finish_reason: str
    response_ms: NotRequired[float]
    metadata: NotRequired[dict[str, Any]]
    assistant_message: NotRequired[dict[str, Any]]


class ErrorEvent(EngineEventBase):
    type: Literal["error"]
    message: str
    error_type: NotRequired[str]
    details: NotRequired[dict[str, Any]]


EngineEvent = (
    AssistantChunkEvent
    | AssistantFinalEvent
    | ToolMessageEvent
    | StatusEvent
    | LLMResponseEndEvent
    | ErrorEvent
)

