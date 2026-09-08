from __future__ import annotations

import asyncio
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Awaitable, Callable, Optional

from langgraph.checkpoint.memory import MemorySaver
from langgraph.errors import GraphRecursionError

from core.langgraph_engine.checkpoint_store import MemoryCheckpointStore
from core.langgraph_engine.contracts.checkpoint_contract import CheckpointStore
from core.langgraph_engine.contracts.engine_interface import BaseEngine, RunConfig
from core.langgraph_engine.contracts.tool_interface import ToolRegistry
from core.langgraph_engine.contracts.event_schema import EngineEvent
from core.langgraph_engine.contracts.state_schema import GraphState
from core.langgraph_engine.graph import GraphStateInternal, LangGraphBuilder
from core.langgraph_engine.persistence import EventPersister
from core.langgraph_engine.tools.catalog import build_registry
from core.services import metrics
from core.utils.logger import logger


class LangGraphEngine(BaseEngine):
    """
    LangGraph engine implementation.

    Dependencies (call_model_fn/execute_tools_fn) are injectable to allow testing and
    future integration with real LLM + tool execution.
    """

    def __init__(
        self,
        call_model_fn: Optional[Callable[[GraphState, Any], Awaitable[GraphState]]] = None,
        execute_tools_fn: Optional[Callable[[GraphState, Any], Awaitable[GraphState]]] = None,
        checkpoint_store: Optional[CheckpointStore] = None,
        tool_registry: ToolRegistry | None = None,
        *,
        persist_events: bool = True,
        event_persister: EventPersister | None = None,
        tool_context: dict[str, Any] | None = None,
        async_event_persistence: bool = False,
        async_event_queue_size: int = 256,
        async_checkpoint_saves: bool = False,
        async_checkpoint_queue_size: int = 2,
    ) -> None:
        self.call_model_fn = call_model_fn
        self.execute_tools_fn = execute_tools_fn
        self.checkpoint_store = checkpoint_store or MemoryCheckpointStore()
        self.tool_registry = tool_registry
        self._auto_registry = tool_registry is None
        self.persist_events = persist_events
        self.event_persister = event_persister or EventPersister()
        self.tool_context = tool_context or {}
        self.async_event_persistence = bool(async_event_persistence)
        self.async_event_queue_size = max(8, int(async_event_queue_size or 256))
        self.async_checkpoint_saves = bool(async_checkpoint_saves)
        self.async_checkpoint_queue_size = max(1, int(async_checkpoint_queue_size or 2))
        self._persistence_failed = False

    async def _initial_state(self, cfg: RunConfig) -> GraphState:
        initial_messages = list(cfg.initial_messages_context or [])
        session_index = 0
        if initial_messages:
            for msg in initial_messages:
                if isinstance(msg, dict):
                    md = msg.get("metadata")
                    if isinstance(md, dict):
                        try:
                            session_index = max(session_index, int(md.get("session_index", 0) or 0))
                        except Exception:
                            continue
        return {
            "agent_run_id": cfg.agent_run_id,
            "thread_id": cfg.thread_id,
            "project_id": cfg.project_id,
            "account_id": cfg.account_id,
            "model_name": cfg.model_name,
            "enable_thinking": cfg.enable_thinking,
            "reasoning_effort": cfg.reasoning_effort,
            "enable_context_manager": cfg.enable_context_manager,
            "enable_prompt_caching": cfg.enable_prompt_caching,
            "agent_config": cfg.agent_config,
            "messages_context": initial_messages,
            "session_index": session_index,
            "iteration": 0,
            "max_iterations": cfg.max_iterations,
            "pending_tool_calls": [],
            "tool_results": [],
            "termination": {"should_terminate": False, "reason": "not_finished"},
            "checkpoint_thread_id": cfg.agent_run_id,
            "engine": cfg.engine,
            "engine_version": cfg.engine_version,
            "is_shadow": cfg.is_shadow,
            "shadow_parent_run_id": cfg.shadow_parent_run_id,
            "side_effect_policy": cfg.side_effect_policy,
        }

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _to_internal_state(state: GraphState) -> GraphStateInternal:
        """Drop reserved keys before feeding state into LangGraph."""
        internal: GraphStateInternal = dict(state)  # type: ignore[assignment]
        internal.pop("checkpoint_id", None)
        return internal

    @staticmethod
    def _to_graph_state(state: GraphStateInternal) -> GraphState:
        # Restore contract shape for persistence/checkpoint/export; checkpoint_id may be set by store.
        gs: GraphState = dict(state)  # type: ignore[assignment]
        gs.setdefault("checkpoint_id", None)
        return gs

    async def run(self, run_config: RunConfig) -> AsyncIterator[EngineEvent]:
        # Reset transient flags per run
        self._persistence_failed = False

        # Load checkpoint (latest if checkpoint_id is None).
        initial_state: GraphState
        loaded = await self.checkpoint_store.load(run_config.agent_run_id, run_config.checkpoint_id)
        if loaded:
            initial_state = loaded
        else:
            initial_state = await self._initial_state(run_config)

        _apply_runtime_overrides(initial_state, run_config)

        if run_config.reset_loaded_state and loaded:
            _reset_state_for_resume(initial_state, run_config)

        if run_config.append_messages_context:
            messages_context = initial_state.get("messages_context")
            if not isinstance(messages_context, list):
                messages_context = []
                initial_state["messages_context"] = messages_context
            messages_context.extend(list(run_config.append_messages_context))
            initial_state["session_index"] = _resolve_session_index(messages_context)

        event_queue: asyncio.Queue[EngineEvent] = asyncio.Queue()
        current_state: GraphState = initial_state
        latest_checkpoint_id: str | None = current_state.get("checkpoint_id")

        async_persistence_enabled = bool(
            self.async_event_persistence and self.persist_events and self.event_persister
        )
        sync_persistence_enabled = bool(
            (not async_persistence_enabled) and self.persist_events and self.event_persister
        )
        persistence_queue: asyncio.Queue[tuple[dict[str, Any], EngineEvent] | None] | None = None
        persistence_task: asyncio.Task[None] | None = None

        async_checkpoint_enabled = bool(self.async_checkpoint_saves)
        checkpoint_queue: asyncio.Queue[GraphState | None] | None = None
        checkpoint_task: asyncio.Task[None] | None = None

        def _snapshot_state_for_persistence(state: GraphState) -> dict[str, Any]:
            checkpoint_id = state.get("checkpoint_id") or latest_checkpoint_id
            return {
                "agent_run_id": state.get("agent_run_id"),
                "thread_id": state.get("thread_id"),
                "account_id": state.get("account_id"),
                "session_index": int(state.get("session_index") or 0),
                "engine": state.get("engine"),
                "engine_version": state.get("engine_version"),
                "checkpoint_id": checkpoint_id,
                "is_shadow": bool(state.get("is_shadow", False)),
                "model_name": state.get("model_name"),
            }

        async def persistence_worker() -> None:
            nonlocal async_persistence_enabled
            if not persistence_queue:
                return
            while True:
                item = await persistence_queue.get()
                if item is None:
                    persistence_queue.task_done()
                    return
                state_snapshot, event = item
                if async_persistence_enabled and self.event_persister:
                    try:
                        await self.event_persister.persist(state_snapshot, event)  # type: ignore[arg-type]
                    except Exception as persist_err:
                        if not self._persistence_failed:
                            self._persistence_failed = True
                            async_persistence_enabled = False
                            self.persist_events = False
                            logger.exception(
                                "Event persistence failed; continuing without persistence",
                                agent_run_id=state_snapshot.get("agent_run_id"),
                                thread_id=state_snapshot.get("thread_id"),
                                error=str(persist_err),
                            )
                persistence_queue.task_done()

        async def checkpoint_worker() -> None:
            nonlocal latest_checkpoint_id, current_state
            if not checkpoint_queue:
                return
            while True:
                state_for_save = await checkpoint_queue.get()
                if state_for_save is None:
                    checkpoint_queue.task_done()
                    return
                try:
                    checkpoint_id = await self.checkpoint_store.save(state_for_save)
                    latest_checkpoint_id = checkpoint_id
                    current_state["checkpoint_id"] = checkpoint_id
                except Exception:
                    metrics.incr("langgraph.checkpoint.save_failed", 1, mode="async")
                    logger.exception(
                        "Failed to save checkpoint",
                        agent_run_id=state_for_save.get("agent_run_id"),
                    )
                checkpoint_queue.task_done()

        async def enqueue_checkpoint_state(state: GraphState, *, force: bool = False) -> None:
            if not checkpoint_queue:
                return
            try:
                checkpoint_queue.put_nowait(state)
                return
            except asyncio.QueueFull:
                pass

            try:
                _ = checkpoint_queue.get_nowait()
                checkpoint_queue.task_done()
                metrics.incr("langgraph.checkpoint.coalesced", 1)
            except asyncio.QueueEmpty:
                if not force:
                    metrics.incr("langgraph.checkpoint.enqueue_dropped", 1)
                    return

            try:
                checkpoint_queue.put_nowait(state)
            except asyncio.QueueFull:
                if force:
                    await checkpoint_queue.put(state)
                else:
                    metrics.incr("langgraph.checkpoint.enqueue_dropped", 1)

        if async_persistence_enabled:
            persistence_queue = asyncio.Queue(maxsize=self.async_event_queue_size)
            persistence_task = asyncio.create_task(persistence_worker())

        if async_checkpoint_enabled:
            checkpoint_queue = asyncio.Queue(maxsize=self.async_checkpoint_queue_size)
            checkpoint_task = asyncio.create_task(checkpoint_worker())

        async def emit(event: EngineEvent) -> None:
            nonlocal sync_persistence_enabled
            if async_persistence_enabled and persistence_queue is not None:
                state_snapshot = _snapshot_state_for_persistence(current_state)
                item = (state_snapshot, event)
                try:
                    persistence_queue.put_nowait(item)
                except asyncio.QueueFull:
                    event_type = str(event.get("type", "unknown"))
                    if event_type == "status":
                        metrics.incr("langgraph.persistence.queue_dropped", 1, event_type=event_type)
                    else:
                        await persistence_queue.put(item)
            elif sync_persistence_enabled and self.event_persister:
                try:
                    await self.event_persister.persist(current_state, event)
                except Exception as persist_err:
                    if not self._persistence_failed:
                        self._persistence_failed = True
                        sync_persistence_enabled = False
                        self.persist_events = False
                        logger.exception(
                            "Event persistence failed; continuing without persistence",
                            agent_run_id=current_state.get("agent_run_id"),
                            thread_id=current_state.get("thread_id"),
                            error=str(persist_err),
                        )
            await event_queue.put(event)

        # Auto-build registry if requested (uses static + optional MCP catalog).
        if self._auto_registry and self.tool_registry is None:
            try:
                self.tool_registry = build_registry()
            except Exception:
                logger.exception("Failed to build default tool registry; continuing without tools")
                self.tool_registry = None

        tool_context = dict(self.tool_context)
        tool_context.setdefault("side_effect_policy", initial_state.get("side_effect_policy"))
        tool_context.setdefault("is_shadow", initial_state.get("is_shadow"))
        if self.tool_registry:
            tool_context.setdefault("tool_registry", self.tool_registry)

        builder = LangGraphBuilder(
            emit=emit,
            stop_event=run_config.stop_event,
            call_model_fn=self.call_model_fn,
            execute_tools_fn=self.execute_tools_fn,
            tool_registry=self.tool_registry,
            run_config=run_config,
            tool_context=tool_context,
        )
        state_graph = builder.build()
        app = state_graph.compile(checkpointer=MemorySaver())

        done = asyncio.Event()

        async def run_graph():
            nonlocal current_state, latest_checkpoint_id
            try:
                recursion_limit = max(50, int(run_config.max_iterations or 1) * 4)
                async for state in app.astream(
                    self._to_internal_state(initial_state),
                    config={
                        "configurable": {"thread_id": run_config.agent_run_id},
                        "recursion_limit": recursion_limit,
                    },
                    stream_mode="values",
                ):
                    current_state = self._to_graph_state(state)
                    deferred_events = list(current_state.pop("deferred_events", []) or [])
                    if latest_checkpoint_id and not current_state.get("checkpoint_id"):
                        current_state["checkpoint_id"] = latest_checkpoint_id
                    try:
                        if checkpoint_queue is not None:
                            await enqueue_checkpoint_state(current_state)
                        else:
                            checkpoint_id = await self.checkpoint_store.save(current_state)
                            current_state["checkpoint_id"] = checkpoint_id
                            latest_checkpoint_id = checkpoint_id
                    except Exception:
                        metrics.incr(
                            "langgraph.checkpoint.save_failed",
                            1,
                            mode="async" if checkpoint_queue is not None else "sync",
                        )
                        logger.exception("Failed to save checkpoint", agent_run_id=state.get("agent_run_id"))
                    for deferred_event in deferred_events:
                        await emit(deferred_event)  # type: ignore[arg-type]
            except GraphRecursionError as exc:
                logger.exception(
                    "LangGraph recursion limit reached",
                    agent_run_id=run_config.agent_run_id,
                    thread_id=run_config.thread_id,
                    error=str(exc),
                )
                await emit(
                    {
                        "type": "error",
                        "timestamp": self._now_iso(),
                        "agent_run_id": run_config.agent_run_id,
                        "thread_id": run_config.thread_id,
                        "message": "graph_recursion_limit_reached",
                        "error_type": "graph_recursion",
                        "details": {"error": str(exc)},
                    }
                )
            except Exception as exc:
                exc_type = type(exc).__name__
                exc_text = str(exc).strip()
                exc_repr = repr(exc)
                summary = f"{exc_type}: {exc_text}" if exc_text else f"{exc_type}: {exc_repr}"
                logger.exception(
                    "LangGraph run failed",
                    agent_run_id=run_config.agent_run_id,
                    thread_id=run_config.thread_id,
                    error=summary,
                )
                await emit(
                    {
                        "type": "error",
                        "timestamp": self._now_iso(),
                        "agent_run_id": run_config.agent_run_id,
                        "thread_id": run_config.thread_id,
                        "message": f"graph_run_failed: {summary}",
                        "error_type": "graph_error",
                        "details": {
                            "error": summary,
                            "error_type": exc_type,
                            "error_repr": exc_repr,
                        },
                    }
                )
            finally:
                done.set()

        task = asyncio.create_task(run_graph())

        try:
            while True:
                if done.is_set() and event_queue.empty():
                    break
                try:
                    ev = await asyncio.wait_for(event_queue.get(), timeout=0.05)
                except asyncio.TimeoutError:
                    continue
                yield ev
        finally:
            if not task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(task), timeout=0.1)
                except asyncio.TimeoutError:
                    task.cancel()
                    with suppress(asyncio.CancelledError):
                        await task
                try:
                    await task
                except asyncio.CancelledError:
                    pass

            if checkpoint_queue is not None and checkpoint_task is not None:
                try:
                    await enqueue_checkpoint_state(current_state, force=True)
                    await checkpoint_queue.join()
                    await checkpoint_queue.put(None)
                    await checkpoint_task
                except Exception as checkpoint_flush_err:
                    logger.exception(
                        "Failed to flush async checkpoint queue",
                        agent_run_id=current_state.get("agent_run_id"),
                        error=str(checkpoint_flush_err),
                    )
                    if not checkpoint_task.done():
                        checkpoint_task.cancel()
                        try:
                            await checkpoint_task
                        except asyncio.CancelledError:
                            pass

            if persistence_queue is not None and persistence_task is not None:
                try:
                    await persistence_queue.join()
                    await persistence_queue.put(None)
                    await persistence_task
                except Exception as persistence_flush_err:
                    logger.exception(
                        "Failed to flush async persistence queue",
                        agent_run_id=current_state.get("agent_run_id"),
                        error=str(persistence_flush_err),
                    )
                    if not persistence_task.done():
                        persistence_task.cancel()
                        try:
                            await persistence_task
                        except asyncio.CancelledError:
                            pass


