from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from core.domains.automation import events as automation_events
from core.domains.automation.model import AutomationRun
from core.domains.automation.ports.automation_repository import AutomationRepository


class QueueAutomationRunUseCase:
    def __init__(self, repository: AutomationRepository) -> None:
        self._repository = repository

    async def execute(
        self,
        *,
        automation_id: str,
        account_id: str,
        trigger_source: str,
        provider_event_id: Optional[str],
        external_run_key: Optional[str],
        retry_count: int,
        max_retries: int,
        metadata: Dict[str, Any],
        actor_id: Optional[str] = None,
    ) -> Tuple[AutomationRun, bool]:
        run, duplicate = await self._repository.create_run(
            automation_id=automation_id,
            account_id=account_id,
            trigger_source=trigger_source,
            provider_event_id=provider_event_id,
            external_run_key=external_run_key,
            status="queued",
            retry_count=retry_count,
            max_retries=max_retries,
            metadata=metadata,
        )

        if duplicate:
            return run, True

        from core.application.event_bus import record_event

        await record_event(
            automation_events.automation_event(
                event_type=automation_events.AUTOMATION_RUN_QUEUED,
                automation_id=automation_id,
                tenant_id=account_id,
                actor_id=actor_id,
                payload={
                    "run_id": run.id,
                    "provider_event_id": run.provider_event_id,
                    "trigger_source": run.trigger_source,
                    "retry_count": run.retry_count,
                    "max_retries": run.max_retries,
                },
            )
        )
        return run, False
