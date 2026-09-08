"""
Canvas as Code - 核心引擎

包含：
- 布局引擎（stack, row, grid）
- 锚点解析
- 临时 ID 解析
- 选择器匹配
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple, Set
from dataclasses import dataclass

from core.tools.constants import get_default_node_size
from core.utils.logger import logger
from core.canvas.id_utils import generate_canvas_entity_id


def fit_text_height(content: Any, width: float, default_h: float, *, max_h: float = 560.0) -> float:
    """Grow a text/todo node's height to fit its content so long text is not clipped at the
    default 60px (the critic's ``undersized_for_content``). Conservative char-per-line estimate
    (CJK-aware-ish); honours explicit newlines; never shrinks below default, capped at max_h.
    Only used when the agent did NOT set an explicit height."""
    if not content:
        return default_h
    import math

    text = str(content)
    chars_per_line = max(8, int(float(width or 300) / 16.0))
    lines = 0
    for seg in text.split("\n"):
        lines += max(1, math.ceil(len(seg) / chars_per_line))
    grown = lines * 26.0 + 40.0
    return max(float(default_h), min(grown, max_h))

from .types import (
    NodeInput,
    ConnectionInput,
    TreeNodeInput,
    LayoutMode,
    AnchorPoint,
    CanvasWritePayload,
    CanvasEditPayload,
)


def _generate_id() -> str:
    """生成唯一 ID"""
    return generate_canvas_entity_id()


def _generate_connection_id() -> str:
    """生成连接 ID"""
    return generate_canvas_entity_id()


@dataclass
class LayoutContext:
    """布局上下文"""
    base_x: float = 0
    base_y: float = 0
    spacing_x: float = 20
    spacing_y: float = 20
    columns: int = 3


@dataclass
class SelectionContext:
    """选中内容上下文"""
    node_ids: List[str]
    bounds: Optional[Dict[str, float]] = None  # { minX, minY, maxX, maxY }


class CaCEngine:
    """Canvas as Code 核心引擎"""

    def __init__(
        self,
        canvas_doc: Dict[str, Any],
        selection_context: Optional[Dict[str, Any]] = None,
        viewport: Optional[Dict[str, Any]] = None,
    ):
        self.canvas = canvas_doc
        self.nodes = canvas_doc.get("nodes", [])
        self.connections = canvas_doc.get("connections", [])
        self.selection = self._parse_selection(selection_context)
        self.viewport = viewport or {"x": 0, "y": 0, "zoom": 1}

        # 节点 ID 索引
        self._node_by_id: Dict[str, Dict[str, Any]] = {
            n.get("id"): n for n in self.nodes if n.get("id")
        }

    def _parse_selection(self, ctx: Optional[Dict[str, Any]]) -> SelectionContext:
        """解析选中内容"""
        if not ctx:
            return SelectionContext(node_ids=[])

        node_ids = []
        nodes_data = ctx.get("nodes", [])
        for n in nodes_data:
            if isinstance(n, dict) and n.get("id"):
                node_ids.append(n["id"])
            elif isinstance(n, str):
                node_ids.append(n)

        # 计算边界框
        bounds = None
        if nodes_data:
            min_x = min_y = float("inf")
            max_x = max_y = float("-inf")
            for n in nodes_data:
                if isinstance(n, dict):
                    x = float(n.get("x", 0))
                    y = float(n.get("y", 0))
                    w = float(n.get("width", 200))
                    h = float(n.get("height", 60))
                    min_x = min(min_x, x)
                    min_y = min(min_y, y)
                    max_x = max(max_x, x + w)
                    max_y = max(max_y, y + h)
            if min_x != float("inf"):
                bounds = {"minX": min_x, "minY": min_y, "maxX": max_x, "maxY": max_y}

        return SelectionContext(node_ids=node_ids, bounds=bounds)

    # ================================================================
    # 锚点解析
    # ================================================================

    def resolve_anchor(self, anchor: Optional[AnchorPoint]) -> Tuple[float, float]:
        """解析锚点，返回 (x, y) 坐标"""
        if anchor is None:
            # 默认：选中内容右侧，否则视口中心
            if self.selection.bounds:
                return (
                    self.selection.bounds["maxX"] + 40,
                    self.selection.bounds["minY"],
                )
            return self._viewport_center()

        # 精确坐标
        if isinstance(anchor, dict):
            return (float(anchor.get("x", 0)), float(anchor.get("y", 0)))

        # 字符串锚点
        if isinstance(anchor, str):
            # Coordinate string "x,y" (e.g. "100.0,200.0" from normalizer)
            if "," in anchor:
                parts = anchor.split(",", 1)
                try:
                    return (float(parts[0].strip()), float(parts[1].strip()))
                except (ValueError, IndexError):
                    pass  # fall through to keyword matching

            # selection 相关
            if anchor == "selection" or anchor == "selection.right":
                if self.selection.bounds:
                    return (
                        self.selection.bounds["maxX"] + 40,
                        self.selection.bounds["minY"],
                    )
                return self._viewport_center()

            if anchor == "selection.left":
                if self.selection.bounds:
                    return (
                        self.selection.bounds["minX"] - 240,  # 假设默认宽度 200 + 40 间距
                        self.selection.bounds["minY"],
                    )
                return self._viewport_center()

            if anchor == "selection.below":
                if self.selection.bounds:
                    return (
                        self.selection.bounds["minX"],
                        self.selection.bounds["maxY"] + 40,
                    )
                return self._viewport_center()

            if anchor == "selection.above":
                if self.selection.bounds:
                    return (
                        self.selection.bounds["minX"],
                        self.selection.bounds["minY"] - 100,  # 假设默认高度 60 + 40 间距
                    )
                return self._viewport_center()

            if anchor == "selection.center":
                if self.selection.bounds:
                    return (
                        (self.selection.bounds["minX"] + self.selection.bounds["maxX"]) / 2,
                        (self.selection.bounds["minY"] + self.selection.bounds["maxY"]) / 2,
                    )
                return self._viewport_center()

            # viewport 相关
            if anchor == "viewport.center":
                return self._viewport_center()

            if anchor == "viewport.topLeft":
                return (float(self.viewport.get("x", 0)), float(self.viewport.get("y", 0)))

            if anchor == "canvas.origin":
                return (0, 0)

            # node:id 或 node:id.direction
            if anchor.startswith("node:"):
                return self._resolve_node_anchor(anchor[5:])

        # 默认
        return self._viewport_center()

    def _viewport_center(self) -> Tuple[float, float]:
        """获取视口中心坐标"""
        # 假设视口大小 1200x800（实际应该从前端获取）
        vp_width = 1200
        vp_height = 800
        zoom = float(self.viewport.get("zoom", 1))
        x = float(self.viewport.get("x", 0)) + (vp_width / 2) / zoom
        y = float(self.viewport.get("y", 0)) + (vp_height / 2) / zoom
        return (x, y)

    def _resolve_node_anchor(self, node_ref: str) -> Tuple[float, float]:
        """解析 node:id 或 node:id.direction 锚点"""
        parts = node_ref.split(".")
        node_id = parts[0]
        direction = parts[1] if len(parts) > 1 else "right"

        node = self._node_by_id.get(node_id)
        if not node:
            logger.warning(f"CaC: anchor node not found: {node_id}")
            return self._viewport_center()

        x = float(node.get("x", 0))
        y = float(node.get("y", 0))
        w = float(node.get("width", 200))
        h = float(node.get("height", 60))

        if direction == "right":
            return (x + w + 40, y)
        elif direction == "left":
            return (x - 240, y)
        elif direction == "below":
            return (x, y + h + 40)
        elif direction == "above":
            return (x, y - 100)
        elif direction == "center":
            return (x + w / 2, y + h / 2)
        else:
            return (x + w + 40, y)

    # ================================================================
    # 布局引擎
    # ================================================================

    def calculate_layout(
        self,
        nodes: List[NodeInput],
        layout: Optional[LayoutMode],
        anchor: Tuple[float, float],
        spacing: Optional[float | Dict[str, float]],
        columns: Optional[int],
    ) -> List[Dict[str, Any]]:
        """计算节点布局，返回带位置的节点字典列表"""
        if not nodes:
            return []

        # 解析间距
        if isinstance(spacing, dict):
            spacing_x = float(spacing.get("x", 20))
            spacing_y = float(spacing.get("y", 20))
        elif spacing is not None:
            spacing_x = spacing_y = float(spacing)
        else:
            spacing_x = spacing_y = 20

        layout_mode = layout or "stack"
        base_x, base_y = anchor

        result = []
        cursor_x = base_x
        cursor_y = base_y
        col_idx = 0
        row_heights: List[float] = []
        current_row_height = 0

        for i, node_input in enumerate(nodes):
            # 获取节点尺寸
            width, height = self._get_node_size(node_input)

            # 计算位置
            if layout_mode == "stack":
                # 垂直堆叠
                x = base_x
                y = cursor_y
                cursor_y += height + spacing_y

            elif layout_mode == "row":
                # 水平排列
                x = cursor_x
                y = base_y
                cursor_x += width + spacing_x

            elif layout_mode == "grid":
                # 网格布局
                cols = columns or 3
                row = i // cols
                col = i % cols

                # 计算列宽度（简化：使用固定宽度）
                x = base_x + col * (width + spacing_x)
                y = base_y + row * (height + spacing_y)

            elif layout_mode == "freeform":
                # 自由布局：使用节点自带的坐标，或默认堆叠
                if node_input.x is not None and node_input.y is not None:
                    x = node_input.x
                    y = node_input.y
                else:
                    x = base_x
                    y = cursor_y
                    cursor_y += height + spacing_y

            else:
                # 默认：stack
                x = base_x
                y = cursor_y
                cursor_y += height + spacing_y

            # 构建节点字典
            node_dict = self._build_node_dict(node_input, x, y, width, height)
            result.append(node_dict)

        return result

    def _get_node_size(self, node: NodeInput) -> Tuple[float, float]:
        """获取节点尺寸"""
        # 使用指定的尺寸
        if node.width is not None and node.width != "auto":
            width = float(node.width)
        else:
            width = None

        if node.height is not None and node.height != "auto":
            height = float(node.height)
        else:
            height = None

        # 使用默认尺寸
        if width is None or height is None:
            default_w, default_h = get_default_node_size(node.type, node.code_type)
            width = width or default_w
            if height is None:
                # auto-fit height to content for text/todo so long text isn't clipped at 60px
                if node.type in (None, "text", "todo"):
                    height = fit_text_height(getattr(node, "content", None), width, default_h)
                else:
                    height = default_h

        return (width, height)

    def _build_node_dict(
        self,
        node: NodeInput,
        x: float,
        y: float,
        width: float,
        height: float,
    ) -> Dict[str, Any]:
        """构建节点字典"""
        # Honor an agent-supplied durable id (ID-3); otherwise the server mints one.
        node_id = node.node_id or _generate_id()

        result: Dict[str, Any] = {
            "id": node_id,
            "type": node.type,
            "x": x,
            "y": y,
            "width": width,
            "height": height,
        }

        # 临时 ID 映射（用于后续替换）
        if node.temp_id:
            result["_temp_id"] = node.temp_id

        # 内容
        if node.content is not None:
            result["content"] = node.content

        if node.title is not None:
            result["title"] = node.title

        # 类型特定属性
        if node.code_type:
            result["codeType"] = node.code_type

        if node.data:
            result["data"] = node.data

        if node.children:
            result["children"] = node.children

        if node.group_mode:
            result["groupMode"] = node.group_mode

        if node.target_canvas_id:
            result["targetCanvasId"] = node.target_canvas_id

        # 样式
        if node.style:
            result["style"] = node.style

        # Preserve forward-compatible extra fields (e.g. media urls, textStyles, parentGroupId).
        # Do not allow overrides of core geometry/type/id.
        if node.extra and isinstance(node.extra, dict):
            protected = {"id", "type", "x", "y", "width", "height", "_temp_id"}
            for k, v in node.extra.items():
                if not isinstance(k, str) or not k.strip():
                    continue
                if k in protected or k.startswith("_"):
                    continue
                # Avoid silently overriding already-set keys (explicit fields win).
                if k in result:
                    continue
                result[k] = v

        return result

    # ================================================================
    # 连接处理
    # ================================================================

    def create_connections(
        self,
        connections: List[ConnectionInput] | str | None,
        nodes: List[Dict[str, Any]],
        id_map: Dict[str, str],
    ) -> List[Dict[str, Any]]:
        """创建连接"""
        if not connections:
            return []

        # 连接快捷方式
        if isinstance(connections, str):
            return self._create_preset_connections(connections, nodes)

        # 显式连接列表
        result = []
        for conn in connections:
            # 解析临时 ID
            from_id = id_map.get(conn.from_id, conn.from_id)
            to_id = id_map.get(conn.to_id, conn.to_id)

            conn_dict: Dict[str, Any] = {
                "id": _generate_connection_id(),
                "from": from_id,
                "to": to_id,
            }

            if conn.label:
                conn_dict["label"] = conn.label

            if conn.style:
                conn_dict["style"] = conn.style

            if conn.dashed is not None:
                conn_dict["dashed"] = conn.dashed

            # Typed-edge slots (§4.1) — carry through so the agent can author typed edges
            # (relation/directed/relationData), not just plain labelled ones.
            if conn.relation is not None:
                conn_dict["relation"] = conn.relation
            if conn.directed is not None:
                conn_dict["directed"] = conn.directed
            if conn.relation_data is not None:
                conn_dict["relationData"] = conn.relation_data

            # Echo a connection $id into id_map so the agent can reference the created edge
            # in a later call (id authority — ID-4). Node temp ids are written first and share
            # this dict, so DON'T clobber an existing key — a node ref to that $id must keep
            # resolving to the node, not the edge (IDMAP-COLLISION guard).
            if conn.temp_id and conn.temp_id not in id_map:
                id_map[conn.temp_id] = conn_dict["id"]

            result.append(conn_dict)

        return result

    def _create_preset_connections(
        self,
        preset: str,
        nodes: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """创建预设连接"""
        if not nodes or len(nodes) < 2:
            return []

        result = []

        if preset == "chain":
            # 串联：1→2→3→4
            for i in range(len(nodes) - 1):
                result.append({
                    "id": _generate_connection_id(),
                    "from": nodes[i]["id"],
                    "to": nodes[i + 1]["id"],
                })

        elif preset == "star":
            # 星形：第一个节点连接到所有其他节点
            root_id = nodes[0]["id"]
            for i in range(1, len(nodes)):
                result.append({
                    "id": _generate_connection_id(),
                    "from": root_id,
                    "to": nodes[i]["id"],
                })

        elif preset == "tree":
            # A flat node list can't express a hierarchy, so the 'tree' preset is a sequential
            # chain (1->2->3) — NOT a real tree. For an actual hierarchy/mindmap use the `tree:`
            # field (TreeNodeInput), which builds parent->child structure. Kept as a chain alias
            # for back-compat; the schema steers models to `tree:` for hierarchy (WRITE-7).
            for i in range(len(nodes) - 1):
                result.append({
                    "id": _generate_connection_id(),
                    "from": nodes[i]["id"],
                    "to": nodes[i + 1]["id"],
                })

        return result

    # ================================================================
    # 树形结构展开
    # ================================================================

    def flatten_tree(
        self,
        tree: TreeNodeInput,
        layout: Optional[LayoutMode],
        anchor: Tuple[float, float],
        spacing: Optional[float | Dict[str, float]],
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """展开树形结构为节点和连接列表"""
        nodes: List[Dict[str, Any]] = []
        connections: List[Dict[str, Any]] = []

        # 解析间距
        if isinstance(spacing, dict):
            spacing_x = float(spacing.get("x", 96))
            spacing_y = float(spacing.get("y", 30))
        elif spacing is not None:
            spacing_x = spacing_y = float(spacing)
        else:
            spacing_x = 96
            spacing_y = 30

        # 递归展开
        temp_id_counter = [0]

        def process_node(
            node: TreeNodeInput,
            depth: int,
            parent_id: Optional[str],
        ) -> str:
            # 生成 ID
            node_id = _generate_id()
            temp_id_counter[0] += 1
            # Single temp convention (§3.3(1)): auto-generated tree refs use the tmp:
            # prefix the executor recognizes (isTmpId), not the legacy $tree_ token.
            temp_id = node.temp_id or f"tmp:tree_{temp_id_counter[0]}"

            # 获取尺寸（text/todo 按内容自动定高，避免长文本被裁切）
            default_w, default_h = get_default_node_size(node.type, None)
            if node.type in (None, "text", "todo"):
                default_h = fit_text_height(node.content, default_w, default_h)

            # 创建节点（位置先设为 0，后续由布局算法计算）
            node_dict: Dict[str, Any] = {
                "id": node_id,
                "_temp_id": temp_id,
                "type": node.type,
                "content": node.content,
                "x": 0,
                "y": 0,
                "width": default_w,
                "height": default_h,
                "_depth": depth,
                "_parent_id": parent_id,
            }

            if node.style:
                node_dict["style"] = node.style

            nodes.append(node_dict)

            # 创建与父节点的连接
            if parent_id:
                connections.append({
                    "id": _generate_connection_id(),
                    "from": parent_id,
                    "to": node_id,
                })

            # 处理子节点
            for child in node.children:
                process_node(child, depth + 1, node_id)

            return node_id

        # 处理根节点
        process_node(tree, 0, None)

        # 应用简单的树形布局
        self._apply_tree_layout(nodes, anchor, spacing_x, spacing_y)

        # 清理临时字段
        for n in nodes:
            n.pop("_depth", None)
            n.pop("_parent_id", None)

        return nodes, connections

    def _apply_tree_layout(
        self,
        nodes: List[Dict[str, Any]],
        anchor: Tuple[float, float],
        spacing_x: float,
        spacing_y: float,
    ) -> None:
        """应用简单的树形布局（右向）"""
        if not nodes:
            return

        base_x, base_y = anchor

        # 按深度分组
        by_depth: Dict[int, List[Dict[str, Any]]] = {}
        for n in nodes:
            depth = n.get("_depth", 0)
            if depth not in by_depth:
                by_depth[depth] = []
            by_depth[depth].append(n)

        # 计算每层的 X 位置
        layer_x = base_x
        max_width_by_depth: Dict[int, float] = {}

        for depth in sorted(by_depth.keys()):
            layer_nodes = by_depth[depth]
            max_width = max(n.get("width", 200) for n in layer_nodes)
            max_width_by_depth[depth] = max_width

            for n in layer_nodes:
                n["x"] = layer_x

            layer_x += max_width + spacing_x

        # 计算每个节点的 Y 位置（简单堆叠，后续可优化为居中对齐）
        cursor_y = base_y
        for depth in sorted(by_depth.keys()):
            layer_nodes = by_depth[depth]
            layer_cursor_y = base_y

            for n in layer_nodes:
                n["y"] = layer_cursor_y
                layer_cursor_y += n.get("height", 60) + spacing_y

    # ================================================================
    # 选择器匹配
    # ================================================================

    def match_selector(self, selector: str) -> List[Dict[str, Any]]:
        """匹配选择器，返回匹配的节点列表"""
        if not selector:
            return []

        # 多选择器（逗号分隔）
        if "," in selector:
            parts = [s.strip() for s in selector.split(",")]
            matched_ids: Set[str] = set()
            result = []
            for part in parts:
                for node in self._match_single_selector(part):
                    if node["id"] not in matched_ids:
                        matched_ids.add(node["id"])
                        result.append(node)
            return result

        return self._match_single_selector(selector)

    def _match_single_selector(self, selector: str) -> List[Dict[str, Any]]:
        """匹配单个选择器"""
        selector = selector.strip()

        # * - 所有节点
        if selector == "*":
            return list(self.nodes)

        # #id - 精确 ID
        if selector.startswith("#"):
            node_id = selector[1:]
            node = self._node_by_id.get(node_id)
            return [node] if node else []

        # 组合选择器：.type[attr*=value]
        # Type names can contain '-' (e.g. canvas-link), so allow hyphens here.
        combo_match = re.match(r'\.([\w-]+)\[(.+)\]', selector)
        if combo_match:
            node_type = combo_match.group(1)
            attr_selector = f"[{combo_match.group(2)}]"

            type_nodes = [n for n in self.nodes if n.get("type") == node_type]
            attr_nodes = set(n["id"] for n in self._match_single_selector(attr_selector))

            return [n for n in type_nodes if n["id"] in attr_nodes]

        # .type - 按类型
        if selector.startswith("."):
            node_type = selector[1:]
            return [n for n in self.nodes if n.get("type") == node_type]

        # [attr=value] 或 [attr*=value] - 属性匹配
        attr_match = re.match(r'\[([\w-]+)([*^$]?)=([\'"]?)(.+?)\3\]', selector)
        if attr_match:
            attr_name = attr_match.group(1)
            operator = attr_match.group(2)
            attr_value = attr_match.group(4)

            result = []
            for node in self.nodes:
                node_value = str(node.get(attr_name, ""))

                if operator == "":
                    # 精确匹配
                    if node_value == attr_value:
                        result.append(node)
                elif operator == "*":
                    # 包含
                    if attr_value in node_value:
                        result.append(node)
                elif operator == "^":
                    # 开头
                    if node_value.startswith(attr_value):
                        result.append(node)
                elif operator == "$":
                    # 结尾
                    if node_value.endswith(attr_value):
                        result.append(node)

            return result
        return []

    # ================================================================
    # 辅助方法
    # ================================================================

    def build_id_map(self, nodes: List[Dict[str, Any]]) -> Dict[str, str]:
        """构建临时 ID 到真实 ID 的映射。

        Only agent-authored temp refs are exposed; internal auto-generated tree ids
        (tmp:tree_N) are stripped from the node but kept out of the returned idMap so
        the agent sees only keys it actually named.
        """
        id_map = {}
        for node in nodes:
            temp_id = node.pop("_temp_id", None)
            if temp_id and not str(temp_id).startswith("tmp:tree_"):
                id_map[temp_id] = node["id"]
        return id_map
