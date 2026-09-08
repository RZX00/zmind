from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from core.canvas.agent_context import (
    extract_canvas_id_from_payload,
    normalize_selection_context_payload,
)
from core.canvas.write_service import CanvasWriteService
from core.services.supabase import DBConnection


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _latest_user_metadata(messages: list[dict[str, Any]]) -> dict[str, Any]:
    for message in reversed(messages):
        if str(message.get("role") or "").strip().lower() != "user":
            continue
        metadata = message.get("metadata")
        if isinstance(metadata, dict):
            return metadata
    return {}


def _compose_canvas_doc(row: dict[str, Any]) -> dict[str, Any]:
    doc = dict(row.get("doc") or {})
    if "id" not in doc and row.get("id"):
        doc["id"] = row["id"]
    if "title" not in doc and row.get("title"):
        doc["title"] = row["title"]
    if "version" not in doc and row.get("version"):
        doc["version"] = row["version"]
    if "createdAt" not in doc and row.get("created_at"):
        try:
            doc["createdAt"] = int(
                datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00")).timestamp() * 1000
            )
        except Exception:
            doc["createdAt"] = _now_ms()
    if "updatedAt" not in doc and row.get("updated_at"):
        try:
            doc["updatedAt"] = int(
                datetime.fromisoformat(str(row["updated_at"]).replace("Z", "+00:00")).timestamp() * 1000
            )
        except Exception:
            doc["updatedAt"] = _now_ms()
    doc.setdefault("nodes", [])
    doc.setdefault("connections", [])
    if "serverVersion" not in doc:
        try:
            doc["serverVersion"] = int(doc.get("updatedAt") or _now_ms())
        except Exception:
            doc["serverVersion"] = _now_ms()
    return doc


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


