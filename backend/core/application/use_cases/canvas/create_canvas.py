from __future__ import annotations

from typing import Optional, Dict, Any

from core.domains.canvas.model import Canvas
from core.domains.canvas.ports.canvas_repository import CanvasRepository
from core.domains.canvas import events as canvas_events
from core.application.event_bus import record_event


class CreateCanvasUseCase:
    def __init__(self, repository: CanvasRepository) -> None:
        self._repository = repository

    async def execute(
        self,
        *,
        canvas_id: str,
        workspace_id: str,
        title: str,
        version: str,
        doc: Dict[str, Any],
        actor_id: Optional[str] = None,
        event_payload: Optional[Dict[str, Any]] = None,
    ) -> Canvas:
        canvas = Canvas(
            id=canvas_id,
            workspace_id=workspace_id,
            title=title,
            version=version,
            doc=doc,
        )
        canvas.validate()
        saved = await self._repository.save(canvas)
        payload: Dict[str, Any] = {
            "canvas_id": saved.id,
            "title": saved.title,
            "version": saved.version,
        }
        if isinstance(doc, dict):
            if doc.get("serverVersion") is not None:
                payload.setdefault("server_version", doc.get("serverVersion"))
            if doc.get("createdAt") is not None:
                payload.setdefault("created_at", doc.get("createdAt"))
        if event_payload:
            payload.update({k: v for k, v in event_payload.items() if v is not None})
        payload = {k: v for k, v in payload.items() if v is not None}
        event = canvas_events.canvas_created(
            canvas_id=saved.id,
            tenant_id=workspace_id,
            actor_id=actor_id,
            payload=payload,
        )
        await record_event(event)
        return saved
