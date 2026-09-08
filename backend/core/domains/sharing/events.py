from __future__ import annotations

from typing import Any, Mapping, Optional

from core.domains.shared.events import DomainEvent, new_event
from core.domains.shared.event_registry import register_event_type

CANVAS_SHARE_UPDATED = "CanvasShareUpdated"
TEMPLATE_PUBLISHED = "TemplatePublished"
TEMPLATE_UNPUBLISHED = "TemplateUnpublished"

register_event_type(CANVAS_SHARE_UPDATED, 1)
register_event_type(TEMPLATE_PUBLISHED, 1)
register_event_type(TEMPLATE_UNPUBLISHED, 1)


def canvas_share_updated(
    *,
    canvas_id: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> DomainEvent:
    return new_event(
        event_type=CANVAS_SHARE_UPDATED,
        aggregate_id=canvas_id,
        aggregate_type="CanvasShare",
        payload=payload,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )


def template_published(
    *,
    canvas_id: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> DomainEvent:
    return new_event(
        event_type=TEMPLATE_PUBLISHED,
        aggregate_id=canvas_id,
        aggregate_type="Publication",
        payload=payload,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )


def template_unpublished(
    *,
    canvas_id: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> DomainEvent:
    return new_event(
        event_type=TEMPLATE_UNPUBLISHED,
        aggregate_id=canvas_id,
        aggregate_type="Publication",
        payload=payload,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
