from __future__ import annotations

from typing import Optional, Dict, Any, Tuple

from core.application.event_bus import record_event
from core.domains.agent import events as agent_events
from core.domains.agent.model import AgentRun
from core.domains.agent.ports.agent_run_repository import AgentRunRepository


class StartAgentRunUseCase:
    def __init__(self, repository: AgentRunRepository) -> None:
        self._repository = repository

    async def execute(
        self,
        *,
        thread_id: str,
        status: str,
        started_at: Optional[str],
        agent_id: Optional[str],
        agent_version_id: Optional[str],
        metadata: Dict[str, Any],
        idempotency_key: Optional[str],
        skip_idempotency_lookup: bool = False,
        tenant_id: Optional[str],
        actor_id: Optional[str],
        event_payload: Optional[Dict[str, Any]] = None,
    ) -> Tuple[AgentRun, bool]:
        run, duplicate = await self._repository.create_run(
            thread_id=thread_id,
            status=status,
            started_at=started_at,
            agent_id=agent_id,
            agent_version_id=agent_version_id,
            metadata=metadata,
            idempotency_key=idempotency_key,
            skip_idempotency_lookup=skip_idempotency_lookup,
        )
        if duplicate:
            return run, True

        payload: Dict[str, Any] = {
            "agent_run_id": run.id,
            "thread_id": thread_id,
        }
        if event_payload:
            payload.update({k: v for k, v in event_payload.items() if v is not None})

        event = agent_events.agent_event(
            event_type=agent_events.AGENT_RUN_STARTED,
            agent_id=str(agent_id or run.id),
            tenant_id=tenant_id,
            actor_id=actor_id,
            payload=payload,
        )
        await record_event(event)
        return run, False
