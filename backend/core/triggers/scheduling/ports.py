from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Protocol


@dataclass(slots=True)
class ScheduleRegistration:
    schedule_id: str
    provider: str
    metadata: Dict[str, Any]


class ScheduleProviderPort(Protocol):
    async def create_schedule(
        self,
        *,
        trigger_id: str,
        destination_url: str,
        cron_expression: str,
        timezone: str,
        payload: Dict[str, Any],
    ) -> ScheduleRegistration: ...

    async def pause_schedule(self, *, schedule_id: str) -> None: ...

    async def resume_schedule(self, *, schedule_id: str) -> None: ...

    async def delete_schedule(self, *, schedule_id: str) -> None: ...
