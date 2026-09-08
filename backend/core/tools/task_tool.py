from __future__ import annotations

import uuid
from typing import Any, Dict, Optional

from core.langgraph_engine.checkpoint_store import MemoryCheckpointStore, SupabaseCheckpointStore
from core.langgraph_engine.contracts.engine_interface import RunConfig
from core.langgraph_engine.engine import LangGraphEngine
from core.langgraph_engine.supervisor.agent_defs import SUPERVISOR_AGENT_DEFS, AgentDef
from core.langgraph_engine.stream.subtask_forwarder import (
    SubtaskForwarderConfig,
    build_subtask_event_forwarder,
)
from core.langgraph_engine.tools.catalog import build_registry
from core.services.supabase import DBConnection
from core.tools.base import Tool, ToolResult
from core.utils.logger import logger

from core.langgraph_engine.supervisor.subagent_runner import BillingOnlyEventPersister


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _normalize_output_mode(value: Any) -> str:
    mode = str(value or "last_message").strip().lower()
    return "full_history" if mode == "full_history" else "last_message"


def _build_user_prompt(*, description: str | None, prompt: str, context: str | None) -> str:
    parts: list[str] = []
    if description:
        parts.append(f"Task: {description}")
    if prompt:
        parts.append(prompt)
    if context:
        parts.append(f"Context:\n{context}")
    return "\n\n".join([p for p in parts if p])


def _select_agent_def(subagent_type: str) -> AgentDef | None:
    name = str(subagent_type or "").strip()
    if not name:
        return None
    return SUPERVISOR_AGENT_DEFS.get(name)


async def _ensure_task_session_row(
    db: DBConnection,
    *,
    task_run_id: str,
    thread_id: str,
    account_id: str,
    project_id: str | None,
    description: str | None,
    subagent_type: str,
) -> None:
    try:
        client = await db.client
        await client.table("agent_task_sessions").upsert(
            {
                "task_run_id": task_run_id,
                "thread_id": thread_id,
                "account_id": account_id,
                "project_id": project_id,
                "description": description,
                "subagent_type": subagent_type,
            },
            on_conflict="task_run_id",
        ).execute()
    except Exception as exc:
        # Best-effort: migration may not be applied yet in some envs.
        logger.debug("Task session upsert skipped", error=str(exc))


async def _load_task_session_row(db: DBConnection, *, task_run_id: str) -> dict[str, Any] | None:
    try:
        client = await db.client
        res = (
            await client.table("agent_task_sessions")
            .select("task_run_id, thread_id, account_id, project_id, description, subagent_type, status, last_checkpoint_id, metadata")
            .eq("task_run_id", task_run_id)
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0]
    except Exception as exc:
        logger.debug("Task session lookup skipped", error=str(exc))
    return None


