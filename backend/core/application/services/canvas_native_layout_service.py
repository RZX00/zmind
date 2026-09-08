from __future__ import annotations

import math
import time
from typing import Any


def _default_anchor_box() -> dict[str, float]:
    return {
        "x": 80.0,
        "y": 80.0,
        "width": 320.0,
        "height": 180.0,
        "center_x": 240.0,
        "center_y": 170.0,
    }


def _normalize_anchor_box(anchor_box: dict[str, Any] | None) -> dict[str, float]:
    source = anchor_box or {}
    x = float(source.get("x") or 80.0)
    y = float(source.get("y") or 80.0)
    width = max(240.0, float(source.get("width") or 320.0))
    height = max(120.0, float(source.get("height") or 180.0))
    center_x = float(source.get("center_x") or (x + width / 2.0))
    center_y = float(source.get("center_y") or (y + height / 2.0))
    return {
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "center_x": center_x,
        "center_y": center_y,
    }


def _node_dimensions(node_lookup: dict[str, dict[str, Any]], entity_ids: list[str]) -> tuple[float, float]:
    widths: list[float] = []
    heights: list[float] = []
    for entity_id in entity_ids:
        node = node_lookup.get(entity_id) or {}
        try:
            widths.append(float(node.get("width") or 300.0))
            heights.append(float(node.get("height") or 80.0))
        except Exception:
            continue
    if not widths or not heights:
        return 300.0, 80.0
    return max(220.0, sum(widths) / len(widths)), max(60.0, sum(heights) / len(heights))


def _entity_dimensions_map(
    node_lookup: dict[str, dict[str, Any]],
    entity_ids: list[str],
    *,
    default_width: float,
    default_height: float,
) -> dict[str, tuple[float, float]]:
    dimensions: dict[str, tuple[float, float]] = {}
    for entity_id in entity_ids:
        node = node_lookup.get(entity_id) or {}
        try:
            width = float(node.get("width") or default_width)
            height = float(node.get("height") or default_height)
        except Exception:
            width, height = default_width, default_height
        dimensions[entity_id] = (width, height)
    return dimensions


def _rectangles_overlap(a: dict[str, float], b: dict[str, float], padding: float = 24.0) -> bool:
    return not (
        a["x"] + a["width"] + padding <= b["x"]
        or b["x"] + b["width"] + padding <= a["x"]
        or a["y"] + a["height"] + padding <= b["y"]
        or b["y"] + b["height"] + padding <= a["y"]
    )


