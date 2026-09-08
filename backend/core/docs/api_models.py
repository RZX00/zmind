from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, Field, AliasChoices
import time
from typing import Literal


class DocBlock(BaseModel):
    blockId: str
    itemId: str
    blockType: str
    anchor: str
    textPreview: str
    hash: str
    orderIndex: int


class DocContent(BaseModel):
    itemId: str
    title: str
    contentMd: str
    frontmatter: dict[str, Any] = {}
    version: int
    createdAt: int
    updatedAt: int


class CreateDocRequest(BaseModel):
    title: str = Field(min_length=1)
    contentMd: str = ""
    frontmatter: dict[str, Any] = {}
    folderId: Optional[str] = None
    parentItemId: Optional[str] = None


class UpdateDocRequest(BaseModel):
    contentMd: str
    frontmatter: Optional[dict[str, Any]] = None


class UpdateDocResponse(BaseModel):
    itemId: str
    version: int
    updatedAt: int


class DocBlocksResponse(BaseModel):
    itemId: str
    blocks: list[DocBlock]


class DocImageResponse(BaseModel):
    url: str
    markdown: str
    fileId: Optional[str] = None


class DocsMetaItem(BaseModel):
    itemId: str
    title: str
    version: int
    updatedAt: int


class EnsureDocThreadResponse(BaseModel):
    thread_id: str


class PeekDocThreadResponse(BaseModel):
    exists: bool
    thread_id: Optional[str] = None


class DocOpRange(BaseModel):
    from_: int = Field(validation_alias=AliasChoices("from", "from_"), serialization_alias="from")
    to: int


class DocApplyOperation(BaseModel):
    op: Literal[
        "replace_document",
        "replace_range",
        "delete_range",
        "insert_at",
        "insert_after_block",
        "insert_before_block",
    ]
    range: Optional[DocOpRange] = None
    contentMd: Optional[str] = None
    blockId: Optional[str] = None
    position: Optional[int] = None
    metadata: Optional[dict[str, Any]] = None


class ApplyDocOpsRequest(BaseModel):
    baseVersion: int = Field(ge=1)
    idempotencyKey: Optional[str] = None
    summary: Optional[str] = None
    ops: list[DocApplyOperation] = Field(default_factory=list)
    actorType: Optional[Literal["user", "agent", "system"]] = "agent"
    actorId: Optional[str] = None
    agentRunId: Optional[str] = None
    threadId: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class ApplyDocOpsResponse(BaseModel):
    itemId: str
    revisionId: str
    previousVersion: int
    version: int
    updatedAt: int
    appliedOps: int
    summary: str
    idempotentReplay: bool = False


class DocRevision(BaseModel):
    revisionId: str
    itemId: str
    baseVersion: int
    version: int
    actorType: str
    actorId: Optional[str] = None
    agentRunId: Optional[str] = None
    threadId: Optional[str] = None
    summary: str
    ops: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    createdAt: int


class DocRevisionListResponse(BaseModel):
    itemId: str
    revisions: list[DocRevision]


class UndoDocRevisionRequest(BaseModel):
    expectedCurrentVersion: Optional[int] = None
    summary: Optional[str] = None
    actorType: Optional[Literal["user", "agent", "system"]] = "agent"
    actorId: Optional[str] = None
    agentRunId: Optional[str] = None
    threadId: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


def now_ms() -> int:
    return int(time.time() * 1000)
