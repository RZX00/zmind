from __future__ import annotations

from typing import Any, Dict, Optional

from core.domains.automation import events as automation_events
from core.domains.automation.model import Automation
from core.domains.automation.ports.automation_repository import AutomationRepository


class CreateAutomationUseCase:
    def __init__(self, repository: AutomationRepository) -> None:
        self._repository = repository

    async def execute(
        self,
        *,
        account_id: str,
        agent_id: Optional[str],
        name: str,
        description: Optional[str],
        trigger_type: str,
        provider: Optional[str],
        provider_binding_key: Optional[str],
        route_type: str,
        route_ref: Optional[str],
        is_active: bool,
        config: Dict[str, Any],
        actor_id: Optional[str],
        event_payload: Optional[Dict[str, Any]] = None,
    ) -> Automation:
        automation = await self._repository.create_automation(
            account_id=account_id,
            agent_id=agent_id,
            name=name,
            description=description,
            trigger_type=trigger_type,
            provider=provider,
            provider_binding_key=provider_binding_key,
            route_type=route_type,
            route_ref=route_ref,
            is_active=is_active,
            config=config,
            created_by=actor_id,
        )

        payload: Dict[str, Any] = {
            "automation_id": automation.id,
            "trigger_type": automation.trigger_type,
            "provider": automation.provider,
            "route_type": automation.route_type,
        }
        if event_payload:
            payload.update({k: v for k, v in event_payload.items() if v is not None})

        from core.application.event_bus import record_event

        await record_event(
            automation_events.automation_event(
                event_type=automation_events.AUTOMATION_CREATED,
                automation_id=automation.id,
                tenant_id=account_id,
                actor_id=actor_id,
                payload=payload,
            )
        )
        return automation
