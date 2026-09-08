from __future__ import annotations

from typing import Optional, Tuple

from core.domains.knowledge.model import KnowledgeSource
from core.domains.knowledge.ports.knowledge_repository import KnowledgeRepository
from core.services.supabase import DBConnection


class SupabaseKnowledgeRepository(KnowledgeRepository):
    def __init__(self, db: Optional[DBConnection] = None) -> None:
        self._db = db or DBConnection()

    async def get(self, source_id: str, workspace_id: str) -> KnowledgeSource:
        client = await self._db.client
        res = (
            await client.table("knowledge_base_entries")
            .select("entry_id, account_id")
            .eq("entry_id", source_id)
            .eq("account_id", workspace_id)
            .limit(1)
            .execute()
        )
        if not res.data:
            raise ValueError("Knowledge source not found")
        row = res.data[0]
        return KnowledgeSource(
            id=str(row.get("entry_id")),
            workspace_id=str(row.get("account_id")),
            source_type="file",
        )

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
        client = await self._db.client
        payload = {
            "p_entry_id": entry_id,
            "p_folder_id": folder_id,
            "p_account_id": account_id,
            "p_filename": filename,
            "p_file_path": storage_path,
            "p_file_size": file_size,
            "p_mime_type": mime_type,
            "p_summary": summary,
            "p_idempotency_key": idempotency_key,
            "p_file_id": file_id,
            "p_entity_type": "kb_entry",
        }
        result = await client.rpc("kb_create_entry_with_link", payload).execute()
        if result.data:
            row = result.data[0]
            return str(row.get("entry_id") or entry_id), bool(row.get("duplicate"))
        raise RuntimeError("Failed to create knowledge base entry")
