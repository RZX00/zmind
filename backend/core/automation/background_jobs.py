from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import os
import uuid
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

import dramatiq

from core.ai_models.registry import DEFAULT_FREE_MODEL
from core.infrastructure.automation.supabase_automation_repository import (
    SupabaseAutomationRepository,
)
from core.utils.logger import logger
from .schedule_utils import compute_retry_delay_ms, is_schedule_due


AUTOMATION_WORKER_INSTANCE_ID = os.getenv("AUTOMATION_WORKER_INSTANCE_ID", "automation-worker")


def _repo() -> SupabaseAutomationRepository:
    from core.services.supabase import DBConnection

    return SupabaseAutomationRepository(db=DBConnection())


def _safe_json(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, indent=2)
    except Exception:
        return str(value)


def _extract_provider_binding_key(provider_event_payload: Dict[str, Any]) -> Optional[str]:
    data = provider_event_payload.get("data") if isinstance(provider_event_payload, dict) else None
    if isinstance(data, dict):
        if data.get("trigger_nano_id"):
            return str(data["trigger_nano_id"])
        if data.get("trigger_id"):
            return str(data["trigger_id"])
    for key in ("trigger_nano_id", "trigger_id", "composio_trigger_id"):
        value = provider_event_payload.get(key) if isinstance(provider_event_payload, dict) else None
        if value:
            return str(value)
    return None


def _build_prompt(
    *,
    automation: Any,
    trigger_source: str,
    provider_event_payload: Optional[Dict[str, Any]],
    run_metadata: Dict[str, Any],
) -> str:
    config = automation.config or {}
    if isinstance(config.get("agent_prompt"), str) and config.get("agent_prompt").strip():
        return config.get("agent_prompt").strip()

    if trigger_source == "event":
        event_dump = _safe_json(provider_event_payload or {})
        return (
            f"Automation '{automation.name}' was triggered by an external event. "
            "Process the event and complete the requested workflow.\n\n"
            f"Event payload:\n{event_dump}"
        )

    if trigger_source == "schedule":
        cron_expression = config.get("cron_expression") or "(unknown)"
        return (
            f"Automation '{automation.name}' scheduled run fired with cron '{cron_expression}'. "
            "Execute the configured workflow and provide final result output."
        )

    payload_dump = _safe_json(run_metadata)
    return (
        f"Automation '{automation.name}' manual/test run fired. "
        f"Run context:\n{payload_dump}"
    )


