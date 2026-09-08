from __future__ import annotations

from typing import Any, Mapping, Optional

from core.domains.shared.events import DomainEvent, new_event
from core.domains.shared.event_registry import register_event_type

CANVAS_CREATED = "CanvasCreated"
CANVAS_UPDATED = "CanvasUpdated"
CANVAS_VERSION_SAVED = "CanvasVersionSaved"
CANVAS_DELETED = "CanvasDeleted"
CANVAS_RESTORED = "CanvasRestored"
CANVAS_PURGED = "CanvasPurged"

register_event_type(CANVAS_CREATED, 1)
register_event_type(CANVAS_UPDATED, 1)
register_event_type(CANVAS_VERSION_SAVED, 1)
register_event_type(CANVAS_DELETED, 1)
register_event_type(CANVAS_RESTORED, 1)
register_event_type(CANVAS_PURGED, 1)


def canvas_created(
    *,
    canvas_id: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> DomainEvent:
    return new_event(
        event_type=CANVAS_CREATED,
        aggregate_id=canvas_id,
        aggregate_type="Canvas",
        payload=payload,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )


def canvas_updated(
    *,
    canvas_id: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> DomainEvent:
    return new_event(
        event_type=CANVAS_UPDATED,
        aggregate_id=canvas_id,
        aggregate_type="Canvas",
        payload=payload,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )


def canvas_version_saved(
    *,
    canvas_id: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
    ) -> DomainEvent:
        return new_event(
            event_type=CANVAS_VERSION_SAVED,
            aggregate_id=canvas_id,
            aggregate_type="Canvas",
            payload=payload,
            tenant_id=tenant_id,
            actor_id=actor_id,
        )


def canvas_deleted(
    *,
    canvas_id: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> DomainEvent:
    return new_event(
        event_type=CANVAS_DELETED,
        aggregate_id=canvas_id,
        aggregate_type="Canvas",
        payload=payload,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )


def canvas_restored(
    *,
    canvas_id: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> DomainEvent:
    return new_event(
        event_type=CANVAS_RESTORED,
        aggregate_id=canvas_id,
        aggregate_type="Canvas",
        payload=payload,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )


def canvas_purged(
    *,
    canvas_id: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> DomainEvent:
    return new_event(
        event_type=CANVAS_PURGED,
        aggregate_id=canvas_id,
        aggregate_type="Canvas",
        payload=payload,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
