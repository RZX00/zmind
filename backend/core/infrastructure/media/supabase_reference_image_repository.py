from __future__ import annotations

from typing import Optional

from core.domains.media.ports.reference_image_repository import (
    FileUploadRecord,
    ReferenceImageRepository,
)
from core.services.supabase import DBConnection


class SupabaseReferenceImageRepository(ReferenceImageRepository):
    def __init__(self, db: Optional[DBConnection] = None) -> None:
        self._db = db or DBConnection()

    async def get_file_by_id(
        self, file_id: str, account_id: Optional[str]
    ) -> Optional[FileUploadRecord]:
        if not file_id:
            return None
        client = await self._db.client
        query = (
            client.table("file_uploads")
            .select("id, storage_path, content_type, original_filename, status")
            .eq("id", file_id)
        )
        if account_id:
            query = query.eq("account_id", account_id)
        resp = await query.limit(1).execute()
        if not resp.data:
            return None
        return resp.data[0]

    async def get_file_by_storage_path(
        self, storage_path: str, account_id: Optional[str]
    ) -> Optional[FileUploadRecord]:
        if not storage_path:
            return None
        client = await self._db.client
        query = (
            client.table("file_uploads")
            .select("id, storage_path, content_type, original_filename, status")
            .eq("storage_path", storage_path)
        )
        if account_id:
            query = query.eq("account_id", account_id)
        resp = await query.limit(1).execute()
        if not resp.data:
            return None
        return resp.data[0]
