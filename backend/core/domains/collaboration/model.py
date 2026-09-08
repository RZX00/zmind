from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional, List


@dataclass(frozen=True)
class CollaborationSession:
    id: str
    canvas_id: str
    workspace_id: str
    user_id: Optional[str]
    status: str
    started_at: datetime
    ended_at: Optional[datetime]


@dataclass(frozen=True)
class CollaborationOperationBatch:
    id: str
    session_id: str
    canvas_id: str
    workspace_id: str
    user_id: Optional[str]
    operations: List[Dict[str, Any]]
    op_count: int
    idempotency_key: Optional[str]
    created_at: datetime
