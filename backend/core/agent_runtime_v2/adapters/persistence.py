from __future__ import annotations

from dataclasses import dataclass

from core.langgraph_engine.persistence.event_persister import EventPersister

from ..contracts import AgentEventV2, RuntimeContextV2
from .legacy_events import AgentEventLegacyProjectionV2


@dataclass(slots=True)
class RuntimePersistenceProjectionV2:
    event_persister: EventPersister

    async def persist(self, *, context: RuntimeContextV2, event: AgentEventV2) -> None:
        engine_event = AgentEventLegacyProjectionV2.to_engine_event(event)
        state_snapshot = AgentEventLegacyProjectionV2.build_persistence_state_snapshot(context, event)
        await self.event_persister.persist(state_snapshot, engine_event)  # type: ignore[arg-type]
