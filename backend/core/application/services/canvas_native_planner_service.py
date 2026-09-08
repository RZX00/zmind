from __future__ import annotations

import hashlib
import math
import re
from typing import Any

from core.application.services.canvas_native_best_path_service import CanvasNativeBestPathService
from core.domains.canvas.task_ir import (
    CanvasEntitySpec,
    CanvasSemanticLane,
    CanvasTaskIR,
    CanvasTransform,
    CanvasWorkingSet,
    ConnectionIntent,
    ExecutionPolicy,
    LayoutConstraints,
    TargetCanvasRef,
    VerificationCheck,
    VerificationPlan,
)


_LAYOUT_KEYWORDS = ("layout", "organize", "arrange", "rearrange", "排版", "整理", "归类", "布局")
_CONNECT_KEYWORDS = ("connect", "link", "relationship", "flow", "连线", "连接", "关联", "关系")
_CREATE_KEYWORDS = ("create", "add", "append", "insert", "生成", "创建", "添加", "新增", "插入")
_MINDMAP_KEYWORDS = ("mindmap", "brainstorm", "脑图", "思维导图")
_TIMELINE_KEYWORDS = ("timeline", "时间线", "roadmap", "路线图", "阶段")
_GRID_KEYWORDS = ("grid", "matrix", "表格", "矩阵")
_SWIMLANE_KEYWORDS = ("swimlane", "lane", "泳道", "看板", "kanban")
_SUMMARY_KEYWORDS = ("summary", "summarize", "总结", "归纳", "提炼", "总纲", "总览")
_RETITLE_KEYWORDS = ("rename", "retitle", "重命名", "改名", "改成", "改为")
_SPLIT_KEYWORDS = ("split", "break down", "expand", "拆分", "拆成", "展开", "分解")
_MERGE_KEYWORDS = ("merge", "combine", "condense", "合并", "归并", "压缩", "合成")
_ACTION_NOISE_KEYWORDS = (
    _LAYOUT_KEYWORDS
    + _CONNECT_KEYWORDS
    + _SUMMARY_KEYWORDS
    + _RETITLE_KEYWORDS
    + _SPLIT_KEYWORDS
    + _MERGE_KEYWORDS
    + ("自动", "auto", "然后", "并")
)


def _latest_user_text(state: dict[str, Any]) -> str:
    for message in reversed(state.get("messages_context") or []):
        if str(message.get("role") or "").strip().lower() != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            return content.strip()
    intent = state.get("intent") or {}
    return str(intent.get("user_goal") or "").strip()


def _contains_any(text: str, tokens: tuple[str, ...]) -> bool:
    return any(token in text for token in tokens)


def _split_short_items(text: str) -> list[str]:
    parts = re.split(r"[,\n，；;、|/]", text)
    return _dedupe_short_items(parts)


def _extract_items_from_text(text: str) -> list[str]:
    normalized = str(text or "").replace("\r", "\n")
    if "->" in normalized:
        chain_parts = _dedupe_short_items(normalized.split("->"))
        if len(chain_parts) >= 2:
            return chain_parts

    lines = [line.strip(" \t-•*") for line in normalized.split("\n")]
    bullet_items = [
        re.sub(r"^\d+[.)]\s*", "", line).strip()
        for line in lines
        if line.strip() and (line.lstrip().startswith(("-", "*", "•")) or re.match(r"^\d+[.)]\s+", line))
    ]
    if len(bullet_items) >= 2:
        return _dedupe_short_items(bullet_items)

    for separator in ("：", ":"):
        if separator in normalized:
            _, tail = normalized.split(separator, 1)
            cleaned = _split_short_items(tail)
            if len(cleaned) >= 2:
                return cleaned

    cleaned = _split_short_items(normalized)
    return cleaned if len(cleaned) >= 2 else []


