from __future__ import annotations

from typing import Optional, Dict, Any

from core.application.event_bus import record_event
from core.domains.canvas import events as canvas_events
from core.domains.canvas.model import Canvas
from core.domains.canvas.ports.canvas_repository import CanvasRepository


class RestoreCanvasUseCase:
    def __init__(self, repository: CanvasRepository) -> None:
        self._repository = repository

    async def execute(
        self,
        *,
        canvas_id: str,
        workspace_id: str,
        actor_id: Optional[str] = None,
        event_payload: Optional[Dict[str, Any]] = None,
    ) -> Canvas:
        restored = await self._repository.restore(
            canvas_id=canvas_id, workspace_id=workspace_id
        )
        payload: Dict[str, Any] = {"canvas_id": canvas_id}
        if restored.doc and isinstance(restored.doc, dict):
            payload.setdefault("title", restored.doc.get("title") or restored.title)
            payload.setdefault("version", restored.doc.get("version") or restored.version)
        if event_payload:
            payload.update({k: v for k, v in event_payload.items() if v is not None})
        payload = {k: v for k, v in payload.items() if v is not None}
        event = canvas_events.canvas_restored(
            canvas_id=canvas_id,
            tenant_id=workspace_id,
            actor_id=actor_id,
            payload=payload,
        )
        await record_event(event)
        return restored
