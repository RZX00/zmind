from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, NotRequired, Optional, TypedDict

from langgraph.graph import StateGraph

from core.langgraph_engine.contracts.engine_interface import RunConfig
from core.langgraph_engine.contracts.event_schema import EngineEvent, StatusEvent
from core.langgraph_engine.contracts.state_schema import TerminationState
from core.langgraph_engine.contracts.tool_interface import TERMINATING_TOOL_NAMES, ToolCall, ToolExecutionResult
from core.langgraph_engine.nodes import (
    DefaultCallModelNode,
    DefaultExecuteToolsNode,
    DefaultExecutePlanNode,
    DefaultLoadContextNode,
    DefaultNarrateResultNode,
    DefaultPlanTaskNode,
    DefaultRepairPlanNode,
    DefaultResolveIntentNode,
    DefaultVerifyOutcomeNode,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


EventEmitter = Callable[[EngineEvent], Awaitable[None]]


@dataclass
class NodeContext:
    emit: EventEmitter
    stop_event: Optional[asyncio.Event]
    run_config: Optional[RunConfig] = None
    tool_context: Optional[dict[str, Any]] = None


class GraphStateInternal(TypedDict):
    """Internal state used inside LangGraph (omits reserved channel names like checkpoint_id)."""

    agent_run_id: str
    thread_id: str
    project_id: str | None
    account_id: str

    model_name: str
    enable_thinking: bool | None
    reasoning_effort: str
    enable_context_manager: bool
    enable_prompt_caching: bool

    agent_config: dict[str, Any] | None

    messages_context: List[dict[str, Any]]
    session_index: int

    iteration: int
    max_iterations: int

    pending_tool_calls: List[ToolCall]
    tool_results: List[ToolExecutionResult]

    termination: TerminationState

    checkpoint_thread_id: str

    engine: str
    engine_version: str
    is_shadow: bool
    shadow_parent_run_id: str | None
    side_effect_policy: str
    domain: NotRequired[str | None]
    intent: NotRequired[dict[str, Any] | None]
    degraded_state: NotRequired[list[dict[str, Any]]]
    canvas_runtime: NotRequired[dict[str, Any] | None]
    canvas_context: NotRequired[dict[str, Any] | None]
    canvas_task: NotRequired[dict[str, Any] | None]
    canvas_execution: NotRequired[dict[str, Any] | None]
    canvas_verification: NotRequired[dict[str, Any] | None]
    repair_count: NotRequired[int]
    deferred_events: NotRequired[list[dict[str, Any]]]
    # Canvas follow-through loop control. MUST be declared channels so they persist
    # across LangGraph iterations — otherwise canvas_followthrough_count resets to 0
    # every loop and its cap is never reached (runaway re-invocation on no-write turns).
    force_continue: NotRequired[bool]
    canvas_followthrough_count: NotRequired[int]
    presentation_repair_count: NotRequired[int]
    teach_rich_count: NotRequired[int]


# --- Default node helpers -----------------------------------------------------

# --- Graph builder ------------------------------------------------------------


class LangGraphBuilder:
    """
    Build a StateGraph over GraphState with pluggable model/tool executors.

    call_model_fn: async (state, ctx) -> GraphState
    execute_tools_fn: async (state, ctx) -> GraphState
    """

    def __init__(
        self,
        emit: EventEmitter,
        stop_event: Optional[asyncio.Event] = None,
        load_context_fn: Optional[Callable[[GraphStateInternal, NodeContext], Awaitable[GraphStateInternal]]] = None,
        resolve_intent_fn: Optional[Callable[[GraphStateInternal, NodeContext], Awaitable[GraphStateInternal]]] = None,
        plan_task_fn: Optional[Callable[[GraphStateInternal, NodeContext], Awaitable[GraphStateInternal]]] = None,
        execute_plan_fn: Optional[Callable[[GraphStateInternal, NodeContext], Awaitable[GraphStateInternal]]] = None,
        verify_outcome_fn: Optional[Callable[[GraphStateInternal, NodeContext], Awaitable[GraphStateInternal]]] = None,
        repair_plan_fn: Optional[Callable[[GraphStateInternal, NodeContext], Awaitable[GraphStateInternal]]] = None,
        narrate_result_fn: Optional[Callable[[GraphStateInternal, NodeContext], Awaitable[GraphStateInternal]]] = None,
        call_model_fn: Optional[Callable[[GraphStateInternal, NodeContext], Awaitable[GraphStateInternal]]] = None,
        execute_tools_fn: Optional[Callable[[GraphStateInternal, NodeContext], Awaitable[GraphStateInternal]]] = None,
        tool_registry=None,
        run_config: Optional[RunConfig] = None,
        tool_context: Optional[dict[str, Any]] = None,
    ) -> None:
        self.emit = emit
        self.stop_event = stop_event
        self.load_context_fn = load_context_fn or DefaultLoadContextNode()
        self.resolve_intent_fn = resolve_intent_fn or DefaultResolveIntentNode()
        self.plan_task_fn = plan_task_fn or DefaultPlanTaskNode()
        self.execute_plan_fn = execute_plan_fn or DefaultExecutePlanNode()
        self.verify_outcome_fn = verify_outcome_fn or DefaultVerifyOutcomeNode()
        self.repair_plan_fn = repair_plan_fn or DefaultRepairPlanNode()
        self.narrate_result_fn = narrate_result_fn or DefaultNarrateResultNode()
        self.call_model_fn = call_model_fn or DefaultCallModelNode(tool_registry)
        self.execute_tools_fn = execute_tools_fn or DefaultExecuteToolsNode(tool_registry)
        self.run_config = run_config
        self.tool_context = tool_context or {}

    def _ctx(self) -> NodeContext:
        return NodeContext(
            emit=self.emit,
            stop_event=self.stop_event,
            run_config=self.run_config,
            tool_context=self.tool_context,
        )

    def build(self) -> StateGraph:
        graph = StateGraph(GraphStateInternal)

        # Nodes
        graph.add_node("load_context", self._load_context)
        graph.add_node("resolve_intent", self._resolve_intent)
        graph.add_node("plan_task", self._plan_task)
        graph.add_node("execute_plan", self._execute_plan)
        graph.add_node("verify_outcome", self._verify_outcome)
        graph.add_node("repair_plan", self._repair_plan)
        graph.add_node("narrate_result", self._narrate_result)
        graph.add_node("call_model", self._call_model)
        graph.add_node("execute_tools", self._execute_tools)
        graph.add_node("finalize", self._finalize)

        # Edges
        graph.set_entry_point("load_context")
        graph.add_edge("load_context", "resolve_intent")
        graph.add_conditional_edges(
            "resolve_intent",
            self._route_after_intent,
            {
                "plan_task": "plan_task",
                "call_model": "call_model",
            },
        )
        graph.add_conditional_edges(
            "plan_task",
            self._route_after_plan,
            {
                "execute_plan": "execute_plan",
                "finalize": "finalize",
            },
        )
        graph.add_conditional_edges(
            "execute_plan",
            self._route_after_execute_plan,
            {
                "verify_outcome": "verify_outcome",
                "narrate_result": "narrate_result",
                "finalize": "finalize",
            },
        )
        graph.add_conditional_edges(
            "verify_outcome",
            self._route_after_verify,
            {
                "repair_plan": "repair_plan",
                "narrate_result": "narrate_result",
                "finalize": "finalize",
            },
        )
        graph.add_edge("repair_plan", "execute_plan")
        graph.add_edge("narrate_result", "finalize")
        graph.add_conditional_edges(
            "call_model",
            self._route_after_model,
            {
                "execute_tools": "execute_tools",
                "finalize": "finalize",
                # Canvas follow-through: re-enter call_model to force the edit tool call when the
                # model returned prose without applying a pending canvas modification (bounded).
                "call_model": "call_model",
            },
        )
        graph.add_conditional_edges(
            "execute_tools",
            self._route_after_tools,
            {
                "call_model": "call_model",
                "finalize": "finalize",
            },
        )
        graph.add_edge("finalize", "__end__")
        return graph

    # --- Nodes ---
    async def _load_context(self, state: GraphStateInternal) -> GraphStateInternal:
        ctx = self._ctx()
        return await self.load_context_fn(state, ctx)

    async def _resolve_intent(self, state: GraphStateInternal) -> GraphStateInternal:
        ctx = self._ctx()
        return await self.resolve_intent_fn(state, ctx)

    async def _plan_task(self, state: GraphStateInternal) -> GraphStateInternal:
        ctx = self._ctx()
        return await self.plan_task_fn(state, ctx)

    async def _execute_plan(self, state: GraphStateInternal) -> GraphStateInternal:
        ctx = self._ctx()
        return await self.execute_plan_fn(state, ctx)

    async def _verify_outcome(self, state: GraphStateInternal) -> GraphStateInternal:
        ctx = self._ctx()
        return await self.verify_outcome_fn(state, ctx)

    async def _repair_plan(self, state: GraphStateInternal) -> GraphStateInternal:
        ctx = self._ctx()
        return await self.repair_plan_fn(state, ctx)

    async def _narrate_result(self, state: GraphStateInternal) -> GraphStateInternal:
        ctx = self._ctx()
        return await self.narrate_result_fn(state, ctx)

    async def _call_model(self, state: GraphStateInternal) -> GraphStateInternal:
        pending = state.get("pending_tool_calls") or []
        if pending:
            return state

        # Stop signal check
        if self.stop_event and self.stop_event.is_set():
            state["termination"] = {"should_terminate": True, "reason": "stopped", "message": "stop_signal"}
            await self.emit(
                StatusEvent(
                    type="status",
                    timestamp=_now_iso(),
                    agent_run_id=state["agent_run_id"],
                    thread_id=state["thread_id"],
                    status_type="run_stopped",
                    terminal_status="stopped",
                    iteration=state.get("iteration"),
                )
            )
            return state

        # Max iteration guard
        iteration = state.get("iteration", 0) + 1
        state["iteration"] = iteration
        if iteration > state.get("max_iterations", 0):
            state["termination"] = {"should_terminate": True, "reason": "max_iterations"}
            await self.emit(
                StatusEvent(
                    type="status",
                    timestamp=_now_iso(),
                    agent_run_id=state["agent_run_id"],
                    thread_id=state["thread_id"],
                    status_type="run_max_iterations",
                    terminal_status="error",
                    message="max_iterations_reached",
                    iteration=iteration,
                )
            )
            return state

        # Delegate to caller
        ctx = self._ctx()
        new_state = await self.call_model_fn(state, ctx)
        return new_state

    async def _execute_tools(self, state: GraphStateInternal) -> GraphStateInternal:
        # Skip when stop requested
        if self.stop_event and self.stop_event.is_set():
            state["termination"] = {"should_terminate": True, "reason": "stopped", "message": "stop_signal"}
            return state

        deferred_events: list[dict[str, Any]] = []

        async def _buffer_event(event: dict[str, Any]) -> None:
            deferred_events.append(dict(event))

        # Execute via delegate
        ctx = NodeContext(
            emit=_buffer_event,
            stop_event=self.stop_event,
            run_config=self.run_config,
            tool_context=self.tool_context,
        )
        new_state = await self.execute_tools_fn(state, ctx)

        # Terminate on terminating tools
        for res in new_state.get("tool_results", []):
            if res.get("name") in TERMINATING_TOOL_NAMES:
                new_state["termination"] = {
                    "should_terminate": True,
                    "reason": "terminating_tool",
                    "message": res.get("name"),
                }
                break

        if deferred_events:
            existing = list(new_state.get("deferred_events") or [])
            existing.extend(deferred_events)
            new_state["deferred_events"] = existing

        return new_state

    async def _finalize(self, state: GraphStateInternal) -> GraphStateInternal:
        term: TerminationState = state.get("termination") or {"should_terminate": True, "reason": "completed"}
        reason = term.get("reason")
        if reason in ("max_iterations", "llm_error", "error", "tool_error"):
            terminal_status = "error"
        elif reason == "stopped":
            terminal_status = "stopped"
        else:
            terminal_status = "completed"
        await self.emit(
            StatusEvent(
                type="status",
                timestamp=_now_iso(),
                agent_run_id=state["agent_run_id"],
                thread_id=state["thread_id"],
                status_type="run_completed",
                terminal_status=terminal_status,
                message=term.get("reason"),
                iteration=state.get("iteration"),
            )
        )
        return state

    # --- Routing ---
    def _route_after_model(self, state: GraphStateInternal) -> str:
        if state.get("termination", {}).get("should_terminate"):
            return "finalize"
        pending = state.get("pending_tool_calls") or []
        if pending:
            return "execute_tools"
        # Canvas follow-through: the model returned no tool calls but a pending canvas
        # modification has not been applied — loop back to call_model (with a forceful nudge
        # already appended) to make it emit the edit. Bounded by canvas_followthrough_count.
        if state.get("force_continue"):
            return "call_model"
        return "finalize"

    def _route_after_tools(self, state: GraphStateInternal) -> str:
        if state.get("termination", {}).get("should_terminate"):
            return "finalize"
        return "call_model"

    def _route_after_intent(self, state: GraphStateInternal) -> str:
        runtime = state.get("canvas_runtime") or {}
        if runtime.get("route") == "native":
            return "plan_task"
        return "call_model"

    def _route_after_plan(self, state: GraphStateInternal) -> str:
        if state.get("termination", {}).get("should_terminate"):
            return "finalize"
        return "execute_plan"

    def _route_after_execute_plan(self, state: GraphStateInternal) -> str:
        if state.get("termination", {}).get("should_terminate"):
            return "finalize"
        runtime = state.get("canvas_runtime") or {}
        if runtime.get("verify_enabled"):
            return "verify_outcome"
        return "narrate_result"

    def _route_after_verify(self, state: GraphStateInternal) -> str:
        if state.get("termination", {}).get("should_terminate"):
            return "finalize"
        verification = state.get("canvas_verification") or {}
        if verification.get("passed"):
            return "narrate_result"
        runtime = state.get("canvas_runtime") or {}
        repair_count = int(state.get("repair_count") or 0)
        if repair_count < int(runtime.get("repair_attempt_limit") or 0):
            return "repair_plan"
        return "narrate_result"
