from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Dict, Any


@dataclass
class Subscription:
    id: str
    workspace_id: str
    plan: str
    status: str


@dataclass(frozen=True)
class Entitlement:
    workspace_id: str
    plan: str
    limits: Dict[str, Any]


@dataclass(frozen=True)
class UsageRecord:
    id: Optional[str]
    workspace_id: str
    amount: float
    usage_type: str
    description: Optional[str]
    reference_id: Optional[str]
    metadata: Dict[str, Any]
