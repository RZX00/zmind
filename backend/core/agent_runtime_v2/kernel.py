from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, AsyncIterator

from .adapters.langgraph_general_lane import LangGraphGeneralLaneAdapter
from .adapters.persistence import RuntimePersistenceProjectionV2
from .artifacts import ArtifactStoreV2
from .canvas.execution_core import CanvasExecutionCoreV2
from .context.pipeline import ContextLifecyclePipelineV2
from .continuity import ContinuityStoreV2, load_or_create_continuity_state, resume_consistency_check
from .contracts import AgentEventV2, AgentRunStartV2, RuntimeContextV2
from .event_bus import CanonicalEventBusV2
from .lane_selector import ExecutionLaneSelectorV2
from .normalization import InputNormalizerV2
from .tool_policy import ToolPolicyEngineV2
from .tool_pool import ToolPoolFactoryV2, ToolPoolV2


@dataclass(slots=True)
class AgentRuntimeKernelV2:
    continuity_store: ContinuityStoreV2
    normalizer: InputNormalizerV2 | None = None
    lane_selector: ExecutionLaneSelectorV2 | None = None
    artifact_store: ArtifactStoreV2 | None = None
    context_pipeline: ContextLifecyclePipelineV2 | None = None
    canvas_core: CanvasExecutionCoreV2 | None = None
    general_lane_adapter: LangGraphGeneralLaneAdapter | None = None
    persistence_projection: RuntimePersistenceProjectionV2 | None = None
    tool_policy_engine: ToolPolicyEngineV2 | None = None
    tool_pool_factory: ToolPoolFactoryV2 | None = None

    def __post_init__(self) -> None:
        self.normalizer = self.normalizer or InputNormalizerV2()
        self.lane_selector = self.lane_selector or ExecutionLaneSelectorV2()
        self.artifact_store = self.artifact_store or ArtifactStoreV2()
        self.context_pipeline = self.context_pipeline or ContextLifecyclePipelineV2(
            artifact_store=self.artifact_store,
        )
        self.canvas_core = self.canvas_core or CanvasExecutionCoreV2()
        self.tool_policy_engine = self.tool_policy_engine or ToolPolicyEngineV2()
        self.tool_pool_factory = self.tool_pool_factory or ToolPoolFactoryV2()

    async def run(
        self,
        start: AgentRunStartV2,
        *,
        tool_registry: Any | None = None,
    ) -> AsyncIterator[AgentEventV2]:
        normalized = self.normalizer.normalize(start)
        continuity_id = f"thread:{normalized.identity.thread_id}"
        continuity_state = await load_or_create_continuity_state(
            self.continuity_store,
            continuity_id=continuity_id,
            resume_token=normalized.resume_token,
        )
        context = RuntimeContextV2(
            identity=normalized.identity,
            surface=normalized.surface,
            interaction_mode=normalized.interaction_mode,
            response_mode=normalized.response_mode,
            latest_user_text=normalized.latest_user_text,
            user_input=dict(normalized.user_input or {}),
            workspace_target=normalized.workspace_target,
            selection_context=normalized.selection_context,
            model_name=normalized.model_name,
            enable_thinking=normalized.enable_thinking,
            reasoning_effort=normalized.reasoning_effort,
            enable_context_manager=normalized.enable_context_manager,
            enable_prompt_caching=normalized.enable_prompt_caching,
            agent_config=normalized.agent_config,
            tool_context=dict(normalized.tool_context),
            continuity_state=continuity_state,
            checkpoint_id=normalized.checkpoint_id,
            resume_token=normalized.resume_token,
            stop_event=normalized.stop_event,
        )
        if continuity_state is not None:
            continuity_state.active_lane = None
            continuity_state.lane_state = "started"
        bus = CanonicalEventBusV2(runtime_context=context)

        self._append_transcript_entry(
            context,
            role="user",
            content=context.latest_user_text,
            metadata={"surface": context.surface},
        )

        pending_events: list[AgentEventV2] = []
        try:
            pending_events.append(
                bus.build(
                    "run.started",
                    payload={
                        "surface": context.surface,
                        "interaction_mode": context.interaction_mode,
                        "response_mode": context.response_mode,
                    },
                )
            )

            if normalized.resume_token:
                consistency = resume_consistency_check(
                    stored=continuity_state,
                    surface=normalized.surface,
                    workspace_target=normalized.workspace_target.to_dict(),
                    selection_context=normalized.selection_context.to_dict(),
                )
                context.diagnostics.append({"kind": "resume_consistency", **consistency})
                if continuity_state is not None:
                    continuity_state.decision_trace.append(
                        {
                            "component": "agent_runtime_kernel_v2",
                            "decision": "resume_consistency_checked",
                            "result": consistency,
                        }
                    )
                pending_events.append(bus.build("resume.consistency_checked", payload=consistency))

            intent_payload = self.lane_selector.resolve_intent(
                latest_user_text=context.latest_user_text,
                interaction_surface=context.surface,
                agent_config=context.agent_config,
            )
            context.policy_context["intent"] = intent_payload
            pending_events.append(
                bus.build(
                    "intent.resolved",
                    payload={"intent": intent_payload},
                )
            )

            lane_decision = self.lane_selector.select_lane(
                latest_user_text=context.latest_user_text,
                interaction_surface=context.surface,
                intent_payload=intent_payload,
                continuity_state=context.continuity_state,
            )
            context.lane = lane_decision.lane
            if continuity_state is not None:
                continuity_state.active_lane = context.lane
                continuity_state.lane_state = "lane_selected"
                continuity_state.decision_trace.append(
                    {
                        "component": "agent_runtime_kernel_v2",
                        "decision": "lane_selected",
                        "lane": lane_decision.lane,
                        "reason": lane_decision.reason,
                    }
                )
            pending_events.append(
                bus.build(
                    "lane.selected",
                    payload={"lane": lane_decision.lane, "reason": lane_decision.reason},
                )
            )

            tool_pool = self._build_tool_pool(context=context, tool_registry=tool_registry)
            context.policy_context["tool_pool"] = tool_pool.to_dict()

            context = self.context_pipeline.run(context)
            if continuity_state is not None:
                continuity_state.lane_state = "context_prepared"
            pending_events.append(
                bus.build(
                    "context.prepared",
                    payload={
                        "prompt_context": {
                            "stable_prefix": context.prompt_context.get("assembled", {}).get("stable_prefix") or [],
                            "lifecycle_stages": [
                                record.get("stage")
                                for record in list(context.prompt_context.get("lifecycle_records") or [])
                                if isinstance(record, dict)
                            ],
                        }
                    },
                )
            )

            checkpoint_token_for_turn: str | None = None

            for event in pending_events:
                event, checkpoint_token_for_turn = await self._prepare_event_for_emission(
                    context=context,
                    continuity_id=continuity_id,
                    event=event,
                    checkpoint_token=checkpoint_token_for_turn,
                )
                await self._persist_if_needed(context, event)
                yield event

            if context.lane == "canvas":
                events = await self.canvas_core.execute(
                    context=context,
                    bus=bus,
                    intent_payload=intent_payload,
                )
                for event in events:
                    event, checkpoint_token_for_turn = await self._prepare_event_for_emission(
                        context=context,
                        continuity_id=continuity_id,
                        event=event,
                        checkpoint_token=checkpoint_token_for_turn,
                    )
                    await self._persist_if_needed(context, event)
                    self._capture_event_in_transcript(context, event)
                    yield event
            else:
                if self.general_lane_adapter is None:
                    raise RuntimeError("General lane adapter is required for non-canvas execution.")
                if continuity_state is not None:
                    continuity_state.lane_state = "executing"
                async for event in self.general_lane_adapter.run(
                    context=context,
                    bus=bus,
                    tool_pool=tool_pool,
                ):
                    event, checkpoint_token_for_turn = await self._prepare_event_for_emission(
                        context=context,
                        continuity_id=continuity_id,
                        event=event,
                        checkpoint_token=checkpoint_token_for_turn,
                    )
                    await self._persist_if_needed(context, event)
                    self._capture_event_in_transcript(context, event)
                    if str(event.event_type).startswith("run.") and continuity_state is not None:
                        terminal_status = str(event.metadata.get("terminal_status") or "")
                        if terminal_status:
                            continuity_state.lane_state = terminal_status
                    yield event

        except Exception as exc:
            failure_event = bus.build(
                "run.failed",
                payload={"status": "failed", "error": str(exc)},
                metadata={"terminal_status": "failed"},
            )
            if continuity_state is not None:
                continuity_state.lane_state = "failed"
            failure_event, _ = await self._prepare_event_for_emission(
                context=context,
                continuity_id=continuity_id,
                event=failure_event,
                checkpoint_token=None,
            )
            await self._persist_if_needed(context, failure_event)
            self._capture_event_in_transcript(context, failure_event)
            yield failure_event
            return
        finally:
            if context.continuity_state is not None:
                await self._checkpoint_continuity_state(context=context, continuity_id=continuity_id)

    async def _prepare_event_for_emission(
        self,
        *,
        context: RuntimeContextV2,
        continuity_id: str,
        event: AgentEventV2,
        checkpoint_token: str | None,
    ) -> tuple[AgentEventV2, str | None]:
        if not self._should_attach_resume_token(context=context, event=event):
            return event, checkpoint_token

        if not checkpoint_token:
            checkpoint_token = await self._checkpoint_continuity_state(
                context=context,
                continuity_id=continuity_id,
            )

        enriched = self._attach_resume_token(
            context=context,
            event=event,
            resume_token=checkpoint_token,
        )
        return enriched, checkpoint_token

    async def _checkpoint_continuity_state(
        self,
        *,
        context: RuntimeContextV2,
        continuity_id: str,
    ) -> str | None:
        if context.continuity_state is None:
            return None

        context.continuity_state.resume_metadata["runtime_context_snapshot"] = {
            "surface": context.surface,
            "workspace_target": context.workspace_target.to_dict(),
            "selection_context": context.selection_context.to_dict(),
        }
        checkpoint_id = await self.continuity_store.save(continuity_id, context.continuity_state)
        context.continuity_state.resume_metadata["last_checkpoint_id"] = checkpoint_id
        context.checkpoint_id = checkpoint_id
        return checkpoint_id

    @staticmethod
    def _should_attach_resume_token(*, context: RuntimeContextV2, event: AgentEventV2) -> bool:
        continuity_state = context.continuity_state
        if continuity_state is None:
            return False

        terminal_status = str(event.metadata.get("terminal_status") or "").strip().lower()
        if terminal_status:
            return True

        if continuity_state.pending_preview is not None:
            return event.event_type in {"preview.ready", "preview.invalidated", "run.message"}

        lane_state = str(continuity_state.lane_state or "").strip().lower()
        return event.event_type == "run.message" and lane_state in {"completed", "failed", "stopped"}

    def _attach_resume_token(
        self,
        *,
        context: RuntimeContextV2,
        event: AgentEventV2,
        resume_token: str | None,
    ) -> AgentEventV2:
        if not resume_token:
            return event

        metadata = dict(event.metadata)
        metadata["resume_token"] = resume_token
        payload = dict(event.payload)

        if event.event_type == "preview.ready":
            preview = dict(payload.get("preview") or {})
            preview["resume_token"] = resume_token
            payload["preview"] = preview
            payload["resume_token"] = resume_token
        elif event.event_type in {"run.completed", "run.failed"}:
            payload["resume_token"] = resume_token

        frontend_content = metadata.get("frontend_content")
        if isinstance(frontend_content, dict):
            metadata["frontend_content"] = self._attach_resume_token_to_frontend_content(
                frontend_content=frontend_content,
                resume_token=resume_token,
            )

        enriched = replace(event, payload=payload, metadata=metadata)
        self._sync_event_history(context=context, event=enriched)
        return enriched

    @staticmethod
    def _attach_resume_token_to_frontend_content(
        *,
        frontend_content: dict[str, Any],
        resume_token: str,
    ) -> dict[str, Any]:
        updated = dict(frontend_content)

        canvas_preview = updated.get("canvas_preview")
        if isinstance(canvas_preview, dict):
            preview_payload = dict(canvas_preview)
            preview_payload["resume_token"] = resume_token
            updated["canvas_preview"] = preview_payload

        ctas = []
        for item in list(updated.get("cta") or []):
            if not isinstance(item, dict):
                continue
            cta_payload = dict(item.get("payload") or {})
            cta_payload["resume_token"] = resume_token
            updated_item = dict(item)
            updated_item["payload"] = cta_payload
            ctas.append(updated_item)
        if ctas:
            updated["cta"] = ctas

        continuity = dict(updated.get("continuity") or {})
        continuity["resume_token"] = resume_token
        continuity["pending_preview"] = True
        updated["continuity"] = continuity
        return updated

    @staticmethod
    def _sync_event_history(*, context: RuntimeContextV2, event: AgentEventV2) -> None:
        continuity_state = context.continuity_state
        if continuity_state is None:
            return
        for index in range(len(continuity_state.event_history) - 1, -1, -1):
            entry = continuity_state.event_history[index]
            if entry.get("event_id") == event.event_id:
                continuity_state.event_history[index] = event.to_dict()
                return

    def _build_tool_pool(self, *, context: RuntimeContextV2, tool_registry: Any | None) -> ToolPoolV2:
        assert self.tool_policy_engine is not None
        assert self.tool_pool_factory is not None
        mcp_service = context.tool_context.get("mcp_service")
        side_effect_policy = str(context.tool_context.get("side_effect_policy") or "allow_all")
        policy_decision = self.tool_policy_engine.resolve(
            agent_config=context.agent_config,
            mcp_enabled=bool(mcp_service),
            side_effect_policy=side_effect_policy,
        )
        context.policy_context["tool_policy"] = policy_decision.to_dict()
        if context.continuity_state is not None:
            context.continuity_state.decision_trace.append(
                {
                    "component": "agent_runtime_kernel_v2",
                    "decision": "tool_policy_resolved",
                    "policy": policy_decision.to_dict(),
                }
            )

        if tool_registry is not None:
            return self.tool_pool_factory.wrap(
                registry=tool_registry,
                policy=policy_decision,
                mcp_enabled=bool(mcp_service),
            )
        return self.tool_pool_factory.build(
            policy=policy_decision,
            mcp_service=mcp_service,
        )

    async def _persist_if_needed(self, context: RuntimeContextV2, event: AgentEventV2) -> None:
        if self.persistence_projection is None:
            return
        await self.persistence_projection.persist(context=context, event=event)

    @staticmethod
    def _append_transcript_entry(
        context: RuntimeContextV2,
        *,
        role: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        if context.continuity_state is None:
            return
        context.continuity_state.transcript.append(
            {
                "role": role,
                "content": content,
                "metadata": dict(metadata or {}),
            }
        )

    def _capture_event_in_transcript(self, context: RuntimeContextV2, event: AgentEventV2) -> None:
        if context.continuity_state is None:
            return
        if event.event_type == "run.message":
            message = dict(event.payload.get("message") or {})
            self._append_transcript_entry(
                context,
                role=str(message.get("role") or "assistant"),
                content=str(message.get("content") or ""),
                metadata=dict(event.metadata),
            )
            return

        raw_engine_event = event.payload.get("engine_event")
        if isinstance(raw_engine_event, dict) and raw_engine_event.get("type") == "assistant_final":
            message = dict(raw_engine_event.get("content") or {})
            self._append_transcript_entry(
                context,
                role=str(message.get("role") or "assistant"),
                content=str(message.get("content") or ""),
                metadata=dict(event.metadata),
            )