def _dedupe_short_items(items: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in items:
        cleaned = str(item or "").strip()
        if not cleaned or len(cleaned) > 80:
            continue
        if cleaned.startswith("并") or cleaned.startswith("然后"):
            continue
        lowered = cleaned.lower()
        if len(cleaned) > 6 and any(keyword in lowered for keyword in _ACTION_NOISE_KEYWORDS):
            continue
        if lowered in seen:
            continue
        seen.add(lowered)
        result.append(cleaned)
        if len(result) >= 16:
            break
    return result


def _extract_lane_groups(text: str) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    for line in str(text or "").replace("\r", "\n").split("\n"):
        stripped = line.strip(" \t-•*")
        if not stripped or ("：" not in stripped and ":" not in stripped):
            continue
        if "->" in stripped:
            continue
        lane_label, tail = re.split(r"[:：]", stripped, maxsplit=1)
        items = _split_short_items(tail)
        lane_label = lane_label.strip()
        if not lane_label or len(items) < 1:
            continue
        groups.append(
            {
                "lane_id": re.sub(r"[^a-z0-9]+", "_", lane_label.lower()).strip("_") or f"lane_{len(groups) + 1}",
                "label": lane_label,
                "titles": items,
            }
        )
    return groups if len(groups) >= 2 else []


def _extract_lane_names(text: str) -> list[str]:
    normalized = str(text or "")
    patterns = (
        r"按\s*([^\n：:]+?)\s*(?:泳道|三列|三栏|多列|整理|布局|排版)",
        r"(?:泳道|lane|swimlane)\s*[:：]\s*([^\n]+)",
    )
    for pattern in patterns:
        match = re.search(pattern, normalized, flags=re.IGNORECASE)
        if not match:
            continue
        candidate = match.group(1)
        parts = [part.strip() for part in re.split(r"[/,，、|｜]", candidate) if part.strip()]
        if len(parts) >= 2:
            return parts[:6]
    return []


def _assign_focus_nodes_to_lanes(
    focus_nodes: list[dict[str, Any]],
    lane_names: list[str],
) -> list[dict[str, Any]]:
    if not focus_nodes or len(lane_names) < 2:
        return []

    lanes = [
        {
            "lane_id": re.sub(r"[^a-z0-9]+", "_", lane.lower()).strip("_") or f"lane_{index + 1}",
            "label": lane,
            "entity_ids": [],
        }
        for index, lane in enumerate(lane_names)
    ]
    unmatched_ids: list[str] = []
    direct_match_count = 0
    for node in focus_nodes:
        node_id = str(node.get("id") or "")
        content = str(
            node.get("content")
            or node.get("text")
            or node.get("title")
            or node.get("label")
            or ""
        ).lower()
        matched = False
        for lane in lanes:
            if lane["label"].lower() in content:
                lane["entity_ids"].append(node_id)
                matched = True
                direct_match_count += 1
                break
        if not matched:
            unmatched_ids.append(node_id)

    if direct_match_count <= 0:
        return []

    for index, node_id in enumerate(unmatched_ids):
        lanes[index % len(lanes)]["entity_ids"].append(node_id)

    return [lane for lane in lanes if lane["entity_ids"]]


def _choose_layout_strategy(
    text: str,
    *,
    focus_count: int,
    create_count: int,
    lane_groups: list[dict[str, Any]],
    assigned_lanes: list[dict[str, Any]],
) -> str:
    if lane_groups or assigned_lanes or _contains_any(text, _SWIMLANE_KEYWORDS):
        return "swimlane" if lane_groups or assigned_lanes else "cluster"
    if _contains_any(text, _MINDMAP_KEYWORDS):
        return "mindmap"
    if _contains_any(text, _TIMELINE_KEYWORDS) or "->" in text:
        return "timeline"
    if _contains_any(text, _GRID_KEYWORDS):
        return "grid"
    if _contains_any(text, _LAYOUT_KEYWORDS):
        if focus_count >= 4 or create_count >= 3:
            return "grid"
        return "cluster"
    if create_count >= 4:
        return "grid"
    if create_count >= 2:
        return "cluster"
    return "preserve"


def _make_native_key(agent_run_id: str, suffix: str) -> str:
    digest = hashlib.sha1(f"{agent_run_id}:{suffix}".encode("utf-8")).hexdigest()[:10]
    return f"native_{suffix}_{digest}"


def _summary_title(text: str) -> str | None:
    if not _contains_any(text.lower(), _SUMMARY_KEYWORDS):
        return None
    match = re.search(r"(?:总结|归纳|总纲|summary)[:：]\s*([^\n]+)", text, flags=re.IGNORECASE)
    if match:
        return match.group(1).strip()[:40] or "总结"
    return "总结"


def _merge_title(text: str) -> str | None:
    if not _contains_any(text.lower(), _MERGE_KEYWORDS):
        return None
    match = re.search(r"(?:合并成|合并为|merge(?:\s+into)?)[:：]?\s*([^\n]+)", text, flags=re.IGNORECASE)
    if match:
        return match.group(1).strip()[:40] or "合并结果"
    return "合并结果"


class CanvasNativePlannerService:
    def __init__(self, best_path_service: CanvasNativeBestPathService | None = None) -> None:
        self._best_path_service = best_path_service or CanvasNativeBestPathService()

    def plan(self, *, state: dict[str, Any], context: dict[str, Any]) -> CanvasTaskIR:
        latest_user_text = _latest_user_text(state)
        lowered = latest_user_text.lower()
        intent = state.get("intent") or {}
        agent_run_id = str(state.get("agent_run_id") or "run")
        runtime = state.get("canvas_runtime") or {}
        focus_node_ids = [str(node_id) for node_id in (context.get("focus_node_ids") or []) if node_id]
        focus_nodes = [node for node in (context.get("focus_nodes") or []) if isinstance(node, dict)]

        lane_groups = _extract_lane_groups(latest_user_text)
        lane_names = _extract_lane_names(latest_user_text)
        assigned_focus_lanes = _assign_focus_nodes_to_lanes(focus_nodes, lane_names)

        if lane_groups:
            create_titles = [title for lane in lane_groups for title in lane["titles"]]
        elif len(focus_node_ids) == 1 and _contains_any(lowered, _SPLIT_KEYWORDS):
            create_titles = []
        elif _contains_any(lowered, _CREATE_KEYWORDS) or "->" in latest_user_text:
            create_titles = _extract_items_from_text(latest_user_text)
        else:
            create_titles = []

        baseline_layout_strategy = _choose_layout_strategy(
            lowered,
            focus_count=len(focus_node_ids) + len(create_titles),
            create_count=len(create_titles),
            lane_groups=lane_groups,
            assigned_lanes=assigned_focus_lanes,
        )
        should_connect = _contains_any(lowered, _CONNECT_KEYWORDS)
        if bool(runtime.get("best_path_enabled", True)):
            best_path = self._best_path_service.choose(
                latest_user_text=latest_user_text,
                context=context,
                create_titles=create_titles,
                lane_groups=lane_groups,
                lane_names=lane_names,
                current_layout_strategy=baseline_layout_strategy,
                should_connect=should_connect,
                budget_ms=runtime.get("plan_budget_ms"),
            )
        else:
            best_path = {
                "request_archetype": "disabled",
                "strategy": baseline_layout_strategy,
                "strategy_reason": "best_path_disabled",
                "selection_topology": {"shape": "disabled"},
                "ordered_focus_node_ids": focus_node_ids,
                "selected_root_node_id": None,
                "connect_pattern": "none",
                "optimization_profile": "compact",
                "budget_ms": runtime.get("plan_budget_ms"),
                "budget_exceeded": False,
            }
        layout_strategy = str(best_path.get("strategy") or baseline_layout_strategy)
        ordered_focus_node_ids = [
            str(node_id)
            for node_id in (best_path.get("ordered_focus_node_ids") or focus_node_ids)
            if node_id
        ]
        selected_root_node_id = str(best_path.get("selected_root_node_id") or "")
        focus_node_ids_for_actions = ordered_focus_node_ids or focus_node_ids

        lane_entity_titles: list[tuple[str, list[str]]] = []
        if lane_groups:
            lane_entity_titles = [(str(lane["label"]), list(lane["titles"])) for lane in lane_groups]

        entities: list[CanvasEntitySpec] = []
        lane_entities: dict[str, list[str]] = {}
        for index, title in enumerate(create_titles):
            entity_id = _make_native_key(agent_run_id, f"node_{index}")
            entities.append(
                CanvasEntitySpec(
                    entity_id=entity_id,
                    entity_type="note",
                    label=title,
                    text=title,
                    properties={"type": "text"},
                )
            )

        if lane_entity_titles and entities:
            entity_cursor = 0
            for lane_label, titles in lane_entity_titles:
                lane_id = re.sub(r"[^a-z0-9]+", "_", lane_label.lower()).strip("_") or f"lane_{len(lane_entities) + 1}"
                lane_entities[lane_id] = []
                for _title in titles:
                    if entity_cursor >= len(entities):
                        break
                    entity = entities[entity_cursor]
                    if entity.entity_id:
                        lane_entities[lane_id].append(entity.entity_id)
                    entity_cursor += 1

        connections: list[ConnectionIntent] = []
        if entities:
            entity_ids = [entity.entity_id for entity in entities if entity.entity_id]
            if layout_strategy == "mindmap" and len(entity_ids) >= 2:
                root_id = entity_ids[0]
                for index, target_id in enumerate(entity_ids[1:], start=1):
                    connections.append(
                        ConnectionIntent(
                            source_entity_id=root_id,
                            target_entity_id=target_id,
                            relation="branch",
                            directed=True,
                            metadata={"planner_index": index, "pattern": "mindmap"},
                        )
                    )
            elif layout_strategy == "timeline" and len(entity_ids) >= 2:
                for index in range(len(entity_ids) - 1):
                    connections.append(
                        ConnectionIntent(
                            source_entity_id=entity_ids[index],
                            target_entity_id=entity_ids[index + 1],
                            relation="next",
                            directed=True,
                            metadata={"planner_index": index, "pattern": "timeline"},
                        )
                    )
            elif should_connect and len(entity_ids) >= 2:
                for index in range(len(entity_ids) - 1):
                    connections.append(
                        ConnectionIntent(
                            source_entity_id=entity_ids[index],
                            target_entity_id=entity_ids[index + 1],
                            relation="related_to",
                            directed=True,
                            metadata={"planner_index": index, "pattern": "sequence"},
                        )
                    )
        elif len(focus_node_ids_for_actions) >= 2 and (
            should_connect
            or layout_strategy in {"timeline", "mindmap"}
            or best_path.get("connect_pattern") in {"sequence", "star"}
        ):
            if layout_strategy == "mindmap":
                root_id = selected_root_node_id or focus_node_ids_for_actions[0]
                for index, target_id in enumerate(
                    [node_id for node_id in focus_node_ids_for_actions if node_id != root_id],
                    start=1,
                ):
                    connections.append(
                        ConnectionIntent(
                            source_entity_id=root_id,
                            target_entity_id=target_id,
                            relation="branch",
                            directed=True,
                            metadata={"planner_index": index, "pattern": "selection_mindmap"},
                        )
                    )
            else:
                relation = "next" if layout_strategy == "timeline" else "related_to"
                pattern = "selection_timeline" if layout_strategy == "timeline" else "selection_sequence"
                for index in range(len(focus_node_ids_for_actions) - 1):
                    connections.append(
                        ConnectionIntent(
                            source_entity_id=focus_node_ids_for_actions[index],
                            target_entity_id=focus_node_ids_for_actions[index + 1],
                            relation=relation,
                            directed=True,
                            metadata={"planner_index": index, "pattern": pattern},
                        )
                    )

        verification_checks: list[VerificationCheck] = []
        if context.get("current_server_version") is not None:
            verification_checks.append(
                VerificationCheck(
                    kind="version_match",
                    target="serverVersion",
                    expected=int(context["current_server_version"]),
                    required=True,
                )
            )
        if entities:
            verification_checks.append(
                VerificationCheck(
                    kind="entity_count",
                    target="created_nodes",
                    expected=len(entities),
                    required=True,
                )
            )
        if connections:
            verification_checks.append(
                VerificationCheck(
                    kind="connection_integrity",
                    target="created_connections",
                    expected=len(connections),
                    required=True,
                )
            )
        if layout_strategy != "preserve" and (focus_node_ids or entities):
            verification_checks.append(
                VerificationCheck(
                    kind="layout_stability",
                    target="layout_targets",
                    expected=len(focus_node_ids) + len(entities),
                    required=False,
                    metadata={"strategy": layout_strategy},
                )
            )

        lanes: list[CanvasSemanticLane] = []
        if lane_entities:
            for lane in lane_groups:
                lane_id = re.sub(r"[^a-z0-9]+", "_", str(lane["label"]).lower()).strip("_") or f"lane_{len(lanes) + 1}"
                lanes.append(
                    CanvasSemanticLane(
                        lane_id=lane_id,
                        label=str(lane["label"]),
                        entity_ids=tuple(lane_entities.get(lane_id, [])),
                        metadata={"source": "create_titles"},
                    )
                )
        elif assigned_focus_lanes:
            for lane in assigned_focus_lanes:
                lanes.append(
                    CanvasSemanticLane(
                        lane_id=str(lane["lane_id"]),
                        label=str(lane["label"]),
                        entity_ids=tuple(str(entity_id) for entity_id in lane["entity_ids"]),
                        metadata={"source": "selection_content_match"},
                    )
                )

        transforms: list[CanvasTransform] = []
        retitle_titles = _extract_items_from_text(latest_user_text) if _contains_any(lowered, _RETITLE_KEYWORDS) else []
        if focus_node_ids_for_actions and retitle_titles and len(retitle_titles) == len(focus_node_ids_for_actions):
            transforms.append(
                CanvasTransform(
                    kind="retitle_selection",
                    target_entity_ids=tuple(focus_node_ids_for_actions),
                    payload={"titles": retitle_titles},
                )
            )

        summary_title = _summary_title(latest_user_text)
        if summary_title and focus_node_ids_for_actions and not entities:
            transforms.append(
                CanvasTransform(
                    kind="create_summary_hub",
                    target_entity_ids=tuple(focus_node_ids_for_actions),
                    payload={
                        "title": summary_title,
                        "summary_node_id": _make_native_key(agent_run_id, "summary"),
                        "connect_mode": "outbound",
                    },
                )
            )
        split_titles = _extract_items_from_text(latest_user_text) if _contains_any(lowered, _SPLIT_KEYWORDS) else []
        if len(focus_node_ids_for_actions) == 1 and len(split_titles) >= 2:
            transforms.append(
                CanvasTransform(
                    kind="split_node_into_children",
                    target_entity_ids=tuple(focus_node_ids_for_actions),
                    payload={
                        "parent_node_id": focus_node_ids_for_actions[0],
                        "titles": split_titles,
                        "child_layout": layout_strategy if layout_strategy != "preserve" else "cluster",
                        "child_node_ids": [
                            _make_native_key(agent_run_id, f"split_child_{index}")
                            for index in range(len(split_titles))
                        ],
                    },
                )
            )

        merge_title = _merge_title(latest_user_text)
        if len(focus_node_ids_for_actions) >= 2 and merge_title and not entities:
            transforms.append(
                CanvasTransform(
                    kind="merge_selection_into_node",
                    target_entity_ids=tuple(focus_node_ids_for_actions),
                    payload={
                        "title": merge_title,
                        "merged_node_id": _make_native_key(agent_run_id, "merged"),
                    },
                )
            )

        execution_policy = ExecutionPolicy(
            mode="apply",
            idempotency_key=_make_native_key(agent_run_id, "base"),
            expected_canvas_version=context.get("current_server_version"),
            allow_partial_success=False,
            repair_attempt_limit=max(
                0,
                int((state.get("canvas_runtime") or {}).get("repair_attempt_limit") or 0),
            ),
            metadata={
                "recipe_names": [
                    recipe
                    for recipe, enabled in (
                        ("create_nodes", bool(entities)),
                        ("connect_sequence", bool(connections)),
                        ("layout", layout_strategy != "preserve"),
                        ("selection_transforms", bool(transforms)),
                        ("rewrite_transforms", any(transform.kind in {"split_node_into_children", "merge_selection_into_node"} for transform in transforms)),
                    )
                    if enabled
                ],
                "best_path_enabled": bool(runtime.get("best_path_enabled", True)),
                "plan_budget_ms": runtime.get("plan_budget_ms"),
                "layout_budget_ms": runtime.get("layout_budget_ms"),
                "layout_collision_pass_limit": runtime.get("layout_collision_pass_limit"),
            },
        )

        return CanvasTaskIR(
            intent_id=agent_run_id,
            user_goal=intent.get("user_goal") or latest_user_text,
            domain="canvas",
            target=TargetCanvasRef(
                canvas_id=context.get("canvas_id"),
                workspace_id=context.get("workspace_id"),
            ),
            working_set=CanvasWorkingSet(
                node_ids=tuple(focus_node_ids_for_actions),
                connection_ids=tuple(context.get("focus_connection_ids") or ()),
                selected_entity_ids=tuple(focus_node_ids_for_actions),
                viewport=context.get("anchor_box"),
            ),
            entities=tuple(entities),
            connections=tuple(connections),
            transforms=tuple(transforms),
            layout=LayoutConstraints(
                strategy=layout_strategy,
                preserve_positions=layout_strategy == "preserve",
                lock_selection=False,
                root_entity_id=(
                    entities[0].entity_id
                    if entities and layout_strategy == "mindmap"
                    else selected_root_node_id or None
                ),
                lanes=tuple(lanes),
                metadata={
                    "focus_scope": context.get("focus_scope"),
                    "focus_count": len(focus_node_ids_for_actions),
                    "focus_texts": list(context.get("focus_texts") or []),
                    "lane_names": lane_names,
                    "best_path": dict(best_path),
                },
            ),
            execution=execution_policy,
            verification=VerificationPlan(
                checks=tuple(verification_checks),
                strict=True,
                metadata={
                    "planner_version": "v4",
                    "rewrite_enabled": any(
                        transform.kind in {"split_node_into_children", "merge_selection_into_node"}
                        for transform in transforms
                    ),
                    "contains_layout": layout_strategy != "preserve",
                    "contains_creation": bool(entities),
                    "contains_connections": bool(connections),
                    "contains_transforms": bool(transforms),
                },
            ),
            metadata={
                "planner_version": "v4",
                "layout_target_node_ids": focus_node_ids_for_actions,
                "create_titles": create_titles,
                "focus_scope": context.get("focus_scope"),
                "anchor_box": context.get("anchor_box"),
                "lane_names": lane_names,
                "best_path": dict(best_path),
                "estimated_operation_count": (
                    len(entities)
                    + len(connections)
                    + len(transforms)
                    + (0 if layout_strategy == "preserve" else len(focus_node_ids_for_actions) + len(entities))
                ),
                "focus_density": round(
                    len(focus_node_ids_for_actions) / max(1, int(math.sqrt(max(1, len(focus_node_ids_for_actions))))),
                    2,
                ),
            },
        )
