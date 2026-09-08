from __future__ import annotations

from typing import Any

from core.application.services.canvas_native_context_resolver_service import (
    CanvasNativeContextResolverService,
)
from core.application.services.canvas_native_layout_service import CanvasNativeLayoutService
from core.canvas.ops_normalization import normalize_ops
from core.canvas.write_service import CanvasRealtimeError, CanvasWriteService
from core.services import metrics
from core.tools.constants import get_default_node_size


def _default_anchor_box() -> dict[str, float]:
    return {
        "x": 80.0,
        "y": 80.0,
        "width": 320.0,
        "height": 180.0,
        "center_x": 240.0,
        "center_y": 170.0,
    }


def _find_nodes_by_ids(snapshot_doc: dict[str, Any] | None, node_ids: list[str]) -> list[dict[str, Any]]:
    if not isinstance(snapshot_doc, dict):
        return []
    wanted = set(str(node_id) for node_id in node_ids if node_id)
    nodes = snapshot_doc.get("nodes") or []
    return [
        node for node in nodes
        if isinstance(node, dict) and str(node.get("id")) in wanted
    ]


def _bounding_box(nodes: list[dict[str, Any]]) -> dict[str, float] | None:
    xs: list[float] = []
    ys: list[float] = []
    rights: list[float] = []
    bottoms: list[float] = []
    for node in nodes:
        try:
            x = float(node.get("x") or 0.0)
            y = float(node.get("y") or 0.0)
            width = float(node.get("width") or 0.0)
            height = float(node.get("height") or 0.0)
        except Exception:
            continue
        xs.append(x)
        ys.append(y)
        rights.append(x + width)
        bottoms.append(y + height)
    if not xs:
        return None
    return {
        "x": min(xs),
        "y": min(ys),
        "width": max(rights) - min(xs),
        "height": max(bottoms) - min(ys),
        "center_x": (min(xs) + max(rights)) / 2.0,
        "center_y": (min(ys) + max(bottoms)) / 2.0,
    }


