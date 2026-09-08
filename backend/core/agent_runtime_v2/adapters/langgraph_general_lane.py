from __future__ import annotations

from dataclasses import dataclass
from typing import Any, AsyncIterator, Callable

from core.langgraph_engine.contracts.engine_interface import RunConfig
from core.langgraph_engine.engine import LangGraphEngine
from core.utils.config import config

from ..contracts import AgentEventV2, RuntimeContextV2
from ..event_bus import CanonicalEventBusV2
from ..tool_pool import ToolPoolV2


@dataclass(slots=True)
class LangGraphGeneralLaneAdapter:
    checkpoint_store: Any
    async_event_persistence: bool = True
    async_event_queue_size: int = 256
    async_checkpoint_saves: bool = True
    async_checkpoint_queue_size: int = 2
    engine_factory: Callable[..., LangGraphEngine] = LangGraphEngine

    async def run(
        self,
        *,
        context: RuntimeContextV2,
        bus: CanonicalEventBusV2,
        tool_pool: ToolPoolV2 | None,
    ) -> AsyncIterator[AgentEventV2]:
        tool_context = context.to_tool_context()
        tool_context["tool_policy_v2"] = dict(context.policy_context.get("tool_policy") or {})
        tool_context["tool_pool_v2"] = dict(context.policy_context.get("tool_pool") or {})

        engine = self.engine_factory(
            tool_registry=tool_pool.registry if tool_pool else None,
            tool_context=tool_context,
            checkpoint_store=self.checkpoint_store,
            persist_events=False,
            async_event_persistence=False,
            async_event_queue_size=self.async_event_queue_size,
            async_checkpoint_saves=self.async_checkpoint_saves,
            async_checkpoint_queue_size=self.async_checkpoint_queue_size,
        )
        assembled_context = dict(context.prompt_context.get("assembled") or {})
        canvas_id = tool_context.get("canvas_id")
        messages_context = self._with_canvas_guidance(
            list(assembled_context.get("messages_context") or []),
            canvas_id=canvas_id,
        )
        # On the agentic canvas lane, force a known-good model so a blocked free-tier default
        # (e.g. a gateway-blocked model) can't kill the run; falls back to the request model.
        model_name = context.model_name
        if canvas_id and getattr(config, "CANVAS_AGENTIC_LANE_ENABLED", False):
            forced = getattr(config, "CANVAS_AGENTIC_MODEL", "") or ""
            if forced:
                model_name = forced
        run_config = RunConfig(
            agent_run_id=context.identity.run_id,
            thread_id=context.identity.thread_id,
            project_id=context.identity.project_id,
            account_id=context.identity.account_id,
            model_name=model_name,
            enable_thinking=context.enable_thinking,
            reasoning_effort=context.reasoning_effort,
            enable_context_manager=context.enable_context_manager,
            enable_prompt_caching=context.enable_prompt_caching,
            agent_config=context.agent_config,
            max_iterations=100,
            engine="langgraph",
            engine_version="v1",
            is_shadow=False,
            shadow_parent_run_id=None,
            side_effect_policy=str(context.tool_context.get("side_effect_policy") or "allow_all"),
            checkpoint_id=context.checkpoint_id,
            stop_event=context.stop_event,
            append_messages_context=messages_context,
        )
        async for engine_event in engine.run(run_config):
            engine_event_type = str(engine_event.get("type") or "status")
            terminal_status = str(engine_event.get("terminal_status") or "").strip().lower()
            mapped_type = self._map_engine_event_type(engine_event_type, terminal_status=terminal_status)
            metadata = {
                "source": "langgraph_v1_adapter",
                "engine_event_type": engine_event_type,
            }
            if engine_event_type == "status" and terminal_status:
                metadata["terminal_status"] = terminal_status
            yield bus.build(
                mapped_type,
                payload={"engine_event": dict(engine_event)},
                user_visible=str(engine_event.get("type") or "") == "assistant_final",
                metadata=metadata,
            )

    @staticmethod
    def _with_canvas_guidance(messages_context: list, *, canvas_id: Any) -> list:
        """When the run is bound to a canvas, prepend a concise canvas-operating system
        message so the agentic loop drives the canvas via canvas_read/canvas_edit. No-op
        (returns the list unchanged) when there is no canvas — keeps non-canvas runs intact."""
        if not canvas_id:
            return messages_context
        guidance = {
            "role": "system",
            "content": (
                f"You are DIRECTLY operating the user's live canvas (canvas_id={canvas_id}) right now. "
                "This is an EXECUTE request, not a planning or advisory one: actually perform the canvas "
                "changes by calling the canvas tools in THIS turn. Do NOT just describe a plan, do NOT end "
                "with an open question, and do NOT ask the user for confirmation before acting.\n"
                "Tool choice: to CREATE new nodes/connections use `canvas_write`; to MODIFY or DELETE existing "
                "content use `canvas_edit` (with a non-empty `operations` array of {op,...} items: add_node/"
                "update_node/move_node/add_connection/update_connection/group_nodes/...). If you need existing "
                "node ids first, call `canvas_read`. Emit incremental ops; never rewrite the whole document. "
                "If the canvas is empty, create the nodes with canvas_write, then connect them. "
                "Help the user organize and clarify their thinking; respect their existing layout and never "
                "delete or move their content without a clear reason. After applying, reply with a one-line summary."
            ),
            "metadata": {"source": "canvas_agentic_lane"},
        }
        return [guidance, *messages_context]

    @staticmethod
    def _map_engine_event_type(engine_event_type: str, *, terminal_status: str = "") -> str:
        if engine_event_type == "status" and terminal_status:
            if terminal_status == "completed":
                return "run.completed"
            if terminal_status in {"failed", "error"}:
                return "run.failed"
            if terminal_status == "stopped":
                return "run.cancelled"
        if engine_event_type == "assistant_final":
            return "run.message"
        if engine_event_type == "error":
            return "run.failed"
        if engine_event_type == "llm_response_end":
            return "model.response.completed"
        if engine_event_type == "tool_message":
            return "tool.completed"
        return "run.status"
