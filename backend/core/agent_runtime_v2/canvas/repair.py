from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from core.application.services.canvas_native_repair_service import CanvasNativeRepairService


@dataclass(slots=True)
class CanvasRepairEngineV2:
    repair_service: CanvasNativeRepairService

    def __init__(self, repair_service: CanvasNativeRepairService | None = None) -> None:
        self.repair_service = repair_service or CanvasNativeRepairService()

    async def repair(self, *, state: dict[str, Any], tool_context: dict[str, Any]) -> dict[str, Any]:
        return await self.repair_service.repair(state=state, tool_context=tool_context)