class CanvasNativeContextResolverService:
    def __init__(
        self,
        *,
        create_write_service: type[CanvasWriteService] = CanvasWriteService,
        db_connection: Any | None = None,
        snapshot_timeout_sec: float = 5.0,
    ) -> None:
        self._create_write_service = create_write_service
        self._db_connection = db_connection
        self._snapshot_timeout_sec = snapshot_timeout_sec

    async def resolve(self, state: dict[str, Any], tool_context: dict[str, Any] | None) -> dict[str, Any]:
        tool_ctx = dict(tool_context or {})
        messages = state.get("messages_context") or []
        latest_metadata = _latest_user_metadata(messages)

        explicit_target = latest_metadata.get("workspace_target_canvas")
        selection_payload = latest_metadata.get("selection_context") or tool_ctx.get("selection_context")

        canvas_id = (
            str(tool_ctx.get("canvas_id") or "").strip()
            or extract_canvas_id_from_payload(explicit_target)
            or extract_canvas_id_from_payload(selection_payload)
        )
        workspace_id = str(tool_ctx.get("account_id") or "").strip()

        selection_context = None
        selection_warnings: list[str] = []
        if selection_payload:
            selection_context, selection_warnings = normalize_selection_context_payload(
                selection_payload,
                target_canvas_id=canvas_id or None,
            )

        snapshot_doc, snapshot_source, snapshot_warnings = await self.fetch_snapshot(
            canvas_id=canvas_id or None,
            workspace_id=workspace_id or None,
        )

        focus_node_ids: list[str] = []
        selected_nodes: list[dict[str, Any]] = []
        if isinstance(selection_context, dict):
            for node in selection_context.get("nodes", []) if isinstance(selection_context.get("nodes"), list) else []:
                if not isinstance(node, dict) or not node.get("id"):
                    continue
                focus_node_ids.append(str(node["id"]))
                selected_nodes.append(node)

        snapshot_nodes = snapshot_doc.get("nodes") if isinstance(snapshot_doc, dict) else None
        snapshot_connections = snapshot_doc.get("connections") if isinstance(snapshot_doc, dict) else None
        snapshot_node_lookup = {
            str(node.get("id")): node
            for node in (snapshot_nodes or [])
            if isinstance(node, dict) and node.get("id")
        }
        if focus_node_ids and snapshot_node_lookup:
            selected_nodes = [
                snapshot_node_lookup.get(node_id) or next(
                    (
                        node for node in selected_nodes
                        if isinstance(node, dict) and str(node.get("id")) == node_id
                    ),
                    {"id": node_id},
                )
                for node_id in focus_node_ids
            ]
        if not focus_node_ids and isinstance(snapshot_nodes, list):
            focus_node_ids = [
                str(node.get("id"))
                for node in snapshot_nodes
                if isinstance(node, dict) and node.get("id")
            ][:24]
            selected_nodes = [
                node for node in snapshot_nodes
                if isinstance(node, dict) and str(node.get("id")) in set(focus_node_ids)
            ]

        bbox = _bounding_box(selected_nodes)
        focus_texts = [
            str(
                node.get("content")
                or node.get("text")
                or node.get("title")
                or node.get("label")
                or ""
            ).strip()
            for node in selected_nodes
            if isinstance(node, dict)
            and str(
                node.get("content")
                or node.get("text")
                or node.get("title")
                or node.get("label")
                or ""
            ).strip()
        ]
        focus_node_id_set = set(focus_node_ids)
        focus_connections: list[dict[str, Any]] = []
        if isinstance(selection_context, dict) and isinstance(selection_context.get("connections"), list):
            for connection in selection_context.get("connections") or []:
                if not isinstance(connection, dict):
                    continue
                source_id = str(connection.get("from") or connection.get("source") or "")
                target_id = str(connection.get("to") or connection.get("target") or "")
                if source_id in focus_node_id_set and target_id in focus_node_id_set:
                    focus_connections.append(connection)
        elif isinstance(snapshot_connections, list):
            for connection in snapshot_connections:
                if not isinstance(connection, dict):
                    continue
                source_id = str(connection.get("from") or "")
                target_id = str(connection.get("to") or "")
                if source_id in focus_node_id_set and target_id in focus_node_id_set:
                    focus_connections.append(connection)
        current_server_version = None
        if isinstance(snapshot_doc, dict):
            try:
                current_server_version = int(snapshot_doc.get("serverVersion"))
            except Exception:
                current_server_version = None

        return {
            "canvas_id": canvas_id or None,
            "workspace_id": workspace_id or None,
            "selection_context": selection_context,
            "selection_warnings": selection_warnings,
            "focus_scope": "selection" if selection_context else "canvas",
            "focus_node_ids": focus_node_ids,
            "focus_nodes": selected_nodes,
            "focus_texts": focus_texts,
            "focus_connections": focus_connections,
            "focus_connection_ids": [
                str(conn.get("id"))
                for conn in focus_connections
                if isinstance(conn, dict) and conn.get("id")
            ],
            "snapshot_source": snapshot_source,
            "snapshot_warnings": snapshot_warnings,
            "current_server_version": current_server_version,
            "node_count": len(snapshot_nodes) if isinstance(snapshot_nodes, list) else 0,
            "connection_count": len(snapshot_connections or []) if isinstance(snapshot_connections, list) else 0,
            "anchor_box": bbox,
            "target_canvas_source": (
                "tool_context" if tool_ctx.get("canvas_id")
                else "latest_user_metadata" if explicit_target
                else "selection_context" if selection_payload
                else "unknown"
            ),
            "latest_user_metadata": latest_metadata,
        }

    async def fetch_snapshot(
        self,
        *,
        canvas_id: str | None,
        workspace_id: str | None,
    ) -> tuple[dict[str, Any] | None, str, list[str]]:
        warnings: list[str] = []
        if not canvas_id or not workspace_id:
            return None, "missing_target", ["missing_canvas_target"]

        try:
            write_service = self._create_write_service()
            snap = await asyncio.wait_for(
                write_service.fetch_canvas_snapshot(
                    canvas_id=canvas_id,
                    workspace_id=workspace_id,
                    user_id=None,
                ),
                timeout=self._snapshot_timeout_sec,
            )
            canvas_doc = snap.get("canvas") if isinstance(snap, dict) else None
            if isinstance(canvas_doc, dict):
                return canvas_doc, "realtime", warnings
        except Exception as exc:
            warnings.append(f"realtime_snapshot_failed:{type(exc).__name__}")

        db_connection = self._db_connection or DBConnection()
        try:
            client = await db_connection.client
            result = (
                await client.table("canvases")
                .select("id, title, version, doc, created_at, updated_at")
                .eq("id", canvas_id)
                .eq("account_id", workspace_id)
                .eq("is_deleted", False)
                .limit(1)
                .execute()
            )
            if not result.data:
                warnings.append("canvas_not_found")
                return None, "db_missing", warnings
            return _compose_canvas_doc(result.data[0] or {}), "db", warnings
        except Exception as exc:
            warnings.append(f"db_snapshot_failed:{type(exc).__name__}")
            return None, "unavailable", warnings
