from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class ReferenceImageInput:
    file_id: Optional[str] = None
    storage_path: Optional[str] = None
    node_id: Optional[str] = None
    label: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    source: Optional[str] = None

    @staticmethod
    def from_payload(payload: Dict[str, Any]) -> "ReferenceImageInput":
        if not isinstance(payload, dict):
            return ReferenceImageInput()
        return ReferenceImageInput(
            file_id=_coalesce_str(payload, ("file_id", "fileId")),
            storage_path=_coalesce_str(payload, ("storage_path", "storagePath")),
            node_id=_coalesce_str(payload, ("node_id", "nodeId")),
            label=_coalesce_str(payload, ("label", "name")),
            width=_coalesce_int(payload, ("width",)),
            height=_coalesce_int(payload, ("height",)),
            source=_coalesce_str(payload, ("source",)),
        )

    def is_empty(self) -> bool:
        return not (self.file_id or self.storage_path or self.node_id)


@dataclass(frozen=True)
class ResolvedReferenceImage:
    file_id: str
    storage_path: Optional[str] = None
    node_id: Optional[str] = None
    label: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    source: Optional[str] = None


@dataclass(frozen=True)
class UnresolvedReferenceImage:
    original: ReferenceImageInput
    reason: str


@dataclass(frozen=True)
class ReferenceImageCandidate:
    file_id: str
    storage_path: Optional[str]
    node_id: str
    label: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None


@dataclass(frozen=True)
class ReferenceImageResolution:
    resolved: List[ResolvedReferenceImage] = field(default_factory=list)
    unresolved: List[UnresolvedReferenceImage] = field(default_factory=list)
    candidates: List[ReferenceImageCandidate] = field(default_factory=list)
    backfilled_nodes: List[str] = field(default_factory=list)


def _coalesce_str(payload: Dict[str, Any], keys: tuple[str, ...]) -> Optional[str]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str):
            value = value.strip()
            if value:
                return value
    return None


def _coalesce_int(payload: Dict[str, Any], keys: tuple[str, ...]) -> Optional[int]:
    for key in keys:
        value = payload.get(key)
        if value is None:
            continue
        try:
            return int(value)
        except Exception:
            continue
    return None
