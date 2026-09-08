from __future__ import annotations

from typing import Any, Literal, Optional
from pydantic import BaseModel, Field
import time


ReferenceSourceType = Literal["canvas_node", "doc_block"]
ReferenceTargetType = Literal["doc", "doc_block", "canvas"]
ReferenceMode = Literal["reference", "snapshot"]


def now_ms() -> int:
    return int(time.time() * 1000)


class ReferenceEdge(BaseModel):
    id: str
    sourceType: ReferenceSourceType
    sourceItemId: str
    sourceAnchor: Optional[str] = None
    targetType: ReferenceTargetType
    targetItemId: str
    targetAnchor: Optional[str] = None
    mode: ReferenceMode
    snapshotPayload: Optional[dict[str, Any]] = None
    isDeleted: bool = False
    createdAt: int = Field(default_factory=now_ms)
    updatedAt: int = Field(default_factory=now_ms)


class CreateReferenceRequest(BaseModel):
    sourceType: ReferenceSourceType
    sourceItemId: str
    sourceAnchor: Optional[str] = None
    targetType: ReferenceTargetType
    targetItemId: str
    targetAnchor: Optional[str] = None
    mode: ReferenceMode = "reference"
    snapshotPayload: Optional[dict[str, Any]] = None


class ResolveReferencesRequest(BaseModel):
    referenceIds: list[str] = Field(default_factory=list)


class ResolveReferenceItem(BaseModel):
    referenceId: str
    resolved: bool
    reason: Optional[str] = None
    reference: Optional[ReferenceEdge] = None


class ResolveReferencesResponse(BaseModel):
    items: list[ResolveReferenceItem]


class BacklinksResponse(BaseModel):
    targetItemId: str
    targetAnchor: Optional[str] = None
    references: list[ReferenceEdge]


class RefsSummary(BaseModel):
    inboundCountByItem: dict[str, int]
    outboundCountByItem: dict[str, int]
