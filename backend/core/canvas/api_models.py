from __future__ import annotations

from typing import List, Optional, Literal, Any
from pydantic import BaseModel, Field, ConfigDict, field_validator
import time


class Position(BaseModel):
    x: float
    y: float


class CanvasConnection(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str
    from_: Optional[str] = Field(default=None, alias="from")
    to: Optional[str] = None
    label: Optional[str] = None
    # 🔧 修复时间戳验证 - 设置合理的默认值
    createdAt: Optional[int] = Field(default_factory=lambda: int(time.time() * 1000))
    selected: Optional[bool] = None
    # Persisted curvature anchor (optional)
    curveAnchor: Optional[Position] = None
    # Free-connection endpoints (mutually exclusive with from/to)
    fromPoint: Optional[Position] = None
    toPoint: Optional[Position] = None
    # Rendering style hints
    style: Optional[Literal['line','arrow']] = None
    dashed: Optional[bool] = None
    # Rich appearance (frontend-defined, persisted as-is)
    appearance: Optional[dict[str, Any]] = None
    # Universal structural slots (WS5-1). OPEN relation kind + logical direction; the
    # substrate stores/indexes only `relation` and never validates the value. `relationData`
    # is an open per-relation bag typed by the layer above. `directed` defaults true logically
    # (None == unset == treat as directed) so old docs without it are unaffected.
    relation: Optional[str] = None
    directed: Optional[bool] = None
    relationData: Optional[dict[str, Any]] = None
    # Provenance (WS5-5): OPEN block — who/what created/updated, plus open state/origin.
    # Stored as-is; the substrate never validates state/origin.
    provenance: Optional[dict[str, Any]] = None


class CanvasNode(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str
    type: Literal['text', 'code', 'column', 'table', 'canvas-link', 'todo', 'media', 'group']
    # 使用 float 接收小数坐标与尺寸，兼容前端拖拽/缩放产生的小数值
    x: float
    y: float
    width: float
    height: float
    content: str = ""

    # Optional/extended fields (kept flexible for forward-compat)
    data: Optional[Any] = None
    # Be flexible: allow any string; clients may send 'text', 'markdown', etc.
    codeType: Optional[str] = None
    mermaidThemeId: Optional[str] = None
    mermaidTheme: Optional[Any] = None
    title: Optional[str] = None
    children: Optional[List[str]] = None
    isCollapsed: Optional[bool] = None
    parentGroupId: Optional[str] = None
    targetCanvasId: Optional[str] = None
    thumbnailUrl: Optional[str] = None
    lastSyncedAt: Optional[int] = None
    completed: Optional[bool] = None
    fileName: Optional[str] = None
    fileType: Optional[str] = None
    fileExtension: Optional[str] = None
    fileSize: Optional[int] = None
    mediaType: Optional[Literal['image','document','spreadsheet','presentation','audio','video']] = None
    # Signed URL fields (short-lived) and stable storage path for media assets
    fileUrl: Optional[str] = None
    fileDownloadUrl: Optional[str] = None
    storagePath: Optional[str] = None
    mediaSource: Optional[Literal['file','external']] = None
    externalUrl: Optional[str] = None
    embedUrl: Optional[str] = None
    externalProvider: Optional[Literal['youtube','bilibili']] = None
    localPath: Optional[str] = None
    uploadStatus: Optional[Literal['pending','uploaded','mock','error']] = None
    textStyles: Optional[Any] = None
    tableStyles: Optional[Any] = None
    linkStyles: Optional[Any] = None
    shapeDecoration: Optional[Any] = None
    accentColor: Optional[str] = None
    # SVG code node extras (preserve if present)
    svgTheme: Optional[Any] = None
    svgMetadata: Optional[dict[str, Any]] = None
    groupStyles: Optional[Any] = None
    # Canonical group modes (schema GroupNode.groupMode = mindmap|normal). Legacy
    # 'container'/'column' strings are folded to 'normal' by the validator below.
    groupMode: Optional[Literal['mindmap', 'normal']] = None
    mindmap: Optional[Any] = None
    # Attached free connections that conceptually belong to this group (persisted)
    attachedConnections: Optional[list[str]] = None
    # AI-authored marker (derived) + provenance (WS5-5): OPEN block, stored as-is.
    ai: Optional[bool] = None
    provenance: Optional[dict[str, Any]] = None
    # 🔧 修复时间戳验证 - 设置合理的默认值
    createdAt: Optional[int] = Field(default_factory=lambda: int(time.time() * 1000))
    updatedAt: Optional[int] = Field(default_factory=lambda: int(time.time() * 1000))
    locked: Optional[bool] = None

    @field_validator("groupMode", mode="before")
    @classmethod
    def _normalize_group_mode(cls, value):
        # Legacy producers stored 'container'/'column'; the canonical schema allows
        # only mindmap|normal, so fold anything unexpected back to 'normal'.
        if value in (None, "mindmap", "normal"):
            return value
        return "normal"


class CanvasDoc(BaseModel):
    id: str
    title: str
    nodes: List[CanvasNode] = []
    connections: List[CanvasConnection] = []
    groups: Optional[Any] = None
    createdAt: int
    updatedAt: int
    version: str
    serverVersion: Optional[int] = None
    folderId: Optional[str] = None
    cornerStyle: Optional[str] = None
    fontStyle: Optional[str] = None
    # Global background styles
    backgroundColor: Optional[str] = None
    backgroundStyleId: Optional[str] = None
    patternColor: Optional[str] = None
    # Global text presets (optional)
    textOpacityPreset: Optional[str] = None
    textLayoutPreset: Optional[str] = None
    # Frontend extensions (persisted as-is)
    metadata: Optional[dict[str, Any]] = None


class CanvasMeta(BaseModel):
    id: str
    title: str
    version: str
    createdAt: int
    updatedAt: int
    folderId: Optional[str] = None


class CanvasCreate(BaseModel):
    title: str
    nodes: List[CanvasNode] = []
    connections: List[CanvasConnection] = []
    # Optional global background styles on create
    backgroundColor: Optional[str] = None
    backgroundStyleId: Optional[str] = None
    patternColor: Optional[str] = None
    # Optional global styles on create
    cornerStyle: Optional[str] = None
    fontStyle: Optional[str] = None
    # Optional global presets on create
    textOpacityPreset: Optional[str] = None
    textLayoutPreset: Optional[str] = None
    # Optional metadata blob (stored under doc.metadata)
    metadata: Optional[dict[str, Any]] = None


class CanvasUpdate(BaseModel):
    title: Optional[str] = None
    nodes: Optional[List[CanvasNode]] = None
    connections: Optional[List[CanvasConnection]] = None
    version: Optional[str] = None
    # Optional global background styles on update
    backgroundColor: Optional[str] = None
    backgroundStyleId: Optional[str] = None
    patternColor: Optional[str] = None
    # Optional global styles on update
    cornerStyle: Optional[str] = None
    fontStyle: Optional[str] = None
    # Optional global presets on update
    textOpacityPreset: Optional[str] = None
    textLayoutPreset: Optional[str] = None
    # Optional metadata blob (stored under doc.metadata)
    metadata: Optional[dict[str, Any]] = None


# ===== Canvas Version Models =====
class CanvasVersion(BaseModel):
    id: str
    canvas_id: str
    version_data: CanvasDoc
    is_auto_save: bool = False
    description: Optional[str] = None
    created_at: int

class SaveCanvasVersionRequest(BaseModel):
    is_auto_save: Optional[bool] = False
    description: Optional[str] = None


class CanvasApplyRequest(BaseModel):
    """Request model for applying operation batches to a canvas.

    This mirrors tool-level `canvas_edit` operations and is intended for
    REST clients (e.g., frontend UI) to submit minimal, conflict-safe
    mutations using If-Match for concurrency control.
    """
    operations: List[dict[str, Any]]
