from __future__ import annotations

from typing import Optional, Dict, Any, Tuple

from core.application.event_bus import record_event
from core.domains.knowledge import events as knowledge_events
from core.domains.knowledge.ports.knowledge_repository import KnowledgeRepository


class CreateKnowledgeEntryUseCase:
    def __init__(self, repository: KnowledgeRepository) -> None:
        self._repository = repository

    async def execute(
        self,
        *,
        entry_id: str,
        folder_id: str,
        account_id: str,
        filename: str,
        storage_path: str,
        file_size: int,
        mime_type: str,
        summary: str,
        file_id: Optional[str],
        idempotency_key: Optional[str],
        user_id: Optional[str],
        source_type: str = "file",
    ) -> Tuple[str, bool]:
        payload: Dict[str, Any] = {
            "entry_id": entry_id,
            "folder_id": folder_id,
            "filename": filename,
            "file_size": file_size,
            "mime_type": mime_type,
            "storage_path": storage_path,
            "file_id": file_id,
            "source_type": source_type,
        }

        try:
            resolved_entry_id, duplicate = await self._repository.create_entry_with_link(
                entry_id=entry_id,
                folder_id=folder_id,
                account_id=account_id,
                filename=filename,
                storage_path=storage_path,
                file_size=file_size,
                mime_type=mime_type,
                summary=summary,
                file_id=file_id,
                idempotency_key=idempotency_key,
            )
        except Exception as exc:
            failure_payload = dict(payload)
            failure_payload["error"] = str(exc)
            event = knowledge_events.knowledge_event(
                event_type=knowledge_events.INGESTION_FAILED,
                source_id=entry_id,
                tenant_id=account_id,
                actor_id=user_id,
                payload=failure_payload,
            )
            await record_event(event)
            raise

        if duplicate:
            return resolved_entry_id, True

        success_payload = dict(payload)
        success_payload["entry_id"] = resolved_entry_id

        registered_event = knowledge_events.knowledge_event(
            event_type=knowledge_events.SOURCE_REGISTERED,
            source_id=resolved_entry_id,
            tenant_id=account_id,
            actor_id=user_id,
            payload=success_payload,
        )
        await record_event(registered_event)

        ingested_event = knowledge_events.knowledge_event(
            event_type=knowledge_events.INGESTION_SUCCEEDED,
            source_id=resolved_entry_id,
            tenant_id=account_id,
            actor_id=user_id,
            payload=success_payload,
        )
        await record_event(ingested_event)

        return resolved_entry_id, False
