from __future__ import annotations

from .engine_interface import RunConfig
from .event_schema import EngineEvent
from .legacy_stream_contract import LegacySSEPayload
from .state_schema import GraphState
from .tool_interface import ToolCall, ToolExecutionResult


SAMPLE_RUN_CONFIG = RunConfig(
    agent_run_id="ar_0000000001",
    thread_id="th_0000000001",
    project_id="prj_0000000001",
    account_id="acct_0000000001",
    model_name="openai/gpt-4o-mini",
    enable_thinking=False,
    reasoning_effort="low",
    enable_context_manager=True,
    enable_prompt_caching=True,
    agent_config={"name": "Default", "agent_id": "default"},
    max_iterations=5,
    engine="langgraph",
    engine_version="v1",
    is_shadow=False,
    side_effect_policy="allow_all",
)


SAMPLE_TOOL_CALL: ToolCall = {
    "id": "call_0001",
    "name": "web_search_tool",
    "arguments": {"query": "LangGraph checkpoint resume pattern"},
}


SAMPLE_TOOL_RESULT: ToolExecutionResult = {
    "tool_call_id": "call_0001",
    "name": "web_search_tool",
    "success": True,
    "started_at": "2025-01-01T00:00:00Z",
    "ended_at": "2025-01-01T00:00:01Z",
    "output": {"results": [{"title": "Example", "url": "https://example.com"}]},
}


SAMPLE_STATE: GraphState = {
    "agent_run_id": SAMPLE_RUN_CONFIG.agent_run_id,
    "thread_id": SAMPLE_RUN_CONFIG.thread_id,
    "project_id": SAMPLE_RUN_CONFIG.project_id,
    "account_id": SAMPLE_RUN_CONFIG.account_id,
    "model_name": SAMPLE_RUN_CONFIG.model_name,
    "enable_thinking": SAMPLE_RUN_CONFIG.enable_thinking,
    "reasoning_effort": SAMPLE_RUN_CONFIG.reasoning_effort,
    "enable_context_manager": SAMPLE_RUN_CONFIG.enable_context_manager,
    "enable_prompt_caching": SAMPLE_RUN_CONFIG.enable_prompt_caching,
    "agent_config": SAMPLE_RUN_CONFIG.agent_config,
    "messages_context": [{"role": "user", "content": "Hello"}],
    "session_index": 0,
    "iteration": 0,
    "max_iterations": SAMPLE_RUN_CONFIG.max_iterations,
    "pending_tool_calls": [SAMPLE_TOOL_CALL],
    "tool_results": [SAMPLE_TOOL_RESULT],
    "termination": {"should_terminate": False, "reason": "not_finished"},
    "checkpoint_id": None,
    "checkpoint_thread_id": SAMPLE_RUN_CONFIG.agent_run_id,
    "engine": SAMPLE_RUN_CONFIG.engine,
    "engine_version": SAMPLE_RUN_CONFIG.engine_version,
    "is_shadow": SAMPLE_RUN_CONFIG.is_shadow,
    "shadow_parent_run_id": SAMPLE_RUN_CONFIG.shadow_parent_run_id,
    "side_effect_policy": SAMPLE_RUN_CONFIG.side_effect_policy,
}


