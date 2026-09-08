from __future__ import annotations

import asyncio
import contextlib
import json
import uuid
from typing import Any, Awaitable, Callable

from core.langgraph_engine.billing.billing_guard import BillingGuard
from core.langgraph_engine.checkpoint_store import MemoryCheckpointStore
from core.langgraph_engine.contracts.engine_interface import RunConfig
from core.langgraph_engine.contracts.event_schema import EngineEvent
from core.langgraph_engine.engine import LangGraphEngine
from core.langgraph_engine.tools.catalog import build_registry
from core.utils.logger import logger

from .agent_defs import AgentDef, resolve_agent_prompt
from core.langgraph_engine.research_graph import run_research_graph


class BillingOnlyEventPersister:
    def __init__(self, billing_guard: BillingGuard | None = None) -> None:
        self._billing_guard = billing_guard or BillingGuard()
        self._disabled = False

    async def persist(self, state: dict[str, Any], event: EngineEvent) -> None:
        if self._disabled:
            return
        if event.get("type") != "llm_response_end":
            return
        try:
            await self._billing_guard.deduct_once(state, event)  # type: ignore[arg-type]
        except Exception as exc:
            self._disabled = True
            logger.warning(
                "Subagent billing failed; disabling billing for remainder of run",
                error=str(exc),
            )


def _normalize_message_content(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, list):
        return "".join(str(item) for item in content)
    return str(content)


def _coerce_positive_int(value: Any, default: int) -> int:
    try:
        resolved = int(value)
    except Exception:
        return default
    if resolved <= 0:
        return default
    return min(resolved, 3600)


def _truncate_text(text: str, limit: int = 4000) -> str:
    trimmed = text.strip()
    if len(trimmed) <= limit:
        return trimmed
    return trimmed[:limit].rstrip() + " ...[truncated]"


def _extract_last_assistant(parent_state: dict[str, Any]) -> str:
    messages = parent_state.get("messages_context") or []
    for msg in reversed(messages):
        if isinstance(msg, dict) and msg.get("role") == "assistant":
            candidate = _normalize_message_content(msg.get("content")).strip()
            if candidate:
                return candidate
    return ""


def _build_initial_messages(
    agent_def: AgentDef,
    *,
    task: str,
    context: str | None,
    parent_state: dict[str, Any],
) -> list[dict[str, Any]]:
    parts = [f"Task: {_truncate_text(task)}"]
    if context:
        parts.append(f"Context: {_truncate_text(context)}")
    # Include the latest user message to reduce ambiguity when missing context.
    # Robust across message shapes: langgraph messages may use `type` (human/ai) instead of
    # `role` (user/assistant), and may live under different state keys.
    def _is_user_msg(m: dict) -> bool:
        v = str(m.get("role") or m.get("type") or "").strip().lower()
        return v in ("user", "human", "humanmessage")
    last_user = ""
    for _key in ("messages_context", "messages", "conversation", "history"):
        for msg in reversed(parent_state.get(_key) or []):
            if isinstance(msg, dict) and _is_user_msg(msg):
                cand = _normalize_message_content(msg.get("content")).strip()
                if cand:
                    last_user = cand
                    break
        if last_user:
            break
    draft = _extract_last_assistant(parent_state)
    if draft:
        draft = _truncate_text(draft)
        if context:
            if draft not in context:
                parts.append(f"Supervisor draft: {draft}")
        else:
            parts.append(f"Supervisor draft: {draft}")
    if last_user:
        parts.append(f"Latest user message: {_truncate_text(last_user)}")

    return [
        {"role": "system", "content": resolve_agent_prompt(agent_def)},
        {"role": "user", "content": "\n".join(parts)},
    ]