class CanvasNativeExecutorService:
    def __init__(
        self,
        *,
        context_resolver: CanvasNativeContextResolverService | None = None,
        layout_service: CanvasNativeLayoutService | None = None,
        create_write_service: type[CanvasWriteService] = CanvasWriteService,
    ) -> None:
        self._context_resolver = context_resolver or CanvasNativeContextResolverService()
        self._layout_service = layout_service or CanvasNativeLayoutService()
        self._create_write_service = create_write_service

    async def execute(self, *, state: dict[str, Any], tool_context: dict[str, Any] | None) -> dict[str, Any]:
        runtime = state.get("canvas_runtime") or {}
        task = state.get("canvas_task") or {}
        context = state.get("canvas_context") or {}
        repair_count = int(state.get("repair_count") or 0)

        canvas_id = context.get("canvas_id")
        workspace_id = context.get("workspace_id")
        snapshot_doc, snapshot_source, snapshot_warnings = await self._context_resolver.fetch_snapshot(
            canvas_id=canvas_id,
            workspace_id=workspace_id,
        )

        operations, expected_positions, layout_metadata = self.compile_mutation_batch(
            task=task,
            context=context,
            snapshot_doc=snapshot_doc,
            runtime=runtime,
        )
        normalized_ops, norm_warnings = normalize_ops(operations)

        execution = {
            "status": "pending",
            "mode": runtime.get("mode") or "apply",
            "operation_count": len(normalized_ops),
            "operations": normalized_ops,
            "expected_positions": expected_positions,
            "expected_version": task.get("execution", {}).get("expected_canvas_version"),
            "snapshot_source": snapshot_source,
            "warnings": list(snapshot_warnings) + list(norm_warnings),
            "idempotency_key": self._attempt_idempotency_key(task, repair_count),
            "retryable": False,
            "response": None,
            "layout_metadata": layout_metadata,
            "transform_metadata": (layout_metadata.get("transforms") or {}) if isinstance(layout_metadata, dict) else {},
            "error": None,
        }
        if layout_metadata.get("budget_exceeded"):
            execution["warnings"].append("layout_budget_exceeded")

        if not normalized_ops:
            execution["status"] = "no_op"
            return execution

        if runtime.get("mode") == "shadow":
            execution["status"] = "dry_run"
            return execution

        write_service = self._create_write_service()
        expected_version = execution["expected_version"]

        try:
            result = await write_service.apply_canvas_ops(
                canvas_id=canvas_id,
                workspace_id=workspace_id,
                operations=normalized_ops,
                expected_version=str(expected_version) if expected_version is not None else None,
                user_id=None,
                idempotency_key=execution["idempotency_key"],
                client_request_id=str(task.get("intent_id") or state.get("agent_run_id") or "native"),
                client_session_id=f"canvas-native:{state.get('agent_run_id')}",
            )
            execution["response"] = self._trim_response(result)

            status_code = int(result.get("status_code") or 200) if isinstance(result, dict) else 200
            if status_code == 409 or result.get("error") == "version_conflict":
                execution["status"] = "failed"
                execution["retryable"] = True
                execution["error"] = {
                    "code": "version_conflict",
                    "detail": result,
                }
            else:
                execution["status"] = "applied"
                server_version = result.get("serverVersion") or result.get("server_version")
                if server_version is not None:
                    execution["server_version"] = server_version
                metrics.incr("canvas_native.execute.applied", 1)
        except CanvasRealtimeError as exc:
            execution["status"] = "failed"
            execution["retryable"] = bool(exc.code in {"version_conflict", "timeout"} or exc.status_code == 409)
            execution["error"] = {
                "code": exc.code or "realtime_error",
                "status_code": exc.status_code,
                "message": exc.message,
                "detail": exc.detail,
            }
            metrics.incr("canvas_native.execute.failed", 1, code=exc.code or "realtime_error")

        return execution

    def compile_mutation_batch(
        self,
        *,
        task: dict[str, Any],
        context: dict[str, Any],
        snapshot_doc: dict[str, Any] | None,
        runtime: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], dict[str, dict[str, float]], dict[str, Any]]:
        operations: list[dict[str, Any]] = []
        expected_positions: dict[str, dict[str, float]] = {}
        layout_metadata: dict[str, Any] = {}

        entities = list(task.get("entities") or [])
        transforms = list(task.get("transforms") or [])
        working_set = task.get("working_set") or {}
        layout = task.get("layout") or {}
        strategy = str(layout.get("strategy") or "preserve")
        layout_metadata_from_task = layout.get("metadata") or {}
        best_path = (
            task.get("metadata", {}).get("best_path")
            or layout_metadata_from_task.get("best_path")
            or {}
        )
        preferred_order_ids = [
            str(node_id)
            for node_id in (
                best_path.get("ordered_focus_node_ids")
                or working_set.get("node_ids")
                or []
            )
            if node_id
        ]

        focus_node_ids = [str(node_id) for node_id in (working_set.get("node_ids") or []) if node_id]
        snapshot_nodes = _find_nodes_by_ids(snapshot_doc, focus_node_ids)
        node_lookup = {
            str(node.get("id")): node
            for node in ((snapshot_doc or {}).get("nodes") or [])
            if isinstance(node, dict) and node.get("id")
        }
        anchor_box = context.get("anchor_box") or _bounding_box(snapshot_nodes) or _default_anchor_box()
        layout_lanes = [lane for lane in (layout.get("lanes") or []) if isinstance(lane, dict)]

        if entities:
            entity_ids = [str(entity.get("entity_id")) for entity in entities if entity.get("entity_id")]
            entity_positions, layout_metadata = self._layout_service.compute_positions(
                entity_ids=entity_ids,
                strategy=strategy if strategy != "preserve" else "grid",
                anchor_box=anchor_box,
                node_lookup=node_lookup,
                prefer_right_side=bool(focus_node_ids),
                root_entity_id=layout.get("root_entity_id"),
                lanes=layout_lanes,
                preferred_order_ids=preferred_order_ids,
                optimization_profile=best_path.get("optimization_profile"),
                budget_ms=runtime.get("layout_budget_ms"),
                collision_pass_limit=int(runtime.get("layout_collision_pass_limit") or 2),
            )
            header_ops, header_positions = self._build_lane_headers(
                task=task,
                strategy=strategy,
                anchor_box=anchor_box,
                layout_metadata=layout_metadata,
            )
            operations.extend(header_ops)
            expected_positions.update(header_positions)
            for entity in entities:
                entity_id = str(entity.get("entity_id") or "")
                if not entity_id:
                    continue
                node_type = str((entity.get("properties") or {}).get("type") or "text")
                code_type = (entity.get("properties") or {}).get("codeType")
                width, height = get_default_node_size(node_type, code_type)
                target_position = entity_positions[entity_id]
                expected_positions[entity_id] = target_position
                operations.append(
                    {
                        "op": "add_node",
                        "node": {
                            "id": entity_id,
                            "type": node_type,
                            "content": entity.get("text") or entity.get("label") or "",
                            "x": target_position["x"],
                            "y": target_position["y"],
                            "width": width,
                            "height": height,
                        },
                    }
                )
        elif strategy != "preserve" and focus_node_ids:
            target_positions, layout_metadata = self._layout_service.compute_positions(
                entity_ids=focus_node_ids,
                strategy=strategy,
                anchor_box=anchor_box,
                node_lookup=node_lookup,
                prefer_right_side=False,
                root_entity_id=layout.get("root_entity_id"),
                lanes=layout_lanes,
                preferred_order_ids=preferred_order_ids,
                optimization_profile=best_path.get("optimization_profile"),
                budget_ms=runtime.get("layout_budget_ms"),
                collision_pass_limit=int(runtime.get("layout_collision_pass_limit") or 2),
            )
            for node in snapshot_nodes:
                node_id = str(node.get("id") or "")
                if node_id not in target_positions:
                    continue
                target = target_positions[node_id]
                expected_positions[node_id] = target
                current_x = float(node.get("x") or 0.0)
                current_y = float(node.get("y") or 0.0)
                if abs(current_x - target["x"]) < 1.0 and abs(current_y - target["y"]) < 1.0:
                    continue
                operations.append(
                    {
                        "op": "move_node",
                        "id": node_id,
                        "x": target["x"],
                        "y": target["y"],
                    }
                )

        transform_ops, transform_positions, transform_metadata = self._compile_transform_operations(
            task=task,
            transforms=transforms,
            snapshot_doc=snapshot_doc,
            anchor_box=anchor_box,
            fallback_target_ids=focus_node_ids,
            runtime=runtime,
        )
        operations.extend(transform_ops)
        expected_positions.update(transform_positions)
        if transform_metadata:
            layout_metadata["transforms"] = transform_metadata

        existing_connections = set()
        if isinstance(snapshot_doc, dict):
            for connection in snapshot_doc.get("connections") or []:
                if not isinstance(connection, dict):
                    continue
                existing_connections.add(
                    (
                        str(connection.get("from") or ""),
                        str(connection.get("to") or ""),
                    )
                )

        for index, connection in enumerate(task.get("connections") or []):
            source_id = str(connection.get("source_entity_id") or "")
            target_id = str(connection.get("target_entity_id") or "")
            if not source_id or not target_id:
                continue
            if (source_id, target_id) in existing_connections:
                continue
            operations.append(
                {
                    "op": "add_connection",
                    "id": f"{task.get('intent_id')}_conn_{index}",
                    "from": source_id,
                    "to": target_id,
                    "label": connection.get("relation") or "",
                    "style": "arrow",
                }
            )

        return operations, expected_positions, layout_metadata

    def _compile_transform_operations(
        self,
        *,
        task: dict[str, Any],
        transforms: list[dict[str, Any]],
        snapshot_doc: dict[str, Any] | None,
        anchor_box: dict[str, Any],
        fallback_target_ids: list[str],
        runtime: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], dict[str, dict[str, float]], dict[str, Any]]:
        operations: list[dict[str, Any]] = []
        expected_positions: dict[str, dict[str, float]] = {}
        metadata: dict[str, Any] = {
            "retitled_nodes": [],
            "summary_nodes": [],
            "split_nodes": [],
            "merged_nodes": [],
        }
        node_lookup = {
            str(node.get("id")): node
            for node in ((snapshot_doc or {}).get("nodes") or [])
            if isinstance(node, dict) and node.get("id")
        }
        snapshot_connections = [
            connection
            for connection in ((snapshot_doc or {}).get("connections") or [])
            if isinstance(connection, dict)
        ]
        existing_connections = {
            (
                str(connection.get("from") or ""),
                str(connection.get("to") or ""),
            )
            for connection in snapshot_connections
        }
        scheduled_add_pairs: set[tuple[str, str]] = set()
        scheduled_delete_connection_ids: set[str] = set()
        scheduled_delete_node_ids: set[str] = set()

        for index, transform in enumerate(transforms):
            kind = str(transform.get("kind") or "")
            target_ids = [str(entity_id) for entity_id in (transform.get("target_entity_ids") or fallback_target_ids) if entity_id]
            payload = transform.get("payload") or {}

            if kind == "retitle_selection":
                titles = [str(title).strip() for title in (payload.get("titles") or []) if str(title).strip()]
                for node_id, title in zip(target_ids, titles, strict=False):
                    current_content = str((node_lookup.get(node_id) or {}).get("content") or "").strip()
                    if current_content == title:
                        continue
                    operations.append(
                        {
                            "op": "update_node",
                            "id": node_id,
                            "patch": {"content": title},
                        }
                    )
                    metadata["retitled_nodes"].append({"node_id": node_id, "title": title})

            if kind == "split_node_into_children":
                parent_node_id = str(payload.get("parent_node_id") or (target_ids[0] if target_ids else ""))
                child_titles = [str(title).strip() for title in (payload.get("titles") or []) if str(title).strip()]
                child_ids = [str(node_id) for node_id in (payload.get("child_node_ids") or []) if str(node_id)]
                if parent_node_id and child_titles and len(child_titles) == len(child_ids):
                    parent_node = node_lookup.get(parent_node_id) or {}
                    parent_box = _bounding_box([parent_node]) or anchor_box or _default_anchor_box()
                    child_positions, _layout = self._layout_service.compute_positions(
                        entity_ids=child_ids,
                        strategy=str(payload.get("child_layout") or "cluster"),
                        anchor_box=parent_box,
                        node_lookup=node_lookup,
                        prefer_right_side=True,
                        optimization_profile="compact",
                        budget_ms=runtime.get("layout_budget_ms"),
                        collision_pass_limit=int(runtime.get("layout_collision_pass_limit") or 2),
                    )
                    split_record = {
                        "parent_node_id": parent_node_id,
                        "child_node_ids": child_ids,
                        "titles": child_titles,
                    }
                    for child_id, child_title in zip(child_ids, child_titles, strict=False):
                        width, height = get_default_node_size("text", None)
                        target_position = child_positions[child_id]
                        expected_positions[child_id] = target_position
                        operations.append(
                            {
                                "op": "add_node",
                                "node": {
                                    "id": child_id,
                                    "type": "text",
                                    "content": child_title,
                                    "x": target_position["x"],
                                    "y": target_position["y"],
                                    "width": width,
                                    "height": height,
                                },
                            }
                        )
                        pair = (parent_node_id, child_id)
                        if pair not in existing_connections and pair not in scheduled_add_pairs:
                            operations.append(
                                {
                                    "op": "add_connection",
                                    "id": f"{parent_node_id}_split_{child_id}",
                                    "from": parent_node_id,
                                    "to": child_id,
                                    "label": "expands_to",
                                    "style": "arrow",
                                }
                            )
                            scheduled_add_pairs.add(pair)
                    metadata["split_nodes"].append(split_record)
                continue

            if kind == "merge_selection_into_node":
                merged_node_id = str(payload.get("merged_node_id") or f"{task.get('intent_id')}_merged_{index}")
                merged_title = str(payload.get("title") or "合并结果").strip() or "合并结果"
                target_nodes = _find_nodes_by_ids(snapshot_doc, target_ids) if target_ids else []
                merge_box = _bounding_box(target_nodes) or anchor_box or _default_anchor_box()
                merged_position = {
                    "x": float(merge_box.get("center_x") or 240.0),
                    "y": float(merge_box.get("center_y") or 170.0),
                }
                expected_positions[merged_node_id] = merged_position
                if merged_node_id not in node_lookup:
                    width, height = get_default_node_size("text", None)
                    operations.append(
                        {
                            "op": "add_node",
                            "node": {
                                "id": merged_node_id,
                                "type": "text",
                                "content": merged_title,
                                "x": merged_position["x"],
                                "y": merged_position["y"],
                                "width": width,
                                "height": height,
                            },
                        }
                    )

                replacement_pairs: set[tuple[str, str]] = set()
                for connection in snapshot_connections:
                    connection_id = str(connection.get("id") or "")
                    source_id = str(connection.get("from") or "")
                    target_id = str(connection.get("to") or "")
                    source_selected = source_id in target_ids
                    target_selected = target_id in target_ids
                    if not source_selected and not target_selected:
                        continue

                    if connection_id and connection_id not in scheduled_delete_connection_ids:
                        operations.append({"op": "delete_connection", "id": connection_id})
                        scheduled_delete_connection_ids.add(connection_id)

                    if source_selected and target_selected:
                        continue
                    replacement_pair = (
                        merged_node_id if source_selected else source_id,
                        merged_node_id if target_selected else target_id,
                    )
                    if (
                        not replacement_pair[0]
                        or not replacement_pair[1]
                        or replacement_pair[0] == replacement_pair[1]
                        or replacement_pair in existing_connections
                        or replacement_pair in replacement_pairs
                        or replacement_pair in scheduled_add_pairs
                    ):
                        continue
                    operations.append(
                        {
                            "op": "add_connection",
                            "id": f"{merged_node_id}_merge_{replacement_pair[0]}_{replacement_pair[1]}",
                            "from": replacement_pair[0],
                            "to": replacement_pair[1],
                            "label": "merged_flow",
                            "style": "arrow",
                        }
                    )
                    replacement_pairs.add(replacement_pair)
                    scheduled_add_pairs.add(replacement_pair)

                for target_id in target_ids:
                    if target_id in scheduled_delete_node_ids:
                        continue
                    operations.append({"op": "delete_node", "id": target_id})
                    scheduled_delete_node_ids.add(target_id)

                metadata["merged_nodes"].append(
                    {
                        "merged_node_id": merged_node_id,
                        "title": merged_title,
                        "deleted_node_ids": list(target_ids),
                        "replacement_pairs": [
                            {"from": source_id, "to": target_id}
                            for source_id, target_id in sorted(replacement_pairs)
                        ],
                    }
                )
                continue

            if kind != "create_summary_hub":
                continue

            summary_node_id = str(payload.get("summary_node_id") or f"{task.get('intent_id')}_summary_{index}")
            summary_title = str(payload.get("title") or "总结").strip() or "总结"
            target_nodes = _find_nodes_by_ids(snapshot_doc, target_ids) if target_ids else []
            target_box = _bounding_box(target_nodes) or anchor_box or _default_anchor_box()
            summary_position = {
                "x": float(target_box.get("center_x") or 240.0),
                "y": max(40.0, float(target_box.get("y") or 80.0) - 180.0),
            }
            expected_positions[summary_node_id] = summary_position

            existing_summary = node_lookup.get(summary_node_id)
            if existing_summary is None:
                width, height = get_default_node_size("text", None)
                operations.append(
                    {
                        "op": "add_node",
                        "node": {
                            "id": summary_node_id,
                            "type": "text",
                            "content": summary_title,
                            "x": summary_position["x"],
                            "y": summary_position["y"],
                            "width": width,
                            "height": height,
                        },
                    }
                )

            for target_id in target_ids:
                pair = (summary_node_id, target_id)
                if pair in existing_connections or pair in scheduled_add_pairs:
                    continue
                operations.append(
                    {
                        "op": "add_connection",
                        "id": f"{summary_node_id}_conn_{target_id}",
                        "from": summary_node_id,
                        "to": target_id,
                        "label": "summary_of",
                        "style": "arrow",
                    }
                )
                scheduled_add_pairs.add(pair)
            metadata["summary_nodes"].append(
                {
                    "summary_node_id": summary_node_id,
                    "title": summary_title,
                    "target_ids": target_ids,
                }
            )

        return operations, expected_positions, metadata

    def _build_lane_headers(
        self,
        *,
        task: dict[str, Any],
        strategy: str,
        anchor_box: dict[str, Any],
        layout_metadata: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], dict[str, dict[str, float]]]:
        if strategy != "swimlane":
            return [], {}
        lane_regions = [lane for lane in (layout_metadata.get("lanes") or []) if isinstance(lane, dict)]
        if not lane_regions:
            return [], {}

        operations: list[dict[str, Any]] = []
        expected_positions: dict[str, dict[str, float]] = {}
        header_y = float(anchor_box.get("y") or 80.0)
        for index, lane in enumerate(lane_regions):
            lane_label = str(lane.get("label") or f"Lane {index + 1}")
            header_id = f"{task.get('intent_id')}_lane_{lane.get('lane_id') or index}"
            header_position = {"x": float(lane.get("x") or 80.0), "y": header_y}
            expected_positions[header_id] = header_position
            operations.append(
                {
                    "op": "add_node",
                    "node": {
                        "id": header_id,
                        "type": "text",
                        "content": lane_label,
                        "x": header_position["x"],
                        "y": header_position["y"],
                        "width": 240.0,
                        "height": 64.0,
                    },
                }
            )
        return operations, expected_positions

    def _attempt_idempotency_key(self, task: dict[str, Any], repair_count: int) -> str:
        base_key = str(task.get("execution", {}).get("idempotency_key") or task.get("intent_id") or "native")
        if repair_count <= 0:
            return base_key
        return f"{base_key}:repair:{repair_count}"

    def _trim_response(self, response: Any) -> dict[str, Any] | None:
        if not isinstance(response, dict):
            return None
        trimmed: dict[str, Any] = {}
        for key in ("serverVersion", "server_version", "id_map", "idMap", "applied", "warnings", "status_code", "error"):
            if key in response:
                trimmed[key] = response.get(key)
        return trimmed