SAMPLE_EVENTS: list[EngineEvent] = [
    {
        "type": "status",
        "timestamp": "2025-01-01T00:00:00Z",
        "agent_run_id": SAMPLE_RUN_CONFIG.agent_run_id,
        "thread_id": SAMPLE_RUN_CONFIG.thread_id,
        "thread_run_id": "tr_0001",
        "status_type": "thread_run_start",
    },
    {
        "type": "assistant_chunk",
        "timestamp": "2025-01-01T00:00:00Z",
        "agent_run_id": SAMPLE_RUN_CONFIG.agent_run_id,
        "thread_id": SAMPLE_RUN_CONFIG.thread_id,
        "thread_run_id": "tr_0001",
        "content": "Searching…",
    },
    {
        "type": "tool_message",
        "timestamp": "2025-01-01T00:00:01Z",
        "agent_run_id": SAMPLE_RUN_CONFIG.agent_run_id,
        "thread_id": SAMPLE_RUN_CONFIG.thread_id,
        "thread_run_id": "tr_0001",
        "message_id": "7b0a16a3-1cb2-42e7-8ed4-dc0c6b62b9e9",
        "tool_call_id": SAMPLE_TOOL_CALL["id"],
        "name": SAMPLE_TOOL_CALL["name"],
        "content": "{\"results\": [{\"title\": \"Example\", \"url\": \"https://example.com\"}]}",
        "success": True,
    },
    {
        "type": "assistant_final",
        "timestamp": "2025-01-01T00:00:02Z",
        "agent_run_id": SAMPLE_RUN_CONFIG.agent_run_id,
        "thread_id": SAMPLE_RUN_CONFIG.thread_id,
        "thread_run_id": "tr_0001",
        "message_id": "0c4e7f69-8d1f-4704-8b12-69847e22377a",
        "content": {"role": "assistant", "content": "Here are the results…", "tool_calls": None},
    },
    {
        "type": "llm_response_end",
        "timestamp": "2025-01-01T00:00:02Z",
        "agent_run_id": SAMPLE_RUN_CONFIG.agent_run_id,
        "thread_id": SAMPLE_RUN_CONFIG.thread_id,
        "thread_run_id": "tr_0001",
        "message_id": "3a2c6550-06d0-4d44-9325-0a96ee87a70a",
        "llm_response_id": "llm_0001",
        "model": SAMPLE_RUN_CONFIG.model_name,
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        "finish_reason": "stop",
    },
    {
        "type": "status",
        "timestamp": "2025-01-01T00:00:02Z",
        "agent_run_id": SAMPLE_RUN_CONFIG.agent_run_id,
        "thread_id": SAMPLE_RUN_CONFIG.thread_id,
        "status_type": "run_completed",
        "terminal_status": "completed",
    },
]


SAMPLE_LEGACY_SSE_PAYLOADS: list[LegacySSEPayload] = [
    {
        "sequence": 0,
        "message_id": None,
        "thread_id": SAMPLE_RUN_CONFIG.thread_id,
        "type": "assistant",
        "is_llm_message": True,
        "content": "{\"role\": \"assistant\", \"content\": \"Hello\"}",
        "metadata": "{\"stream_status\": \"chunk\", \"thread_run_id\": \"tr_0001\"}",
        "created_at": "2025-01-01T00:00:00Z",
        "updated_at": "2025-01-01T00:00:00Z",
    },
    {
        "sequence": 1,
        "message_id": None,
        "thread_id": SAMPLE_RUN_CONFIG.thread_id,
        "type": "assistant",
        "is_llm_message": True,
        "content": "{\"role\": \"assistant\", \"content\": \"(thinking) ...\"}",
        "metadata": "{\"stream_status\": \"chunk\", \"thread_run_id\": \"tr_0001\", \"channel\": \"reasoning\"}",
        "created_at": "2025-01-01T00:00:00Z",
        "updated_at": "2025-01-01T00:00:00Z",
    },
    {
        "message_id": "msg_asst_0001",
        "thread_id": SAMPLE_RUN_CONFIG.thread_id,
        "type": "assistant",
        "is_llm_message": True,
        "content": "{\"role\": \"assistant\", \"content\": \"Final answer\", \"tool_calls\": null}",
        "metadata": "{\"thread_run_id\": \"tr_0001\", \"stream_status\": \"complete\"}",
        "created_at": "2025-01-01T00:00:02Z",
        "updated_at": "2025-01-01T00:00:02Z",
    },
    {"type": "status", "status": "completed", "message": "Agent run completed successfully"},
    {"type": "ping"},
]
