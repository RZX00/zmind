from __future__ import annotations

from typing import Optional, Dict, Any

from core.application.event_bus import record_event
from core.domains.billing import events as billing_events
from core.domains.billing.ports.billing_repository import BillingRepository


class RecordUsageUseCase:
    def __init__(self, repository: BillingRepository) -> None:
        self._repository = repository

    async def execute(
        self,
        *,
        account_id: str,
        ledger_entry: Dict[str, Any],
        subscription_id: Optional[str] = None,
        actor_id: Optional[str] = None,
        event_payload: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        usage_id = await self._repository.record_usage(
            account_id=account_id,
            ledger_entry=ledger_entry,
        )
        if not usage_id:
            return None

        payload: Dict[str, Any] = {
            "usage_id": usage_id,
            "amount": ledger_entry.get("amount"),
            "type": ledger_entry.get("type"),
            "description": ledger_entry.get("description"),
            "reference_id": ledger_entry.get("reference_id"),
            "metadata": ledger_entry.get("metadata"),
            "account_id": account_id,
            "subscription_id": subscription_id,
        }
        if event_payload:
            payload.update({k: v for k, v in event_payload.items() if v is not None})

        aggregate_type = "Subscription" if subscription_id else "BillingAccount"
        aggregate_id = subscription_id or account_id
        event = billing_events.billing_event(
            event_type=billing_events.USAGE_RECORDED,
            subscription_id=aggregate_id,
            tenant_id=account_id,
            actor_id=actor_id,
            payload=payload,
            aggregate_type=aggregate_type,
        )
        await record_event(event)
        return usage_id
