from __future__ import annotations

from typing import Any, Mapping, Optional

from core.domains.shared.events import DomainEvent, new_event
from core.domains.shared.event_registry import register_event_type

LISTING_PUBLISHED = "ListingPublished"
LISTING_DEPRECATED = "ListingDeprecated"
LISTING_INSTALLED = "ListingInstalled"

register_event_type(LISTING_PUBLISHED, 1)
register_event_type(LISTING_DEPRECATED, 1)
register_event_type(LISTING_INSTALLED, 1)


def marketplace_event(
    *,
    event_type: str,
    listing_id: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> DomainEvent:
    return new_event(
        event_type=event_type,
        aggregate_id=listing_id,
        aggregate_type="Listing",
        payload=payload,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