async def run_subagent(
    *,
    agent_def: AgentDef,
    task: str,
    context: str | None,
    parent_state: dict[str, Any],
    parent_run_config: RunConfig,
    tool_context: dict[str, Any],
    output_mode: str = "last_message",
    event_forwarder: Callable[[EngineEvent], Awaitable[None]] | None = None,
    plan_only: bool = False,
    confirmed_queries: list[str] | None = None,
    confirmed_task: str | None = None,
) -> dict[str, Any]:
    subagent_tool_context = dict(tool_context or {})
    if agent_def.name == "presentation_agent":
        agent_cfg = getattr(parent_run_config, "agent_config", None) or {}
        req_timeout = _coerce_positive_int(
            agent_cfg.get("presentation_llm_request_timeout_sec"),
            180,
        )
        idle_timeout = _coerce_positive_int(
            agent_cfg.get("presentation_llm_stream_idle_timeout_sec"),
            max(req_timeout, 180),
        )
        subagent_tool_context["llm_request_timeout_sec"] = req_timeout
        subagent_tool_context["llm_stream_idle_timeout_sec"] = idle_timeout

    base_model = subagent_tool_context.get("supervisor_base_model")
    model_name = agent_def.model_name or base_model or parent_run_config.model_name
    mcp_service = subagent_tool_context.get("mcp_service") if agent_def.allow_mcp else None

    allowed_prefixes = set(agent_def.allowed_prefixes or [])
    tool_registry = build_registry(
        mcp_service=mcp_service,
        allowed_names=agent_def.allowed_names,
        allowed_prefixes=allowed_prefixes or None,
    )

    messages_context = _build_initial_messages(
        agent_def,
        task=task,
        context=context,
        parent_state=parent_state,
    )

    subagent_agent_config = parent_run_config.agent_config if agent_def.runner == "research_graph" else None

    parent_stop_event = parent_run_config.stop_event
    local_stop_event: asyncio.Event | None = None
    parent_stop_relay: asyncio.Task[Any] | None = None
    if agent_def.name == "presentation_agent":
        # Presentation run is deterministic after render_presentation:
        # stop the subgraph immediately after render succeeds, then publish in handoff.
        local_stop_event = asyncio.Event()
        if parent_stop_event is not None:
            async def _relay_parent_stop() -> None:
                await parent_stop_event.wait()
                local_stop_event.set()
            parent_stop_relay = asyncio.create_task(_relay_parent_stop())
        effective_stop_event = local_stop_event
    else:
        effective_stop_event = parent_stop_event

    run_config = RunConfig(
        agent_run_id=parent_run_config.agent_run_id,
        thread_id=parent_run_config.thread_id,
        project_id=parent_run_config.project_id,
        account_id=parent_run_config.account_id,
        model_name=model_name,
        enable_thinking=parent_run_config.enable_thinking,
        reasoning_effort=parent_run_config.reasoning_effort,
        enable_context_manager=False,
        enable_prompt_caching=False,
        agent_config=subagent_agent_config,
        max_iterations=agent_def.max_iterations,
        engine=parent_run_config.engine,
        engine_version=parent_run_config.engine_version,
        is_shadow=parent_run_config.is_shadow,
        shadow_parent_run_id=parent_run_config.shadow_parent_run_id,
        side_effect_policy=parent_run_config.side_effect_policy,
        checkpoint_id=None,
        stop_event=effective_stop_event,
        initial_messages_context=messages_context,
    )

    if agent_def.runner == "research_graph":
        return await run_research_graph(
            task=task,
            context=context,
            messages_context=messages_context,
            parent_run_config=run_config,
            tool_context=subagent_tool_context,
            output_mode=output_mode,
            event_forwarder=event_forwarder,
            plan_only=plan_only,
            confirmed_queries=confirmed_queries,
            confirmed_task=confirmed_task,
        )

    engine = LangGraphEngine(
        tool_registry=tool_registry,
        tool_context=subagent_tool_context,
        checkpoint_store=MemoryCheckpointStore(),
        event_persister=BillingOnlyEventPersister(),
        persist_events=True,
    )

    assistant_messages: list[dict[str, Any]] = []
    tool_messages: list[dict[str, Any]] = []
    last_error: str | None = None

    forwarder = event_forwarder

    try:
        async for event in engine.run(run_config):
            if forwarder:
                try:
                    await forwarder(event)
                except Exception as exc:
                    forwarder = None
                    logger.warning(
                        "Subagent event forwarder failed; disabling for remainder of run",
                        agent=agent_def.name,
                        error=str(exc),
                    )
            if event.get("type") == "assistant_final":
                content = event.get("content")
                if isinstance(content, dict):
                    assistant_messages.append(content)
            if event.get("type") == "tool_message":
                tool_messages.append(
                    {
                        "name": event.get("name"),
                        "content": event.get("content"),
                        "success": event.get("success"),
                        "error": event.get("error"),
                        "tool_call_id": event.get("tool_call_id"),
                        "metadata": event.get("metadata"),
                    }
                )
                if (
                    local_stop_event is not None
                    and event.get("name") == "render_presentation"
                    and bool(event.get("success"))
                ):
                    local_stop_event.set()
            if event.get("type") == "error":
                last_error = str(event.get("message") or "subagent_error")
    finally:
        if parent_stop_relay is not None:
            parent_stop_relay.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await parent_stop_relay

    if output_mode == "full_history":
        output_payload = {"messages": assistant_messages, "tool_messages": tool_messages}
        return {"success": last_error is None, "output": output_payload, "error": last_error}

    last_message = assistant_messages[-1] if assistant_messages else {"role": "assistant", "content": ""}
    output_payload = {
        "agent": agent_def.name,
        "display_name": agent_def.display_name,
        "content": _normalize_message_content(last_message.get("content")),
        "tool_messages": tool_messages,
    }
    return {"success": last_error is None, "output": output_payload, "error": last_error}
