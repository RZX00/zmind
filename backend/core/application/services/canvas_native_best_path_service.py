from __future__ import annotations

import math
from typing import Any


_TIMELINE_KEYWORDS = ("timeline", "时间线", "roadmap", "路线图", "阶段", "流程", "顺序")
_MINDMAP_KEYWORDS = ("mindmap", "brainstorm", "脑图", "思维导图")
_SWIMLANE_KEYWORDS = ("swimlane", "lane", "泳道", "看板", "kanban")
_GRID_KEYWORDS = ("grid", "matrix", "表格", "矩阵")
_SPLIT_KEYWORDS = ("split", "break down", "expand", "拆分", "拆成", "展开", "分解")
_MERGE_KEYWORDS = ("merge", "combine", "condense", "合并", "归并", "压缩", "合成")
_SUMMARY_KEYWORDS = ("summary", "summarize", "总结", "归纳", "提炼", "总纲", "总览")
_RETITLE_KEYWORDS = ("rename", "retitle", "重命名", "改名", "改成", "改为")
_LAYOUT_KEYWORDS = ("layout", "organize", "arrange", "rearrange", "排版", "整理", "归类", "布局")
_ROOT_HINT_KEYWORDS = ("goal", "objective", "theme", "中心", "主题", "目标", "核心", "总纲")


def _contains_any(text: str, tokens: tuple[str, ...]) -> bool:
    return any(token in text for token in tokens)


def _distance(x1: float, y1: float, x2: float, y2: float) -> float:
    return math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)


