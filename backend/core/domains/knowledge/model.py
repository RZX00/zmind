from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class KnowledgeSource:
    id: str
    workspace_id: str
    source_type: str


@dataclass(frozen=True)
class IngestionJob:
    id: str
    source_id: str
    workspace_id: str
    status: str
    created_at: Optional[str]
    completed_at: Optional[str]
    error: Optional[str]
