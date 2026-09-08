from __future__ import annotations

from typing import Optional, Protocol, TypedDict


class FileUploadRecord(TypedDict, total=False):
    id: str
    storage_path: str
    content_type: str
    original_filename: str
    status: str


class ReferenceImageRepository(Protocol):
    async def get_file_by_id(
        self, file_id: str, account_id: Optional[str]
    ) -> Optional[FileUploadRecord]:
        ...

    async def get_file_by_storage_path(
        self, storage_path: str, account_id: Optional[str]
    ) -> Optional[FileUploadRecord]:
        ...
