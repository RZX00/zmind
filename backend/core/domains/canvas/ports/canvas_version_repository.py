from __future__ import annotations

from typing import Protocol, Optional, Dict, Any

from core.domains.canvas.model import CanvasVersion


class CanvasVersionRepository(Protocol):
    async def save(
        self,
        *,
        canvas_id: str,
        version_doc: Dict[str, Any],
        is_auto_save: bool,
        description: Optional[str],
    ) -> CanvasVersion:
        ...

    async def latest_for_canvas(self, canvas_id: str) -> Optional[CanvasVersion]:
        ...
