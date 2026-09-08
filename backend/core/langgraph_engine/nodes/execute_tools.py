from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Sequence, Tuple

from pydantic import ValidationError

from core.langgraph_engine.contracts.event_schema import StatusEvent, ToolMessageEvent
from core.langgraph_engine.contracts.state_schema import GraphState
from core.langgraph_engine.contracts.tool_interface import (
    DISABLED_IN_SHADOW_ERROR,
    TERMINATING_TOOL_NAMES,
    SideEffectLevel,
    ToolCall,
    ToolExecutionResult,
    ToolRegistry,
    ToolSpec,
)
from core.langgraph_engine.tools.adapters.structured_output_adapter import (
    StructuredOutputAdapter,
    wrap_raw_output,
)
from core.langgraph_engine.tools.doc_surface import is_doc_surface_tool_allowed
from core.langgraph_engine.tool_message_truncation import truncate_tool_message_content
from core.utils.logger import logger


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_interaction_surface(value: Any) -> str:
    cleaned = str(value or "").strip().lower()
    if cleaned in {"doc", "document"}:
        return "doc"
    return "canvas"


def _is_tool_blocked_for_surface(tool_name: str, interaction_surface: str) -> bool:
    if interaction_surface != "doc":
        return False
    normalized = str(tool_name or "").strip()
    return not is_doc_surface_tool_allowed(normalized)


