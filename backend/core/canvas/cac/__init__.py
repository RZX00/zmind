"""
Canvas as Code (CaC) Engine

AI Canvas 编辑的行业最佳实践范式，遵循 Read/Write/Edit 标准。

核心工具：
- workspace_list_canvases → 枚举工作区画布
- canvas_read             → 读取画布内容
- canvas_write            → 创建新内容
- canvas_edit             → 修改/删除现有内容
"""

from .engine import CaCEngine
from .types import (
    # Read
    CanvasReadPayload,
    CanvasReadResult,
    # Write
    CanvasWritePayload,
    CanvasWriteResult,
    # Edit
    CanvasEditPayload,
    CanvasEditResult,
    # Common
    NodeInput,
    ConnectionInput,
    TreeNodeInput,
    LayoutMode,
    AnchorPoint,
)

__all__ = [
    "CaCEngine",
    # Read
    "CanvasReadPayload",
    "CanvasReadResult",
    # Write
    "CanvasWritePayload",
    "CanvasWriteResult",
    # Edit
    "CanvasEditPayload",
    "CanvasEditResult",
    # Common
    "NodeInput",
    "ConnectionInput",
    "TreeNodeInput",
    "LayoutMode",
    "AnchorPoint",
]
