from __future__ import annotations

from typing import Protocol, Optional, Dict, Any, Tuple

from core.domains.knowledge.model import KnowledgeSource


class KnowledgeRepository(Protocol):
    async def get(self, source_id: str, workspace_id: str) -> KnowledgeSource:
        ...

    async def create_entry_with_link(
        self,
        *,
        entry_id: str,
        folder_id: str,
        account_id: str,
        filename: str,
        storage_path: str,
        file_size: int,
        mime_type: str,
        summary: str,
        file_id: Optional[str],
        idempotency_key: Optional[str],
    ) -> Tuple[str, bool]:
        ...
