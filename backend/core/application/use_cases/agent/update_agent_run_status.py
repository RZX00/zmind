from __future__ import annotations

from typing import Optional, Dict, Any

from core.application.event_bus import record_event
from core.domains.agent import events as agent_events
from core.domains.agent.model import AgentRun
from core.domains.agent.ports.agent_run_repository import AgentRunRepository


class UpdateAgentRunStatusUseCase:
    def __init__(self, repository: AgentRunRepository) -> None:
        self._repository = repository

    async def execute(
        self,
        *,
        agent_run_id: str,
        status: str,
        error: Optional[str] = None,
        completed_at: Optional[str] = None,
        expected_status: Optional[str] = None,
        tenant_id: Optional[str] = None,
        actor_id: Optional[str] = None,
        event_payload: Optional[Dict[str, Any]] = None,
    ) -> Optional[AgentRun]:
        run = await self._repository.update_status(
            agent_run_id=agent_run_id,
            status=status,
            error=error,
            completed_at=completed_at,
            expected_status=expected_status,
        )
        if not run:
            return None

        event_type = None
        if status == "completed":
            event_type = agent_events.AGENT_RUN_COMPLETED
        elif status == "stopped":
            event_type = agent_events.AGENT_RUN_STOPPED
        elif status in {"failed", "error"}:
            event_type = agent_events.AGENT_RUN_FAILED

        if event_type:
            payload: Dict[str, Any] = {
                "agent_run_id": run.id,
                "thread_id": run.thread_id,
                "status": status,
            }
            if error:
                payload["error"] = error
            if event_payload:
                payload.update({k: v for k, v in event_payload.items() if v is not None})

            event = agent_events.agent_event(
                event_type=event_type,
                agent_id=str(run.agent_id or run.id),
                tenant_id=tenant_id or run.workspace_id,
                actor_id=actor_id,
                payload=payload,
            )
            await record_event(event)

        return run