def _apply_runtime_overrides(state: GraphState, cfg: RunConfig) -> None:
    """Apply runtime tunables to a loaded checkpoint state (or initial state)."""
    state["model_name"] = cfg.model_name
    state["enable_thinking"] = cfg.enable_thinking
    state["reasoning_effort"] = cfg.reasoning_effort
    state["enable_context_manager"] = cfg.enable_context_manager
    state["enable_prompt_caching"] = cfg.enable_prompt_caching
    state["max_iterations"] = cfg.max_iterations
    state["engine"] = cfg.engine
    state["engine_version"] = cfg.engine_version
    state["is_shadow"] = cfg.is_shadow
    state["shadow_parent_run_id"] = cfg.shadow_parent_run_id
    state["side_effect_policy"] = cfg.side_effect_policy
    if cfg.agent_config is not None:
        state["agent_config"] = cfg.agent_config


def _reset_state_for_resume(state: GraphState, cfg: RunConfig) -> None:
    """Reset transient fields so a checkpoint can be continued as a new turn."""
    state["iteration"] = 0
    state["pending_tool_calls"] = []
    state["tool_results"] = []
    state["termination"] = {"should_terminate": False, "reason": "not_finished"}
    state["max_iterations"] = cfg.max_iterations


def _resolve_session_index(messages: list[dict[str, Any]]) -> int:
    session_index = 0
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        metadata = msg.get("metadata")
        if not isinstance(metadata, dict):
            continue
        try:
            session_index = max(session_index, int(metadata.get("session_index", 0) or 0))
        except Exception:
            continue
    return session_index
