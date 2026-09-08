"""
Trigger execution service - executes agent runs when triggers fire.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from core.ai_models.registry import DEFAULT_FREE_MODEL
from core.application.use_cases.agent.start_agent_run import StartAgentRunUseCase
from core.config_helper import extract_agent_config
from core.infrastructure.agent.supabase_agent_run_repository import SupabaseAgentRunRepository
from core.services.supabase import DBConnection
from core.utils.logger import logger
from run_agent_background import run_agent_background

from .trigger_service import TriggerEvent, TriggerResult


class ExecutionService:
    """Executes agents when triggers fire by creating a normal agent run."""

    def __init__(self, db_connection: DBConnection):
        self._db = db_connection

    async def execute_trigger_result(
        self,
        agent_id: str,
        trigger_result: TriggerResult,
        trigger_event: TriggerEvent,
    ) -> Dict[str, Any]:
        if not trigger_result.agent_prompt or not str(trigger_result.agent_prompt).strip():
            return {
                "success": False,
                "error": "missing_agent_prompt",
                "message": "Failed to execute trigger",
            }

        try:
            client = await self._db.client
            agent_result = (
                await client.table("agents")
                .select("*")
                .eq("agent_id", agent_id)
                .limit(1)
                .execute()
            )
            if not agent_result.data:
                return {
                    "success": False,
                    "error": f"Agent {agent_id} not found",
                    "message": "Failed to execute trigger",
                }

            agent_row = agent_result.data[0]
            account_id = agent_row.get("account_id")
            if not account_id:
                return {
                    "success": False,
                    "error": "missing_account_id",
                    "message": "Failed to execute trigger",
                }

            rendered_prompt = self._render_prompt(
                trigger_result.agent_prompt,
                trigger_result.execution_variables,
                trigger_event,
            )

            now_iso = datetime.now(timezone.utc).isoformat()
            project_id = str(uuid.uuid4())
            thread_id = str(uuid.uuid4())
            message_id = str(uuid.uuid4())
            project_name = f"[Trigger] {agent_row.get('name') or 'Worker'}"[:160]

            await client.table("projects").insert(
                {
                    "project_id": project_id,
                    "account_id": account_id,
                    "name": project_name,
                    "created_at": now_iso,
                }
            ).execute()

            await client.table("threads").insert(
                {
                    "thread_id": thread_id,
                    "project_id": project_id,
                    "account_id": account_id,
                    "created_at": now_iso,
                }
            ).execute()

            message_metadata = {
                "trigger": {
                    "trigger_id": trigger_event.trigger_id,
                    "trigger_type": trigger_event.trigger_type.value,
                    "trigger_variables": trigger_result.execution_variables or {},
                }
            }

            await client.table("messages").insert(
                {
                    "message_id": message_id,
                    "thread_id": thread_id,
                    "type": "user",
                    "is_llm_message": True,
                    "content": json.dumps(
                        {"role": "user", "content": rendered_prompt},
                        ensure_ascii=False,
                    ),
                    "metadata": message_metadata,
                    "created_at": now_iso,
                }
            ).execute()

            agent_config = None
            try:
                agent_config = extract_agent_config(agent_row, None)
            except Exception as exc:
                logger.warning(
                    "trigger_agent_config_fallback",
                    agent_id=agent_id,
                    error=str(exc),
                )
                agent_config = {
                    "agent_id": str(agent_row.get("agent_id") or ""),
                    "model": agent_row.get("model"),
                    "name": agent_row.get("name") or "Trigger Agent",
                }

            model_name = trigger_result.model or DEFAULT_FREE_MODEL
            idempotency_suffix = (
                (trigger_result.execution_variables or {}).get("provider_event_id")
                or (trigger_result.execution_variables or {}).get("webhook_id")
                or trigger_event.timestamp.isoformat()
            )

            use_case = StartAgentRunUseCase(SupabaseAgentRunRepository(self._db))
            agent_run, duplicate = await use_case.execute(
                thread_id=thread_id,
                status="running",
                started_at=now_iso,
                agent_id=agent_id,
                agent_version_id=str((agent_config or {}).get("current_version_id"))
                if agent_config
                else None,
                metadata={
                    "model_name": model_name,
                    "model_source": "trigger",
                    "enable_thinking": False,
                    "reasoning_effort": "low",
                    "enable_context_manager": True,
                    "run_mode": "agent",
                    "trigger_execution": True,
                    "trigger_id": trigger_event.trigger_id,
                },
                idempotency_key=f"trigger:{trigger_event.trigger_id}:{idempotency_suffix}",
                tenant_id=account_id,
                actor_id=None,
                event_payload={
                    "model_name": model_name,
                    "trigger_id": trigger_event.trigger_id,
                },
            )

            if not duplicate:
                run_agent_background.send(
                    agent_run_id=agent_run.id,
                    thread_id=thread_id,
                    instance_id=os.getenv("TRIGGER_WORKER_INSTANCE_ID", "trigger-worker"),
                    project_id=project_id,
                    model_name=model_name,
                    enable_thinking=False,
                    reasoning_effort="low",
                    stream=True,
                    enable_context_manager=True,
                    enable_prompt_caching=True,
                    agent_config=agent_config,
                    request_id=f"trigger:{trigger_event.trigger_id}",
                    requested_model_name=model_name,
                    run_mode="agent",
                    client_message={
                        "message_id": message_id,
                        "type": "trigger",
                        "metadata": message_metadata,
                    },
                )

            return {
                "success": True,
                "thread_id": thread_id,
                "agent_run_id": agent_run.id,
                "duplicate": duplicate,
                "message": "Worker execution started successfully",
            }

        except Exception as e:
            logger.error(f"Failed to execute trigger result: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "message": "Failed to execute trigger",
            }

    def _render_prompt(
        self,
        prompt: str,
        trigger_variables: Optional[Dict[str, Any]],
        trigger_event: TriggerEvent,
    ) -> str:
        rendered = prompt

        try:
            context: Dict[str, Any] = {}
            if isinstance(trigger_event.context, dict):
                context.update(trigger_event.context)
            if isinstance(trigger_variables, dict):
                context.update(trigger_variables)

            payload = context.get("payload")
            trigger_slug = context.get("trigger_slug")
            webhook_id = context.get("webhook_id")

            def _to_json(obj: Any) -> str:
                try:
                    return json.dumps(obj, ensure_ascii=False, indent=2)
                except Exception:
                    return str(obj)

            if "{{payload}}" in rendered:
                rendered = rendered.replace("{{payload}}", _to_json(payload))
            if "{{trigger_slug}}" in rendered:
                rendered = rendered.replace("{{trigger_slug}}", str(trigger_slug or ""))
            if "{{webhook_id}}" in rendered:
                rendered = rendered.replace("{{webhook_id}}", str(webhook_id or ""))

            if context:
                rendered = f"{rendered}\n\n---\nTrigger Context:\n{_to_json(context)}"

        except Exception as exc:
            logger.warning(f"Failed to render prompt variables: {exc}")

        return rendered


def get_execution_service(db_connection: DBConnection) -> ExecutionService:
    return ExecutionService(db_connection)
