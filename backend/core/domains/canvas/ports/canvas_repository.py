from __future__ import annotations

from typing import Protocol, Optional

from core.domains.canvas.model import Canvas


class CanvasRepository(Protocol):
    async def get_by_id(self, canvas_id: str, workspace_id: str) -> Optional[Canvas]:
        ...

    async def save(self, canvas: Canvas) -> Canvas:
        ...

    async def update(self, canvas: Canvas) -> Canvas:
        ...

    async def soft_delete(self, canvas_id: str, workspace_id: str) -> None:
        ...

    async def restore(self, canvas_id: str, workspace_id: str) -> Canvas:
        ...

    async def hard_delete(self, canvas_id: str, workspace_id: str) -> None:
        ...
