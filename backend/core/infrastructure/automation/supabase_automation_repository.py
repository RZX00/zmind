from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple
import json

from core.domains.automation.model import (
    Automation,
    AutomationBinding,
    AutomationRun,
    AutomationRunAttempt,
    ProviderEvent,
)
from core.domains.automation.ports.automation_repository import AutomationRepository
from core.utils.errors import is_unique_violation

if TYPE_CHECKING:
    from core.services.supabase import DBConnection


class SupabaseAutomationRepository(AutomationRepository):
    def __init__(self, db: Optional["DBConnection"] = None) -> None:
        if db is not None:
            self._db = db
            return

        from core.services.supabase import DBConnection as _DBConnection

        self._db = _DBConnection()

    @staticmethod
    def _parse_datetime(value: Any) -> datetime:
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value
        if isinstance(value, str) and value:
            normalized = value.replace("Z", "+00:00")
            try:
                parsed = datetime.fromisoformat(normalized)
            except Exception:
                return datetime.now(timezone.utc)
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed
        return datetime.now(timezone.utc)

    @classmethod
    def _parse_optional_datetime(cls, value: Any) -> Optional[datetime]:
        if value in (None, ""):
            return None
        return cls._parse_datetime(value)

    @staticmethod
    def _to_dict(value: Any) -> Dict[str, Any]:
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except Exception:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    @staticmethod
    def _to_text(value: Any) -> Optional[str]:
        if value is None:
            return None
        text = str(value)
        return text if text else None

    @classmethod
    def _row_to_automation(cls, row: Dict[str, Any]) -> Automation:
        trigger_type = row.get("trigger_type")
        if trigger_type not in ("schedule", "event"):
            trigger_type = "event"

        route_type = row.get("route_type")
        if route_type not in ("agent", "workflow"):
            route_type = "agent"

        return Automation(
            id=str(row.get("automation_id") or ""),
            account_id=str(row.get("account_id") or ""),
            agent_id=cls._to_text(row.get("agent_id")),
            name=row.get("name") or "",
            description=row.get("description"),
            trigger_type=trigger_type,
            provider=row.get("provider"),
            provider_binding_key=row.get("provider_binding_key"),
            route_type=route_type,
            route_ref=row.get("route_ref"),
            is_active=bool(row.get("is_active", True)),
            config=cls._to_dict(row.get("config")),
            created_by=cls._to_text(row.get("created_by")),
            created_at=cls._parse_datetime(row.get("created_at")),
            updated_at=cls._parse_datetime(row.get("updated_at")),
        )

    @classmethod
    def _row_to_binding(cls, row: Dict[str, Any]) -> AutomationBinding:
        match_strategy = row.get("match_strategy")
        if match_strategy not in ("exact", "prefix", "jsonpath"):
            match_strategy = "exact"

        return AutomationBinding(
            id=str(row.get("binding_id") or ""),
            automation_id=str(row.get("automation_id") or ""),
            account_id=str(row.get("account_id") or ""),
            provider=row.get("provider") or "",
            match_strategy=match_strategy,
            match_value=cls._to_dict(row.get("match_value")),
            is_active=bool(row.get("is_active", True)),
            created_at=cls._parse_datetime(row.get("created_at")),
            updated_at=cls._parse_datetime(row.get("updated_at")),
        )

    @classmethod
    def _row_to_provider_event(cls, row: Dict[str, Any]) -> ProviderEvent:
        processing_status = row.get("processing_status")
        if processing_status not in ("received", "dispatched", "ignored", "failed"):
            processing_status = "received"

        return ProviderEvent(
            id=str(row.get("provider_event_id") or ""),
            account_id=cls._to_text(row.get("account_id")),
            provider=row.get("provider") or "",
            external_event_id=row.get("external_event_id"),
            event_type=row.get("event_type"),
            signature_valid=bool(row.get("signature_valid", True)),
            dedupe_key=row.get("dedupe_key") or "",
            payload=cls._to_dict(row.get("payload")),
            headers=cls._to_dict(row.get("headers")),
            processing_status=processing_status,
            processing_error=row.get("processing_error"),
            dispatched_at=cls._parse_optional_datetime(row.get("dispatched_at")),
            received_at=cls._parse_datetime(row.get("received_at")),
            created_at=cls._parse_datetime(row.get("created_at")),
        )

    @classmethod
    def _row_to_run(cls, row: Dict[str, Any]) -> AutomationRun:
        status = row.get("status")
        if status not in ("queued", "running", "completed", "failed", "cancelled", "dead_lettered"):
            status = "queued"

        trigger_source = row.get("trigger_source")
        if trigger_source not in ("schedule", "event", "manual"):
            trigger_source = "manual"

        return AutomationRun(
            id=str(row.get("run_id") or ""),
            automation_id=str(row.get("automation_id") or ""),
            account_id=str(row.get("account_id") or ""),
            provider_event_id=cls._to_text(row.get("provider_event_id")),
            trigger_source=trigger_source,
            triggered_at=cls._parse_datetime(row.get("triggered_at")),
            status=status,
            retry_count=int(row.get("retry_count") or 0),
            max_retries=int(row.get("max_retries") or 0),
            external_run_key=row.get("external_run_key"),
            agent_run_id=cls._to_text(row.get("agent_run_id")),
            error_code=row.get("error_code"),
            error_message=row.get("error_message"),
            metadata=cls._to_dict(row.get("metadata")),
            created_at=cls._parse_datetime(row.get("created_at")),
            updated_at=cls._parse_datetime(row.get("updated_at")),
        )

    @classmethod
    def _row_to_run_attempt(cls, row: Dict[str, Any]) -> AutomationRunAttempt:
        status = row.get("status")
        if status not in ("running", "completed", "failed"):
            status = "running"

        return AutomationRunAttempt(
            id=str(row.get("attempt_id") or ""),
            run_id=str(row.get("run_id") or ""),
            attempt_no=int(row.get("attempt_no") or 1),
            status=status,
            started_at=cls._parse_datetime(row.get("started_at")),
            ended_at=cls._parse_optional_datetime(row.get("ended_at")),
            error_code=row.get("error_code"),
            error_message=row.get("error_message"),
            metadata=cls._to_dict(row.get("metadata")),
            created_at=cls._parse_datetime(row.get("created_at")),
        )

    async def create_automation(
        self,
        *,
        account_id: str,
        agent_id: Optional[str],
        name: str,
        description: Optional[str],
        trigger_type: str,
        provider: Optional[str],
        provider_binding_key: Optional[str],
        route_type: str,
        route_ref: Optional[str],
        is_active: bool,
        config: Dict[str, Any],
        created_by: Optional[str],
    ) -> Automation:
        client = await self._db.client
        payload: Dict[str, Any] = {
            "account_id": account_id,
            "agent_id": agent_id,
            "name": name,
            "description": description,
            "trigger_type": trigger_type,
            "provider": provider,
            "provider_binding_key": provider_binding_key,
            "route_type": route_type,
            "route_ref": route_ref,
            "is_active": is_active,
            "config": config or {},
            "created_by": created_by,
        }
        res = await client.table("automations").insert(payload).execute()
        if res.data:
            return self._row_to_automation(res.data[0])
        raise RuntimeError("automations insert failed")

    async def get_automation(
        self,
        automation_id: str,
        *,
        account_id: Optional[str] = None,
    ) -> Optional[Automation]:
        client = await self._db.client
        query = client.table("automations").select("*").eq("automation_id", automation_id).limit(1)
        if account_id:
            query = query.eq("account_id", account_id)
        res = await query.execute()
        if not res.data:
            return None
        return self._row_to_automation(res.data[0])

    async def list_automations(
        self,
        *,
        account_id: str,
        is_active: Optional[bool] = None,
        trigger_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Automation]:
        client = await self._db.client
        query = client.table("automations").select("*").eq("account_id", account_id)
        if is_active is not None:
            query = query.eq("is_active", is_active)
        if trigger_type:
            query = query.eq("trigger_type", trigger_type)
        query = query.order("created_at", desc=True).range(offset, max(offset, offset + max(limit, 1) - 1))
        res = await query.execute()
        return [self._row_to_automation(row) for row in (res.data or [])]

    async def update_automation(
        self,
        *,
        automation_id: str,
        account_id: str,
        patch: Dict[str, Any],
    ) -> Optional[Automation]:
        if not patch:
            return await self.get_automation(automation_id, account_id=account_id)

        allowed_fields = {
            "agent_id",
            "name",
            "description",
            "trigger_type",
            "provider",
            "provider_binding_key",
            "route_type",
            "route_ref",
            "is_active",
            "config",
        }
        update_data = {k: v for k, v in patch.items() if k in allowed_fields}
        if not update_data:
            return await self.get_automation(automation_id, account_id=account_id)

        client = await self._db.client
        res = (
            await client.table("automations")
            .update(update_data)
            .eq("automation_id", automation_id)
            .eq("account_id", account_id)
            .execute()
        )
        if not res.data:
            return None
        return self._row_to_automation(res.data[0])

    async def delete_automation(self, *, automation_id: str, account_id: str) -> bool:
        client = await self._db.client
        res = (
            await client.table("automations")
            .delete()
            .eq("automation_id", automation_id)
            .eq("account_id", account_id)
            .execute()
        )
        return bool(res.data)

    async def create_binding(
        self,
        *,
        automation_id: str,
        account_id: str,
        provider: str,
        match_strategy: str,
        match_value: Dict[str, Any],
        is_active: bool = True,
    ) -> AutomationBinding:
        client = await self._db.client
        payload: Dict[str, Any] = {
            "automation_id": automation_id,
            "account_id": account_id,
            "provider": provider,
            "match_strategy": match_strategy,
            "match_value": match_value or {},
            "is_active": is_active,
        }
        res = await client.table("automation_bindings").insert(payload).execute()
        if res.data:
            return self._row_to_binding(res.data[0])
        raise RuntimeError("automation_bindings insert failed")

    async def list_bindings(
        self,
        *,
        automation_id: str,
        only_active: bool = False,
    ) -> List[AutomationBinding]:
        client = await self._db.client
        query = client.table("automation_bindings").select("*").eq("automation_id", automation_id)
        if only_active:
            query = query.eq("is_active", True)
        res = await query.order("created_at", desc=False).execute()
        return [self._row_to_binding(row) for row in (res.data or [])]

    async def upsert_provider_event(
        self,
        *,
        provider: str,
        dedupe_key: str,
        payload: Dict[str, Any],
        headers: Dict[str, Any],
        external_event_id: Optional[str],
        event_type: Optional[str],
        account_id: Optional[str],
        signature_valid: bool,
    ) -> Tuple[ProviderEvent, bool]:
        client = await self._db.client

        existing = (
            await client.table("provider_events")
            .select("*")
            .eq("dedupe_key", dedupe_key)
            .limit(1)
            .execute()
        )
        if existing.data:
            return self._row_to_provider_event(existing.data[0]), True

        insert_payload = {
            "provider": provider,
            "dedupe_key": dedupe_key,
            "payload": payload or {},
            "headers": headers or {},
            "external_event_id": external_event_id,
            "event_type": event_type,
            "account_id": account_id,
            "signature_valid": signature_valid,
        }

        try:
            res = await client.table("provider_events").insert(insert_payload).execute()
        except Exception as exc:
            if is_unique_violation(exc):
                winner = (
                    await client.table("provider_events")
                    .select("*")
                    .eq("dedupe_key", dedupe_key)
                    .limit(1)
                    .execute()
                )
                if winner.data:
                    return self._row_to_provider_event(winner.data[0]), True
            raise

        if res.data:
            return self._row_to_provider_event(res.data[0]), False

        winner = (
            await client.table("provider_events")
            .select("*")
            .eq("dedupe_key", dedupe_key)
            .limit(1)
            .execute()
        )
        if winner.data:
            return self._row_to_provider_event(winner.data[0]), True

        raise RuntimeError("provider_events insert failed")

    async def get_provider_event(self, provider_event_id: str) -> Optional[ProviderEvent]:
        client = await self._db.client
        res = (
            await client.table("provider_events")
            .select("*")
            .eq("provider_event_id", provider_event_id)
            .limit(1)
            .execute()
        )
        if not res.data:
            return None
        return self._row_to_provider_event(res.data[0])

    async def list_active_event_automations(
        self,
        *,
        provider: str,
        provider_binding_key: Optional[str],
    ) -> List[Automation]:
        client = await self._db.client
        query = (
            client.table("automations")
            .select("*")
            .eq("trigger_type", "event")
            .eq("is_active", True)
            .eq("provider", provider)
        )
        if provider_binding_key:
            # Prefer exact binding match and then include provider-level fallbacks.
            exact_res = await query.eq("provider_binding_key", provider_binding_key).execute()
            exact_rows = exact_res.data or []
            if exact_rows:
                return [self._row_to_automation(row) for row in exact_rows]

            fallback_res = (
                await client.table("automations")
                .select("*")
                .eq("trigger_type", "event")
                .eq("is_active", True)
                .eq("provider", provider)
                .is_("provider_binding_key", "null")
                .execute()
            )
            return [self._row_to_automation(row) for row in (fallback_res.data or [])]

        res = await query.execute()
        return [self._row_to_automation(row) for row in (res.data or [])]

    async def list_active_schedule_automations(
        self,
        *,
        account_id: Optional[str] = None,
    ) -> List[Automation]:
        client = await self._db.client
        query = (
            client.table("automations")
            .select("*")
            .eq("trigger_type", "schedule")
            .eq("is_active", True)
        )
        if account_id:
            query = query.eq("account_id", account_id)
        res = await query.execute()
        return [self._row_to_automation(row) for row in (res.data or [])]

    async def update_provider_event_status(
        self,
        *,
        provider_event_id: str,
        status: str,
        processing_error: Optional[str] = None,
    ) -> Optional[ProviderEvent]:
        client = await self._db.client
        payload: Dict[str, Any] = {"processing_status": status}
        if processing_error is not None:
            payload["processing_error"] = processing_error
        if status == "dispatched":
            payload["dispatched_at"] = datetime.now(timezone.utc).isoformat()

        res = (
            await client.table("provider_events")
            .update(payload)
            .eq("provider_event_id", provider_event_id)
            .execute()
        )
        if not res.data:
            return None
        return self._row_to_provider_event(res.data[0])

    async def create_run(
        self,
        *,
        automation_id: str,
        account_id: str,
        trigger_source: str,
        provider_event_id: Optional[str],
        external_run_key: Optional[str],
        status: str,
        retry_count: int,
        max_retries: int,
        metadata: Dict[str, Any],
    ) -> Tuple[AutomationRun, bool]:
        client = await self._db.client

        existing = await self._find_existing_run(
            automation_id=automation_id,
            provider_event_id=provider_event_id,
            external_run_key=external_run_key,
        )
        if existing:
            return existing, True

        payload = {
            "automation_id": automation_id,
            "account_id": account_id,
            "trigger_source": trigger_source,
            "provider_event_id": provider_event_id,
            "external_run_key": external_run_key,
            "status": status,
            "retry_count": retry_count,
            "max_retries": max_retries,
            "metadata": metadata or {},
        }

        try:
            res = await client.table("automation_runs").insert(payload).execute()
        except Exception as exc:
            if is_unique_violation(exc):
                winner = await self._find_existing_run(
                    automation_id=automation_id,
                    provider_event_id=provider_event_id,
                    external_run_key=external_run_key,
                )
                if winner:
                    return winner, True
            raise

        if res.data:
            return self._row_to_run(res.data[0]), False

        winner = await self._find_existing_run(
            automation_id=automation_id,
            provider_event_id=provider_event_id,
            external_run_key=external_run_key,
        )
        if winner:
            return winner, True

        raise RuntimeError("automation_runs insert failed")

    async def _find_existing_run(
        self,
        *,
        automation_id: str,
        provider_event_id: Optional[str],
        external_run_key: Optional[str],
    ) -> Optional[AutomationRun]:
        client = await self._db.client

        if provider_event_id:
            query = (
                client.table("automation_runs")
                .select("*")
                .eq("automation_id", automation_id)
                .eq("provider_event_id", provider_event_id)
                .limit(1)
            )
            res = await query.execute()
            if res.data:
                return self._row_to_run(res.data[0])

        if external_run_key:
            query = (
                client.table("automation_runs")
                .select("*")
                .eq("automation_id", automation_id)
                .eq("external_run_key", external_run_key)
                .limit(1)
            )
            res = await query.execute()
            if res.data:
                return self._row_to_run(res.data[0])

        return None

    async def get_run(self, run_id: str) -> Optional[AutomationRun]:
        client = await self._db.client
        res = await client.table("automation_runs").select("*").eq("run_id", run_id).limit(1).execute()
        if not res.data:
            return None
        return self._row_to_run(res.data[0])

    async def get_latest_run_for_automation(
        self,
        *,
        automation_id: str,
        trigger_source: Optional[str] = None,
    ) -> Optional[AutomationRun]:
        client = await self._db.client
        query = (
            client.table("automation_runs")
            .select("*")
            .eq("automation_id", automation_id)
            .order("triggered_at", desc=True)
            .limit(1)
        )
        if trigger_source:
            query = query.eq("trigger_source", trigger_source)
        res = await query.execute()
        if not res.data:
            return None
        return self._row_to_run(res.data[0])

    async def list_runs(
        self,
        *,
        automation_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> List[AutomationRun]:
        client = await self._db.client
        res = (
            await client.table("automation_runs")
            .select("*")
            .eq("automation_id", automation_id)
            .order("triggered_at", desc=True)
            .range(offset, max(offset, offset + max(limit, 1) - 1))
            .execute()
        )
        return [self._row_to_run(row) for row in (res.data or [])]

    async def update_run_status(
        self,
        *,
        run_id: str,
        status: str,
        agent_run_id: Optional[str] = None,
        error_code: Optional[str] = None,
        error_message: Optional[str] = None,
        retry_count: Optional[int] = None,
    ) -> Optional[AutomationRun]:
        client = await self._db.client
        payload: Dict[str, Any] = {"status": status}
        if agent_run_id is not None:
            payload["agent_run_id"] = agent_run_id
        if error_code is not None:
            payload["error_code"] = error_code
        if error_message is not None:
            payload["error_message"] = error_message
        if retry_count is not None:
            payload["retry_count"] = retry_count

        res = await client.table("automation_runs").update(payload).eq("run_id", run_id).execute()
        if not res.data:
            return None
        return self._row_to_run(res.data[0])

    async def create_run_attempt(
        self,
        *,
        run_id: str,
        attempt_no: int,
        status: str,
        error_code: Optional[str],
        error_message: Optional[str],
        metadata: Dict[str, Any],
    ) -> Tuple[AutomationRunAttempt, bool]:
        client = await self._db.client

        existing = (
            await client.table("automation_run_attempts")
            .select("*")
            .eq("run_id", run_id)
            .eq("attempt_no", attempt_no)
            .limit(1)
            .execute()
        )
        if existing.data:
            return self._row_to_run_attempt(existing.data[0]), True

        payload: Dict[str, Any] = {
            "run_id": run_id,
            "attempt_no": attempt_no,
            "status": status,
            "error_code": error_code,
            "error_message": error_message,
            "metadata": metadata or {},
        }
        if status in ("completed", "failed"):
            payload["ended_at"] = datetime.now(timezone.utc).isoformat()

        try:
            res = await client.table("automation_run_attempts").insert(payload).execute()
        except Exception as exc:
            if is_unique_violation(exc):
                winner = (
                    await client.table("automation_run_attempts")
                    .select("*")
                    .eq("run_id", run_id)
                    .eq("attempt_no", attempt_no)
                    .limit(1)
                    .execute()
                )
                if winner.data:
                    return self._row_to_run_attempt(winner.data[0]), True
            raise

        if res.data:
            return self._row_to_run_attempt(res.data[0]), False

        winner = (
            await client.table("automation_run_attempts")
            .select("*")
            .eq("run_id", run_id)
            .eq("attempt_no", attempt_no)
            .limit(1)
            .execute()
        )
        if winner.data:
            return self._row_to_run_attempt(winner.data[0]), True

        raise RuntimeError("automation_run_attempts insert failed")

    async def update_run_attempt_status(
        self,
        *,
        attempt_id: str,
        status: str,
        error_code: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> Optional[AutomationRunAttempt]:
        client = await self._db.client
        payload: Dict[str, Any] = {
            "status": status,
        }
        if status in ("completed", "failed"):
            payload["ended_at"] = datetime.now(timezone.utc).isoformat()
        if error_code is not None:
            payload["error_code"] = error_code
        if error_message is not None:
            payload["error_message"] = error_message

        res = (
            await client.table("automation_run_attempts")
            .update(payload)
            .eq("attempt_id", attempt_id)
            .execute()
        )
        if not res.data:
            return None
        return self._row_to_run_attempt(res.data[0])

    async def list_run_attempts(self, *, run_id: str) -> List[AutomationRunAttempt]:
        client = await self._db.client
        res = (
            await client.table("automation_run_attempts")
            .select("*")
            .eq("run_id", run_id)
            .order("attempt_no", desc=False)
            .execute()
        )
        return [self._row_to_run_attempt(row) for row in (res.data or [])]