class CanvasNativeLayoutService:
    def compute_positions(
        self,
        *,
        entity_ids: list[str],
        strategy: str,
        anchor_box: dict[str, Any] | None,
        node_lookup: dict[str, dict[str, Any]] | None = None,
        prefer_right_side: bool = False,
        root_entity_id: str | None = None,
        lanes: list[dict[str, Any]] | None = None,
        preferred_order_ids: list[str] | None = None,
        optimization_profile: str | None = None,
        budget_ms: int | None = None,
        collision_pass_limit: int = 2,
    ) -> tuple[dict[str, dict[str, float]], dict[str, Any]]:
        if not entity_ids:
            return {}, {"strategy": strategy, "entity_count": 0}

        started_at = time.perf_counter()
        resolved_anchor = _normalize_anchor_box(anchor_box)
        lookup = dict(node_lookup or {})
        ordered_entity_ids = self._ordered_entity_ids(
            entity_ids=entity_ids,
            preferred_order_ids=preferred_order_ids,
        )
        avg_width, avg_height = _node_dimensions(lookup, ordered_entity_ids)
        dimension_map = _entity_dimensions_map(
            lookup,
            ordered_entity_ids,
            default_width=avg_width,
            default_height=avg_height,
        )
        step_x = avg_width + 120.0
        step_y = avg_height + 80.0
        start_x = (
            resolved_anchor["x"] + resolved_anchor["width"] + 120.0
            if prefer_right_side
            else resolved_anchor["x"]
        )
        start_y = resolved_anchor["y"]
        positions: dict[str, dict[str, float]] = {}
        metadata: dict[str, Any] = {
            "strategy": strategy,
            "entity_count": len(ordered_entity_ids),
            "anchor_box": resolved_anchor,
            "step_x": step_x,
            "step_y": step_y,
            "optimization_profile": optimization_profile or "compact",
            "budget_ms": budget_ms,
            "collision_pass_limit": collision_pass_limit,
            "preferred_order_ids": list(preferred_order_ids or []),
            "ordered_entity_ids": list(ordered_entity_ids),
        }

        if strategy == "timeline":
            for index, entity_id in enumerate(ordered_entity_ids):
                positions[entity_id] = {
                    "x": start_x + step_x * index,
                    "y": start_y,
                }
            return self._finalize_positions(
                positions=positions,
                entity_ids=ordered_entity_ids,
                node_lookup=lookup,
                dimension_map=dimension_map,
                metadata=metadata,
                budget_ms=budget_ms,
                collision_pass_limit=collision_pass_limit,
            )

        if strategy == "mindmap":
            root_id = root_entity_id if root_entity_id in ordered_entity_ids else ordered_entity_ids[0]
            root_x = resolved_anchor["center_x"] if not prefer_right_side else start_x + avg_width / 2.0
            root_y = resolved_anchor["center_y"]
            positions[root_id] = {"x": root_x, "y": root_y}
            branches = [entity_id for entity_id in ordered_entity_ids if entity_id != root_id]
            branch_gap_x = max(step_x, 320.0)
            branch_gap_y = max(step_y - 10.0, 120.0)
            for index, entity_id in enumerate(branches):
                ring = index // 4 + 1
                slot = index % 4
                direction = -1 if slot in (0, 1) else 1
                vertical_offset = (-1.5 + slot % 2 + (index // 2 % 2)) * branch_gap_y
                positions[entity_id] = {
                    "x": root_x + direction * branch_gap_x * ring,
                    "y": root_y + vertical_offset,
                }
            metadata["root_entity_id"] = root_id
            return self._finalize_positions(
                positions=positions,
                entity_ids=ordered_entity_ids,
                node_lookup=lookup,
                dimension_map=dimension_map,
                metadata=metadata,
                budget_ms=budget_ms,
                collision_pass_limit=collision_pass_limit,
            )

        if strategy == "swimlane":
            lane_list = [lane for lane in (lanes or []) if isinstance(lane, dict) and lane.get("entity_ids")]
            if not lane_list:
                lane_list = [{"lane_id": "lane_1", "label": "Lane 1", "entity_ids": list(ordered_entity_ids)}]
            lane_step_x = max(step_x, 360.0)
            lane_start_y = start_y + 96.0
            for lane_index, lane in enumerate(lane_list):
                lane_x = start_x + lane_index * lane_step_x
                lane_entity_ids = [
                    entity_id
                    for entity_id in (preferred_order_ids or lane.get("entity_ids") or [])
                    if entity_id in set(lane.get("entity_ids") or []) and entity_id in ordered_entity_ids
                ]
                if not lane_entity_ids:
                    lane_entity_ids = [entity_id for entity_id in lane.get("entity_ids") or [] if entity_id in ordered_entity_ids]
                for row_index, entity_id in enumerate(lane_entity_ids):
                    positions[entity_id] = {
                        "x": lane_x,
                        "y": lane_start_y + row_index * step_y,
                    }
            metadata["lanes"] = [
                {
                    "lane_id": str(lane.get("lane_id") or f"lane_{index + 1}"),
                    "label": str(lane.get("label") or f"Lane {index + 1}"),
                    "entity_ids": [entity_id for entity_id in lane.get("entity_ids") or [] if entity_id in ordered_entity_ids],
                    "x": start_x + index * lane_step_x,
                }
                for index, lane in enumerate(lane_list)
            ]
            return self._finalize_positions(
                positions=positions,
                entity_ids=ordered_entity_ids,
                node_lookup=lookup,
                dimension_map=dimension_map,
                metadata=metadata,
                budget_ms=budget_ms,
                collision_pass_limit=collision_pass_limit,
            )

        if strategy == "cluster":
            columns = 2 if len(ordered_entity_ids) <= 6 else 3
        else:
            columns = max(2, int(math.ceil(math.sqrt(len(ordered_entity_ids)))))

        for index, entity_id in enumerate(ordered_entity_ids):
            row = index // columns
            col = index % columns
            positions[entity_id] = {
                "x": start_x + col * step_x,
                "y": start_y + row * step_y,
            }
        metadata["columns"] = columns
        return self._finalize_positions(
            positions=positions,
            entity_ids=ordered_entity_ids,
            node_lookup=lookup,
            dimension_map=dimension_map,
            metadata=metadata,
            budget_ms=budget_ms,
            collision_pass_limit=collision_pass_limit,
            started_at=started_at,
        )

    def _ordered_entity_ids(
        self,
        *,
        entity_ids: list[str],
        preferred_order_ids: list[str] | None,
    ) -> list[str]:
        if not preferred_order_ids:
            return list(entity_ids)
        ordered = [entity_id for entity_id in preferred_order_ids if entity_id in entity_ids]
        ordered.extend(entity_id for entity_id in entity_ids if entity_id not in ordered)
        return ordered

    def _finalize_positions(
        self,
        *,
        positions: dict[str, dict[str, float]],
        entity_ids: list[str],
        node_lookup: dict[str, dict[str, Any]],
        dimension_map: dict[str, tuple[float, float]],
        metadata: dict[str, Any],
        budget_ms: int | None,
        collision_pass_limit: int,
        started_at: float | None = None,
    ) -> tuple[dict[str, dict[str, float]], dict[str, Any]]:
        optimized_positions, optimization = self._avoid_collisions(
            positions=positions,
            entity_ids=entity_ids,
            node_lookup=node_lookup,
            dimension_map=dimension_map,
            budget_ms=budget_ms,
            collision_pass_limit=collision_pass_limit,
            started_at=started_at,
        )
        metadata.update(optimization)
        return optimized_positions, metadata

    def _avoid_collisions(
        self,
        *,
        positions: dict[str, dict[str, float]],
        entity_ids: list[str],
        node_lookup: dict[str, dict[str, Any]],
        dimension_map: dict[str, tuple[float, float]],
        budget_ms: int | None,
        collision_pass_limit: int,
        started_at: float | None,
    ) -> tuple[dict[str, dict[str, float]], dict[str, Any]]:
        if collision_pass_limit <= 0:
            return positions, {
                "collision_resolved_count": 0,
                "collision_passes_used": 0,
                "budget_exceeded": False,
            }

        started = started_at or time.perf_counter()
        optimized = {entity_id: dict(position) for entity_id, position in positions.items()}
        obstacle_rects = []
        movable_entity_ids = set(entity_ids)
        for node_id, node in node_lookup.items():
            if node_id in movable_entity_ids:
                continue
            try:
                obstacle_rects.append(
                    {
                        "x": float(node.get("x") or 0.0),
                        "y": float(node.get("y") or 0.0),
                        "width": float(node.get("width") or 300.0),
                        "height": float(node.get("height") or 80.0),
                    }
                )
            except Exception:
                continue

        collision_resolved_count = 0
        collision_passes_used = 0
        budget_exceeded = False
        for entity_id in entity_ids:
            width, height = dimension_map.get(entity_id, (300.0, 80.0))
            for pass_index in range(max(0, collision_pass_limit)):
                collision_passes_used = max(collision_passes_used, pass_index + 1)
                if budget_ms is not None and (time.perf_counter() - started) * 1000.0 > float(budget_ms):
                    budget_exceeded = True
                    break

                current_rect = {
                    "x": float(optimized[entity_id]["x"]),
                    "y": float(optimized[entity_id]["y"]),
                    "width": width,
                    "height": height,
                }
                collides = any(_rectangles_overlap(current_rect, obstacle_rect) for obstacle_rect in obstacle_rects)
                if not collides:
                    for other_id in entity_ids:
                        if other_id == entity_id:
                            continue
                        other_width, other_height = dimension_map.get(other_id, (300.0, 80.0))
                        other_position = optimized[other_id]
                        other_rect = {
                            "x": float(other_position["x"]),
                            "y": float(other_position["y"]),
                            "width": other_width,
                            "height": other_height,
                        }
                        if _rectangles_overlap(current_rect, other_rect):
                            collides = True
                            break

                if not collides:
                    break

                optimized[entity_id]["x"] = float(optimized[entity_id]["x"]) + width * 0.45
                optimized[entity_id]["y"] = float(optimized[entity_id]["y"]) + height * 0.35 * pass_index
                collision_resolved_count += 1
            if budget_exceeded:
                break

        return optimized, {
            "collision_resolved_count": collision_resolved_count,
            "collision_passes_used": collision_passes_used,
            "budget_exceeded": budget_exceeded,
        }
