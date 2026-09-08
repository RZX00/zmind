from __future__ import annotations

from typing import Optional, Dict, Any

from core.application.event_bus import record_event
from core.domains.canvas import events as canvas_events
from core.domains.canvas.model import CanvasVersion
from core.domains.canvas.ports.canvas_version_repository import CanvasVersionRepository


class SaveCanvasVersionUseCase:
    def __init__(self, repository: CanvasVersionRepository) -> None:
        self._repository = repository

    async def execute(
        self,
        *,
        canvas_id: str,
        version_doc: Dict[str, Any],
        is_auto_save: bool,
        description: Optional[str] = None,
        tenant_id: Optional[str] = None,
        actor_id: Optional[str] = None,
        event_payload: Optional[Dict[str, Any]] = None,
    ) -> CanvasVersion:
        saved = await self._repository.save(
            canvas_id=canvas_id,
            version_doc=version_doc,
            is_auto_save=is_auto_save,
            description=description,
        )
        payload: Dict[str, Any] = {
            "canvas_id": saved.canvas_id,
            "version_id": saved.id,
            "is_auto_save": saved.is_auto_save,
        }
        if saved.description:
            payload["description"] = saved.description
        if event_payload:
            payload.update({k: v for k, v in event_payload.items() if v is not None})
        payload = {k: v for k, v in payload.items() if v is not None}
        event = canvas_events.canvas_version_saved(
            canvas_id=saved.canvas_id,
            tenant_id=tenant_id,
            actor_id=actor_id,
            payload=payload,
        )
        await record_event(event)
        return saved
