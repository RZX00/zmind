from __future__ import annotations

from typing import Any, Mapping, Optional

from core.domains.shared.event_registry import register_event_type
from core.domains.shared.events import new_event


OPENCLAW_SETTINGS_UPDATED = "OpenClawSettingsUpdated"
OPENCLAW_ACTIVITY_RECORDED = "OpenClawActivityRecorded"
OPENCLAW_ACTIVITY_ROLLED_BACK = "OpenClawActivityRolledBack"


register_event_type(OPENCLAW_SETTINGS_UPDATED, 1)
register_event_type(OPENCLAW_ACTIVITY_RECORDED, 1)
register_event_type(OPENCLAW_ACTIVITY_ROLLED_BACK, 1)


def openclaw_settings_updated(
    *,
    workspace_id: str,
    actor_id: str,
    payload: Mapping[str, Any],
) -> Any:
    return new_event(
        event_type=OPENCLAW_SETTINGS_UPDATED,
        aggregate_id=workspace_id,
        aggregate_type="openclaw_workspace_settings",
        tenant_id=workspace_id,
        actor_id=actor_id,
        payload=payload,
    )


def openclaw_activity_recorded(
    *,
    activity_id: str,
    workspace_id: str,
    actor_id: str,
    payload: Mapping[str, Any],
) -> Any:
    return new_event(
        event_type=OPENCLAW_ACTIVITY_RECORDED,
        aggregate_id=activity_id,
        aggregate_type="openclaw_activity",
        tenant_id=workspace_id,
        actor_id=actor_id,
        payload=payload,
    )


def openclaw_activity_rolled_back(
    *,
    activity_id: str,
    workspace_id: str,
    actor_id: str,
    payload: Mapping[str, Any],
) -> Any:
    return new_event(
        event_type=OPENCLAW_ACTIVITY_ROLLED_BACK,
        aggregate_id=activity_id,
        aggregate_type="openclaw_activity",
        tenant_id=workspace_id,
        actor_id=actor_id,
        payload=payload,
    )
