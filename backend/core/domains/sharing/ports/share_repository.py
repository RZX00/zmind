from __future__ import annotations

from typing import Protocol

from core.domains.sharing.model import ShareLink


class ShareRepository(Protocol):
    async def get(self, canvas_id: str, workspace_id: str) -> ShareLink:
        ...

    async def save(self, share: ShareLink) -> ShareLink:
        ...
