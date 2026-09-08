from __future__ import annotations

from typing import Any, Mapping, Optional

from core.domains.shared.events import DomainEvent, new_event
from core.domains.shared.event_registry import register_event_type

WORKSPACE_CREATED = "WorkspaceCreated"
MEMBER_INVITED = "WorkspaceMemberInvited"
MEMBER_ROLE_CHANGED = "WorkspaceMemberRoleChanged"

register_event_type(WORKSPACE_CREATED, 1)
register_event_type(MEMBER_INVITED, 1)
register_event_type(MEMBER_ROLE_CHANGED, 1)


def workspace_event(
    *,
    event_type: str,
    workspace_id: str,
    payload: Mapping[str, Any],
    tenant_id: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> DomainEvent:
    return new_event(
        event_type=event_type,
        aggregate_id=workspace_id,
        aggregate_type="Workspace",
        payload=payload,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
