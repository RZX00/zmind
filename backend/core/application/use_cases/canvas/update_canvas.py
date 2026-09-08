from __future__ import annotations

from typing import Optional, Dict, Any

from core.domains.canvas.model import Canvas, merge_updates
from core.domains.canvas.ports.canvas_repository import CanvasRepository
from core.domains.canvas import events as canvas_events
from core.application.event_bus import record_event


class UpdateCanvasUseCase:
    def __init__(self, repository: CanvasRepository) -> None:
        self._repository = repository

    async def execute(
        self,
        *,
        canvas: Canvas,
        updates: Dict[str, Any],
        actor_id: Optional[str] = None,
        event_payload: Optional[Dict[str, Any]] = None,
        persist: bool = True,
    ) -> Canvas:
        merged_doc = merge_updates(canvas.doc, updates)
        updated = Canvas(
            id=canvas.id,
            workspace_id=canvas.workspace_id,
            title=updates.get("title") or canvas.title,
            version=updates.get("version") or canvas.version,
            doc=merged_doc,
        )
        updated.validate()
        saved = await self._repository.update(updated) if persist else updated
        payload: Dict[str, Any] = {
            "canvas_id": saved.id,
            "title": saved.title,
            "version": saved.version,
        }
        if isinstance(updated.doc, dict):
            if updated.doc.get("serverVersion") is not None:
                payload.setdefault("server_version", updated.doc.get("serverVersion"))
            if updated.doc.get("updatedAt") is not None:
                payload.setdefault("updated_at", updated.doc.get("updatedAt"))
        if event_payload:
            payload.update({k: v for k, v in event_payload.items() if v is not None})
        payload = {k: v for k, v in payload.items() if v is not None}
        event = canvas_events.canvas_updated(
            canvas_id=saved.id,
            tenant_id=saved.workspace_id,
            actor_id=actor_id,
            payload=payload,
        )
        await record_event(event)
        return saved
