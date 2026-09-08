from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Protocol


@dataclass(frozen=True)
class CanvasMediaNode:
    node_id: str
    file_id: Optional[str]
    storage_path: Optional[str]
    label: Optional[str]
    width: Optional[int]
    height: Optional[int]
    updated_at: Optional[int]


class CanvasMediaRepository(Protocol):
    async def list_media_nodes(
        self, canvas_id: str, account_id: Optional[str]
    ) -> List[CanvasMediaNode]:
        ...

    async def update_node_file_id(
        self, canvas_id: str, account_id: Optional[str], node_id: str, file_id: str
    ) -> bool:
        ...
