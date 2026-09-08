from __future__ import annotations

from typing import Any, Mapping, Optional

from core.domains.shared.events import DomainEvent, new_event
from core.domains.shared.event_registry import register_event_type

SUBSCRIPTION_STARTED = "SubscriptionStarted"
PLAN_CHANGED = "PlanChanged"
USAGE_RECORDED = "UsageRecorded"

register_event_type(SUBSCRIPTION_STARTED, 1)
register_event_type(PLAN_CHANGED, 1)
register_event_type(USAGE_RECORDED, 1)


def billing_event(
    *,
    event_type: str,
    subscription_id: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
    aggregate_type: Optional[str] = None,
) -> DomainEvent:
    return new_event(
        event_type=event_type,
        aggregate_id=subscription_id,
        aggregate_type=aggregate_type or "Subscription",
        payload=payload,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
