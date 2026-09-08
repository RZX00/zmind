"""
Canvas as Code - 类型定义

遵循 Read/Write/Edit 标准范式
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union
from dataclasses import dataclass, field


# ============================================================
# 基础类型
# ============================================================

NodeType = Literal[
    "text", "todo", "table", "code", "media", "group", "column", "canvas-link"
]

CodeType = Literal["mermaid", "svg", "html"]

LayoutMode = Literal["stack", "row", "grid", "mindmap", "tree", "freeform"]

ConnectionPreset = Literal["none", "chain", "star", "tree"]

# 锚点类型
AnchorPoint = Union[
    Literal[
        "selection",
        "selection.right",
        "selection.left",
        "selection.above",
        "selection.below",
        "selection.center",
        "viewport.center",
        "viewport.topLeft",
        "canvas.origin",
    ],
    str,  # node:n1, node:n1.right 等
    Dict[str, float],  # { "x": 100, "y": 200 }
]


# ============================================================
# 节点输入
# ============================================================

@dataclass
class NodeInput:
    """节点输入格式"""
    type: NodeType
    content: Optional[str] = None
    title: Optional[str] = None

    # 临时 ID
    temp_id: Optional[str] = None  # $1, $2, ...
    # Durable id the agent explicitly supplies (non-$) to pin/recreate a known node (ID-3).
    node_id: Optional[str] = None

    # 位置（可选，系统可自动计算）
    x: Optional[float] = None
    y: Optional[float] = None

    # 尺寸（可选，使用默认值或自动计算）
    width: Optional[Union[float, Literal["auto"]]] = None
    height: Optional[Union[float, Literal["auto"]]] = None

    # 类型特定属性
    code_type: Optional[CodeType] = None
    data: Optional[Dict[str, Any]] = None
    children: Optional[List[str]] = None
    group_mode: Optional[Literal["normal", "mindmap"]] = None
    target_canvas_id: Optional[str] = None

    # 样式
    style: Optional[Dict[str, Any]] = None
    # Preserve unknown fields so canvas_write can create richer nodes (e.g. media urls, textStyles).
    # These are merged into the final node payload (except protected geometry keys).
    extra: Optional[Dict[str, Any]] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "NodeInput":
        """从字典创建 NodeInput"""
        # Capture forward-compatible/extra fields (e.g. fileUrl/externalUrl for media nodes).
        known_keys = {
            "type",
            "content",
            "title",
            "$id",
            "id",
            "x",
            "y",
            "width",
            "height",
            "codeType",
            "code_type",
            "data",
            "children",
            "groupMode",
            "group_mode",
            "targetCanvasId",
            "target_canvas_id",
            "style",
        }
        extra: Dict[str, Any] = {}
        for k, v in (d or {}).items():
            if k in known_keys:
                continue
            if isinstance(k, str) and (k.startswith("$") or k.startswith("_")):
                continue
            extra[k] = v

        # Split the supplied id: a "$"-prefixed value is a temp ref the server resolves;
        # any other non-empty value is a durable id the agent wants honored (ID-3).
        raw_id = d.get("$id") or d.get("id")
        is_temp = isinstance(raw_id, str) and raw_id.startswith("$")
        return cls(
            type=d.get("type", "text"),
            content=d.get("content"),
            title=d.get("title"),
            temp_id=raw_id if is_temp else None,
            node_id=raw_id if (raw_id and not is_temp) else None,
            x=d.get("x"),
            y=d.get("y"),
            width=d.get("width"),
            height=d.get("height"),
            code_type=d.get("codeType") or d.get("code_type"),
            data=d.get("data"),
            children=d.get("children"),
            group_mode=d.get("groupMode") or d.get("group_mode"),
            target_canvas_id=d.get("targetCanvasId") or d.get("target_canvas_id"),
            style=d.get("style"),
            extra=extra or None,
        )


@dataclass
class TreeNodeInput:
    """树形结构输入（用于思维导图）"""
    content: str
    type: NodeType = "text"
    temp_id: Optional[str] = None
    style: Optional[Dict[str, Any]] = None
    children: List["TreeNodeInput"] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "TreeNodeInput":
        """从字典创建 TreeNodeInput"""
        children = [cls.from_dict(c) for c in d.get("children", [])]
        return cls(
            content=d.get("content", ""),
            type=d.get("type", "text"),
            temp_id=d.get("$id"),
            style=d.get("style"),
            children=children,
        )


@dataclass
class ConnectionInput:
    """连接输入格式"""
    from_id: str
    to_id: str
    temp_id: Optional[str] = None
    label: Optional[str] = None
    style: Optional[Literal["line", "arrow"]] = None
    dashed: Optional[bool] = None
    # Typed-edge slots (§4.1): open machine-readable kind, logical direction, open bag.
    # These are the AI-authored logical fields. Render-only geometry (curveAnchor /
    # anchorParams / curveMode / tension) is intentionally NOT on the agent connection
    # grammar (WRITE-9) — it's set via explicit update_connection ops / the UI, not authored here.
    relation: Optional[str] = None
    directed: Optional[bool] = None
    relation_data: Optional[Dict[str, Any]] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "ConnectionInput":
        """从字典创建 ConnectionInput"""
        return cls(
            from_id=d.get("from", ""),
            to_id=d.get("to", ""),
            temp_id=d.get("$id"),
            label=d.get("label"),
            style=d.get("style"),
            dashed=d.get("dashed"),
            relation=d.get("relation"),
            directed=d.get("directed"),
            relation_data=d.get("relationData"),
        )


# ============================================================
# canvas_read
# ============================================================

@dataclass
class CanvasReadPayload:
    """canvas_read 输入"""
    scope: Optional[Literal["all", "selection", "viewport"]] = None
    select: Optional[List[str]] = None
    where: Optional[Dict[str, Any]] = None
    limit: Optional[int] = None
    full: Optional[bool] = None

    @classmethod
    def from_dict(cls, d: Optional[Dict[str, Any]]) -> "CanvasReadPayload":
        if not d:
            return cls()
        return cls(
            scope=d.get("scope"),
            select=d.get("select"),
            where=d.get("where"),
            limit=d.get("limit"),
            full=d.get("full"),
        )


@dataclass
class CanvasReadResult:
    """canvas_read 输出"""
    canvas: Dict[str, Any]
    selection: Optional[List[str]] = None
    viewport: Optional[Dict[str, float]] = None
    meta: Optional[Dict[str, Any]] = None


# ============================================================
# canvas_write
# ============================================================

@dataclass
class CanvasWritePayload:
    """canvas_write 输入"""
    # 布局
    layout: Optional[LayoutMode] = None
    anchor: Optional[AnchorPoint] = None
    spacing: Optional[Union[float, Dict[str, float]]] = None
    columns: Optional[int] = None

    # Level 1-2: 直接添加
    nodes: Optional[List[NodeInput]] = None
    connections: Optional[Union[List[ConnectionInput], ConnectionPreset]] = None

    # Level 3: 树形结构
    tree: Optional[TreeNodeInput] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "CanvasWritePayload":
        nodes = None
        if d.get("nodes"):
            nodes = [NodeInput.from_dict(n) for n in d["nodes"]]

        connections = d.get("connections")
        if isinstance(connections, list):
            connections = [ConnectionInput.from_dict(c) for c in connections]

        tree = None
        if d.get("tree"):
            tree = TreeNodeInput.from_dict(d["tree"])

        return cls(
            layout=d.get("layout"),
            anchor=d.get("anchor"),
            spacing=d.get("spacing"),
            columns=d.get("columns"),
            nodes=nodes,
            connections=connections,
            tree=tree,
        )


@dataclass
class CanvasWriteResult:
    """canvas_write 输出"""
    success: bool
    id_map: Optional[Dict[str, str]] = None
    group_id: Optional[str] = None
    applied: Optional[Dict[str, int]] = None
    errors: Optional[List[Dict[str, Any]]] = None
    warnings: Optional[List[str]] = None


# ============================================================
# canvas_edit
# ============================================================

@dataclass
class CanvasEditPayload:
    """canvas_edit 输入"""
    # 通过 ID 修改
    updates: Optional[Dict[str, Dict[str, Any]]] = None  # { "n1": { "content": "..." } }

    # 删除
    delete: Optional[List[str]] = None

    # 连接修改
    connections: Optional[Union[Dict[str, Any], List[Dict[str, Any]]]] = None

    # 画布属性
    canvas: Optional[Dict[str, Any]] = None

    # 选择器模式
    select: Optional[str] = None
    set_values: Optional[Dict[str, Any]] = None
    transform: Optional[Dict[str, Any]] = None

    # 批量操作
    operations: Optional[List[Dict[str, Any]]] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "CanvasEditPayload":
        # 提取特殊字段
        delete = d.pop("$delete", None)
        if delete is None:
            delete = d.pop("delete", None)

        explicit_updates = d.pop("updates", None)
        if explicit_updates is None:
            explicit_updates = d.pop("nodes", None)

        connections = d.pop("$connections", None)
        if connections is None:
            connections = d.pop("connections", None)

        canvas = d.pop("$canvas", None)
        if canvas is None:
            canvas = d.pop("canvas", None)

        select = d.pop("$select", None)
        if select is None:
            select = d.pop("select", None)

        set_values = d.pop("$set", None)
        if set_values is None:
            set_values = d.pop("set_values", None)
        if set_values is None:
            set_values = d.pop("set", None)

        transform = d.pop("$transform", None)
        if transform is None:
            transform = d.pop("transform", None)

        operations = d.pop("$operations", None)
        if operations is None:
            operations = d.pop("operations", None)

        # 兼容常见误写: {"updates":{"$delete":[...]}}
        if isinstance(explicit_updates, dict):
            nested_delete = explicit_updates.get("$delete")
            if nested_delete is None:
                nested_delete = explicit_updates.get("delete")
            if delete is None and nested_delete is not None:
                delete = nested_delete

        # 剩余的都是节点 ID -> patch 的映射
        updates = {}
        if isinstance(explicit_updates, dict):
            for key, value in explicit_updates.items():
                if not key.startswith("$") and isinstance(value, dict):
                    updates[key] = value
        for key, value in d.items():
            if not key.startswith("$") and isinstance(value, dict):
                updates[key] = value

        return cls(
            updates=updates if updates else None,
            delete=delete,
            connections=connections,
            canvas=canvas,
            select=select,
            set_values=set_values,
            transform=transform,
            operations=operations,
        )


@dataclass
class CanvasEditResult:
    """canvas_edit 输出"""
    success: Union[bool, Literal["partial"]]
    applied: Optional[Dict[str, int]] = None
    errors: Optional[List[Dict[str, Any]]] = None
    warnings: Optional[List[str]] = None
