from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field
import time


ItemType = Literal["canvas", "doc"]


def now_ms() -> int:
    return int(time.time() * 1000)


class Item(BaseModel):
    id: str
    type: ItemType
    title: str
    folderId: Optional[str] = None
    parentItemId: Optional[str] = None
    sourceId: Optional[str] = None
    isDeleted: bool = False
    createdAt: int = Field(default_factory=now_ms)
    updatedAt: int = Field(default_factory=now_ms)


class CreateItemRequest(BaseModel):
    type: ItemType
    title: str = Field(min_length=1)
    folderId: Optional[str] = None
    parentItemId: Optional[str] = None
    sourceId: Optional[str] = None


class UpdateItemRequest(BaseModel):
    title: Optional[str] = None
    folderId: Optional[str] = None
    parentItemId: Optional[str] = None


class MoveItemRequest(BaseModel):
    folderId: Optional[str] = None
    parentItemId: Optional[str] = None


class ItemsListResponse(BaseModel):
    items: list[Item]
    total: int


class BackfillResult(BaseModel):
    scanned: int
    created: int
    updated: int
    skipped: int
