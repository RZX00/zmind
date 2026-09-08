from __future__ import annotations

from typing import Any, Literal, NotRequired, TypedDict

from .tool_interface import ToolCall, ToolExecutionResult

EngineName = Literal["langgraph"]
SideEffectPolicy = Literal["allow_all", "dry_run", "deny_write"]


class TerminationState(TypedDict):
    """Run termination decision attached to state."""

    should_terminate: bool
    reason: str
    message: NotRequired[str]


class GraphState(TypedDict):
    """
    LangGraph state schema (v1).

    This is a *frozen contract* shared across workstreams; fields listed here must
    remain backward compatible once merged (additive changes only via v2).
    """

    # Run identity
    agent_run_id: str
    thread_id: str
    project_id: str | None
    account_id: str

    # Model config
    model_name: str
    enable_thinking: bool | None
    reasoning_effort: str
    enable_context_manager: bool
    enable_prompt_caching: bool

    # Agent config (already merged with defaults upstream)
    agent_config: dict[str, Any] | None

    # Conversation context for model input (already trimmed/compressed)
    messages_context: list[dict[str, Any]]
    session_index: int

    # Iteration control
    iteration: int
    max_iterations: int

    # Tool execution
    pending_tool_calls: list[ToolCall]
    tool_results: list[ToolExecutionResult]

    # Termination
    termination: TerminationState

    # Checkpoint
    checkpoint_id: str | None
    # Must equal `agent_run_id` in v1 (decision 3).
    checkpoint_thread_id: str

    # Mode flags
    engine: EngineName
    engine_version: str
    is_shadow: bool
    shadow_parent_run_id: str | None
    side_effect_policy: SideEffectPolicy

    # Routing / recovery annotations (JSON-serializable only)
    domain: NotRequired[str | None]
    intent: NotRequired[dict[str, Any] | None]
    degraded_state: NotRequired[list[dict[str, Any]]]
    canvas_runtime: NotRequired[dict[str, Any] | None]
    canvas_context: NotRequired[dict[str, Any] | None]
    canvas_task: NotRequired[dict[str, Any] | None]
    canvas_execution: NotRequired[dict[str, Any] | None]
    canvas_verification: NotRequired[dict[str, Any] | None]
    repair_count: NotRequired[int]