class DefaultExecuteToolsNode:
    """
    Execute pending tool calls with ToolRegistry handlers.

    - Validates arguments via ToolSpec.args_model
    - Enforces shadow side_effect_policy
    - Emits ToolMessageEvent per result
    - Prefers ToolRegistry.execute_tool_call when available to preserve WS-B behavior
    """

    def __init__(self, tool_registry: Optional[ToolRegistry] = None) -> None:
        self._tool_registry = tool_registry

    @staticmethod
    def _is_parallel_handoff(tool_name: str) -> bool:
        if not tool_name.startswith("transfer_to_"):
            return False
        return tool_name != "transfer_to_canvas_agent"

    @staticmethod
    def _resolve_concurrency(tool_ctx: dict[str, Any]) -> int:
        raw = tool_ctx.get("subagent_concurrency") or os.getenv("LANGGRAPH_SUBAGENT_CONCURRENCY") or 3
        try:
            value = int(raw)
        except Exception:
            value = 3
        if value < 1:
            return 1
        return min(value, 6)

    async def _execute_batch(
        self,
        batch: Sequence[Tuple[int, ToolCall, bool]],
        state: GraphState,
        context: dict[str, Any],
        concurrency: int,
    ) -> dict[int, ToolExecutionResult]:
        semaphore = asyncio.Semaphore(concurrency)

        async def _run(item: Tuple[int, ToolCall, bool]) -> Tuple[int, ToolExecutionResult]:
            index, tc, _shadow = item
            async with semaphore:
                res = await self._execute_single(tc, state, context)
            return index, res

        results: dict[int, ToolExecutionResult] = {}
        tasks = [asyncio.create_task(_run(item)) for item in batch]
        for task in tasks:
            index, res = await task
            results[index] = res
        return results

    async def __call__(self, state: GraphState, ctx: Any) -> GraphState:
        emit = getattr(ctx, "emit")
        stop_event: Optional[asyncio.Event] = getattr(ctx, "stop_event", None)
        run_config = getattr(ctx, "run_config", None)
        tool_ctx_extra = getattr(ctx, "tool_context", None) or {}
        pending: list[ToolCall] = state.get("pending_tool_calls") or []
        results: list[ToolExecutionResult] = []

        adapter: StructuredOutputAdapter | None = tool_ctx_extra.get("structured_output_adapter")

        concurrency = self._resolve_concurrency(tool_ctx_extra)
        base_context = {
            "state": state,
            "run_config": run_config,
            "thread_id": state.get("thread_id"),
            "project_id": state.get("project_id"),
            "agent_config": state.get("agent_config"),
            "side_effect_policy": state.get("side_effect_policy"),
            "is_shadow": state.get("is_shadow"),
            **tool_ctx_extra,
        }

        async def _emit_tool_started(tool_index: int, tc: ToolCall, tool_name: str, shadow_blocked: bool) -> None:
            if shadow_blocked:
                return
            await emit(
                StatusEvent(
                    type="status",
                    timestamp=_now_iso(),
                    agent_run_id=state["agent_run_id"],
                    thread_id=state["thread_id"],
                    status_type="tool_started",
                    message=f"Starting execution of {tool_name}",
                    data={
                        "role": "assistant",
                        "tool": tool_name,
                        "function_name": tool_name,
                        "xml_tag_name": None,
                        "message": f"Starting execution of {tool_name}",
                        "tool_index": tool_index,
                        "tool_call_id": tc.get("id"),
                    },
                )
            )

        async def _emit_tool_result(tool_index: int, tc: ToolCall, tool_name: str, res: ToolExecutionResult) -> None:
            nonlocal results
            if adapter:
                try:
                    res = adapter(res, state)
                except Exception:
                    logger.exception("Structured output adapter failed", tool=tool_name)
            else:
                res = wrap_raw_output(res)

            res_metadata = res.get("metadata")
            if not isinstance(res_metadata, dict):
                res_metadata = {}
            res_metadata.setdefault("iteration", state.get("iteration"))
            res["metadata"] = res_metadata
            results.append(res)
            content_payload = res.get("output")
            if content_payload is None and res.get("error"):
                content_payload = {"error": res.get("error")}
            cta_payload_source = content_payload
            if tool_name == "cta" and isinstance(content_payload, str):
                try:
                    parsed_payload = json.loads(content_payload)
                except Exception:
                    parsed_payload = None
                if isinstance(parsed_payload, dict):
                    cta_payload_source = parsed_payload
            content_str = json.dumps(content_payload or {})
            message_id = str(uuid.uuid4())
            tool_exec = {
                "function_name": tool_name,
                "xml_tag_name": None,
                "tool_call_id": tc.get("id"),
                "arguments": tc.get("arguments"),
                "result": {
                    "success": res.get("success", False),
                    "output": content_payload,
                    "error": res.get("error"),
                },
                "execution_details": {
                    "started_at": res.get("started_at"),
                    "ended_at": res.get("ended_at"),
                },
            }
            metadata: dict[str, Any] = {}
            res_metadata = res.get("metadata")
            if isinstance(res_metadata, dict):
                metadata.update(res_metadata)
            frontend_content = metadata.get("frontend_content")
            if not isinstance(frontend_content, dict):
                frontend_content = {}
            if tool_name == "cta" and isinstance(content_payload, dict):
                cta_payload = (
                    content_payload.get("cta")
                    or content_payload.get("buttons")
                    or content_payload.get("actions")
                )
            elif tool_name == "cta" and isinstance(cta_payload_source, dict):
                cta_payload = (
                    cta_payload_source.get("cta")
                    or cta_payload_source.get("buttons")
                    or cta_payload_source.get("actions")
                )
            else:
                cta_payload = None
            if tool_name == "cta" and isinstance(cta_payload, list):
                frontend_content.setdefault("cta", cta_payload)
            frontend_content.setdefault("tool_execution", tool_exec)
            metadata["frontend_content"] = frontend_content
            await emit(
                ToolMessageEvent(
                    type="tool_message",
                    timestamp=_now_iso(),
                    agent_run_id=state["agent_run_id"],
                    thread_id=state["thread_id"],
                    tool_call_id=tc["id"],
                    name=tool_name,
                    message_id=message_id,
                    content=content_str,
                    success=res.get("success", False),
                    error=res.get("error"),
                    metadata=metadata or None,
                )
            )
            status_type = "tool_completed" if res.get("success", False) else "tool_failed"
            await emit(
                StatusEvent(
                    type="status",
                    timestamp=_now_iso(),
                    agent_run_id=state["agent_run_id"],
                    thread_id=state["thread_id"],
                    status_type=status_type,
                    message=f"Tool {tool_name} {'completed successfully' if status_type == 'tool_completed' else 'failed'}",
                    data={
                        "role": "assistant",
                        "tool": tool_name,
                        "function_name": tool_name,
                        "xml_tag_name": None,
                        "message": f"Tool {tool_name} {'completed successfully' if status_type == 'tool_completed' else 'failed'}",
                        "tool_index": tool_index,
                        "tool_call_id": tc.get("id"),
                        "error": res.get("error"),
                    },
                )
            )

            messages_context = state.get("messages_context")
            if not isinstance(messages_context, list):
                messages_context = []
                state["messages_context"] = messages_context
            truncated_content, was_truncated = truncate_tool_message_content(
                content_str,
                message_id=message_id,
                tool_name=tool_name,
            )
            context_metadata: dict[str, Any] | None = None
            if was_truncated:
                context_metadata = {
                    "truncated": True,
                    "message_id": message_id,
                }
            messages_context.append(
                {
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "name": tc.get("name") or res.get("name") or "",
                    "content": truncated_content,
                    "message_id": message_id,
                    "type": "tool",
                    "metadata": context_metadata,
                }
            )

            if res.get("name") in TERMINATING_TOOL_NAMES and res.get("success"):
                state["termination"] = {
                    "should_terminate": True,
                    "reason": "terminating_tool",
                    "message": res.get("name"),
                }

        tool_index = 0
        while tool_index < len(pending):
            if stop_event and stop_event.is_set():
                break

            tc = pending[tool_index]
            tool_name = tc.get("name") or ""

            if self._is_parallel_handoff(tool_name):
                batch: list[Tuple[int, ToolCall, bool]] = []
                while tool_index < len(pending):
                    tc = pending[tool_index]
                    tool_name = tc.get("name") or ""
                    if not self._is_parallel_handoff(tool_name):
                        break
                    shadow_blocked = False
                    if self._tool_registry and state.get("is_shadow") and state.get("side_effect_policy") in (
                        "dry_run",
                        "deny_write",
                    ):
                        tool_spec = self._tool_registry.get(tool_name)
                        if tool_spec and tool_spec.side_effect_level != SideEffectLevel.READ_ONLY:
                            shadow_blocked = True
                    await _emit_tool_started(tool_index, tc, tool_name, shadow_blocked)
                    batch.append((tool_index, tc, shadow_blocked))
                    tool_index += 1

                batch_results = await self._execute_batch(
                    batch,
                    state,
                    base_context,
                    concurrency=concurrency,
                )
                for index, tc, _shadow in batch:
                    tool_name = tc.get("name") or ""
                    res = batch_results.get(index)
                    if res is None:
                        res = {
                            "tool_call_id": tc.get("id"),
                            "name": tool_name,
                            "success": False,
                            "started_at": _now_iso(),
                            "ended_at": _now_iso(),
                            "error": "tool_error:missing_result",
                        }
                    await _emit_tool_result(index, tc, tool_name, res)
                continue

            shadow_blocked = False
            if self._tool_registry and state.get("is_shadow") and state.get("side_effect_policy") in ("dry_run", "deny_write"):
                tool_spec = self._tool_registry.get(tool_name)
                if tool_spec and tool_spec.side_effect_level != SideEffectLevel.READ_ONLY:
                    shadow_blocked = True
            await _emit_tool_started(tool_index, tc, tool_name, shadow_blocked)
            res = await self._execute_single(tc, state, base_context)
            await _emit_tool_result(tool_index, tc, tool_name, res)
            tool_index += 1

        state["tool_results"] = state.get("tool_results", []) + results
        state["pending_tool_calls"] = []
        return state

    async def _execute_single(self, tc: ToolCall, state: GraphState, context: dict[str, Any]) -> ToolExecutionResult:
        started = _now_iso()
        name = tc.get("name") or ""
        interaction_surface = _normalize_interaction_surface(context.get("interaction_surface"))
        if _is_tool_blocked_for_surface(name, interaction_surface):
            return {
                "tool_call_id": tc["id"],
                "name": name,
                "success": False,
                "started_at": started,
                "ended_at": _now_iso(),
                "error": f"tool_blocked_for_surface:{interaction_surface}",
            }
        tool_spec: Optional[ToolSpec] = None
        if self._tool_registry:
            tool_spec = self._tool_registry.get(name)

        # Tool not found
        if not tool_spec:
            return {
                "tool_call_id": tc["id"],
                "name": name,
                "success": False,
                "started_at": started,
                "ended_at": _now_iso(),
                "error": "tool_not_found",
            }

        # Shadow side-effect gating
        if state.get("is_shadow") and state.get("side_effect_policy") in ("dry_run", "deny_write"):
            if tool_spec.side_effect_level != SideEffectLevel.READ_ONLY:
                return {
                    "tool_call_id": tc["id"],
                    "name": name,
                    "success": False,
                    "started_at": started,
                    "ended_at": _now_iso(),
                    "error": DISABLED_IN_SHADOW_ERROR,
                }

        # Prefer registry-provided executor if available (enforces WS-B policies).
        if self._tool_registry and hasattr(self._tool_registry, "execute_tool_call"):
            try:
                return await self._tool_registry.execute_tool_call(tc, context)  # type: ignore[arg-type]
            except Exception as exc:
                logger.exception("Tool registry execution failed", tool=name)
                return {
                    "tool_call_id": tc["id"],
                    "name": name,
                    "success": False,
                    "started_at": started,
                    "ended_at": _now_iso(),
                    "error": f"tool_error:{type(exc).__name__}",
                    "metadata": {"message": str(exc)[:500]},
                }

        # Validate arguments
        try:
            validated = tool_spec.args_model(**(tc.get("arguments") or {}))
        except ValidationError as e:
            return {
                "tool_call_id": tc["id"],
                "name": name,
                "success": False,
                "started_at": started,
                "ended_at": _now_iso(),
                "error": f"schema_reject: {e}",
            }

        # Execute handler
        try:
            call_context = dict(context)
            call_context.setdefault("tool_call_id", tc["id"])
            call_context.setdefault("tool_name", name)
            output = await tool_spec.handler(validated.model_dump(), call_context)
            success = output.get("success", True)
        except Exception as e:
            logger.exception("Tool execution failed", tool=name)
            output = {"success": False, "error": str(e)}
            success = False

        ended = _now_iso()
        result: ToolExecutionResult = {
            "tool_call_id": tc["id"],
            "name": name,
            "success": success,
            "started_at": started,
            "ended_at": ended,
            "output": output if success else None,
            "error": None if success else output.get("error", "tool_error"),
        }
        return result
