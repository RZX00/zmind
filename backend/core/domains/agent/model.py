from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Dict, Any


@dataclass
class Agent:
    id: str
    workspace_id: str
    name: str


@dataclass(frozen=True)
class AgentRun:
    id: str
    thread_id: str
    status: str
    started_at: Optional[str]
    completed_at: Optional[str]
    error: Optional[str]
    agent_id: Optional[str]
    agent_version_id: Optional[str]
    metadata: Dict[str, Any]
    workspace_id: Optional[str] = None
