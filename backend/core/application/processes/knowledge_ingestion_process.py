from __future__ import annotations

from core.application.processes.base import ProcessManager
from core.domains.knowledge import events as knowledge_events
from core.domains.shared.events import DomainEvent
from core.utils.logger import logger


class KnowledgeIngestionProcess(ProcessManager):
    async def handle(self, event: DomainEvent) -> None:
        if event.event_type not in {
            knowledge_events.SOURCE_REGISTERED,
            knowledge_events.INGESTION_QUEUED,
            knowledge_events.INGESTION_SUCCEEDED,
            knowledge_events.INGESTION_FAILED,
        }:
            return
        logger.debug(
            "knowledge_ingestion_process_event",
            event_type=event.event_type,
            source_id=event.aggregate_id,
        )
