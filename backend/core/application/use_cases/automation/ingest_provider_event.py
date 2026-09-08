from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from core.domains.automation import events as automation_events
from core.domains.automation.model import ProviderEvent
from core.domains.automation.ports.automation_repository import AutomationRepository


class IngestProviderEventUseCase:
    def __init__(self, repository: AutomationRepository) -> None:
        self._repository = repository

    async def execute(
        self,
        *,
        provider: str,
        dedupe_key: str,
        payload: Dict[str, Any],
        headers: Dict[str, Any],
        external_event_id: Optional[str],
        event_type: Optional[str],
        account_id: Optional[str],
        signature_valid: bool,
        actor_id: Optional[str] = None,
    ) -> Tuple[ProviderEvent, bool]:
        provider_event, duplicate = await self._repository.upsert_provider_event(
            provider=provider,
            dedupe_key=dedupe_key,
            payload=payload,
            headers=headers,
            external_event_id=external_event_id,
            event_type=event_type,
            account_id=account_id,
            signature_valid=signature_valid,
        )

        if duplicate:
            return provider_event, True

        from core.application.event_bus import record_event

        await record_event(
            automation_events.automation_event(
                event_type=automation_events.PROVIDER_EVENT_INGESTED,
                automation_id=provider_event.id,
                tenant_id=account_id,
                actor_id=actor_id,
                payload={
                    "provider_event_id": provider_event.id,
                    "provider": provider_event.provider,
                    "event_type": provider_event.event_type,
                    "external_event_id": provider_event.external_event_id,
                },
            )
        )
        return provider_event, False
