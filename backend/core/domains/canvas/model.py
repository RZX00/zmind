from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional


@dataclass(frozen=True)
class CanvasNode:
    id: str
    type: str
    data: Dict[str, Any]


@dataclass(frozen=True)
class CanvasConnection:
    id: str
    from_id: Optional[str]
    to_id: Optional[str]
    data: Dict[str, Any]


@dataclass
class Canvas:
    id: str
    workspace_id: str
    title: str
    version: str
    doc: Dict[str, Any]

    def validate(self) -> None:
        nodes = self.doc.get("nodes") or []
        connections = self.doc.get("connections") or []
        node_ids = set()
        for node in nodes:
            node_id = node.get("id")
            if not node_id:
                raise ValueError("Canvas node missing id")
            if node_id in node_ids:
                raise ValueError(f"Duplicate node id: {node_id}")
            node_ids.add(node_id)
        for conn in connections:
            from_id = conn.get("from") or conn.get("from_")
            to_id = conn.get("to")
            if from_id and from_id not in node_ids:
                raise ValueError(f"Connection from missing node: {from_id}")
            if to_id and to_id not in node_ids:
                raise ValueError(f"Connection to missing node: {to_id}")


@dataclass(frozen=True)
class CanvasVersion:
    id: str
    canvas_id: str
    version_doc: Dict[str, Any]
    is_auto_save: bool
    description: Optional[str]
    created_at: datetime


def merge_updates(doc: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    merged = {**doc}
    for key, value in updates.items():
        if value is not None:
            merged[key] = value
    return merged
