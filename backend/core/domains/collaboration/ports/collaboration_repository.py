from __future__ import annotations

from datetime import datetime
from typing import Protocol, Optional, List, Dict, Any

from core.domains.collaboration.model import (
    CollaborationSession,
    CollaborationOperationBatch,
)


class CollaborationRepository(Protocol):
    async def start_session(
        self,
        *,
        session_id: str,
        canvas_id: str,
        workspace_id: str,
        user_id: Optional[str],
    ) -> CollaborationSession:
        ...

    async def close_session(
        self,
        *,
        session_id: str,
        ended_at: datetime,
    ) -> None:
        ...

    async def append_operations(
        self,
        *,
        session_id: str,
        canvas_id: str,
        workspace_id: str,
        user_id: Optional[str],
        operations: List[Dict[str, Any]],
        idempotency_key: Optional[str],
    ) -> CollaborationOperationBatch:
        ...

    async def list_operations_since(
        self,
        *,
        canvas_id: str,
        workspace_id: str,
        since: datetime,
        limit: int = 500,
    ) -> List[CollaborationOperationBatch]:
        ...
