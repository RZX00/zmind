from __future__ import annotations

from typing import Optional, List, Any
from pydantic import BaseModel, Field
import time


def now_ms() -> int:
    return int(time.time() * 1000)


class Folder(BaseModel):
    id: str
    name: str
    parentId: Optional[str] = None
    canvasIds: List[str] = []
    childFolderIds: List[str] = []
    level: int = 0
    isExpanded: bool = False
    sortOrder: int = Field(default_factory=now_ms)
    createdAt: int = Field(default_factory=now_ms)
    updatedAt: int = Field(default_factory=now_ms)


class CreateFolderRequest(BaseModel):
    name: str
    parentId: Optional[str] = None
    sortOrder: Optional[int] = None


class UpdateFolderRequest(BaseModel):
    name: Optional[str] = None
    isExpanded: Optional[bool] = None
    sortOrder: Optional[int] = None
    parentId: Optional[str] = None


class FolderStats(BaseModel):
    totalFolders: int
    totalCanvases: int
    foldersByLevel: dict
    deepestLevel: int


class FoldersListResponse(BaseModel):
    folders: List[Folder]
    tree: List[Any]
    metadata: dict