class TaskTool(Tool):
    """Checkpoint-backed generic subtask runner (Phase 1)."""

    def __init__(
        self,
        *,
        thread_id: str,
        project_id: str | None,
        account_id: str,
        db_connection: DBConnection,
        parent_run_config: RunConfig,
        parent_state: dict[str, Any],
        tool_context: dict[str, Any],
    ) -> None:
        super().__init__()
        self.thread_id = thread_id
        self.project_id = project_id
        self.account_id = account_id
        self.db = db_connection
        self.parent_run_config = parent_run_config
        self.parent_state = parent_state
        self.tool_context = tool_context

    async def task(
        self,
        *,
        prompt: Optional[str] = None,
        context: Optional[str] = None,
        description: Optional[str] = None,
        subagent_type: Optional[str] = None,
        task_run_id: Optional[str] = None,
        output_mode: str = "last_message",
    ) -> ToolResult:
        output_mode = _normalize_output_mode(output_mode)
        task_run_id = _normalize_text(task_run_id)
        if not task_run_id:
            task_run_id = f"task_{uuid.uuid4().hex}"

        description = _normalize_text(description) or None
        prompt_text = _normalize_text(prompt) or "Continue."
        context_text = _normalize_text(context) or None

        session_row = await _load_task_session_row(self.db, task_run_id=task_run_id)
        if not subagent_type and session_row:
            subagent_type = session_row.get("subagent_type")

        subagent_type = _normalize_text(subagent_type)
        if not subagent_type:
            return self.fail_response("task requires subagent_type (or an existing task_run_id).")

        agent_def = _select_agent_def(subagent_type)
        if not agent_def:
            return self.fail_response(f"Unknown subagent_type: {subagent_type}")

        # Ensure resume does not cross threads/accounts (fallback to checkpoint when table absent).
        if session_row:
            if str(session_row.get("thread_id") or "") != str(self.thread_id):
                return self.fail_response("task_run_id does not belong to this thread.")
            if str(session_row.get("account_id") or "") != str(self.account_id):
                return self.fail_response("task_run_id does not belong to this account.")

        mcp_service = self.tool_context.get("mcp_service") if agent_def.allow_mcp else None
        allowed_prefixes = set(agent_def.allowed_prefixes or [])
        tool_registry = build_registry(
            mcp_service=mcp_service,
            allowed_names=agent_def.allowed_names,
            allowed_prefixes=allowed_prefixes or None,
        )

        checkpoint_store = None
        try:
            checkpoint_store = SupabaseCheckpointStore(db_connection=self.db)
        except Exception as exc:
            logger.warning("Task checkpoint store unavailable; falling back to memory", error=str(exc))
            checkpoint_store = MemoryCheckpointStore()

        loaded_state = None
        try:
            loaded_state = await checkpoint_store.load(task_run_id, None)
        except Exception:
            loaded_state = None

        if loaded_state:
            # Defensive: enforce thread/account invariants based on checkpoint payload.
            if str(loaded_state.get("thread_id") or "") != str(self.thread_id):
                return self.fail_response("task_run_id checkpoint does not match this thread.")
            if str(loaded_state.get("account_id") or "") != str(self.account_id):
                return self.fail_response("task_run_id checkpoint does not match this account.")

        await _ensure_task_session_row(
            self.db,
            task_run_id=task_run_id,
            thread_id=self.thread_id,
            account_id=self.account_id,
            project_id=self.project_id,
            description=description,
            subagent_type=subagent_type,
        )

        user_prompt = _build_user_prompt(description=description, prompt=prompt_text, context=context_text)

        initial_messages = None
        append_messages = None
        reset_loaded_state = False
        if loaded_state:
            append_messages = [{"role": "user", "content": user_prompt}]
            reset_loaded_state = True
        else:
            initial_messages = [
                {"role": "system", "content": agent_def.prompt},
                {"role": "user", "content": user_prompt},
            ]

        model_name = agent_def.model_name or self.parent_run_config.model_name

        run_config = RunConfig(
            agent_run_id=task_run_id,
            thread_id=self.thread_id,
            project_id=self.project_id,
            account_id=self.account_id,
            model_name=model_name,
            enable_thinking=self.parent_run_config.enable_thinking,
            reasoning_effort=self.parent_run_config.reasoning_effort,
            enable_context_manager=False,
            enable_prompt_caching=False,
            agent_config=None,
            max_iterations=agent_def.max_iterations,
            engine=self.parent_run_config.engine,
            engine_version=self.parent_run_config.engine_version,
            is_shadow=self.parent_run_config.is_shadow,
            shadow_parent_run_id=self.parent_run_config.shadow_parent_run_id,
            side_effect_policy=self.parent_run_config.side_effect_policy,
            checkpoint_id=None,
            stop_event=self.parent_run_config.stop_event,
            initial_messages_context=initial_messages,
            append_messages_context=append_messages,
            reset_loaded_state=reset_loaded_state,
        )

        engine = LangGraphEngine(
            tool_registry=tool_registry,
            tool_context=self.tool_context,
            checkpoint_store=checkpoint_store,
            event_persister=BillingOnlyEventPersister(),
            persist_events=True,
        )

        assistant_messages: list[dict[str, Any]] = []
        last_error: str | None = None
        event_forwarder = build_subtask_event_forwarder(
            SubtaskForwarderConfig(
                parent_agent_run_id=self.parent_run_config.agent_run_id,
                parent_thread_id=self.parent_run_config.thread_id,
                parent_session_index=int(self.parent_state.get("session_index") or 0)
                if isinstance(self.parent_state, dict)
                else 0,
                parent_checkpoint_id=self.parent_state.get("checkpoint_id") if isinstance(self.parent_state, dict) else None,
                engine=getattr(self.parent_run_config, "engine", None),
                engine_version=getattr(self.parent_run_config, "engine_version", None),
                is_shadow=bool(self.parent_state.get("is_shadow")) if isinstance(self.parent_state, dict) else False,
                subagent=subagent_type,
                subagent_display_name=agent_def.display_name,
                parent_tool_call_id=str(self.tool_context.get("tool_call_id") or "") or None,
                task_run_id=task_run_id,
                persist_tool_messages=False,
            )
        )

        async for event in engine.run(run_config):
            if event_forwarder:
                try:
                    await event_forwarder(event)
                except Exception as exc:
                    event_forwarder = None
                    logger.debug("Task event forwarder failed; disabling", error=str(exc))
            if event.get("type") == "assistant_final":
                content = event.get("content")
                if isinstance(content, dict):
                    assistant_messages.append(content)
            if event.get("type") == "error":
                last_error = str(event.get("message") or "task_error")

        if last_error:
            return self.fail_response(last_error)

        if output_mode == "full_history":
            payload = {
                "task_run_id": task_run_id,
                "subagent_type": subagent_type,
                "messages": assistant_messages,
            }
            return self.success_response(payload)

        last = assistant_messages[-1] if assistant_messages else {"role": "assistant", "content": ""}
        payload = {
            "task_run_id": task_run_id,
            "subagent_type": subagent_type,
            "content": last.get("content", ""),
        }
        return self.success_response(payload)
