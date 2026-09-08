from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Dict, Any

from core.application.event_bus import record_event
from core.domains.collaboration import events as collaboration_events
from core.domains.collaboration.ports.collaboration_repository import (
    CollaborationRepository,
)


class CloseCollaborationSessionUseCase:
    def __init__(self, repository: CollaborationRepository) -> None:
        self._repository = repository

    async def execute(
        self,
        *,
        session_id: str,
        workspace_id: str,
        user_id: Optional[str],
        ended_at: Optional[datetime] = None,
        event_payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        ended_at = ended_at or datetime.now(timezone.utc)
        await self._repository.close_session(session_id=session_id, ended_at=ended_at)
        payload: Dict[str, Any] = {
            "session_id": session_id,
            "ended_at": ended_at.isoformat(),
        }
        if event_payload:
            payload.update({k: v for k, v in event_payload.items() if v is not None})
        event = collaboration_events.collaboration_event(
            event_type=collaboration_events.SESSION_CLOSED,
            session_id=session_id,
            tenant_id=workspace_id,
            actor_id=user_id,
            payload=payload,
        )
        await record_event(event)
