from __future__ import annotations

from typing import Optional, Dict, Any, List

from core.application.event_bus import record_event
from core.domains.collaboration import events as collaboration_events
from core.domains.collaboration.ports.collaboration_repository import (
    CollaborationRepository,
)
from core.domains.collaboration.model import CollaborationOperationBatch


class AppendCollaborationOperationsUseCase:
    def __init__(self, repository: CollaborationRepository) -> None:
        self._repository = repository

    async def execute(
        self,
        *,
        session_id: str,
        canvas_id: str,
        workspace_id: str,
        user_id: Optional[str],
        operations: List[Dict[str, Any]],
        idempotency_key: Optional[str] = None,
        event_payload: Optional[Dict[str, Any]] = None,
    ) -> CollaborationOperationBatch:
        batch = await self._repository.append_operations(
            session_id=session_id,
            canvas_id=canvas_id,
            workspace_id=workspace_id,
            user_id=user_id,
            operations=operations,
            idempotency_key=idempotency_key,
        )
        payload: Dict[str, Any] = {
            "session_id": session_id,
            "canvas_id": canvas_id,
            "op_count": batch.op_count,
        }
        if event_payload:
            payload.update({k: v for k, v in event_payload.items() if v is not None})
        event = collaboration_events.collaboration_event(
            event_type=collaboration_events.OPERATION_APPENDED,
            session_id=session_id,
            tenant_id=workspace_id,
            actor_id=user_id,
            payload=payload,
        )
        await record_event(event)
        return batch
