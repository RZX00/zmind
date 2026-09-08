from __future__ import annotations

from typing import Protocol, Dict, Any, List

from core.domains.sharing.model import CanvasShare


class CanvasShareRepository(Protocol):
    async def update_share(
        self,
        *,
        canvas_id: str,
        workspace_id: str,
        update_payload: Dict[str, Any],
        select_fields: List[str],
    ) -> CanvasShare:
        ...