async def _load_agent_config(client: Any, *, account_id: str, agent_id: Optional[str]) -> Optional[Dict[str, Any]]:
    from core.config_helper import extract_agent_config

    if not agent_id:
        return None

    result = (
        await client.table("agents")
        .select("*")
        .eq("agent_id", agent_id)
        .eq("account_id", account_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        return None

    agent_row = result.data[0]
    try:
        return extract_agent_config(agent_row, None)
    except Exception as exc:
        logger.warning("automation_agent_config_fallback", agent_id=agent_id, error=str(exc))
        return {
            "agent_id": str(agent_row.get("agent_id") or ""),
            "model": agent_row.get("model"),
            "name": agent_row.get("name") or "Automation Agent",
        }


async def _start_agent_run_for_automation(
    *,
    automation: Any,
    run: Any,
    provider_event_payload: Optional[Dict[str, Any]],
) -> str:
    from core.application.use_cases.agent.start_agent_run import StartAgentRunUseCase
    from core.infrastructure.agent.supabase_agent_run_repository import SupabaseAgentRunRepository
    from core.services.supabase import DBConnection

    client = await DBConnection().client

    if automation.route_type != "agent":
        raise RuntimeError(f"unsupported_route_type:{automation.route_type}")

    prompt = _build_prompt(
        automation=automation,
        trigger_source=run.trigger_source,
        provider_event_payload=provider_event_payload,
        run_metadata=run.metadata or {},
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    project_name = f"[Automation] {automation.name}"[:160]
    project_id = str(uuid.uuid4())
    thread_id = str(uuid.uuid4())
    message_id = str(uuid.uuid4())

    await client.table("projects").insert(
        {
            "project_id": project_id,
            "account_id": automation.account_id,
            "name": project_name,
            "created_at": now_iso,
        }
    ).execute()

    await client.table("threads").insert(
        {
            "thread_id": thread_id,
            "project_id": project_id,
            "account_id": automation.account_id,
            "created_at": now_iso,
        }
    ).execute()

    message_metadata = {
        "automation": {
            "automation_id": automation.id,
            "automation_name": automation.name,
            "trigger_source": run.trigger_source,
            "provider_event_id": run.provider_event_id,
            "run_id": run.id,
        }
    }

    await client.table("messages").insert(
        {
            "message_id": message_id,
            "thread_id": thread_id,
            "type": "user",
            "is_llm_message": True,
            "content": json.dumps({"role": "user", "content": prompt}, ensure_ascii=False),
            "metadata": message_metadata,
            "created_at": now_iso,
        }
    ).execute()

    agent_config = await _load_agent_config(
        client,
        account_id=automation.account_id,
        agent_id=automation.agent_id,
    )

    model_name = (automation.config or {}).get("model_name") or DEFAULT_FREE_MODEL
    enable_thinking = bool((automation.config or {}).get("enable_thinking", False))
    reasoning_effort = (automation.config or {}).get("reasoning_effort") or "low"
    enable_context_manager = bool((automation.config or {}).get("enable_context_manager", False))
    enable_prompt_caching = bool((automation.config or {}).get("enable_prompt_caching", False))
    stream = bool((automation.config or {}).get("stream", True))

    use_case = StartAgentRunUseCase(SupabaseAgentRunRepository(DBConnection()))
    agent_run, duplicate = await use_case.execute(
        thread_id=thread_id,
        status="running",
        started_at=datetime.now(timezone.utc).isoformat(),
        agent_id=str(automation.agent_id) if automation.agent_id else None,
        agent_version_id=str((agent_config or {}).get("current_version_id")) if agent_config else None,
        metadata={
            "model_name": model_name,
            "model_source": "automation",
            "enable_thinking": enable_thinking,
            "reasoning_effort": reasoning_effort,
            "enable_context_manager": enable_context_manager,
            "run_mode": "agent",
            "automation_id": automation.id,
            "automation_run_id": run.id,
        },
        idempotency_key=f"automation-run:{run.id}",
        tenant_id=automation.account_id,
        actor_id=None,
        event_payload={
            "model_name": model_name,
            "automation_id": automation.id,
        },
    )

    from run_agent_background import run_agent_background

    if not duplicate:
        run_agent_background.send(
            agent_run_id=agent_run.id,
            thread_id=thread_id,
            instance_id=AUTOMATION_WORKER_INSTANCE_ID,
            project_id=project_id,
            model_name=model_name,
            enable_thinking=enable_thinking,
            reasoning_effort=reasoning_effort,
            stream=stream,
            enable_context_manager=enable_context_manager,
            enable_prompt_caching=enable_prompt_caching,
            agent_config=agent_config,
            request_id=f"automation:{run.id}",
            requested_model_name=model_name,
            run_mode="agent",
            client_message={
                "message_id": message_id,
                "type": "automation",
                "metadata": message_metadata,
            },
        )

    return agent_run.id


@dramatiq.actor(max_retries=2)
async def dispatch_provider_event(provider_event_id: str) -> None:
    from core.application.use_cases.automation.queue_automation_run import QueueAutomationRunUseCase

    repo = _repo()

    provider_event = await repo.get_provider_event(provider_event_id)
    if not provider_event:
        logger.warning("automation_dispatch_missing_provider_event", provider_event_id=provider_event_id)
        return

    if provider_event.processing_status in ("dispatched", "ignored"):
        return

    payload = provider_event.payload or {}
    binding_key = _extract_provider_binding_key(payload)
    automations = await repo.list_active_event_automations(
        provider=provider_event.provider,
        provider_binding_key=binding_key,
    )

    if not automations:
        await repo.update_provider_event_status(
            provider_event_id=provider_event_id,
            status="ignored",
            processing_error="no_matching_automations",
        )
        return

    queued_count = 0
    for automation in automations:
        run, duplicate = await QueueAutomationRunUseCase(repo).execute(
            automation_id=automation.id,
            account_id=automation.account_id,
            trigger_source="event",
            provider_event_id=provider_event.id,
            external_run_key=f"provider-event:{provider_event.id}:{automation.id}",
            retry_count=0,
            max_retries=int((automation.config or {}).get("max_retries") or 5),
            metadata={
                "provider": provider_event.provider,
                "event_type": provider_event.event_type,
                "provider_event_id": provider_event.id,
                "binding_key": binding_key,
            },
            actor_id=None,
        )
        if not duplicate:
            queued_count += 1
            execute_automation_run.send(run_id=run.id)

    await repo.update_provider_event_status(
        provider_event_id=provider_event_id,
        status="dispatched",
        processing_error=None,
    )
    logger.info(
        "automation_event_dispatched",
        provider_event_id=provider_event.id,
        provider=provider_event.provider,
        matched=len(automations),
        queued=queued_count,
    )


@dramatiq.actor(max_retries=0)
async def execute_automation_run(run_id: str) -> None:
    repo = _repo()
    run = await repo.get_run(run_id)
    if not run:
        logger.warning("automation_execute_run_missing", run_id=run_id)
        return

    if run.status in ("completed", "cancelled", "dead_lettered"):
        return

    automation = await repo.get_automation(run.automation_id)
    if not automation:
        await repo.update_run_status(
            run_id=run.id,
            status="failed",
            error_code="AUTOMATION_NOT_FOUND",
            error_message="automation_not_found",
        )
        return

    if not automation.is_active:
        await repo.update_run_status(
            run_id=run.id,
            status="cancelled",
            error_code="AUTOMATION_INACTIVE",
            error_message="automation_inactive",
        )
        return

    await repo.update_run_status(run_id=run.id, status="running")

    attempt_no = max(1, int(run.retry_count or 0) + 1)
    attempt, _duplicate = await repo.create_run_attempt(
        run_id=run.id,
        attempt_no=attempt_no,
        status="running",
        error_code=None,
        error_message=None,
        metadata={"trigger_source": run.trigger_source},
    )

    provider_event_payload: Optional[Dict[str, Any]] = None
    if run.provider_event_id:
        provider_event = await repo.get_provider_event(run.provider_event_id)
        if provider_event:
            provider_event_payload = provider_event.payload or {}

    try:
        agent_run_id = await _start_agent_run_for_automation(
            automation=automation,
            run=run,
            provider_event_payload=provider_event_payload,
        )
        await repo.update_run_attempt_status(attempt_id=attempt.id, status="completed")
        await repo.update_run_status(
            run_id=run.id,
            status="completed",
            agent_run_id=agent_run_id,
            error_code=None,
            error_message=None,
        )
        logger.info(
            "automation_run_started",
            run_id=run.id,
            automation_id=automation.id,
            agent_run_id=agent_run_id,
            attempt_no=attempt_no,
        )
    except Exception as exc:
        error_message = str(exc)
        logger.error(
            "automation_run_execution_failed",
            run_id=run.id,
            automation_id=automation.id,
            attempt_no=attempt_no,
            error=error_message,
        )
        await repo.update_run_attempt_status(
            attempt_id=attempt.id,
            status="failed",
            error_code="AUTOMATION_EXECUTION_ERROR",
            error_message=error_message,
        )

        next_retry_count = int(run.retry_count or 0) + 1
        if next_retry_count < int(run.max_retries or 0):
            await repo.update_run_status(
                run_id=run.id,
                status="failed",
                retry_count=next_retry_count,
                error_code="AUTOMATION_EXECUTION_ERROR",
                error_message=error_message,
            )
            delay_ms = compute_retry_delay_ms(next_retry_count)
            execute_automation_run.send_with_options(kwargs={"run_id": run.id}, delay=delay_ms)
            return

        await repo.update_run_status(
            run_id=run.id,
            status="dead_lettered",
            retry_count=next_retry_count,
            error_code="AUTOMATION_DEAD_LETTERED",
            error_message=error_message,
        )


async def _dispatch_scheduled_automations_impl(account_id: Optional[str] = None) -> Dict[str, int]:
    from core.application.use_cases.automation.queue_automation_run import QueueAutomationRunUseCase

    repo = _repo()
    now_utc = datetime.now(timezone.utc)
    automations = await repo.list_active_schedule_automations(account_id=account_id)

    scanned = 0
    queued = 0
    skipped = 0

    for automation in automations:
        scanned += 1
        config = automation.config or {}
        cron_expression = config.get("cron_expression")
        if not isinstance(cron_expression, str) or not cron_expression.strip():
            skipped += 1
            continue

        timezone_name = config.get("timezone") or "UTC"
        try:
            local_zone = ZoneInfo(str(timezone_name))
        except Exception:
            local_zone = ZoneInfo("UTC")

        local_now = now_utc.astimezone(local_zone)
        if not is_schedule_due(cron_expression.strip(), local_now):
            continue

        minute_start_local = local_now.replace(second=0, microsecond=0)
        minute_start_utc = minute_start_local.astimezone(timezone.utc)
        minute_end_utc = minute_start_utc + timedelta(minutes=1)

        latest_run = await repo.get_latest_run_for_automation(
            automation_id=automation.id,
            trigger_source="schedule",
        )
        if latest_run and minute_start_utc <= latest_run.triggered_at < minute_end_utc:
            skipped += 1
            continue

        run_key = f"schedule:{minute_start_utc.isoformat()}"
        run, duplicate = await QueueAutomationRunUseCase(repo).execute(
            automation_id=automation.id,
            account_id=automation.account_id,
            trigger_source="schedule",
            provider_event_id=None,
            external_run_key=run_key,
            retry_count=0,
            max_retries=int(config.get("max_retries") or 5),
            metadata={
                "cron_expression": cron_expression,
                "timezone": timezone_name,
                "scheduled_minute_utc": minute_start_utc.isoformat(),
            },
            actor_id=None,
        )
        if not duplicate:
            queued += 1
            execute_automation_run.send(run_id=run.id)

    logger.info(
        "automation_schedule_dispatch_complete",
        account_id=account_id,
        scanned=scanned,
        queued=queued,
        skipped=skipped,
    )
    return {
        "scanned": scanned,
        "queued": queued,
        "skipped": skipped,
    }


@dramatiq.actor(max_retries=0)
async def dispatch_scheduled_automations(account_id: Optional[str] = None) -> None:
    await _dispatch_scheduled_automations_impl(account_id=account_id)
