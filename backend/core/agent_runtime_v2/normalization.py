from __future__ import annotations

import json
from typing import Any

from .contracts import AgentRunStartV2, SelectionContextV2, WorkspaceTargetV2
from .semantics import normalize_response_mode


def _extract_text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
            elif isinstance(item, str) and item.strip():
                parts.append(item.strip())
        return "\n".join(parts).strip()
    if isinstance(content, dict):
        text = content.get("text")
        if isinstance(text, str):
            return text.strip()
    return ""


def _normalize_surface(value: Any) -> str | None:
    cleaned = str(value or "").strip().lower()
    if cleaned in {"canvas", "doc"}:
        return cleaned
    if cleaned == "document":
        return "doc"
    return None


def _normalize_selection_payload(payload: Any, *, canvas_id: str | None) -> SelectionContextV2:
    if not isinstance(payload, dict):
        return SelectionContextV2(canvas_id=canvas_id, scope="canvas")
    nodes = payload.get("nodes") if isinstance(payload.get("nodes"), list) else []
    connections = payload.get("connections") if isinstance(payload.get("connections"), list) else []
    node_ids = tuple(
        str(node.get("id"))
        for node in nodes
        if isinstance(node, dict) and node.get("id")
    )
    connection_ids = tuple(
        str(connection.get("id"))
        for connection in connections
        if isinstance(connection, dict) and connection.get("id")
    )
    scope = "selection" if node_ids or connection_ids else "canvas"
    anchor_box = payload.get("anchor_box") if isinstance(payload.get("anchor_box"), dict) else None
    return SelectionContextV2(
        canvas_id=canvas_id or str(payload.get("canvas_id") or "") or None,
        scope=scope,
        node_ids=node_ids,
        connection_ids=connection_ids,
        raw_payload=dict(payload),
        anchor_box=anchor_box,
    )


class InputNormalizerV2:
    def normalize(self, start: AgentRunStartV2) -> AgentRunStartV2:
        user_input = dict(start.user_input or {})
        latest_user_text = start.latest_user_text.strip()
        if not latest_user_text:
            latest_user_text = _extract_text_from_content(user_input.get("content"))

        metadata = user_input.get("metadata")
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except Exception:
                metadata = {}
        if not isinstance(metadata, dict):
            metadata = {}

        surface = _normalize_surface(start.surface) or _normalize_surface(metadata.get("surface"))
        workspace_target = start.workspace_target
        if workspace_target.canvas_id is None:
            workspace_target = WorkspaceTargetV2(
                workspace_id=workspace_target.workspace_id or start.identity.account_id,
                canvas_id=workspace_target.canvas_id or metadata.get("canvas_id") or metadata.get("workspace_target_canvas"),
                doc_item_id=workspace_target.doc_item_id or metadata.get("doc_item_id"),
                metadata=workspace_target.metadata or {},
            )

        selection_context = start.selection_context
        if (
            isinstance(selection_context.raw_payload, dict)
            and not selection_context.node_ids
            and not selection_context.connection_ids
        ):
            selection_context = _normalize_selection_payload(
                selection_context.raw_payload,
                canvas_id=workspace_target.canvas_id,
            )
        elif selection_context.raw_payload is None:
            selection_payload = metadata.get("selection_context") or start.tool_context.get("selection_context")
            selection_context = _normalize_selection_payload(selection_payload, canvas_id=workspace_target.canvas_id)

        return AgentRunStartV2(
            identity=start.identity,
            surface=surface,
            interaction_mode=start.interaction_mode,
            response_mode=normalize_response_mode(start.response_mode),  # type: ignore[arg-type]
            user_input=user_input,
            latest_user_text=latest_user_text,
            workspace_target=workspace_target,
            selection_context=selection_context,
            model_name=start.model_name,
            enable_thinking=start.enable_thinking,
            reasoning_effort=start.reasoning_effort,
            enable_context_manager=start.enable_context_manager,
            enable_prompt_caching=start.enable_prompt_caching,
            agent_config=start.agent_config,
            tool_context=dict(start.tool_context),
            checkpoint_id=start.checkpoint_id,
            resume_token=start.resume_token,
            stop_event=start.stop_event,
        )