class CanvasNativeBestPathService:
    def choose(
        self,
        *,
        latest_user_text: str,
        context: dict[str, Any],
        create_titles: list[str],
        lane_groups: list[dict[str, Any]],
        lane_names: list[str],
        current_layout_strategy: str,
        should_connect: bool,
        budget_ms: int | None = None,
    ) -> dict[str, Any]:
        normalized_text = str(latest_user_text or "").strip().lower()
        focus_node_ids = [str(node_id) for node_id in (context.get("focus_node_ids") or []) if node_id]
        focus_nodes = [node for node in (context.get("focus_nodes") or []) if isinstance(node, dict)]
        focus_connections = [conn for conn in (context.get("focus_connections") or []) if isinstance(conn, dict)]
        topology = self._analyze_topology(focus_node_ids=focus_node_ids, focus_connections=focus_connections)
        request_archetype = self._classify_request(
            text=normalized_text,
            focus_count=len(focus_node_ids),
            create_count=len(create_titles),
            lane_groups=lane_groups,
            should_connect=should_connect,
        )
        strategy = self._choose_strategy(
            text=normalized_text,
            request_archetype=request_archetype,
            focus_count=len(focus_node_ids),
            create_count=len(create_titles),
            topology=topology,
            lane_groups=lane_groups,
            lane_names=lane_names,
            current_layout_strategy=current_layout_strategy,
        )
        ordered_focus_ids = self._ordered_focus_ids(
            focus_nodes=focus_nodes,
            fallback_node_ids=focus_node_ids,
            topology=topology,
            strategy=strategy,
        )
        selected_root_id = self._select_root_node(
            focus_nodes=focus_nodes,
            focus_connections=focus_connections,
            ordered_focus_ids=ordered_focus_ids,
            anchor_box=context.get("anchor_box"),
            text=normalized_text,
        )
        connect_pattern = self._connect_pattern(
            strategy=strategy,
            request_archetype=request_archetype,
            create_count=len(create_titles),
            focus_count=len(focus_node_ids),
            should_connect=should_connect,
        )
        optimization_profile = self._optimization_profile(strategy=strategy, topology=topology)
        elapsed_ms = 0 if budget_ms is None else 0
        return {
            "request_archetype": request_archetype,
            "strategy": strategy,
            "strategy_reason": f"{request_archetype}:{topology['shape']}",
            "selection_topology": topology,
            "ordered_focus_node_ids": ordered_focus_ids,
            "selected_root_node_id": selected_root_id,
            "connect_pattern": connect_pattern,
            "optimization_profile": optimization_profile,
            "budget_ms": budget_ms,
            "budget_exceeded": budget_ms is not None and elapsed_ms > budget_ms,
        }

    def _classify_request(
        self,
        *,
        text: str,
        focus_count: int,
        create_count: int,
        lane_groups: list[dict[str, Any]],
        should_connect: bool,
    ) -> str:
        if _contains_any(text, _SPLIT_KEYWORDS):
            return "rewrite_split"
        if _contains_any(text, _MERGE_KEYWORDS):
            return "rewrite_merge"
        if _contains_any(text, _SUMMARY_KEYWORDS):
            return "summarize_selection"
        if _contains_any(text, _RETITLE_KEYWORDS):
            return "retitle_selection"
        if lane_groups:
            return "swimlane_create"
        if create_count > 0:
            return "create_structure"
        if focus_count > 0 and should_connect:
            return "selection_restructure"
        if focus_count > 0 and _contains_any(text, _LAYOUT_KEYWORDS + _TIMELINE_KEYWORDS + _MINDMAP_KEYWORDS):
            return "selection_relayout"
        return "canvas_adjustment"

    def _choose_strategy(
        self,
        *,
        text: str,
        request_archetype: str,
        focus_count: int,
        create_count: int,
        topology: dict[str, Any],
        lane_groups: list[dict[str, Any]],
        lane_names: list[str],
        current_layout_strategy: str,
    ) -> str:
        if lane_groups or lane_names or _contains_any(text, _SWIMLANE_KEYWORDS):
            return "swimlane" if focus_count + create_count >= 2 else "cluster"
        if _contains_any(text, _TIMELINE_KEYWORDS):
            return "timeline"
        if _contains_any(text, _MINDMAP_KEYWORDS):
            return "mindmap"
        if _contains_any(text, _GRID_KEYWORDS):
            return "grid"
        if request_archetype == "rewrite_split":
            return "timeline" if "->" in text or "步骤" in text else "cluster"
        if request_archetype == "selection_relayout":
            if topology["shape"] == "chain":
                return "timeline"
            if topology["shape"] == "star":
                return "mindmap"
            if topology["shape"] == "dense_cluster":
                return "grid"
            return "cluster"
        if request_archetype == "selection_restructure":
            if topology["shape"] == "star":
                return "mindmap"
            if topology["shape"] == "chain":
                return "timeline"
            return "cluster"
        if current_layout_strategy != "preserve":
            return current_layout_strategy
        if create_count >= 6:
            return "grid"
        if create_count >= 3:
            return "cluster"
        return current_layout_strategy

    def _analyze_topology(
        self,
        *,
        focus_node_ids: list[str],
        focus_connections: list[dict[str, Any]],
    ) -> dict[str, Any]:
        node_count = len(focus_node_ids)
        if node_count <= 1:
            return {"shape": "singleton", "density": 0.0, "edge_count": 0, "max_degree": 0}

        degree_by_node = {node_id: 0 for node_id in focus_node_ids}
        out_degree_by_node = {node_id: 0 for node_id in focus_node_ids}
        in_degree_by_node = {node_id: 0 for node_id in focus_node_ids}
        edge_count = 0
        for connection in focus_connections:
            source_id = str(connection.get("from") or connection.get("source") or "")
            target_id = str(connection.get("to") or connection.get("target") or "")
            if source_id not in degree_by_node or target_id not in degree_by_node:
                continue
            degree_by_node[source_id] += 1
            degree_by_node[target_id] += 1
            out_degree_by_node[source_id] += 1
            in_degree_by_node[target_id] += 1
            edge_count += 1

        max_degree = max(degree_by_node.values(), default=0)
        max_out_degree = max(out_degree_by_node.values(), default=0)
        max_in_degree = max(in_degree_by_node.values(), default=0)
        possible_edges = max(1, node_count * (node_count - 1) / 2)
        density = round(edge_count / possible_edges, 3)
        if edge_count <= 0:
            shape = "unlinked"
        elif max(max_out_degree, max_in_degree) >= node_count - 1:
            shape = "star"
        elif edge_count == node_count - 1 and max_degree <= 2:
            shape = "chain"
        elif density >= 0.55 or edge_count >= node_count:
            shape = "dense_cluster"
        else:
            shape = "cluster"
        return {
            "shape": shape,
            "density": density,
            "edge_count": edge_count,
            "max_degree": max_degree,
            "max_out_degree": max_out_degree,
            "max_in_degree": max_in_degree,
            "degree_by_node": degree_by_node,
        }

    def _ordered_focus_ids(
        self,
        *,
        focus_nodes: list[dict[str, Any]],
        fallback_node_ids: list[str],
        topology: dict[str, Any],
        strategy: str,
    ) -> list[str]:
        if not focus_nodes:
            return list(fallback_node_ids)

        horizontal = self._is_horizontal_distribution(focus_nodes)
        sort_key = (
            (lambda node: (float(node.get("x") or 0.0), float(node.get("y") or 0.0)))
            if horizontal or strategy == "timeline"
            else (lambda node: (float(node.get("y") or 0.0), float(node.get("x") or 0.0)))
        )
        ordered = sorted(
            [node for node in focus_nodes if node.get("id")],
            key=sort_key,
        )
        ordered_ids = [str(node.get("id")) for node in ordered]
        if strategy != "mindmap":
            return ordered_ids

        degree_by_node = topology.get("degree_by_node") or {}
        return sorted(
            ordered_ids,
            key=lambda node_id: (
                -int(degree_by_node.get(node_id) or 0),
                ordered_ids.index(node_id),
            ),
        )

    def _select_root_node(
        self,
        *,
        focus_nodes: list[dict[str, Any]],
        focus_connections: list[dict[str, Any]],
        ordered_focus_ids: list[str],
        anchor_box: dict[str, Any] | None,
        text: str,
    ) -> str | None:
        if not ordered_focus_ids:
            return None

        node_lookup = {
            str(node.get("id")): node
            for node in focus_nodes
            if isinstance(node, dict) and node.get("id")
        }
        for node_id in ordered_focus_ids:
            content = str(
                (node_lookup.get(node_id) or {}).get("content")
                or (node_lookup.get(node_id) or {}).get("text")
                or (node_lookup.get(node_id) or {}).get("title")
                or (node_lookup.get(node_id) or {}).get("label")
                or ""
            ).lower()
            if content and any(token in content for token in _ROOT_HINT_KEYWORDS):
                return node_id

        degree_by_node: dict[str, int] = {node_id: 0 for node_id in ordered_focus_ids}
        for connection in focus_connections:
            source_id = str(connection.get("from") or connection.get("source") or "")
            target_id = str(connection.get("to") or connection.get("target") or "")
            if source_id in degree_by_node:
                degree_by_node[source_id] += 1
            if target_id in degree_by_node:
                degree_by_node[target_id] += 1
        max_degree = max(degree_by_node.values(), default=0)
        high_degree_ids = [node_id for node_id in ordered_focus_ids if degree_by_node.get(node_id) == max_degree]
        if len(high_degree_ids) == 1:
            return high_degree_ids[0]

        center_x = float((anchor_box or {}).get("center_x") or 0.0)
        center_y = float((anchor_box or {}).get("center_y") or 0.0)
        return min(
            high_degree_ids or ordered_focus_ids,
            key=lambda node_id: _distance(
                float((node_lookup.get(node_id) or {}).get("x") or 0.0),
                float((node_lookup.get(node_id) or {}).get("y") or 0.0),
                center_x,
                center_y,
            ),
        )

    def _connect_pattern(
        self,
        *,
        strategy: str,
        request_archetype: str,
        create_count: int,
        focus_count: int,
        should_connect: bool,
    ) -> str:
        if strategy == "mindmap":
            return "star"
        if strategy == "timeline":
            return "sequence"
        if should_connect and (create_count >= 2 or focus_count >= 2):
            return "sequence"
        if request_archetype in {"selection_relayout", "selection_restructure"} and focus_count >= 2:
            return "sequence"
        return "none"

    def _optimization_profile(self, *, strategy: str, topology: dict[str, Any]) -> str:
        if strategy == "timeline":
            return "reading_order"
        if strategy == "mindmap":
            return "radial_balance"
        if strategy == "swimlane":
            return "lane_balance"
        if topology.get("shape") == "dense_cluster":
            return "collision_avoidance"
        return "compact"

    def _is_horizontal_distribution(self, focus_nodes: list[dict[str, Any]]) -> bool:
        xs = [float(node.get("x") or 0.0) for node in focus_nodes]
        ys = [float(node.get("y") or 0.0) for node in focus_nodes]
        if not xs or not ys:
            return True
        return (max(xs) - min(xs)) >= (max(ys) - min(ys))
